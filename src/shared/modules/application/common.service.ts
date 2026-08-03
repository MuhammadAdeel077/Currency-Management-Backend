import { Cache, CACHE_MANAGER } from '@nestjs/cache-manager';
import {
  BadRequestException,
  Inject,
  Injectable,
  InternalServerErrorException,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { AddChqRefBankEntity } from '../../../modules/account/domain/entity/add-chq-ref-bank.entity';
import { AddExpenseEntity } from '../../../modules/account/domain/entity/add-expense.entity';
import { BankAccountEntity } from '../../../modules/account/domain/entity/bank-account.entity';
import { CurrencyAccountEntity } from '../../../modules/account/domain/entity/currency-account.entity';
import { AddCurrencyEntity } from '../../../modules/account/domain/entity/currency.entity';
import { CustomerAccountEntity } from '../../../modules/account/domain/entity/customer-account.entity';
import { EmployeeAccountEntity } from '../../../modules/account/domain/entity/employee-account.entity';
import { GeneralAccountEntity } from '../../../modules/account/domain/entity/general-account.entity';
import { AccountType } from '../../../modules/account/domain/enums/account-type.enum';
import { CustomerCurrencyAccountEntity } from '../../../modules/currency/domain/entities/currencies-account.entity';
import { Repository } from 'typeorm';
import { RedisService } from '../redis/redis.service';

@Injectable()
export class CommonService {
  private repoMap: Record<string, Repository<any>>;
  constructor(
    @InjectRepository(CustomerAccountEntity)
    private customerRepo: Repository<CustomerAccountEntity>,
    @InjectRepository(BankAccountEntity)
    private bankRepo: Repository<BankAccountEntity>,
    @InjectRepository(GeneralAccountEntity)
    private generalRepo: Repository<GeneralAccountEntity>,
    @InjectRepository(EmployeeAccountEntity)
    private employee: Repository<EmployeeAccountEntity>,
    @InjectRepository(AddExpenseEntity)
    private expense: Repository<AddExpenseEntity>,
    @InjectRepository(AddChqRefBankEntity)
    private chqbank: Repository<AddChqRefBankEntity>,
    @InjectRepository(CurrencyAccountEntity)
    private currency: Repository<CurrencyAccountEntity>,
    @InjectRepository(AddCurrencyEntity)
    private currency_user: Repository<AddCurrencyEntity>,
    @InjectRepository(CustomerCurrencyAccountEntity)
    private currency_accounts: Repository<CustomerCurrencyAccountEntity>,
    @Inject(CACHE_MANAGER)
    private readonly cacheManager: Cache,
    private readonly redisService: RedisService,
  ) {
    this.repoMap = {
      customer: this.customerRepo,
      bank: this.bankRepo,
      general: this.generalRepo,
      employee: this.employee,
      expense: this.expense,
      chqbank: this.chqbank,
      currency: this.currency,
      currency_user: this.currency_user,
    };
  }

  async getAllCustomersForDropdown(adminId: string) {
    const key = `customers_${adminId}`;

    const cached =
      await this.redisService.getValue<{ label: string; value: string }[]>(key);

    if (cached) {
      console.log('✅ Cache HIT – returning cached customers');
      return cached;
    }

    console.log('❌ Cache MISS – fetching from DB');
    const customers = await this.customerRepo.find({
      select: ['id', 'name'],
      order: { name: 'ASC' },
      where: { adminId },
    });

    const result = customers.map((c) => ({
      label: c.name,
      value: c.id,
    }));

    await this.redisService.setValue(key, result, 300);

    return result;
  }

  async getAllCustomersandBanksForDropdown(adminId: string) {
    const key = `customers_banks_${adminId}`;

    const cached =
      await this.redisService.getValue<{ label: string; value: string }[]>(key);

    if (cached) {
      console.log('✅ Cache HIT – returning cached customers');
      return cached;
    }

    console.log('❌ Cache MISS – fetching from DB');
    const customers = await this.customerRepo.find({
      select: ['id', 'name'],
      order: { name: 'ASC' },
      where: { adminId },
    });

    const banks = await this.bankRepo.find({
      select: ['id', 'bankName'],
      order: { bankName: 'ASC' },
      where: { adminId },
    });

    const result = [
      ...customers.map((c) => ({
        label: c.name,
        value: c.id,
      })),
      ...banks.map((b) => ({
        label: b.bankName,
        value: b.id,
      })),
    ];

    await this.redisService.setValue(key, result, 300);

    return result;
  }

  async getAllCurrencyAccountsForDropdown(
    adminId: string,
    currency_id: string,
  ) {
    const cacheKey = `currency_accounts_${adminId}_${currency_id}`;
    console.log('🔍 Checking cache for key:', cacheKey);

    // Check Redis first
    const cached =
      await this.redisService.getValue<{ label: string; value: string }[]>(
        cacheKey,
      );
    if (cached) {
      console.log('✅ Cache HIT – returning cached currency accounts');
      return cached;
    }

    console.log('❌ Cache MISS – fetching from DB');
    try {
      const accounts = await this.currency_accounts.find({
        select: ['id', 'name'],
        order: { name: 'ASC' },
        where: { adminId, currencyId: currency_id },
      });

      const result = accounts.map((c) => ({
        label: c.name,
        value: c.id,
      }));

      // Save to Redis with TTL (10 minutes)
      await this.redisService.setValue(cacheKey, result, 600);
      console.log('💾 Cache SET for key:', cacheKey);

      return result;
    } catch (error) {
      throw new InternalServerErrorException(
        'Failed to load currency accounts. Please try again later.',
      );
    }
  }

  async getAllBankForDropdown(adminId: string) {
    const cacheKey = `banks_${adminId}`;

    const cached =
      await this.redisService.getValue<
        { label: string; value: string; accountNumber?: string }[]
      >(cacheKey);
    if (cached) {
      console.log('✅ Cache HIT – returning cached banks');
      return cached;
    }

    console.log('❌ Cache MISS – fetching from DB');
    try {
      const banks = await this.bankRepo.find({
        select: ['id', 'bankName', 'accountNumber'],
        order: { bankName: 'ASC' },
        where: { adminId },
      });
      const result = banks.map((b) => ({
        label: b.bankName,
        value: b.id,
        accountNumber: b.accountNumber,
      }));

      await this.redisService.setValue(cacheKey, result, 300);
      return result;
    } catch (error) {
      throw new InternalServerErrorException(
        'Failed to load banks. Please try again later.',
      );
    }
  }

  async getGeneralAccountsByType(adminId: string, accountType: AccountType) {
    const cacheKey = `general_accounts_${accountType}_${adminId}`;
    console.log('🔍 Checking cache for key:', cacheKey);

    const cached =
      await this.redisService.getValue<{ label: string; value: string }[]>(cacheKey);
    if (cached) {
      console.log('✅ Cache HIT – returning cached general accounts');
      return cached;
    }

    console.log('❌ Cache MISS – fetching from DB');
    try {
      const accounts = await this.generalRepo.find({
        select: ['id', 'name'],
        order: { name: 'ASC' },
        where: { adminId, accountType },
      });

      const result = accounts.map((a) => ({
        label: a.name,
        value: a.id,
      }));

      await this.redisService.setValue(cacheKey, result, 300);
      console.log('💾 Cache SET for key:', cacheKey);

      return result;
    } catch (error) {
      throw new InternalServerErrorException(
        'Failed to load general accounts. Please try again later.',
      );
    }
  }

  async getModuleById(module: string, id: string) {
    const cacheKey = `module_${module}_${id}`;
    console.log('🔍 Checking cache for key:', cacheKey);

    // Check Redis first
    const cached = await this.redisService.getValue<any>(cacheKey);
    if (cached) {
      console.log('✅ Cache HIT – returning cached module record');
      return cached;
    }

    console.log('❌ Cache MISS – fetching from DB');
    const repo = this.repoMap[module];

    if (!repo) {
      throw new BadRequestException('The requested module type is invalid. Please contact support.');
    }

    const record = await repo.findOne({ where: { id } });

    if (!record) {
      throw new NotFoundException(
        'The requested record could not be found. Please verify the ID and try again.',
      );
    }

    // Save to Redis (TTL 10 minutes)
    await this.redisService.setValue(cacheKey, record, 600);
    console.log('💾 Cache SET for key:', cacheKey);

    return record;
  }

  async getCurrencyofUser(adminId: string) {
    const cacheKey = `currency_user_${adminId}`;
    console.log('🔍 Checking cache for key:', cacheKey);

    // Check Redis first
    const cached =
      await this.redisService.getValue<
        { label: string; value: string; code: string }[]
      >(cacheKey);
    if (cached) {
      console.log('✅ Cache HIT – returning cached currency data');
      return cached;
    }

    console.log('❌ Cache MISS – fetching from DB');
    try {
      const currencies = await this.currency_user.find({
        select: ['id', 'name', 'code'],
        order: { name: 'ASC' },
        where: { adminId },
      });

      const result = currencies.map((c) => ({
        label: c.name,
        value: c.id,
        code: c.code,
      }));

      // Save to Redis (TTL 10 minutes)
      await this.redisService.setValue(cacheKey, result, 600);
      console.log('💾 Cache SET for key:', cacheKey);

      return result;
    } catch (error) {
      throw new InternalServerErrorException(
        'Failed to load currency data. Please try again later.',
      );
    }
  }

  async getRefBanks(adminId: string) {
    const cacheKey = `chq_ref_banks_${adminId}`;
    console.log('🔍 Checking cache for key:', cacheKey);

    // Check Redis first
    const cached =
      await this.redisService.getValue<{ label: string; value: string; accountNumber?: string }[]>(
        cacheKey,
      );
    if (cached) {
      console.log('✅ Cache HIT – returning cached cheque reference banks');
      return cached;
    }

    console.log('❌ Cache MISS – fetching from DB');
    try {
      const refbanks = await this.chqbank.find({
        where: { adminId: adminId },
        order: { name: 'ASC' },
        select: ['name', 'id', 'accountNumber'],
      });

      const result = refbanks.map((c) => ({
        label: c.name,
        value: c.id,
        accountNumber: c.accountNumber,
      }));

      // Save to Redis with TTL (10 minutes)
      await this.redisService.setValue(cacheKey, result, 600);
      console.log('💾 Cache SET for key:', cacheKey);

      return result;
    } catch (error) {
      throw new InternalServerErrorException(
        'Failed to load cheque reference banks. Please try again later.',
      );
    }
  }

  async getAllAccountsForDropdown(
    adminId: string,
  ): Promise<
    Array<{
      label: string;
      value: string;
      type: 'customer' | 'bank' | 'currency';
    }>
  > {
    // Validate adminId
    if (!adminId || typeof adminId !== 'string') {
      throw new BadRequestException(
        'Invalid admin ID provided. Please ensure you have proper authorization.',
      );
    }

    const cacheKey = `all_accounts_${adminId}`;
    console.log('🔍 Checking cache for unified accounts:', cacheKey);

    try {
      const cached = await this.redisService.getValue<
        Array<{
          label: string;
          value: string;
          type: 'customer' | 'bank' | 'currency';
        }>
      >(cacheKey);

      if (cached && Array.isArray(cached) && cached.length > 0) {
        console.log(
          `✅ Cache HIT – returning ${cached.length} cached accounts`,
        );
        return cached;
      }

      console.log('❌ Cache MISS – fetching from database');

      const [customers, banks, currencyAccounts] = await Promise.all([
        this.fetchCustomerAccounts(adminId),
        this.fetchBankAccounts(adminId),
        this.fetchCurrencyAccounts(adminId),
      ]);

      const result = [
        ...customers.map((c) => ({
          label: c.name,
          value: c.id,
          type: 'customer' as const,
        })),
        ...banks.map((b) => ({
          label: b.bankName,
          value: b.id,
          type: 'bank' as const,
        })),
        ...currencyAccounts.map((ca) => ({
          label: ca.name,
          value: ca.id,
          type: 'currency' as const,
        })),
      ];

      if (result.length === 0) {
        console.warn(
          `⚠️  No accounts found for adminId: ${adminId}`,
        );
        await this.redisService.setValue(cacheKey, result, 300);
        return result;
      }

      result.sort((a, b) => a.label.localeCompare(b.label));

      await this.redisService.setValue(cacheKey, result, 600);
      console.log(
        `💾 Cache SET for key: ${cacheKey} with ${result.length} accounts`,
      );

      return result;
    } catch (error) {
      console.error('❌ Error in getAllAccountsForDropdown:', error);
      throw new InternalServerErrorException(
        'Failed to load accounts. Please try again later.',
      );
    }
  }

  private async fetchCustomerAccounts(adminId: string) {
    try {
      const customers = await this.customerRepo.find({
        select: ['id', 'name'],
        where: { adminId },
        order: { name: 'ASC' },
      });
      return customers;
    } catch (error) {
      console.error('Error fetching customer accounts:', error);
      return [];
    }
  }


  private async fetchBankAccounts(adminId: string) {
    try {
      const banks = await this.bankRepo.find({
        select: ['id', 'bankName', 'accountNumber'],
        where: { adminId },
        order: { bankName: 'ASC' },
      });
      return banks;
    } catch (error) {
      console.error('Error fetching bank accounts:', error);
      return [];
    }
  }

  private async fetchCurrencyAccounts(adminId: string) {
    try {
      const accounts = await this.currency_accounts.find({
        select: ['id', 'name'],
        where: { adminId },
        order: { name: 'ASC' },
      });
      return accounts;
    } catch (error) {
      console.error('Error fetching currency accounts:', error);
      return [];
    }
  }

  async clearAccountsCache(adminId?: string): Promise<void> {
    try {
      if (adminId) {
        // Clear all accounts cache
        const pattern1 = `all_accounts_${adminId}*`;
        const deleted1 = await this.redisService.deleteKeysByPattern(pattern1);
        
        // Clear customers cache
        const key2 = `customers_${adminId}`;
        await this.redisService.deleteKey(key2);

        // Clear customers and banks cache
        const key3 = `customers_banks_${adminId}`;
        await this.redisService.deleteKey(key3);

        // Clear chq ref banks cache
        const key4 = `chq_ref_banks_${adminId}`;
        await this.redisService.deleteKey(key4);

        // Clear banks cache
        const key5 = `banks_${adminId}`;
        await this.redisService.deleteKey(key5);

        console.log(`🗑️  Cleared ${deleted1} cache entries + dropdown caches for adminId: ${adminId}`);
      } else {
        // Clear all account caches
        const deleted1 = await this.redisService.deleteKeysByPattern('all_accounts_*');
        const deleted2 = await this.redisService.deleteKeysByPattern('customers_*');
        const deleted3 = await this.redisService.deleteKeysByPattern('customers_banks_*');
        const deleted4 = await this.redisService.deleteKeysByPattern('chq_ref_banks_*');
        const deleted5 = await this.redisService.deleteKeysByPattern('banks_*');

        const totalDeleted = deleted1 + deleted2 + deleted3 + deleted4 + deleted5;
        console.log(`🗑️  Cleared ${totalDeleted} total account cache entries`);
      }
    } catch (error) {
      console.error('Error clearing cache:', error);
      throw new InternalServerErrorException(
        'Failed to clear cache. Please contact support.',
      );
    }
  }
}
