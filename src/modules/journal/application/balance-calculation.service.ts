import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { AccountBalanceEntity } from '../domain/entity/account-balance.entity';
import { AccountLedgerEntity } from '../domain/entity/account-ledger.entity';
import { JournalEntryEntity } from '../domain/entity/journal-entry.entity';
import { BankPaymentEntryEntity } from '../domain/entity/bank-payment-entry.entity';
import { BankReceiverEntryEntity } from '../domain/entity/bank-receiver-entry.entity';
import { CashPaymentEntryEntity } from '../domain/entity/cash-payment-entry.entity';
import { CashReceivedEntryEntity } from '../domain/entity/cash-received-entry.entity';
import { CustomerAccountEntity } from '../../account/domain/entity/customer-account.entity';
import { BankAccountEntity } from '../../account/domain/entity/bank-account.entity';
import { GeneralAccountEntity } from '../../account/domain/entity/general-account.entity';
import { CurrencyStockEntity } from '../../currency/domain/entities/currency-stock.entity';
import { SellingEntryEntity } from '../../sale-purchase/domain/entity/selling_entries.entity';
import { PurchaseEntryEntity } from '../../sale-purchase/domain/entity/purchase_entries.entity';

@Injectable()
export class BalanceCalculationService {
  constructor(
    @InjectRepository(AccountBalanceEntity)
    private readonly accountBalanceRepository: Repository<AccountBalanceEntity>,

    @InjectRepository(AccountLedgerEntity)
    private readonly accountLedgerRepository: Repository<AccountLedgerEntity>,

    @InjectRepository(JournalEntryEntity)
    private readonly journalEntryRepository: Repository<JournalEntryEntity>,

    @InjectRepository(BankPaymentEntryEntity)
    private readonly bankPaymentRepository: Repository<BankPaymentEntryEntity>,

    @InjectRepository(BankReceiverEntryEntity)
    private readonly bankReceiverRepository: Repository<BankReceiverEntryEntity>,

    @InjectRepository(CashPaymentEntryEntity)
    private readonly cashPaymentRepository: Repository<CashPaymentEntryEntity>,

    @InjectRepository(CashReceivedEntryEntity)
    private readonly cashReceivedRepository: Repository<CashReceivedEntryEntity>,

    @InjectRepository(CustomerAccountEntity)
    private readonly customerAccountRepository: Repository<CustomerAccountEntity>,

    @InjectRepository(BankAccountEntity)
    private readonly bankAccountRepository: Repository<BankAccountEntity>,

    @InjectRepository(GeneralAccountEntity)
    private readonly generalAccountRepository: Repository<GeneralAccountEntity>,

    @InjectRepository(CurrencyStockEntity)
    private readonly currencyStockRepository: Repository<CurrencyStockEntity>,

    @InjectRepository(SellingEntryEntity)
    private readonly sellingEntryRepository: Repository<SellingEntryEntity>,

    @InjectRepository(PurchaseEntryEntity)
    private readonly purchaseEntryRepository: Repository<PurchaseEntryEntity>,
  ) {}

  /**
   * Recalculate balance for a customer account and update materialized records
   * Called whenever a customer-related entry is created/modified/deleted
   */
  async recalculateCustomerBalance(adminId: string, customerId: string): Promise<void> {
    const customer = await this.customerAccountRepository.findOne({
      where: { id: customerId, adminId },
    });

    if (!customer) return;

    // Calculate totals from all sources
    let totalDebit = 0;
    let totalCredit = 0;

    const drJournal = await this.journalEntryRepository
      .createQueryBuilder('je')
      .where('je.drAccountId = :customerId', { customerId })
      .andWhere('je.adminId = :adminId', { adminId })
      .select('SUM(je.amount)', 'total')
      .getRawOne();

    const crJournal = await this.journalEntryRepository
      .createQueryBuilder('je')
      .where('je.crAccountId = :customerId', { customerId })
      .andWhere('je.adminId = :adminId', { adminId })
      .select('SUM(je.amount)', 'total')
      .getRawOne();

    totalDebit += Number(drJournal?.total || 0);
    totalCredit += Number(crJournal?.total || 0);

    // Bank payments (money paid to customer)
    const bankPayments = await this.bankPaymentRepository
      .createQueryBuilder('bp')
      .where('bp.drAccountId = :customerId', { customerId })
      .andWhere('bp.adminId = :adminId', { adminId })
      .select('SUM(bp.amount)', 'total')
      .getRawOne();
    totalCredit += Number(bankPayments?.total || 0);

    // Bank receivers (money received from customer)
    const bankReceivers = await this.bankReceiverRepository
      .createQueryBuilder('br')
      .where('br.crAccountId = :customerId', { customerId })
      .andWhere('br.adminId = :adminId', { adminId })
      .select('SUM(br.amount)', 'total')
      .getRawOne();
    totalDebit += Number(bankReceivers?.total || 0);

    // Cash payments (cash paid to customer)
    const cashPayments = await this.cashPaymentRepository
      .createQueryBuilder('cp')
      .where('cp.drAccountId = :customerId', { customerId })
      .andWhere('cp.adminId = :adminId', { adminId })
      .select('SUM(cp.amount)', 'total')
      .getRawOne();
    totalCredit += Number(cashPayments?.total || 0);

    // Cash received (cash received from customer)
    const cashReceived = await this.cashReceivedRepository
      .createQueryBuilder('cr')
      .where('cr.crAccountId = :customerId', { customerId })
      .andWhere('cr.adminId = :adminId', { adminId })
      .select('SUM(cr.amount)', 'total')
      .getRawOne();
    totalDebit += Number(cashReceived?.total || 0);

    const balance = totalCredit - totalDebit;

    // Update or create balance record
    await this.accountBalanceRepository.upsert(
      {
        adminId,
        accountId: customerId,
        accountType: 'CUSTOMER',
        accountName: customer.name,
        accountMetadata: customer.contact,
        totalDebit,
        totalCredit,
        balance: Math.abs(balance),
        balanceType: balance >= 0 ? 'CREDIT' : 'DEBIT',
        lastEntryDate: new Date(),
      },
      ['adminId', 'accountId', 'accountType'],
    );

    // Regenerate ledger
    await this.regenerateCustomerLedger(adminId, customerId);
  }

  /**
   * Recalculate balance for a bank account
   */
  async recalculateBankBalance(adminId: string, bankId: string): Promise<void> {
    const bank = await this.bankAccountRepository.findOne({
      where: { id: bankId, adminId },
    });

    if (!bank) return;

    let totalDebit = 0;
    let totalCredit = 0;

    // Bank payments (money out)
    const payments = await this.bankPaymentRepository
      .createQueryBuilder('bp')
      .where('bp.bankAccountId = :bankId', { bankId })
      .andWhere('bp.adminId = :adminId', { adminId })
      .select('SUM(bp.amount)', 'total')
      .getRawOne();
    totalDebit += Number(payments?.total || 0);

    // Bank receivers (money in)
    const receivers = await this.bankReceiverRepository
      .createQueryBuilder('br')
      .where('br.bankAccountId = :bankId', { bankId })
      .andWhere('br.adminId = :adminId', { adminId })
      .select('SUM(br.amount)', 'total')
      .getRawOne();
    totalCredit += Number(receivers?.total || 0);

    // Cash payments from bank
    const cashPayments = await this.cashPaymentRepository
      .createQueryBuilder('cp')
      .where('cp.crAccountId = :bankId', { bankId })
      .andWhere('cp.adminId = :adminId', { adminId })
      .select('SUM(cp.amount)', 'total')
      .getRawOne();
    totalDebit += Number(cashPayments?.total || 0);

    // Cash received to bank
    const cashReceived = await this.cashReceivedRepository
      .createQueryBuilder('cr')
      .where('cr.drAccountId = :bankId', { bankId })
      .andWhere('cr.adminId = :adminId', { adminId })
      .select('SUM(cr.amount)', 'total')
      .getRawOne();
    totalCredit += Number(cashReceived?.total || 0);

    const balance = totalCredit - totalDebit;

    await this.accountBalanceRepository.upsert(
      {
        adminId,
        accountId: bankId,
        accountType: 'BANK',
        accountName: bank.bankName,
        accountMetadata: bank.accountNumber,
        totalDebit,
        totalCredit,
        balance: Math.abs(balance),
        balanceType: balance >= 0 ? 'CREDIT' : 'DEBIT',
        lastEntryDate: new Date(),
      },
      ['adminId', 'accountId', 'accountType'],
    );

    await this.regenerateBankLedger(adminId, bankId);
  }

  /**
   * Recalculate balance for a general account
   */
  async recalculateGeneralBalance(adminId: string, generalId: string): Promise<void> {
    const general = await this.generalAccountRepository.findOne({
      where: { id: generalId, adminId },
    });

    if (!general) return;

    const drEntries = await this.journalEntryRepository
      .createQueryBuilder('je')
      .where('je.drAccountId = :generalId', { generalId })
      .andWhere('je.adminId = :adminId', { adminId })
      .select('SUM(je.amount)', 'total')
      .getRawOne();

    const crEntries = await this.journalEntryRepository
      .createQueryBuilder('je')
      .where('je.crAccountId = :generalId', { generalId })
      .andWhere('je.adminId = :adminId', { adminId })
      .select('SUM(je.amount)', 'total')
      .getRawOne();

    const totalDebit = Number(drEntries?.total || 0);
    const totalCredit = Number(crEntries?.total || 0);
    const balance = totalCredit - totalDebit;

    await this.accountBalanceRepository.upsert(
      {
        adminId,
        accountId: generalId,
        accountType: 'GENERAL',
        accountName: general.name,
        totalDebit,
        totalCredit,
        balance: Math.abs(balance),
        balanceType: balance >= 0 ? 'CREDIT' : 'DEBIT',
        lastEntryDate: new Date(),
      },
      ['adminId', 'accountId', 'accountType'],
    );

    await this.regenerateGeneralLedger(adminId, generalId);
  }

  /**
   * Recalculate balance for a currency
   */
  async recalculateCurrencyBalance(adminId: string, currencyId: string): Promise<void> {
    const currency = await this.currencyStockRepository.findOne({
      where: { currencyId, adminId },
    });

    if (!currency) return;

    // For currencies, we use selling/purchase entries
    const stock = currency.currencyAmount || 0;

    await this.accountBalanceRepository.upsert(
      {
        adminId,
        accountId: currencyId,
        accountType: 'CURRENCY',
        accountName: currencyId,
        totalDebit: stock,
        totalCredit: 0,
        balance: stock,
        balanceType: 'DEBIT',
        lastEntryDate: new Date(),
      },
      ['adminId', 'accountId', 'accountType'],
    );

    await this.regenerateCurrencyLedger(adminId, currencyId);
  }

  /**
   * Regenerate ledger entries for a customer
   */
  private async regenerateCustomerLedger(adminId: string, customerId: string): Promise<void> {
    // Delete old ledger entries
    await this.accountLedgerRepository.delete({
      adminId,
      accountId: customerId,
      accountType: 'CUSTOMER',
    });

    const customer = await this.customerAccountRepository.findOne({
      where: { id: customerId, adminId },
    });

    if (!customer) return;

    const ledgerEntries: Partial<AccountLedgerEntity>[] = [];

    // Get all entries sorted by date
    const drJournal = await this.journalEntryRepository
      .createQueryBuilder('je')
      .where('je.drAccountId = :customerId', { customerId })
      .andWhere('je.adminId = :adminId', { adminId })
      .orderBy('je.date', 'ASC')
      .getMany();

    const crJournal = await this.journalEntryRepository
      .createQueryBuilder('je')
      .where('je.crAccountId = :customerId', { customerId })
      .andWhere('je.adminId = :adminId', { adminId })
      .orderBy('je.date', 'ASC')
      .getMany();

    const bankPayments = await this.bankPaymentRepository
      .createQueryBuilder('bp')
      .where('bp.drAccountId = :customerId', { customerId })
      .andWhere('bp.adminId = :adminId', { adminId })
      .orderBy('bp.date', 'ASC')
      .getMany();

    const bankReceivers = await this.bankReceiverRepository
      .createQueryBuilder('br')
      .where('br.crAccountId = :customerId', { customerId })
      .andWhere('br.adminId = :adminId', { adminId })
      .orderBy('br.date', 'ASC')
      .getMany();

    const cashPayments = await this.cashPaymentRepository
      .createQueryBuilder('cp')
      .where('cp.drAccountId = :customerId', { customerId })
      .andWhere('cp.adminId = :adminId', { adminId })
      .orderBy('cp.date', 'ASC')
      .getMany();

    const cashReceived = await this.cashReceivedRepository
      .createQueryBuilder('cr')
      .where('cr.crAccountId = :customerId', { customerId })
      .andWhere('cr.adminId = :adminId', { adminId })
      .orderBy('cr.date', 'ASC')
      .getMany();

    // Combine and sort
    const allEntries = [
      ...drJournal.map((e) => ({
        date: e.date,
        type: 'JOURNAL',
        debit: Number(e.amount),
        credit: 0,
        narration: e.description || 'Journal Entry',
        reference: e.chqNo,
        sourceId: e.id,
        sourceType: 'JOURNAL' as const,
      })),
      ...crJournal.map((e) => ({
        date: e.date,
        type: 'JOURNAL',
        debit: 0,
        credit: Number(e.amount),
        narration: e.description || 'Journal Entry',
        reference: e.chqNo,
        sourceId: e.id,
        sourceType: 'JOURNAL' as const,
      })),
      ...bankPayments.map((e) => ({
        date: e.date,
        type: 'BANK_PAYMENT',
        debit: 0,
        credit: Number(e.amount),
        narration: e.description || 'Bank Payment',
        reference: e.chqNo,
        sourceId: e.id,
        sourceType: 'BANK_PAYMENT' as const,
      })),
      ...bankReceivers.map((e) => ({
        date: e.date,
        type: 'BANK_RECEIPT',
        debit: Number(e.amount),
        credit: 0,
        narration: 'Bank Receipt',
        reference: e.branchCode,
        sourceId: e.id,
        sourceType: 'BANK_RECEIVER' as const,
      })),
      ...cashPayments.map((e) => ({
        date: e.date,
        type: 'CASH_PAYMENT',
        debit: 0,
        credit: Number(e.amount),
        narration: e.description || 'Cash Payment',
        reference: undefined,
        sourceId: e.id,
        sourceType: 'CASH_PAYMENT' as const,
      })),
      ...cashReceived.map((e) => ({
        date: e.date,
        type: 'CASH_RECEIPT',
        debit: Number(e.amount),
        credit: 0,
        narration: e.description || 'Cash Receipt',
        reference: undefined,
        sourceId: e.id,
        sourceType: 'CASH_RECEIVED' as const,
      })),
    ];

    allEntries.sort((a, b) => {
      const dateA = a.date instanceof Date ? a.date : new Date(a.date);
      const dateB = b.date instanceof Date ? b.date : new Date(b.date);
      return dateA.getTime() - dateB.getTime();
    });

    // Calculate running balances
    let cumulativeDebit = 0;
    let cumulativeCredit = 0;

    allEntries.forEach((entry) => {
      cumulativeDebit += entry.debit;
      cumulativeCredit += entry.credit;

      ledgerEntries.push({
        adminId,
        accountId: customerId,
        accountType: 'CUSTOMER',
        accountName: customer.name,
        date: entry.date instanceof Date ? entry.date : new Date(entry.date),
        entryType: entry.type,
        narration: entry.narration,
        debit: entry.debit,
        credit: entry.credit,
        balance: cumulativeCredit - cumulativeDebit,
        reference: entry.reference,
        cumulativeDebit,
        cumulativeCredit,
        sourceEntryId: entry.sourceId,
        sourceEntryType: entry.sourceType,
      });
    });

    if (ledgerEntries.length > 0) {
      await this.accountLedgerRepository.insert(ledgerEntries);
    }
  }

  /**
   * Regenerate ledger entries for a bank
   */
  private async regenerateBankLedger(adminId: string, bankId: string): Promise<void> {
    await this.accountLedgerRepository.delete({
      adminId,
      accountId: bankId,
      accountType: 'BANK',
    });

    const bank = await this.bankAccountRepository.findOne({
      where: { id: bankId, adminId },
    });

    if (!bank) return;

    const ledgerEntries: Partial<AccountLedgerEntity>[] = [];

    const payments = await this.bankPaymentRepository
      .createQueryBuilder('bp')
      .where('bp.bankAccountId = :bankId', { bankId })
      .andWhere('bp.adminId = :adminId', { adminId })
      .orderBy('bp.date', 'ASC')
      .getMany();

    const receivers = await this.bankReceiverRepository
      .createQueryBuilder('br')
      .where('br.bankAccountId = :bankId', { bankId })
      .andWhere('br.adminId = :adminId', { adminId })
      .orderBy('br.date', 'ASC')
      .getMany();

    const cashPayments = await this.cashPaymentRepository
      .createQueryBuilder('cp')
      .where('cp.crAccountId = :bankId', { bankId })
      .andWhere('cp.adminId = :adminId', { adminId })
      .orderBy('cp.date', 'ASC')
      .getMany();

    const cashReceived = await this.cashReceivedRepository
      .createQueryBuilder('cr')
      .where('cr.drAccountId = :bankId', { bankId })
      .andWhere('cr.adminId = :adminId', { adminId })
      .orderBy('cr.date', 'ASC')
      .getMany();

    const allEntries = [
      ...payments.map((e) => ({
        date: e.date,
        type: 'BANK_PAYMENT',
        debit: Number(e.amount),
        credit: 0,
        narration: e.description || 'Bank Payment',
        reference: e.chqNo,
        sourceId: e.id,
      })),
      ...receivers.map((e) => ({
        date: e.date,
        type: 'BANK_RECEIPT',
        debit: 0,
        credit: Number(e.amount),
        narration: 'Bank Receipt',
        reference: e.branchCode,
        sourceId: e.id,
      })),
      ...cashPayments.map((e) => ({
        date: e.date,
        type: 'CASH_PAYMENT',
        debit: Number(e.amount),
        credit: 0,
        narration: e.description || 'Cash Payment from Bank',
        reference: undefined,
        sourceId: e.id,
      })),
      ...cashReceived.map((e) => ({
        date: e.date,
        type: 'CASH_RECEIPT',
        debit: 0,
        credit: Number(e.amount),
        narration: e.description || 'Cash Receipt to Bank',
        reference: undefined,
        sourceId: e.id,
      })),
    ];

    allEntries.sort((a, b) => {
      const dateA = a.date instanceof Date ? a.date : new Date(a.date);
      const dateB = b.date instanceof Date ? b.date : new Date(b.date);
      return dateA.getTime() - dateB.getTime();
    });

    let cumulativeDebit = 0;
    let cumulativeCredit = 0;

    allEntries.forEach((entry) => {
      cumulativeDebit += entry.debit;
      cumulativeCredit += entry.credit;

      ledgerEntries.push({
        adminId,
        accountId: bankId,
        accountType: 'BANK',
        accountName: bank.bankName,
        date: entry.date instanceof Date ? entry.date : (new Date(entry.date) as Date),
        entryType: entry.type,
        narration: entry.narration,
        debit: entry.debit,
        credit: entry.credit,
        balance: cumulativeCredit - cumulativeDebit,
        reference: entry.reference,
        cumulativeDebit,
        cumulativeCredit,
        sourceEntryId: entry.sourceId,
      });
    });

    if (ledgerEntries.length > 0) {
      await this.accountLedgerRepository.insert(ledgerEntries);
    }
  }

  /**
   * Regenerate ledger for general account
   */
  private async regenerateGeneralLedger(adminId: string, generalId: string): Promise<void> {
    await this.accountLedgerRepository.delete({
      adminId,
      accountId: generalId,
      accountType: 'GENERAL',
    });

    const general = await this.generalAccountRepository.findOne({
      where: { id: generalId, adminId },
    });

    if (!general) return;

    const ledgerEntries: Partial<AccountLedgerEntity>[] = [];

    const drEntries = await this.journalEntryRepository
      .createQueryBuilder('je')
      .where('je.drAccountId = :generalId', { generalId })
      .andWhere('je.adminId = :adminId', { adminId })
      .orderBy('je.date', 'ASC')
      .getMany();

    const crEntries = await this.journalEntryRepository
      .createQueryBuilder('je')
      .where('je.crAccountId = :generalId', { generalId })
      .andWhere('je.adminId = :adminId', { adminId })
      .orderBy('je.date', 'ASC')
      .getMany();

    const allEntries = [
      ...drEntries.map((e) => ({
        date: e.date,
        debit: Number(e.amount),
        credit: 0,
        narration: e.description || 'Journal Entry',
        reference: e.chqNo,
        sourceId: e.id,
      })),
      ...crEntries.map((e) => ({
        date: e.date,
        debit: 0,
        credit: Number(e.amount),
        narration: e.description || 'Journal Entry',
        reference: e.chqNo,
        sourceId: e.id,
      })),
    ];

    allEntries.sort((a, b) => {
      const dateA = a.date instanceof Date ? a.date : new Date(a.date);
      const dateB = b.date instanceof Date ? b.date : new Date(b.date);
      return dateA.getTime() - dateB.getTime();
    });

    let cumulativeDebit = 0;
    let cumulativeCredit = 0;

    allEntries.forEach((entry) => {
      cumulativeDebit += entry.debit;
      cumulativeCredit += entry.credit;

      ledgerEntries.push({
        adminId,
        accountId: generalId,
        accountType: 'GENERAL',
        accountName: general.name,
        date: entry.date,
        entryType: 'JOURNAL',
        narration: entry.narration,
        debit: entry.debit,
        credit: entry.credit,
        balance: cumulativeCredit - cumulativeDebit,
        reference: entry.reference,
        cumulativeDebit,
        cumulativeCredit,
        sourceEntryId: entry.sourceId,
        sourceEntryType: 'JOURNAL',
      });
    });

    if (ledgerEntries.length > 0) {
      await this.accountLedgerRepository.insert(ledgerEntries);
    }
  }

  /**
   * Regenerate ledger for currency
   */
  private async regenerateCurrencyLedger(adminId: string, currencyId: string): Promise<void> {
    await this.accountLedgerRepository.delete({
      adminId,
      accountId: currencyId,
      accountType: 'CURRENCY',
    });

    const ledgerEntries: Partial<AccountLedgerEntity>[] = [];

    const selling = await this.sellingEntryRepository
      .createQueryBuilder('s')
      .where('s.fromCurrencyId = :currencyId', { currencyId })
      .andWhere('s.adminId = :adminId', { adminId })
      .orderBy('s.date', 'ASC')
      .getMany();

    const purchase = await this.purchaseEntryRepository
      .createQueryBuilder('p')
      .where('p.currencyDrId = :currencyId', { currencyId })
      .andWhere('p.adminId = :adminId', { adminId })
      .orderBy('p.date', 'ASC')
      .getMany();

    const allEntries = [
      ...selling.map((e) => ({
        date: e.date,
        debit: 0,
        credit: Number(e.amountCurrency),
        narration: `Sold to ${e.customerAccount?.name}`,
        reference: e.sNo,
        sourceId: e.id,
      })),
      ...purchase.map((e) => ({
        date: e.date,
        debit: Number(e.amountCurrency),
        credit: 0,
        narration: `Bought from ${e.customerAccount?.name}`,
        reference: e.purchaseNumber ? String(e.purchaseNumber) : undefined,
        sourceId: e.id,
      })),
    ];

    allEntries.sort((a, b) => {
      const dateA = a.date instanceof Date ? a.date : new Date(a.date);
      const dateB = b.date instanceof Date ? b.date : new Date(b.date);
      return dateA.getTime() - dateB.getTime();
    });

    let cumulativeDebit = 0;
    let cumulativeCredit = 0;

    allEntries.forEach((entry) => {
      cumulativeDebit += entry.debit;
      cumulativeCredit += entry.credit;

      ledgerEntries.push({
        adminId,
        accountId: currencyId,
        accountType: 'CURRENCY',
        accountName: currencyId,
        date: entry.date,
        entryType: entry.debit > 0 ? 'PURCHASE' : 'SELLING',
        narration: entry.narration,
        debit: entry.debit,
        credit: entry.credit,
        balance: cumulativeDebit - cumulativeCredit,
        reference: entry.reference,
        cumulativeDebit,
        cumulativeCredit,
        sourceEntryId: entry.sourceId,
      });
    });

    if (ledgerEntries.length > 0) {
      await this.accountLedgerRepository.insert(ledgerEntries);
    }
  }
}
