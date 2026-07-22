import {
  Injectable,
  BadRequestException,
  NotFoundException,
  InternalServerErrorException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, Between } from 'typeorm';
import { CustomerCurrencyAccountEntity } from '../domain/entities/currencies-account.entity';
import { CustomerCreateCurrencyAccountDto } from '../domain/dto/create-currency-account.dto';
import { buildPaginationResponse } from '../../../shared/utils/pagination.utils';
import { PaginationDto } from '../../../shared/modules/dtos/pagination.dto';
import { UpdateCustomerCurrencyAccountDto } from '../domain/dto/update-currency-accounts.dto';
import {
  CreateCurrencyEntryDto,
  EntryType,
} from '../domain/dto/create-currency-entry.dto';
import { CustomerCurrencyEntryEntity } from '../domain/entities/currency-entry.entity';
import { CreateMultipleCurrencyEntryDto } from '../domain/dto/multiple-currency-entry.dto';
import { DailyBookDto } from '../domain/dto/daily-book.dto';
import { UserEntity } from '../../users/domain/entities/user.entity';
import { AddCurrencyEntity } from '../../account/domain/entity/currency.entity';
import { RedisService } from '../../../shared/modules/redis/redis.service';
import { CreateCurrencyJournalEntryDto } from '../domain/dto/create-currency-journal-entry.dto';
import { JournalCurrencyEntryEntity } from '../domain/entities/create-currency-journal-entry';

@Injectable()
export class CurrencyAccountService {
  constructor(
    @InjectRepository(UserEntity)
    private readonly userRepo: Repository<UserEntity>,

    @InjectRepository(CustomerCurrencyAccountEntity)
    private currencyRepo: Repository<CustomerCurrencyAccountEntity>,

    @InjectRepository(CustomerCurrencyEntryEntity)
    private entryRepo: Repository<CustomerCurrencyEntryEntity>,

    @InjectRepository(AddCurrencyEntity)
    private currencyAccountRepo: Repository<AddCurrencyEntity>,

    private readonly redisService: RedisService,

    @InjectRepository(JournalCurrencyEntryEntity)
    private journalEntryRepo: Repository<JournalCurrencyEntryEntity>,
  ) {}

  async createCurrencyAccount(
    dto: CustomerCreateCurrencyAccountDto,
    adminId: string,
  ) {
    const exists = await this.currencyRepo.findOne({
      where: { name: dto.name },
    });

    const currencyAccount = await this.currencyAccountRepo.findOne({
      where: { id: dto.currencyId },
    });

    if (!currencyAccount) {
      throw new BadRequestException('Currency Account Does Not Exists');
    }
    if (exists) {
      throw new BadRequestException('Account with this name already exists');
    }

    const currencyAcc = this.currencyRepo.create({
      accountType: dto.accountType,
      name: dto.name,
      accountInfo: dto.accountInfo,
      currencyId: dto.currencyId,
      adminId: adminId,
    });

    const saved = await this.currencyRepo.save(currencyAcc);

    // Invalidate currency accounts dropdown cache
    const redis = this.redisService.getClient();
    await redis.del(`currency-accounts-dropdown:${dto.currencyId}:${adminId}`);
    console.log('🧹 Currency accounts dropdown cache invalidated after new account creation');

    return saved;
  }

  async getCurrencyAccountsDropdown(currencyId: string, adminId: string) {
    const cacheKey = `currency-accounts-dropdown:${currencyId}:${adminId}`;

    const cached = await this.redisService.getValue(cacheKey);
    if (cached) {
      console.log('✅ Currency accounts dropdown cache HIT');
      return cached;
    }

    console.log('❌ Currency accounts dropdown cache MISS');

    const accounts = await this.currencyRepo.find({
      where: { currencyId, adminId },
      select: ['id', 'name', 'accountType', 'accountInfo', 'balance'],
      order: { created_at: 'DESC' },
    });

    if (!accounts || accounts.length === 0) {
      throw new NotFoundException(
        'No currency accounts found for this currency and admin',
      );
    }

    const result = accounts.map((account) => ({
      id: account.id,
      name: account.name,
      accountType: account.accountType,
      accountInfo: account.accountInfo,
      balance: account.balance,
    }));

    await this.redisService.setValue(cacheKey, result, 600);
    console.log('💾 Currency accounts dropdown cache SET');

    return result;
  }

  async getCustomerById(id: string) {
    const customer = await this.currencyRepo.findOne({ where: { id } });
    if (!customer) throw new NotFoundException('Customer account not found');
    return customer;
  }

  async getCustomersByAdmin(
    adminId: string,
    currency: string,
    paginationDto: PaginationDto,
  ) {
    const { offset = 1, limit = 10 } = paginationDto;
    console.log(
      'Fetching customers for admin:',
      adminId,
      'currency:',
      currency,
    );
    const [data, total] = await this.currencyRepo.findAndCount({
      where: { adminId: adminId, currencyId: currency },
      skip: (offset - 1) * limit,
      take: limit,
      order: { created_at: 'DESC' },
    });
    return buildPaginationResponse(data, total, offset, limit);

  }

  async updateCustomer(id: string, dto: UpdateCustomerCurrencyAccountDto) {
    const customer = await this.currencyRepo.findOne({ where: { id } });
    if (!customer) throw new NotFoundException('Customer account not found');

    Object.assign(customer, dto);
    return this.currencyRepo.save(customer);
  }

  async getGenericUserId(adminId: string) {
    // adminId is now the user's own id (roles live directly on the users
    // table), so this simply verifies the user exists.
    const user = await this.userRepo.findOne({
      where: { id: adminId },
      select: ['id'],
    });

    return user?.id || null;
  }

  async createCurrencyEntry(dto: CreateCurrencyEntryDto, adminId: string) {
    const account = await this.currencyRepo.findOne({
      where: { id: dto.accountId },
    });
    const AdminInfo = await this.getGenericUserId(adminId);

    const admin = await this.userRepo.findOne({
      where: { id: AdminInfo },
    });

    if (!account) throw new NotFoundException('Customer account not found');

    if (dto.entryType === EntryType.JAMAM) {
      account.balance += dto.amount;
      admin.account_balance -= dto.amount;
    } else if (dto.entryType === EntryType.BANAM) {
      account.balance -= dto.amount;
      admin.account_balance += dto.amount;
    }

    await this.userRepo.save(admin);
    await this.currencyRepo.save(account);

    const entry = this.entryRepo.create({
      date: dto.date,
      paymentType: dto.paymentType,
      account,
      amount: dto.amount,
      description: dto.description,
      entryType: dto.entryType,
      adminId: adminId,
      balance: account.balance,
    });

    await this.entryRepo.save(entry);
    const redis = this.redisService.getClient();

    await redis.del(`daily-book:${adminId}:${dto.date}`);

    await redis.del(`ledger:${adminId}:${dto.accountId}`);

    await redis.del(`currency-trial-balance:${adminId}:${account.currencyId}`);

    await redis.del(`dailyBooksReport:${adminId}:${dto.date}`);

    console.log('🧹 Redis cache invalidated after currency entry');

    return { entry, updatedBalance: account.balance };
  }

  async createCurrencyJournalEntries(
    dto: CreateCurrencyJournalEntryDto,
    adminId: string,
  ) {
    const admin = await this.userRepo.findOne({ where: { id: adminId } });
    if (!admin) {
      throw new NotFoundException('Admin not found');
    }
    const accounts = await this.currencyRepo.findByIds([
      dto.DraccountId,
      dto.CraccountId,
    ]);

    if (accounts.length !== 2) {
      throw new NotFoundException('One or both customer accounts not found');
    }

    const drAccount = accounts.find((acc) => acc.id === dto.DraccountId);
    const crAccount = accounts.find((acc) => acc.id === dto.CraccountId);
    if (!drAccount || !crAccount) {
      throw new NotFoundException('One or both customer accounts not found');
    }

    drAccount.balance += dto.amount;
    crAccount.balance -= dto.amount;

    await this.currencyRepo.save([drAccount, crAccount]);

    const journalEntry = this.journalEntryRepo.create({
      date: dto.date,
      paymentType: dto.paymentType,
      DrAccount: drAccount,
      CrAccount: crAccount,
      amount: dto.amount,
      description: dto.description,
      adminId: adminId,
    });
    await this.journalEntryRepo.save(journalEntry);
    const redis = this.redisService.getClient();

    await redis.del(`daily-book:${adminId}:${dto.date}`);
    await redis.del(`ledger:${adminId}:${dto.DraccountId}`);
    await redis.del(`ledger:${adminId}:${dto.CraccountId}`);
    await redis.del(
      `currency-trial-balance:${adminId}:${drAccount.currencyId}`,
    );

    console.log('🧹 Redis cache invalidated after currency journal entry');
    return {
      journalEntry,
      drAccountBalance: drAccount.balance,
      crAccountBalance: crAccount.balance,
    };
  }

  async getDailyBook(filter: DailyBookDto, adminId: string, currencyId: string) {
    const cacheKey = `daily-book:${adminId}:${filter.date}:${currencyId}`;

    const cached = await this.redisService.getValue(cacheKey);
    if (cached) {
      console.log('✅ DailyBook cache HIT');
      return cached;
    }

    console.log('❌ DailyBook cache MISS');

    const date = new Date(filter.date);

    const entries = await this.entryRepo.find({
      where: { 
        date, 
        adminId,
        account: { currencyId }
      },
      relations: ['account'],
      order: { created_at: 'DESC' },
    });

    const result = entries.map((entry) => ({
      accountName: entry.account?.name,
      narration: `${entry.account?.name} To ${entry.description ?? ''}`.trim(),
      debitAmount: entry.entryType === EntryType.BANAM ? entry.amount : 0,
      creditAmount: entry.entryType === EntryType.JAMAM ? entry.amount : 0,
    }));

    await this.redisService.setValue(cacheKey, result, 300);
    console.log('💾 DailyBook cache SET');

    return result;
  }

  async getLedgers(
    adminId: string,
    accountId: string,
    currencyId: string,
    fromDate?: string,
    toDate?: string,
  ) {
    // Default toDate to today if not provided
    const to = toDate ? new Date(toDate) : new Date();
    to.setHours(23, 59, 59, 999);

    // fromDate defaults to beginning of time if not provided
    const from = fromDate ? new Date(fromDate) : new Date('1970-01-01');
    from.setHours(0, 0, 0, 0);

    const cacheKey = `ledger:${adminId}:${accountId}:${currencyId}:${from.toISOString()}:${to.toISOString()}`;

    const cached = await this.redisService.getValue(cacheKey);
    if (cached) {
      console.log('✅ Ledger cache HIT');
      return cached;
    }

    console.log('❌ Ledger cache MISS');

    const account = await this.currencyRepo.findOne({
      where: { id: accountId, adminId, currencyId },
    });

    if (!account) {
      throw new BadRequestException(
        'No Account Found of This User in Your Profile',
      );
    }

    const entries = await this.entryRepo.find({
      where: {
        account: { id: accountId },
        date: Between(from, to),
      },
      order: { date: 'ASC' },
    });

    if (!entries || entries.length === 0) {
      throw new BadRequestException('There is no Entry of this User Account');
    }

    const Accountentries = entries.map((entry) => ({
      entryDate: entry.date,
      accountName: entry.account?.name,
      paymentType: entry.paymentType,
      narration: `${entry.account?.name} To ${entry.description ?? ''}`.trim(),
      debitAmount: entry.entryType === EntryType.BANAM ? entry.amount : 0,
      creditAmount: entry.entryType === EntryType.JAMAM ? entry.amount : 0,
      entryBalance: entry.balance,
    }));

    let totalCr = 0;
    let totalDr = 0;

    entries.forEach((entry) => {
      if (entry.entryType === EntryType.JAMAM) {
        totalCr += entry.amount;
      } else {
        totalDr += entry.amount;
      }
    });

    const result = {
      accountName: account.name,
      entries: Accountentries,
      totals: {
        totalCr,
        totalDr,
        netBalance: totalCr - totalDr,
      },
    };

    await this.redisService.setValue(cacheKey, result, 300);
    console.log('💾 Ledger cache SET');

    return result;
  }

  async currencyTrailBalance(adminId: string, currencyId: string) {
    try {
      const cacheKey = `currency-trial-balance:${adminId}:${currencyId}`;
      const cached = await this.redisService.getValue(cacheKey);

      if (cached) {
        console.log('✅ Currency Trial Balance cache HIT');
        return cached;
      }

      console.log('❌ Currency Trial Balance cache MISS');

      const result = await this.entryRepo
        .createQueryBuilder('entry')
        .innerJoin('entry.account', 'account')
        .where('account.adminId = :adminId', { adminId })
        .andWhere('account.currencyId = :currencyId', { currencyId })
        .select('account.name', 'accountName')
        .addSelect(
          `SUM(CASE WHEN entry.entryType = :cr THEN entry.amount ELSE 0 END)`,
          'totalCr',
        )
        .addSelect(
          `SUM(CASE WHEN entry.entryType != :cr THEN entry.amount ELSE 0 END)`,
          'totalDr',
        )
        .setParameter('cr', EntryType.JAMAM)
        .groupBy('account.id')
        .having(`SUM(entry.amount) != 0`)
        .getRawMany();

      const trailBalance = result.map((row) => ({
        accountName: row.accountName,
        totalCr: Number(row.totalCr),
        totalDr: Number(row.totalDr),
        netBalance: Number(row.totalCr) - Number(row.totalDr),
      }));

      await this.redisService.setValue(cacheKey, trailBalance, 300);
      console.log('💾 Currency Trial Balance cache SET');

      return trailBalance;
    } catch (error) {
      throw new InternalServerErrorException(
        'Unable to fetch currency trial balance. Please try again later.',
      );
    }
  }
}
