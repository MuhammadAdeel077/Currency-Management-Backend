import { BadRequestException, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { JournalEntryEntity } from '../domain/entity/journal-entry.entity';
import { CustomerAccountEntity } from '../../account/domain/entity/customer-account.entity';
import { CreateJournalEntryDto } from '../domain/dto/create-journal-entry.dto';
import { BankPaymentEntryEntity } from '../domain/entity/bank-payment-entry.entity';
import { CreateBankPaymentEntryDto } from '../domain/dto/create-bank-payment-entry.dto';
import { BankReceiverEntryEntity } from '../domain/entity/bank-receiver-entry.entity';
import { CreateBankReceiverEntryDto } from '../domain/dto/reate-bank-receiver-entry.dto';
import { CashPaymentEntryEntity } from '../domain/entity/cash-payment-entry.entity';
import { CreateCashPaymentEntryDto } from '../domain/dto/create-cash-payment-entry.dto';
import { CashReceivedEntryEntity } from '../domain/entity/cash-received-entry.entity';
import { CreateCashReceivedEntryDto } from '../domain/dto/create-cash-received-entry.dto';
import { BankAccountEntity } from '../../account/domain/entity/bank-account.entity';
import { GeneralAccountEntity } from '../../account/domain/entity/general-account.entity';
import { AccountType } from '../../account/domain/enums/account-type.enum';
import { GeneralLedgerService } from './general-ledger.service';
import { ReportService } from '../../reports/application/report.service';

@Injectable()
export class JournalService {
  constructor(
    @InjectRepository(JournalEntryEntity)
    private readonly journalRepo: Repository<JournalEntryEntity>,

    @InjectRepository(CustomerAccountEntity)
    private readonly accountsRepo: Repository<CustomerAccountEntity>,

    @InjectRepository(BankPaymentEntryEntity)
    private readonly bankPaymentRepo: Repository<BankPaymentEntryEntity>,

    @InjectRepository(BankAccountEntity)
    private readonly bankAccount: Repository<BankAccountEntity>,

    @InjectRepository(BankReceiverEntryEntity)
    private readonly bankReceiverRepo: Repository<BankReceiverEntryEntity>,

    @InjectRepository(CashPaymentEntryEntity)
    private readonly cashPaymentRepo: Repository<CashPaymentEntryEntity>,

    @InjectRepository(CashReceivedEntryEntity)
    private readonly cashReceivedRepo: Repository<CashReceivedEntryEntity>,

    @InjectRepository(GeneralAccountEntity)
    private readonly generalAccountRepo: Repository<GeneralAccountEntity>,

    private readonly dataSource: DataSource,

    private readonly generalLedgerService: GeneralLedgerService,

    private readonly reportService: ReportService,
  ) {}

  async createJournalEntry(dto: CreateJournalEntryDto, adminId: string) {
    const crAccount = await this.accountsRepo.findOne({
      where: { id: dto.crAccountId },
    });
    const drAccount = await this.accountsRepo.findOne({
      where: { id: dto.drAccountId },
    });

    if (!crAccount || !drAccount) {
      throw new Error('Invalid account selected for credit or debit.');
    }

    const entry = this.journalRepo.create({
      date: dto.date,
      paymentType: dto.paymentType,
      crAccount,
      drAccount,
      amount: dto.amount,
      description: dto.description,
      chqNo: dto.chqNo,
      adminId,
    });

    const savedEntry = await this.journalRepo.save(entry);

    // Log to General Ledger
    await this.generalLedgerService.createLedgerEntries([
      {
        adminId,
        transactionDate: dto.date,
        accountId: crAccount.id,
        accountName: crAccount.name,
        accountType: 'CUSTOMER',
        entryType: 'JOURNAL',
        sourceEntryId: savedEntry.id,
        creditAmount: dto.amount,
        debitAmount: 0,
        description: dto.description,
        paymentType: dto.paymentType,
        contraAccountId: drAccount.id,
        contraAccountName: drAccount.name,
      },
      {
        adminId,
        transactionDate: dto.date,
        accountId: drAccount.id,
        accountName: drAccount.name,
        accountType: 'CUSTOMER',
        entryType: 'JOURNAL',
        sourceEntryId: savedEntry.id,
        debitAmount: dto.amount,
        creditAmount: 0,
        description: dto.description,
        paymentType: dto.paymentType,
        contraAccountId: crAccount.id,
        contraAccountName: crAccount.name,
      },
    ]);

    await this.reportService.invalidateCachesAfterJournalEntry(adminId, dto.date);

    return savedEntry;
  }

  async getAllJournalEntries(adminId: string) {
    return await this.journalRepo.find({
      where: { adminId },
      order: { date: 'DESC' },
      relations: ['crAccount', 'drAccount'],
    });
  }

  async createBankPaymentEntry(
    dto: CreateBankPaymentEntryDto,
    adminId: string,
  ) {
    const crAccount = await this.bankAccount.findOne({
      where: { id: dto.crAccountId },
    });
    const drAccount = await this.accountsRepo.findOne({
      where: { id: dto.drAccountId },
    });

    if (!drAccount || !crAccount) {
      throw new Error('Invalid account selected for credit or debit.');
    }

    const bankEntry = this.bankPaymentRepo.create({
      date: dto.date,
      crAccount,
      drAccount,
      amount: dto.amount,
      description: dto.description,
      chqNo: dto.chqNo,
      adminId,
    });

    const savedEntry = await this.bankPaymentRepo.save(bankEntry);

    // Log to General Ledger
    await this.generalLedgerService.createLedgerEntries([
      {
        adminId,
        transactionDate: dto.date,
        accountId: crAccount.id,
        accountName: crAccount.bankName,
        accountType: 'BANK',
        entryType: 'BANK_PAYMENT',
        sourceEntryId: savedEntry.id,
        referenceNumber: dto.chqNo,
        creditAmount: dto.amount,
        debitAmount: 0,
        description: dto.description,
        contraAccountId: drAccount.id,
        contraAccountName: drAccount.name,
      },
      {
        adminId,
        transactionDate: dto.date,
        accountId: drAccount.id,
        accountName: drAccount.name,
        accountType: 'CUSTOMER',
        entryType: 'BANK_PAYMENT',
        sourceEntryId: savedEntry.id,
        referenceNumber: dto.chqNo,
        debitAmount: dto.amount,
        creditAmount: 0,
        description: dto.description,
        contraAccountId: crAccount.id,
        contraAccountName: crAccount.bankName,
      },
    ]);

    await this.reportService.invalidateCachesAfterBankPaymentEntry(adminId, dto.date);

    return savedEntry;
  }

  async getAllBankPaymentEntries(adminId: string) {
    return await this.bankPaymentRepo.find({
      where: { adminId },
      order: { date: 'DESC' },
      relations: ['crAccount', 'drAccount'],
    });
  }

  async createBankReceiverEntry(
    dto: CreateBankReceiverEntryDto,
    adminId: string,
  ) {
    const crAccount = await this.accountsRepo.findOne({
      where: { id: dto.crAccountId },
    });
    const drAccount = await this.bankAccount.findOne({
      where: { id: dto.drAccountId },
    });

    if (!crAccount || !drAccount) {
      throw new Error('Invalid account selected for credit or debit.');
    }

    const entry = this.bankReceiverRepo.create({
      date: dto.date,
      crAccount,
      drAccount,
      amount: dto.amount,
      branchCode: dto.branchCode,
      adminId,
    });

    const savedEntry = await this.bankReceiverRepo.save(entry);

    // Log to General Ledger - Bank Receiver (Cr: Customer, Dr: Bank)
    await this.generalLedgerService.createLedgerEntries([
      {
        adminId,
        transactionDate: dto.date,
        accountId: crAccount.id,
        accountName: crAccount.name,
        accountType: 'CUSTOMER',
        entryType: 'BANK_RECEIPT',
        sourceEntryId: savedEntry.id,
        referenceNumber: dto.branchCode,
        creditAmount: dto.amount,
        debitAmount: 0,
        contraAccountId: drAccount.id,
        contraAccountName: drAccount.bankName,
      },
      {
        adminId,
        transactionDate: dto.date,
        accountId: drAccount.id,
        accountName: drAccount.bankName,
        accountType: 'BANK',
        entryType: 'BANK_RECEIPT',
        sourceEntryId: savedEntry.id,
        referenceNumber: dto.branchCode,
        debitAmount: dto.amount,
        creditAmount: 0,
        contraAccountId: crAccount.id,
        contraAccountName: crAccount.name,
      },
    ]);

    await this.reportService.invalidateCachesAfterBankReceiverEntry(adminId, dto.date);

    return savedEntry;
  }

  async getAllBankReceiverEntries(adminId: string) {
    return await this.bankReceiverRepo.find({
      where: { adminId },
      order: { date: 'DESC' },
    });
  }

  async createCashPaymentEntry(
    dto: CreateCashPaymentEntryDto,
    adminId: string,
  ) {
    const crAccount = await this.generalAccountRepo.findOne({
      where: { id: dto.crAccountId },
    });
    const drAccount = await this.accountsRepo.findOne({
      where: { id: dto.drAccountId },
    });

    if (!drAccount || !crAccount) {
      throw new Error('Invalid account selected for credit or debit.');
    }

    if (crAccount.accountType !== AccountType.CASH) {
      throw new Error('Credit account must be a Cash-type General Account.');
    }

    const entry = this.cashPaymentRepo.create({
      date: dto.date,
      crAccount,
      drAccount,
      amount: dto.amount,
      description: dto.description,
      adminId,
    });

    const savedEntry = await this.cashPaymentRepo.save(entry);

    // Log to General Ledger - Cash payment (Dr: Customer, Cr: Cash account)
    await this.generalLedgerService.createLedgerEntries([
      {
        adminId,
        transactionDate: dto.date,
        accountId: crAccount.id,
        accountName: crAccount.name,
        accountType: 'GENERAL',
        entryType: 'CASH_PAYMENT',
        sourceEntryId: savedEntry.id,
        creditAmount: dto.amount,
        debitAmount: 0,
        description: dto.description,
        contraAccountId: drAccount.id,
        contraAccountName: drAccount.name,
      },
      {
        adminId,
        transactionDate: dto.date,
        accountId: drAccount.id,
        accountName: drAccount.name,
        accountType: 'CUSTOMER',
        entryType: 'CASH_PAYMENT',
        sourceEntryId: savedEntry.id,
        debitAmount: dto.amount,
        creditAmount: 0,
        description: dto.description,
        contraAccountId: crAccount.id,
        contraAccountName: crAccount.name,
      },
    ]);

    await this.reportService.invalidateCachesAfterCashPaymentEntry(adminId, dto.date);

    return savedEntry;
  }

  async getAllCashPaymentEntries(adminId: string) {
    return await this.cashPaymentRepo.find({
      where: { adminId },
      order: { date: 'DESC' },
      relations: ['crAccount', 'drAccount'],
    });
  }

  async createCashReceivedEntry(
    dto: CreateCashReceivedEntryDto,
    adminId: string,
  ) {
    const crAccount = await this.accountsRepo.findOne({
      where: { id: dto.crAccountId },
    });
    const drAccount = await this.generalAccountRepo.findOne({
      where: { id: dto.drAccountId },
    });

    if (!crAccount || !drAccount) {
      throw new Error('Invalid account selected for credit or debit.');
    }

    if (drAccount.accountType !== AccountType.CASH) {
      throw new Error('Debit account must be a Cash-type General Account.');
    }

    const entry = this.cashReceivedRepo.create({
      date: dto.date,
      crAccount,
      drAccount,
      amount: dto.amount,
      description: dto.description,
      adminId,
    });

    const savedEntry = await this.cashReceivedRepo.save(entry);

    // Log to General Ledger - Cash received (Dr: Cash account, Cr: Customer)
    await this.generalLedgerService.createLedgerEntries([
      {
        adminId,
        transactionDate: dto.date,
        accountId: drAccount.id,
        accountName: drAccount.name,
        accountType: 'GENERAL',
        entryType: 'CASH_RECEIPT',
        sourceEntryId: savedEntry.id,
        debitAmount: dto.amount,
        creditAmount: 0,
        description: dto.description,
        contraAccountId: crAccount.id,
        contraAccountName: crAccount.name,
      },
      {
        adminId,
        transactionDate: dto.date,
        accountId: crAccount.id,
        accountName: crAccount.name,
        accountType: 'CUSTOMER',
        entryType: 'CASH_RECEIPT',
        sourceEntryId: savedEntry.id,
        creditAmount: dto.amount,
        debitAmount: 0,
        description: dto.description,
        contraAccountId: drAccount.id,
        contraAccountName: drAccount.name,
      },
    ]);

    await this.reportService.invalidateCachesAfterCashReceivedEntry(adminId, dto.date);

    return savedEntry;
  }

  async getAllCashReceivedEntries(adminId: string) {
    return await this.cashReceivedRepo.find({
      where: { adminId },
      order: { date: 'DESC' },
      relations: ['crAccount', 'drAccount'],
    });
  }

  async createMultipleJournalEntries(
    dtos: CreateJournalEntryDto[],
    adminId: string,
  ) {
    return await this.dataSource.transaction(async (manager) => {
      const entriesToSave: JournalEntryEntity[] = [];

      for (const dto of dtos) {
        const [crAccount, drAccount] = await Promise.all([
          manager.findOne(CustomerAccountEntity, {
            where: { id: dto.crAccountId },
          }),
          manager.findOne(CustomerAccountEntity, {
            where: { id: dto.drAccountId },
          }),
        ]);

        if (!crAccount || !drAccount) {
          throw new Error(
            `Invalid account selected for entry with description "${dto.description}"`,
          );
        }

        const entry = manager.create(JournalEntryEntity, {
          date: dto.date,
          paymentType: dto.paymentType,
          crAccount,
          drAccount,
          amount: dto.amount,
          description: dto.description,
          chqNo: dto.chqNo,
          adminId,
        });

        entriesToSave.push(entry);
      }

      // Insert all journal entries in one go
      const saved = await manager.save(JournalEntryEntity, entriesToSave);

      await this.reportService.invalidateCachesAfterJournalEntry(adminId);

      return saved;
    });
  }

  async getAvailableAccounts(adminId: string) {
    const accounts = await this.accountsRepo.find({
      where: { adminId },
      select: ['id', 'name'],
      order: { name: 'ASC' },
    });

    return {
      crAccounts: accounts,
      drAccounts: accounts,
    };
  }
}
