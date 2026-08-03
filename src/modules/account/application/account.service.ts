import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { CustomerAccountEntity } from '../domain/entity/customer-account.entity';
import { Repository, DataSource } from 'typeorm';
import { CreateCustomerAccountDto } from '../domain/dto/create-customer-account.dto';
import { CreateBankAccountDto } from '../domain/dto/create-bank-account.dto';
import { BankAccountEntity } from '../domain/entity/bank-account.entity';
import { GeneralAccountEntity } from '../domain/entity/general-account.entity';
import { CreateGeneralAccountDto } from '../domain/dto/create-general-account.dto';
import { EmployeeAccountEntity } from '../domain/entity/employee-account.entity';
import { CreateEmployeeAccountDto } from '../domain/dto/create-employee-account.dto';
import { PaginationDto } from '../../../shared/modules/dtos/pagination.dto';
import { buildPaginationResponse } from '../../../shared/utils/pagination.utils';
import { CreateAddExpenseDto } from '../domain/dto/create-add-expense.dto';
import { AddExpenseEntity } from '../domain/entity/add-expense.entity';
import { CreateAddChqRefBankDto } from '../domain/dto/create-add-chq-ref-bank.dto';
import { AddChqRefBankEntity } from '../domain/entity/add-chq-ref-bank.entity';
import { CreateAddCurrencyDto } from '../domain/dto/create-add-currency.dto';
import { AddCurrencyEntity } from '../domain/entity/currency.entity';
import { CreateCurrencyAccountDto } from '../domain/dto/create-currency-account.dto';
import { CurrencyAccountEntity } from '../domain/entity/currency-account.entity';
import { RedisService } from '../../../shared/modules/redis/redis.service';

@Injectable()
export default class AccountService {
  constructor(
    @InjectRepository(CustomerAccountEntity)
    private readonly customerAccountRepository: Repository<CustomerAccountEntity>,
    @InjectRepository(BankAccountEntity)
    private readonly bankRepo: Repository<BankAccountEntity>,
    @InjectRepository(GeneralAccountEntity)
    private readonly generalAccountRepo: Repository<GeneralAccountEntity>,
    @InjectRepository(EmployeeAccountEntity)
    private readonly employeeRepo: Repository<EmployeeAccountEntity>,
    @InjectRepository(AddExpenseEntity)
    private readonly expenseRepo: Repository<AddExpenseEntity>,
    @InjectRepository(AddChqRefBankEntity)
    private readonly chqRefBankRepo: Repository<AddChqRefBankEntity>,
    @InjectRepository(AddCurrencyEntity)
    private readonly currencyRepo: Repository<AddCurrencyEntity>,
    @InjectRepository(CurrencyAccountEntity)
    private readonly currencyAccountRepo: Repository<CurrencyAccountEntity>,

    private readonly redisService: RedisService,
    private readonly dataSource: DataSource,
  ) {}

  async addUserAccount(dto: CreateCustomerAccountDto, adminId: string) {
    const newAccount = this.customerAccountRepository.create({
      ...dto,
      adminId,
    });
    const savedAccount = await this.customerAccountRepository.save(newAccount);

    // Invalidate every cached dropdown/list that includes customer accounts
    await this.redisService.deleteKeysByPattern(`customers_${adminId}*`);
    await this.redisService.deleteKey(`customers_banks_${adminId}`);
    await this.redisService.deleteKey(`all_accounts_${adminId}`);

    return savedAccount;
  }

  async findAllUserAccount(adminId: string, paginationDto: PaginationDto) {
    const { offset, limit } = paginationDto;

    const [data, total] = await this.customerAccountRepository.findAndCount({
      where: { adminId },
      skip: (offset - 1) * limit,
      take: limit,
      order: { id: 'DESC' },
    });
    return buildPaginationResponse(data, total, offset, limit);
  }

  async addBankAccount(dto: CreateBankAccountDto, adminId: string,): Promise<BankAccountEntity> {
    const newAccount = this.bankRepo.create({
      ...dto,
      adminId,
    });
    const savedAccount = await this.bankRepo.save(newAccount);

    await this.redisService.deleteKey(`banks_${adminId}`);
    await this.redisService.deleteKey(`customers_banks_${adminId}`);
    await this.redisService.deleteKey(`all_accounts_${adminId}`);

    return savedAccount;
  }

  async findAllBankAccount(adminId: string, paginationDto: PaginationDto) {
    const { offset, limit } = paginationDto;
    const [data, total] = await this.bankRepo.findAndCount({
      where: { adminId },
      skip: (offset - 1) * limit,
      take: limit,
      order: { id: 'DESC' },
    });
    return buildPaginationResponse(data, total, offset, limit);
  }

  async addGeneralAccount(dto: CreateGeneralAccountDto, adminId: string,): Promise<GeneralAccountEntity> {
    const newAccount = this.generalAccountRepo.create({
      ...dto,
      adminId,
    });
    const savedAccount = await this.generalAccountRepo.save(newAccount);

    await this.redisService.deleteKey(`general_accounts_${dto.accountType}_${adminId}`);

    return savedAccount;
  }

  async getAllGeneralAccounts(adminId: string, paginationDto: PaginationDto) {
    const { offset, limit } = paginationDto;

    const [data, total] = await this.generalAccountRepo.findAndCount({
      where: { adminId },
      skip: (offset - 1) * limit,
      take: limit,
      order: { id: 'DESC' },
    });

    return buildPaginationResponse(data, total, offset, limit);
  }

  async addExpense(dto: CreateAddExpenseDto, adminId: string,): Promise<AddExpenseEntity> {
    const expense = this.expenseRepo.create({
      ...dto,
      adminId,
    });
    return await this.expenseRepo.save(expense);
  }

  async getAllExpenses(adminId: string, paginationDto: PaginationDto) {
    const { offset, limit } = paginationDto;

    const [data, total] = await this.expenseRepo.findAndCount({
      where: { adminId },
      skip: (offset - 1) * limit,
      take: limit,
      order: { createdAt: 'DESC' },
    });

    return buildPaginationResponse(data, total, offset, limit);
  }

  async addChqRefBank(dto: CreateAddChqRefBankDto, adminId: string,): Promise<AddChqRefBankEntity> {
    const bank = this.chqRefBankRepo.create({
      ...dto,
      adminId,
    });
    const savedBank = await this.chqRefBankRepo.save(bank);
    
    // Clear ChqRefBank dropdown cache after creating new entry
    const cacheKey = `chq_ref_banks_${adminId}`;
    await this.redisService.deleteKey(cacheKey);
    console.log('🗑️ Cache CLEARED for key:', cacheKey);
    
    return savedBank;
  }

  async getAllChqRefBank(adminId: string, paginationDto: PaginationDto) {
    const { offset, limit } = paginationDto;

    const [data, total] = await this.chqRefBankRepo.findAndCount({
      where: { adminId },
      skip: (offset - 1) * limit,
      take: limit,
      order: { createdAt: 'DESC' },
    });

    return buildPaginationResponse(data, total, offset, limit);
  }

  async addEmplyeeAccount(dto: CreateEmployeeAccountDto, adminId: string,): Promise<EmployeeAccountEntity> {
    const employee = this.employeeRepo.create({
      ...dto,
      adminId,
    });
    return await this.employeeRepo.save(employee);
  }

  async getallEmplyeeAccount(adminId: string, paginationDto: PaginationDto) {
    const { offset, limit } = paginationDto;

    const [data, total] = await this.employeeRepo.findAndCount({
      where: { adminId },
      skip: (offset - 1) * limit,
      take: limit,
      order: { id: 'DESC' },
    });

    return buildPaginationResponse(data, total, offset, limit);
  }

  async addCurrency(dto: CreateAddCurrencyDto, adminId: string,): Promise<AddCurrencyEntity> {
    const currency = this.currencyRepo.create({
      ...dto,
      adminId,
    });
    return await this.currencyRepo.save(currency);
  }

  async getAllCurrencies(adminId: string, paginationDto: PaginationDto) {
    const { offset, limit } = paginationDto;

    const [data, total] = await this.currencyRepo.findAndCount({
      where: { adminId },
      skip: (offset - 1) * limit,
      take: limit,
      order: { createdAt: 'DESC' },
    });

    return buildPaginationResponse(data, total, offset, limit);
  }

  async getAllCurrencieswithoutPagination(adminId: string) {
    return await this.currencyRepo.find({
      select: ['id', 'name'],
      where:{adminId: adminId},
      order: { name: 'ASC' },
    });
  }

  async createCurrencyAccount(dto: CreateCurrencyAccountDto, adminId: string) {
    const currency = await this.currencyRepo.findOne({
      where: { id: dto.currencyId }
    });
    if (!currency) {
      throw new Error('Currency not found.');
    }
    const account = this.currencyAccountRepo.create({
      ...dto,
      adminId
    });
    return await this.currencyAccountRepo.save(account);
  }

  async getAllCurrencyAccounts(adminId: string, paginationDto: PaginationDto) {
    const { offset, limit } = paginationDto;

    const [data, total] = await this.currencyAccountRepo.findAndCount({
      where: { adminId },
      relations: ['currency'],
      skip: (offset - 1) * limit,
      take: limit,
      order: { createdAt: 'DESC' },
    });

    return buildPaginationResponse(data, total, offset, limit);
  }

  /**
   * Delete a currency and all its related data
   * This includes:
   * - Currency accounts (customer_currency_accounts)
   * - Currency entries (customer_currency_entries)
   * - Currency journal entries (journal_currency_entries)
   * - Currency stocks (currency_stocks)
   * - Currency balances (currency_balances)
   * - Currency relations (currency_relation)
   * - Purchase entries (purchase_entries)
   * - Selling entries (selling_entries)
   * - General ledger entries (general_ledger)
   * - Currency accounts from currency_account table
   */
  async deleteCurrency(currencyId: string, adminId: string) {
    // Verify currency exists and belongs to admin
    const currency = await this.currencyRepo.findOne({
      where: { id: currencyId, adminId },
    });

    if (!currency) {
      throw new NotFoundException('Currency not found or access denied');
    }

    // Check which tables exist before starting transaction
    const tableExists = async (tableName: string): Promise<boolean> => {
      try {
        const result = await this.dataSource.query(
          `SELECT EXISTS (
            SELECT FROM information_schema.tables 
            WHERE table_schema = 'public' 
            AND table_name = $1
          )`,
          [tableName]
        );
        return result[0]?.exists || false;
      } catch {
        return false;
      }
    };

    const tables = {
      journalCurrencyEntries: await tableExists('journal_currency_entries'),
      customerCurrencyEntries: await tableExists('customer_currency_entries'),
      customerCurrencyAccounts: await tableExists('customer_currency_accounts'),
      currencyStocks: await tableExists('currency_stocks'),
      currencyBalances: await tableExists('currency_balances'),
      currencyRelation: await tableExists('currency_relation'),
      purchaseEntries: await tableExists('purchase_entries'),
      sellingEntries: await tableExists('selling_entries'),
      generalLedger: await tableExists('general_ledger'),
      currencyAccount: await tableExists('currency_account'),
    };

    return await this.dataSource.transaction(async (manager) => {
      // Get all customer currency account IDs first (before deleting them)
      let accountIdList: string[] = [];
      if (tables.customerCurrencyAccounts) {
        const accountIds = await manager.query(
          `SELECT id FROM customer_currency_accounts WHERE currency_id = $1 AND admin_id = $2`,
          [currencyId, adminId]
        );
        accountIdList = accountIds.map((a: any) => a.id);
      }

      // 1. Delete currency journal entries (using account IDs)
      if (tables.journalCurrencyEntries && accountIdList.length > 0) {
        await manager.query(
          `DELETE FROM journal_currency_entries 
           WHERE "Cr_account_id" = ANY($1::uuid[]) OR "Dr_account_id" = ANY($1::uuid[])`,
          [accountIdList]
        );
      }

      // 2. Delete customer currency entries
      if (tables.customerCurrencyEntries && accountIdList.length > 0) {
        await manager.query(
          `DELETE FROM customer_currency_entries WHERE account_id = ANY($1::uuid[])`,
          [accountIdList]
        );
      }

      // 3. Delete customer currency accounts
      if (tables.customerCurrencyAccounts) {
        await manager.query(
          `DELETE FROM customer_currency_accounts WHERE currency_id = $1 AND admin_id = $2`,
          [currencyId, adminId]
        );
      }

      // 4. Delete currency stocks
      if (tables.currencyStocks) {
        await manager.query(
          `DELETE FROM currency_stocks WHERE currency_id = $1 AND admin_id = $2`,
          [currencyId, adminId]
        );
      }

      // 5. Delete currency balances
      if (tables.currencyBalances) {
        await manager.query(
          `DELETE FROM currency_balances WHERE currency_id = $1 AND admin_id = $2`,
          [currencyId, adminId]
        );
      }

      // 6. Delete currency relations
      if (tables.currencyRelation) {
        await manager.query(
          `DELETE FROM currency_relation WHERE currency_id = $1 AND admin_id = $2`,
          [currencyId, adminId]
        );
      }

      // 7. Delete purchase entries
      if (tables.purchaseEntries) {
        await manager.query(
          `DELETE FROM purchase_entries WHERE currency_dr_id = $1 AND admin_id = $2`,
          [currencyId, adminId]
        );
      }

      // 8. Delete selling entries
      if (tables.sellingEntries) {
        await manager.query(
          `DELETE FROM selling_entries WHERE from_currency_id = $1 AND admin_id = $2`,
          [currencyId, adminId]
        );
      }

      // 9. Delete general ledger entries for this currency
      if (tables.generalLedger) {
        await manager.query(
          `DELETE FROM general_ledger WHERE account_id = $1 AND admin_id = $2 AND account_type = 'CURRENCY'`,
          [currencyId, adminId]
        );
      }

      // 10. Delete currency accounts (from currency_account table)
      if (tables.currencyAccount) {
        await manager.query(
          `DELETE FROM currency_account WHERE "currencyId" = $1 AND admin_id = $2`,
          [currencyId, adminId]
        );
      }

      // 11. Finally, delete the currency itself
      await manager.query(
        `DELETE FROM currency_user WHERE id = $1 AND admin_id = $2`,
        [currencyId, adminId]
      );

      // 12. Clear all related Redis cache
      const redis = this.redisService.getClient();
      const keys = await redis.keys(`*${adminId}*`);
      if (keys.length > 0) {
        await redis.del(...keys);
      }

      return {
        success: true,
        message: 'Currency and all related data deleted successfully',
        deletedCurrency: {
          id: currency.id,
          name: currency.name,
          code: currency.code,
        },
      };
    });
  }
}