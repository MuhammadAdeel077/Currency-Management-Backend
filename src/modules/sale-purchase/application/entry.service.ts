import {
  Injectable,
  NotFoundException,
  BadRequestException,
  Inject,
  Logger,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, EntityManager, Repository } from 'typeorm';
import { PurchaseEntryEntity } from '../domain/entity/purchase_entries.entity';
import { SellingEntryEntity } from '../domain/entity/selling_entries.entity';
import { CustomerAccountEntity } from '../../account/domain/entity/customer-account.entity';
import { BankAccountEntity } from '../../account/domain/entity/bank-account.entity';
import { CreatePurchaseDto } from '../domain/dto/purchase-create.dto';
import { CreateSellingDto } from '../domain/dto/selling-create.dto';
import { UpdatePurchaseDto } from '../domain/dto/purchase-update.dto';
import { UpdateSellingDto } from '../domain/dto/selling-update.dto';
import { AddCurrencyEntity } from '../../account/domain/entity/currency.entity';
import { UserEntity } from '../../users/domain/entities/user.entity';
import { CurrencyRelationEntity } from '../domain/entity/currencyRelation.entity';
import { CurrencyPnlPreviewDto } from '../domain/dto/CurrencyPnlPreview.dto';
import { Cache, CACHE_MANAGER } from '@nestjs/cache-manager';
import { RedisService } from '../../../shared/modules/redis/redis.service';
import { CurrencyStockEntity } from '../../currency/domain/entities/currency-stock.entity';
import { CurrencyBalanceEntity } from '../../currency/domain/entities/currency-balance.entity';
import { CustomerCurrencyAccountEntity } from '../../currency/domain/entities/currencies-account.entity';
import { AccountBalanceEntity } from '../../journal/domain/entity/account-balance.entity';
import { AccountLedgerEntity } from '../../journal/domain/entity/account-ledger.entity';
import { GeneralLedgerService } from '../../journal/application/general-ledger.service';

@Injectable()
export class SalePurchaseService {
  private readonly logger = new Logger(SalePurchaseService.name);

  constructor(
    @Inject(CACHE_MANAGER) private cacheManager: Cache,
    @InjectRepository(PurchaseEntryEntity)
    private purchaseRepo: Repository<PurchaseEntryEntity>,

    @InjectRepository(SellingEntryEntity)
    private sellingRepo: Repository<SellingEntryEntity>,

    @InjectRepository(AddCurrencyEntity)
    private currencyRepo: Repository<AddCurrencyEntity>,

    @InjectRepository(CustomerAccountEntity)
    private customerRepo: Repository<CustomerAccountEntity>,

    @InjectRepository(BankAccountEntity)
    private bankRepo: Repository<BankAccountEntity>,

    @InjectRepository(CustomerCurrencyAccountEntity)
    private currencyAccountRepo: Repository<CustomerCurrencyAccountEntity>,

    @InjectRepository(UserEntity)
    private userRepo: Repository<UserEntity>,

    @InjectRepository(CurrencyRelationEntity)
    private readonly currency_relation: Repository<CurrencyRelationEntity>,

    @InjectRepository(AccountBalanceEntity)
    private readonly accountBalanceRepo: Repository<AccountBalanceEntity>,

    @InjectRepository(AccountLedgerEntity)
    private readonly accountLedgerRepo: Repository<AccountLedgerEntity>,

    @InjectRepository(CurrencyBalanceEntity)
    private readonly currencyBalanceRepo: Repository<CurrencyBalanceEntity>,

    private readonly dataSource: DataSource,

    private readonly redisService: RedisService,

    private readonly generalLedgerService: GeneralLedgerService,
  ) {}

  /**
   * Clear currency ledger cache for a specific currency
   * This should be called whenever a purchase or selling entry is created/updated
   */
  private async clearCurrencyLedgerCache(
    adminId: string,
    currencyId: string,
  ): Promise<void> {
    try {
      const redis = this.redisService.getClient();
      // Clear all cache keys for this currency ledger (all pages and date ranges)
      const pattern = `currencyLedger:${adminId}:${currencyId}:*`;
      const keys = await redis.keys(pattern);
      if (keys && keys.length > 0) {
        await redis.del(...keys);
        this.logger.debug(`🗑️ Cleared ${keys.length} currency ledger cache keys for currency ${currencyId}`);
      }
    } catch (error) {
      this.logger.error('Error clearing currency ledger cache:', error);
    }
  }

  /**
   * Clear account ledger cache for a specific account
   * This should be called whenever any transaction affects an account
   */
  private async clearAccountLedgerCache(
    adminId: string,
    accountId: string,
  ): Promise<void> {
    try {
      const redis = this.redisService.getClient();
      // Clear all cache keys for this account ledger (all pages and date ranges)
      const pattern = `accountLedger:${adminId}:${accountId}:*`;
      const keys = await redis.keys(pattern);
      if (keys && keys.length > 0) {
        await redis.del(...keys);
        this.logger.debug(`🗑️ Cleared ${keys.length} account ledger cache keys for account ${accountId}`);
      }
    } catch (error) {
      this.logger.error('Error clearing account ledger cache:', error);
    }
  }

  private async updateCurrencyStock(
    manager: EntityManager,
    adminId: string,
    currencyId: string,
  ) {
    const balances = await manager
      .createQueryBuilder(CurrencyRelationEntity, 'cr')
      .select('SUM(cr.balance)', 'totalCurrency')
      .addSelect('SUM(cr.balancePkr)', 'totalPkr')
      .where('cr.currencyId = :currencyId', { currencyId })
      .andWhere('cr.adminId = :adminId', { adminId })
      .getRawOne();

    const totalCurrency = +balances?.totalCurrency || 0;
    const totalPkr = +balances?.totalPkr || 0;

    const avgRateResult = await manager
      .createQueryBuilder(SellingEntryEntity, 's')
      .select('AVG(s.rate)', 'avgRate')
      .where('s.adminId = :adminId', { adminId })
      .andWhere('s.fromCurrencyId = :currencyId', { currencyId })
      .getRawOne();

    const rate = +avgRateResult?.avgRate || 0;

    const existing = await manager.findOne(CurrencyStockEntity, {
      where: { adminId, currencyId },
    });

    if (existing) {
      await manager.update(CurrencyStockEntity, { id: existing.id }, {
        stockAmountPkr: totalPkr,
        currencyAmount: totalCurrency,
        rate,
      });
    } else {
      const entity = manager.create(CurrencyStockEntity, {
        adminId,
        currencyId,
        stockAmountPkr: totalPkr,
        currencyAmount: totalCurrency,
        rate,
      });
      await manager.save(entity);
    }

    return { totalPkr, totalCurrency, rate };
  }

  /**
   * Update or create currency balance record
   * Maintains one record per currency per admin with average rate from sales and purchases
   */
  private async updateCurrencyBalance(
    manager: EntityManager,
    adminId: string,
    currencyId: string,
  ) {
    try {
      // Get total from currency relations (this is the current balance)
      const balances = await manager
        .createQueryBuilder(CurrencyRelationEntity, 'cr')
        .select('SUM(cr.balance)', 'totalCurrency')
        .addSelect('SUM(cr.balancePkr)', 'totalPkr')
        .where('cr.currencyId = :currencyId', { currencyId })
        .andWhere('cr.adminId = :adminId', { adminId })
        .getRawOne();

      const balanceCurrency = +balances?.totalCurrency || 0;
      const balancePkr = +balances?.totalPkr || 0;

      // Get average rate from sales
      const salesAvg = await manager
        .createQueryBuilder(SellingEntryEntity, 's')
        .select('AVG(s.rate)', 'avgRate')
        .addSelect('COUNT(s.id)', 'count')
        .where('s.adminId = :adminId', { adminId })
        .andWhere('s.fromCurrencyId = :currencyId', { currencyId })
        .getRawOne();

      // Get average rate from purchases
      const purchaseAvg = await manager
        .createQueryBuilder(PurchaseEntryEntity, 'p')
        .select('AVG(p.rate)', 'avgRate')
        .addSelect('COUNT(p.id)', 'count')
        .where('p.adminId = :adminId', { adminId })
        .andWhere('p.currencyDrId = :currencyId', { currencyId })
        .getRawOne();

      const salesRate = +salesAvg?.avgRate || 0;
      const salesCount = +salesAvg?.count || 0;
      const purchaseRate = +purchaseAvg?.avgRate || 0;
      const purchaseCount = +purchaseAvg?.count || 0;

      // Calculate weighted average rate
      let avgRate = 0;
      if (salesCount + purchaseCount > 0) {
        avgRate = ((salesRate * salesCount) + (purchaseRate * purchaseCount)) / (salesCount + purchaseCount);
      }

      // Find existing record or create new one
      const existing = await manager.findOne(CurrencyBalanceEntity, {
        where: { adminId, currencyId },
      });

      if (existing) {
        // Update existing record
        await manager.update(
          CurrencyBalanceEntity,
          { id: existing.id },
          {
            balancePkr,
            balanceCurrency,
            avgRate: Math.round(avgRate * 100) / 100, // Round to 2 decimal places
            totalSales: salesCount,
            totalPurchases: purchaseCount,
          }
        );
      } else {
        // Create new record
        const newBalance = manager.create(CurrencyBalanceEntity, {
          adminId,
          currencyId,
          balancePkr,
          balanceCurrency,
          avgRate: Math.round(avgRate * 100) / 100,
          totalSales: salesCount,
          totalPurchases: purchaseCount,
        });
        await manager.save(newBalance);
      }

      return { balanceCurrency, balancePkr, avgRate };
    } catch (error) {
      this.logger.error(`Error updating currency balance: ${error.message}`);
      // Don't throw error, just log it to prevent transaction rollback
    }
  }

  async getCurrencyPnlPreview(adminId: string, dto: CurrencyPnlPreviewDto) {
    const { currencyId, amountCurrency, sellingRate } = dto;

    const balances = await this.currency_relation
      .createQueryBuilder('cr')
      .select('SUM(cr.balance)', 'totalCurrency')
      .addSelect('SUM(cr.balancePkr)', 'totalPkr')
      .where('cr.currencyId = :currencyId', { currencyId })
      .andWhere('cr.adminId = :adminId', { adminId })
      .getRawOne();

    const totalCurrency = +balances?.totalCurrency || 0;
    const totalPkr = +balances?.totalPkr || 0;

    if (totalCurrency <= 0) {
      throw new BadRequestException('No currency balance available');
    }

    if (amountCurrency > totalCurrency) {
      throw new BadRequestException('Insufficient currency balance');
    }

    const avgRate = totalPkr / totalCurrency;
    const costPkr = amountCurrency * avgRate;
    const salePkr = amountCurrency * sellingRate;
    const pnl = salePkr - costPkr;
    const margin = (pnl / costPkr) * 100;

    return {
      costPkr: +costPkr.toFixed(2),
      salePkr: +salePkr.toFixed(2),
      pnl: +pnl.toFixed(2),
      margin: +margin.toFixed(4),
    };
  }

  async getCurrencyData(
    adminId: string,
    id: string,
    code: 'sale' | 'purchase',
  ) {
    const cacheKey = `currency-dropdown:${adminId}:${id}:${code}`;
    console.log('🔍 Checking cache for key:', cacheKey);

    // Check Redis cache first
    const cached = await this.redisService.getValue<{
      totalPkr: number;
      totalCurrency: number;
      AvgRate: number;
      S_NO: string;
    }>(cacheKey);

    if (cached) {
      console.log('✅ Cache HIT – returning cached currency data');
      return cached;
    }

    console.log('❌ Cache MISS – fetching from DB');

    const [currency, balances, avgRateResult] = await Promise.all([
      this.currencyRepo.findOne({
        where: { id },
        select: ['id', 'code'],
      }),
      this.currency_relation
        .createQueryBuilder('cr')
        .select('SUM(cr.balance)', 'totalCurrency')
        .addSelect('SUM(cr.balancePkr)', 'totalPkr')
        .where('cr.currencyId = :currencyId', { currencyId: id })
        .andWhere('cr.adminId = :adminId', { adminId })
        .getRawOne(),
      this.sellingRepo
        .createQueryBuilder('s')
        .select('AVG(s.rate)', 'avgRate')
        .where('s.adminId = :adminId', { adminId })
        .getRawOne(),
    ]);

    if (!currency) {
      throw new BadRequestException('Currency Not Exists');
    }

    const totalCurrency = +balances?.totalCurrency || 0;
    const totalPkr = +balances?.totalPkr || 0;
    const AvgRate = +avgRateResult?.avgRate || 0;

    const prefix = code === 'sale' ? 'S' : 'P';

    const lastRecord =
      code === 'sale'
        ? await this.sellingRepo
            .createQueryBuilder('s')
            .select('s.saleNumber', 'number')
            .where('s.adminId = :adminId', { adminId })
            .orderBy('s.saleNumber', 'DESC')
            .limit(1)
            .getRawOne<{ number: number }>()
        : await this.purchaseRepo
            .createQueryBuilder('p')
            .select('p.purchaseNumber', 'number')
            .where('p.adminId = :adminId', { adminId })
            .orderBy('p.purchaseNumber', 'DESC')
            .limit(1)
            .getRawOne<{ number: number }>();

    const nextNumber = lastRecord?.number ? lastRecord.number + 1 : 1;

    const response = {
      totalPkr,
      totalCurrency,
      AvgRate,
      S_NO: `${currency.code}-${prefix}-${nextNumber}`,
    };

    // Cache in Redis for 30 seconds
    await this.redisService.setValue(cacheKey, response, 30);
    console.log('💾 Cache SET for key:', cacheKey);

    return response;
  }

  async updateCurrencyRelation(
    manager: EntityManager,
    params: {
      userId: string;
      adminId: string;
      currencyId: string;
      amountCurrency: number;
      amountPkr: number;
      type: 'PURCHASE' | 'SELL';
    },
  ) {
    const relation = await manager.findOne(CurrencyRelationEntity, {
      where: {
        userId: params.userId,
        adminId: params.adminId,
        currencyId: params.currencyId,
      },
    });

    const sign = params.type === 'PURCHASE' ? 1 : -1;

    if (!relation) {
      if (params.type === 'SELL') {
        throw new BadRequestException(
          'Insufficient currency balance (no relation found)',
        );
      }

      const newRelation = manager.create(CurrencyRelationEntity, {
        userId: params.userId,
        adminId: params.adminId,
        currencyId: params.currencyId,
        balance: params.amountCurrency,
        balancePkr: params.amountPkr,
      });

      return manager.save(newRelation);
    }

    const newBalance =
      Number(relation.balance) + sign * Number(params.amountCurrency);

    const newBalancePkr =
      Number(relation.balancePkr) + sign * Number(params.amountPkr);

    if (newBalance < 0) {
      throw new BadRequestException('Insufficient currency balance');
    }

    await manager.update(
      CurrencyRelationEntity,
      { id: relation.id },
      {
        balance: newBalance,
        balancePkr: newBalancePkr,
      },
    );

    return {
      ...relation,
      balance: newBalance,
      balancePkr: newBalancePkr,
    };
  }

  getPkrAmount(AmountCurrenct: number, Rate: number) {
    return {
      amountPkr: AmountCurrenct * Rate,
    };
  }

  private async validateAccountExists(
    accountId: string,
    adminId: string,
  ): Promise<{ found: boolean; type?: 'customer' | 'bank' | 'currency' }> {
    try {
      // Check customer accounts
      const customerAccount = await this.customerRepo.findOne({
        where: { id: accountId, adminId },
      });

      if (customerAccount) {
        return { found: true, type: 'customer' };
      }

      // Check bank accounts
      const bankAccount = await this.bankRepo.findOne({
        where: { id: accountId, adminId },
      });

      if (bankAccount) {
        return { found: true, type: 'bank' };
      }

      // Check currency accounts
      const currencyAccount = await this.currencyAccountRepo.findOne({
        where: { id: accountId, adminId },
      });

      if (currencyAccount) {
        return { found: true, type: 'currency' };
      }

      return { found: false };
    } catch (error) {
      console.error('Error validating account:', error);
      throw new BadRequestException('Error validating account');
    }
  }

  private async updateAccountBalance(
    accountId: string,
    adminId: string,
    accountType: 'customer' | 'bank' | 'currency',
  ): Promise<void> {
    try {
      let totalDebit = 0;
      let totalCredit = 0;
      let accountName = '';
      let accountMetadata = '';

      if (accountType === 'customer') {
        const account = await this.customerRepo.findOne({
          where: { id: accountId, adminId },
        });
        if (!account) return;

        accountName = account.name;
        accountMetadata = account.contact || '';

        const purchases = await this.purchaseRepo
          .createQueryBuilder('p')
          .where('p.customer_account_id = :accountId', { accountId })
          .andWhere('p.admin_id = :adminId', { adminId })
          .select('SUM(p.amountPkr)', 'total')
          .getRawOne();
        totalCredit += Number(purchases?.total || 0);

        const sales = await this.sellingRepo
          .createQueryBuilder('s')
          .where('s.customer_account_id = :accountId', { accountId })
          .andWhere('s.admin_id = :adminId', { adminId })
          .select('SUM(s.amountPkr)', 'total')
          .getRawOne();
        totalDebit += Number(sales?.total || 0);
      } else if (accountType === 'bank') {
        const account = await this.bankRepo.findOne({
          where: { id: accountId, adminId },
        });
        if (!account) return;

        accountName = account.bankName;
        accountMetadata = account.accountNumber || '';

        // Similar calculation for bank accounts if needed
        // Add logic here based on your requirements
      } else if (accountType === 'currency') {
        const account = await this.currencyAccountRepo.findOne({
          where: { id: accountId, adminId },
          relations: ['currency'],
        });
        if (!account) return;

        accountName = account.name;
        accountMetadata = account.currency?.code || '';

        // Similar calculation for currency accounts if needed
        // Add logic here based on your requirements
      }

      const balance = totalCredit - totalDebit;

      // Update or create balance record
      await this.accountBalanceRepo.upsert(
        {
          adminId,
          accountId: accountId,
          accountType: accountType.toUpperCase() as 'CUSTOMER' | 'BANK' | 'CURRENCY',
          accountName,
          accountMetadata,
          totalDebit,
          totalCredit,
          balance: Math.abs(balance),
          balanceType: balance >= 0 ? 'CREDIT' : 'DEBIT',
          lastEntryDate: new Date(),
        },
        ['adminId', 'accountId', 'accountType'],
      );

      console.log(
        `✅ Updated ${accountType} account balance for ${accountName}`,
      );
    } catch (error) {
      console.error(`Error updating ${accountType} account balance:`, error);
      // Don't throw - balance update is supplementary
    }
  }

  async createPurchase(dto: CreatePurchaseDto, adminId: string) {
    return await this.dataSource.transaction(async (manager) => {
      // adminId is now the user's own id (roles live directly on the users
      // table), so it doubles as the userId.
      const userRecord = await this.userRepo.findOne({
        where: { id: adminId },
        select: ['id'],
      });
      if (!userRecord) throw new NotFoundException('User not found');

      const userId = adminId;

      // Validate the account exists in one of three types
      const accountValidation = await this.validateAccountExists(
        dto.customerAccountId,
        adminId,
      );

      if (!accountValidation.found) {
        throw new BadRequestException(
          `Account with ID "${dto.customerAccountId}" not found. Please select a valid customer, bank, or currency account.`,
        );
      }

      // 2. Fetch currency + customer
      const [currency, customer] = await Promise.all([
        manager.findOneBy(AddCurrencyEntity, { id: dto.currencyDrId }),
        manager.findOneBy(CustomerAccountEntity, { id: dto.customerAccountId }),
      ]);

      if (!currency)
        throw new NotFoundException('Currency DR Account not found');
      if (!customer) throw new NotFoundException('Customer Account not found');

      const entry = manager.create(PurchaseEntryEntity, {
        date: dto.date,
        manualRef: dto.manualRef,
        amountCurrency: dto.amountCurrency,
        rate: dto.rate,
        amountPkr: dto.amountPkr,
        description: dto.description,
        currencyDrId: currency.id,
        customerAccountId: dto.customerAccountId,
        customerAccount: customer,
        adminId,
      });

      const relation = await manager.findOneBy(CurrencyRelationEntity, {
        userId,
        adminId,
        currencyId: currency.id,
      });

      if (!relation) {
        await manager.insert(CurrencyRelationEntity, {
          userId,
          adminId,
          currencyId: currency.id,
          balance: dto.amountCurrency,
          balancePkr: dto.amountPkr,
        });
      } else {
        await manager.update(
          CurrencyRelationEntity,
          { id: relation.id },
          {
            balance: Number(relation.balance) + Number(dto.amountCurrency),
            balancePkr: Number(relation.balancePkr) + Number(dto.amountPkr),
          },
        );
      }

      await manager.save(PurchaseEntryEntity, entry);

      // Log to General Ledger
      await this.generalLedgerService.createLedgerEntries(
        [
          {
            adminId,
            transactionDate: dto.date,
            accountId: customer.id,
            accountName: customer.name,
            accountType: 'CUSTOMER',
            entryType: 'PURCHASE',
            sourceEntryId: entry.id,
            referenceNumber: entry.purchaseNumber?.toString(),
            creditAmount: dto.amountPkr, // Customer account credited (we owe them)
            debitAmount: 0,
            currencyAmount: dto.amountCurrency,
            currencyCode: currency.code,
            exchangeRate: dto.rate,
            description: dto.description,
            contraAccountId: currency.id,
            contraAccountName: currency.name,
          },
          {
            adminId,
            transactionDate: dto.date,
            accountId: currency.id,
            accountName: currency.name,
            accountType: 'CURRENCY',
            entryType: 'PURCHASE',
            sourceEntryId: entry.id,
            referenceNumber: entry.purchaseNumber?.toString(),
            debitAmount: dto.amountPkr, // Currency account debited (we received currency)
            creditAmount: 0,
            currencyAmount: dto.amountCurrency,
            currencyCode: currency.name,
            exchangeRate: dto.rate,
            description: dto.description,
            contraAccountId: customer.id,
            contraAccountName: customer.name,
          },
        ],
        manager,
      );

      await this.updateCurrencyStock(manager, adminId, currency.id);

      // Update currency balance summary table
      await this.updateCurrencyBalance(manager, adminId, currency.id);

      const redis = this.redisService.getClient();

      await redis.del(`dailyBooksReport:${adminId}:${dto.date}`);

      await redis.del(`dailyBuyingReport:${adminId}:${dto.date}`);

      // Clear currency ledger cache
      await this.clearCurrencyLedgerCache(adminId, currency.id);

      // Clear account ledger cache for affected accounts
      await this.clearAccountLedgerCache(adminId, currency.id);
      await this.clearAccountLedgerCache(adminId, dto.customerAccountId);

      // Update account balance for the customer/bank/currency account
      if (accountValidation.type) {
        await this.updateAccountBalance(
          dto.customerAccountId,
          adminId,
          accountValidation.type,
        );
      }

      return entry;
    });
  }

  async createSelling(dto: CreateSellingDto, adminId: string) {
    return await this.dataSource.transaction(async (manager) => {
      // adminId is now the user's own id (roles live directly on the users
      // table), so it doubles as the userId.
      const userRecord = await this.userRepo.findOne({
        where: { id: adminId },
        select: ['id'],
      });
      if (!userRecord) throw new NotFoundException('User not found');

      const userId = adminId;

      // Validate the account exists in one of three types
      const accountValidation = await this.validateAccountExists(
        dto.customerAccountId,
        adminId,
      );

      if (!accountValidation.found) {
        throw new BadRequestException(
          `Account with ID "${dto.customerAccountId}" not found. Please select a valid customer, bank, or currency account.`,
        );
      }

      const [currency, customer] = await Promise.all([
        manager.findOneBy(AddCurrencyEntity, { id: dto.fromCurrencyId }),
        manager.findOneBy(CustomerAccountEntity, { id: dto.customerAccountId }),
      ]);

      if (!currency)
        throw new NotFoundException('From Currency Account not found');
      if (!customer) throw new NotFoundException('Customer Account not found');

      const expectedPkr = Number(dto.amountCurrency) * Number(dto.rate);

      if (Number(dto.amountPkr) !== expectedPkr) {
        throw new BadRequestException(
          'PKR amount mismatch with conversion rate',
        );
      }

      const entry = manager.create(SellingEntryEntity, {
        date: dto.date,
        sNo: dto.sNo,
        avgRate: dto.avgRate,
        manualRef: dto.manualRef,
        amountCurrency: dto.amountCurrency,
        rate: dto.rate,
        amountPkr: dto.amountPkr,
        margin: dto.margin,
        pl: dto.pl,
        description: dto.description,
        fromCurrency: currency,
        customerAccount: customer,
        adminId,
      });

      const relation = await manager.findOneBy(CurrencyRelationEntity, {
        userId,
        adminId,
        currencyId: currency.id,
      });

      await manager.update(
        CurrencyRelationEntity,
        { id: relation.id },
        {
          balance: Number(relation.balance) - Number(dto.amountCurrency),
          balancePkr:
            Number(relation.balancePkr) -
            Number(dto.avgRate) * Number(dto.amountCurrency),
        },
      );

      // 6️⃣ Save entry
      await manager.save(SellingEntryEntity, entry);

      // Log to General Ledger
      await this.generalLedgerService.createLedgerEntries(
        [
          {
            adminId,
            transactionDate: dto.date,
            accountId: customer.id,
            accountName: customer.name,
            accountType: 'CUSTOMER',
            entryType: 'SALE',
            sourceEntryId: entry.id,
            referenceNumber: entry.saleNumber?.toString(),
            debitAmount: dto.amountPkr, // Customer account debited (they owe us)
            creditAmount: 0,
            currencyAmount: dto.amountCurrency,
            currencyCode: currency.name,
            exchangeRate: dto.rate,
            description: dto.description,
            contraAccountId: currency.id,
            contraAccountName: currency.name,
          },
          {
            adminId,
            transactionDate: dto.date,
            accountId: currency.id,
            accountName: currency.name,
            accountType: 'CURRENCY',
            entryType: 'SALE',
            sourceEntryId: entry.id,
            referenceNumber: entry.saleNumber?.toString(),
            creditAmount: dto.amountPkr, // Currency account credited (we gave currency)
            debitAmount: 0,
            currencyAmount: dto.amountCurrency,
            currencyCode: currency.name,
            exchangeRate: dto.rate,
            description: dto.description,
            contraAccountId: customer.id,
            contraAccountName: customer.name,
          },
        ],
        manager,
      );

      await this.updateCurrencyStock(manager, adminId, currency.id);

      // Update currency balance summary table
      await this.updateCurrencyBalance(manager, adminId, currency.id);

      const redis = this.redisService.getClient();

      await redis.del(`dailyBooksReport:${adminId}:${dto.date}`);

      // Clear currency ledger cache
      await this.clearCurrencyLedgerCache(adminId, currency.id);

      // Clear account ledger cache for affected accounts
      await this.clearAccountLedgerCache(adminId, currency.id);
      await this.clearAccountLedgerCache(adminId, dto.customerAccountId);

      // Update account balance for the customer/bank/currency account
      if (accountValidation.type) {
        await this.updateAccountBalance(
          dto.customerAccountId,
          adminId,
          accountValidation.type,
        );
      }

      return entry;
    });
  }

  async getPurchaseById(entryId: string, adminId: string): Promise<PurchaseEntryEntity> {
    const entry = await this.purchaseRepo.findOne({
      where: { id: entryId, adminId },
      relations: ['fromCurrency', 'customerAccount'],
    });

    if (!entry) {
      throw new NotFoundException(`Purchase entry with ID "${entryId}" not found`);
    }

    return entry;
  }

  async getSellingById(entryId: string, adminId: string): Promise<SellingEntryEntity> {
    const entry = await this.sellingRepo.findOne({
      where: { id: entryId, adminId },
      relations: ['fromCurrency', 'customerAccount'],
    });

    if (!entry) {
      throw new NotFoundException(`Selling entry with ID "${entryId}" not found`);
    }

    return entry;
  }

  async updatePurchase(
    entryId: string,
    dto: UpdatePurchaseDto,
    adminId: string,
  ): Promise<PurchaseEntryEntity> {
    return await this.dataSource.transaction(async (manager) => {
      // 1. Find existing entry
      const entry = await manager.findOne(PurchaseEntryEntity, {
        where: { id: entryId, adminId },
        relations: ['fromCurrency', 'customerAccount'],
      });

      if (!entry) {
        throw new NotFoundException(`Purchase entry with ID "${entryId}" not found`);
      }

      // adminId is now the user's own id (roles live directly on the users
      // table), so it doubles as the userId.
      const userRecord = await this.userRepo.findOne({
        where: { id: adminId },
        select: ['id'],
      });
      if (!userRecord) throw new NotFoundException('User not found');

      const userId = adminId;

      // Store old values for reversal
      const oldCurrencyId = entry.currencyDrId;
      const oldAmountCurrency = Number(entry.amountCurrency);
      const oldAmountPkr = Number(entry.amountPkr);

      // 2. Validate and fetch new references if changed
      let currency = entry.fromCurrency;
      let customer = entry.customerAccount;

      if (dto.currencyDrId && dto.currencyDrId !== entry.currencyDrId) {
        currency = await manager.findOne(AddCurrencyEntity, {
          where: { id: dto.currencyDrId },
        });
        if (!currency) {
          throw new NotFoundException('Currency not found');
        }
      }

      if (dto.customerAccountId && dto.customerAccountId !== entry.customerAccountId) {
        customer = await manager.findOne(CustomerAccountEntity, {
          where: { id: dto.customerAccountId },
        });
        if (!customer) {
          throw new NotFoundException('Customer account not found');
        }
      }

      // 3. Calculate new amounts if rate or currency amount changed
      let newAmountPkr = dto.amountPkr || Number(entry.amountPkr);
      let newAmountCurrency = dto.amountCurrency || Number(entry.amountCurrency);
      let newRate = dto.rate || Number(entry.rate);

      if (dto.amountCurrency && dto.rate) {
        newAmountPkr = dto.amountCurrency * dto.rate;
      }

      // 4. Reverse old currency relation
      const oldRelation = await manager.findOne(CurrencyRelationEntity, {
        where: { userId, adminId, currencyId: oldCurrencyId },
      });

      if (oldRelation) {
        await manager.update(
          CurrencyRelationEntity,
          { id: oldRelation.id },
          {
            balance: Number(oldRelation.balance) - oldAmountCurrency,
            balancePkr: Number(oldRelation.balancePkr) - oldAmountPkr,
          },
        );
      }

      // 5. Apply new currency relation
      const newCurrencyId = dto.currencyDrId || oldCurrencyId;
      const newRelation = await manager.findOne(CurrencyRelationEntity, {
        where: { userId, adminId, currencyId: newCurrencyId },
      });

      if (!newRelation) {
        await manager.insert(CurrencyRelationEntity, {
          userId,
          adminId,
          currencyId: newCurrencyId,
          balance: newAmountCurrency,
          balancePkr: newAmountPkr,
        });
      } else {
        await manager.update(
          CurrencyRelationEntity,
          { id: newRelation.id },
          {
            balance: Number(newRelation.balance) + newAmountCurrency,
            balancePkr: Number(newRelation.balancePkr) + newAmountPkr,
          },
        );
      }

      // 6. Update the entry
      await manager.update(
        PurchaseEntryEntity,
        { id: entryId },
        {
          date: dto.date || entry.date,
          manualRef: dto.manualRef !== undefined ? dto.manualRef : entry.manualRef,
          amountCurrency: newAmountCurrency,
          rate: newRate,
          amountPkr: newAmountPkr,
          description: dto.description !== undefined ? dto.description : entry.description,
          currencyDrId: currency.id,
          customerAccountId: customer.id,
        },
      );

      // 7. Delete old general ledger entries
      await this.generalLedgerService.deleteLedgerEntriesBySource(entryId, manager);

      // 8. Create new general ledger entries
      await this.generalLedgerService.createLedgerEntries(
        [
          {
            adminId,
            transactionDate: dto.date || entry.date,
            accountId: customer.id,
            accountName: customer.name,
            accountType: 'CUSTOMER',
            entryType: 'PURCHASE',
            sourceEntryId: entryId,
            referenceNumber: entry.purchaseNumber?.toString(),
            creditAmount: newAmountPkr,
            debitAmount: 0,
            currencyAmount: newAmountCurrency,
            currencyCode: currency.name,
            exchangeRate: newRate,
            description: dto.description || entry.description,
            contraAccountId: currency.id,
            contraAccountName: currency.name,
          },
          {
            adminId,
            transactionDate: dto.date || entry.date,
            accountId: currency.id,
            accountName: currency.name,
            accountType: 'CURRENCY',
            entryType: 'PURCHASE',
            sourceEntryId: entryId,
            referenceNumber: entry.purchaseNumber?.toString(),
            debitAmount: newAmountPkr,
            creditAmount: 0,
            currencyAmount: newAmountCurrency,
            currencyCode: currency.name,
            exchangeRate: newRate,
            description: dto.description || entry.description,
            contraAccountId: customer.id,
            contraAccountName: customer.name,
          },
        ],
        manager,
      );

      // 9. Update currency stock
      await this.updateCurrencyStock(manager, adminId, currency.id);
      await this.updateCurrencyBalance(manager, adminId, currency.id);
      if (oldCurrencyId !== newCurrencyId) {
        await this.updateCurrencyStock(manager, adminId, oldCurrencyId);
        await this.updateCurrencyBalance(manager, adminId, oldCurrencyId);
      }

      // 10. Clear cache
      const redis = this.redisService.getClient();
      const dateKey = dto.date || entry.date;
      await redis.del(`dailyBooksReport:${adminId}:${dateKey}`);
      await redis.del(`dailyBuyingReport:${adminId}:${dateKey}`);

      // Clear currency ledger cache for the currency
      await this.clearCurrencyLedgerCache(adminId, newCurrencyId);
      if (oldCurrencyId !== newCurrencyId) {
        await this.clearCurrencyLedgerCache(adminId, oldCurrencyId);
      }

      // Clear account ledger cache for affected accounts
      await this.clearAccountLedgerCache(adminId, newCurrencyId);
      await this.clearAccountLedgerCache(adminId, dto.customerAccountId || entry.customerAccountId);
      if (oldCurrencyId !== newCurrencyId) {
        await this.clearAccountLedgerCache(adminId, oldCurrencyId);
      }

      // Return updated entry
      return await manager.findOne(PurchaseEntryEntity, {
        where: { id: entryId },
        relations: ['fromCurrency', 'customerAccount'],
      });
    });
  }

  async updateSelling(
    entryId: string,
    dto: UpdateSellingDto,
    adminId: string,
  ): Promise<SellingEntryEntity> {
    return await this.dataSource.transaction(async (manager) => {
      // 1. Find existing entry
      const entry = await manager.findOne(SellingEntryEntity, {
        where: { id: entryId, adminId },
        relations: ['fromCurrency', 'customerAccount'],
      });

      if (!entry) {
        throw new NotFoundException(`Selling entry with ID "${entryId}" not found`);
      }

      // adminId is now the user's own id (roles live directly on the users
      // table), so it doubles as the userId.
      const userRecord = await this.userRepo.findOne({
        where: { id: adminId },
        select: ['id'],
      });
      if (!userRecord) throw new NotFoundException('User not found');

      const userId = adminId;

      // Store old values for reversal
      const oldCurrencyId = entry.fromCurrency.id;
      const oldAmountCurrency = Number(entry.amountCurrency);
      const oldAvgRate = Number(entry.avgRate);

      // 2. Validate and fetch new references if changed
      let currency = entry.fromCurrency;
      let customer = entry.customerAccount;

      if (dto.fromCurrencyId && dto.fromCurrencyId !== oldCurrencyId) {
        currency = await manager.findOne(AddCurrencyEntity, {
          where: { id: dto.fromCurrencyId },
        });
        if (!currency) {
          throw new NotFoundException('Currency not found');
        }
      }

      if (dto.customerAccountId && dto.customerAccountId !== entry.customerAccount.id) {
        customer = await manager.findOne(CustomerAccountEntity, {
          where: { id: dto.customerAccountId },
        });
        if (!customer) {
          throw new NotFoundException('Customer account not found');
        }
      }

      // 3. Calculate new amounts
      let newAmountPkr = dto.amountPkr || Number(entry.amountPkr);
      let newAmountCurrency = dto.amountCurrency || Number(entry.amountCurrency);
      let newRate = dto.rate || Number(entry.rate);
      let newAvgRate = dto.avgRate || Number(entry.avgRate);

      if (dto.amountCurrency && dto.rate) {
        const expectedPkr = dto.amountCurrency * dto.rate;
        if (dto.amountPkr && Math.abs(dto.amountPkr - expectedPkr) > 0.01) {
          throw new BadRequestException('PKR amount mismatch with conversion rate');
        }
        newAmountPkr = expectedPkr;
      }

      // 4. Reverse old currency relation (add back sold currency)
      const oldRelation = await manager.findOne(CurrencyRelationEntity, {
        where: { userId, adminId, currencyId: oldCurrencyId },
      });

      if (oldRelation) {
        await manager.update(
          CurrencyRelationEntity,
          { id: oldRelation.id },
          {
            balance: Number(oldRelation.balance) + oldAmountCurrency,
            balancePkr: Number(oldRelation.balancePkr) + (oldAvgRate * oldAmountCurrency),
          },
        );
      }

      // 5. Apply new currency relation (subtract new sold amount)
      const newCurrencyId = dto.fromCurrencyId || oldCurrencyId;
      const newRelation = await manager.findOne(CurrencyRelationEntity, {
        where: { userId, adminId, currencyId: newCurrencyId },
      });

      if (!newRelation) {
        throw new BadRequestException('Insufficient currency balance for this sale');
      }

      await manager.update(
        CurrencyRelationEntity,
        { id: newRelation.id },
        {
          balance: Number(newRelation.balance) - newAmountCurrency,
          balancePkr: Number(newRelation.balancePkr) - (newAvgRate * newAmountCurrency),
        },
      );

      // 6. Update the entry
      await manager.update(
        SellingEntryEntity,
        { id: entryId },
        {
          date: dto.date || entry.date,
          sNo: dto.sNo !== undefined ? dto.sNo : entry.sNo,
          avgRate: newAvgRate,
          manualRef: dto.manualRef !== undefined ? dto.manualRef : entry.manualRef,
          amountCurrency: newAmountCurrency,
          rate: newRate,
          amountPkr: newAmountPkr,
          margin: dto.margin !== undefined ? dto.margin : entry.margin,
          pl: dto.pl !== undefined ? dto.pl : entry.pl,
          description: dto.description !== undefined ? dto.description : entry.description,
          fromCurrencyId: currency.id,
        },
      );

      // 7. Delete old general ledger entries
      await this.generalLedgerService.deleteLedgerEntriesBySource(entryId, manager);

      // 8. Create new general ledger entries
      await this.generalLedgerService.createLedgerEntries(
        [
          {
            adminId,
            transactionDate: dto.date || entry.date,
            accountId: customer.id,
            accountName: customer.name,
            accountType: 'CUSTOMER',
            entryType: 'SALE',
            sourceEntryId: entryId,
            referenceNumber: entry.saleNumber?.toString(),
            debitAmount: newAmountPkr,
            creditAmount: 0,
            currencyAmount: newAmountCurrency,
            currencyCode: currency.name,
            exchangeRate: newRate,
            description: dto.description || entry.description,
            contraAccountId: currency.id,
            contraAccountName: currency.name,
          },
          {
            adminId,
            transactionDate: dto.date || entry.date,
            accountId: currency.id,
            accountName: currency.name,
            accountType: 'CURRENCY',
            entryType: 'SALE',
            sourceEntryId: entryId,
            referenceNumber: entry.saleNumber?.toString(),
            creditAmount: newAmountPkr,
            debitAmount: 0,
            currencyAmount: newAmountCurrency,
            currencyCode: currency.name,
            exchangeRate: newRate,
            description: dto.description || entry.description,
            contraAccountId: customer.id,
            contraAccountName: customer.name,
          },
        ],
        manager,
      );

      // 9. Update currency stock
      await this.updateCurrencyStock(manager, adminId, currency.id);
      await this.updateCurrencyBalance(manager, adminId, currency.id);
      if (oldCurrencyId !== newCurrencyId) {
        await this.updateCurrencyStock(manager, adminId, oldCurrencyId);
        await this.updateCurrencyBalance(manager, adminId, oldCurrencyId);
      }

      // 10. Clear cache
      const redis = this.redisService.getClient();
      const dateKey = dto.date || entry.date;
      await redis.del(`dailyBooksReport:${adminId}:${dateKey}`);

      // Clear currency ledger cache for the currency
      await this.clearCurrencyLedgerCache(adminId, newCurrencyId);
      if (oldCurrencyId !== newCurrencyId) {
        await this.clearCurrencyLedgerCache(adminId, oldCurrencyId);
      }

      // Clear account ledger cache for affected accounts
      await this.clearAccountLedgerCache(adminId, newCurrencyId);
      await this.clearAccountLedgerCache(adminId, dto.customerAccountId || entry.customerAccount.id);
      if (oldCurrencyId !== newCurrencyId) {
        await this.clearAccountLedgerCache(adminId, oldCurrencyId);
      }

      // Return updated entry
      return await manager.findOne(SellingEntryEntity, {
        where: { id: entryId },
        relations: ['fromCurrency', 'customerAccount'],
      });
    });
  }
}
