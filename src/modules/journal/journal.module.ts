import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { JournalEntryEntity } from './domain/entity/journal-entry.entity';
import { JournalService } from './application/jounal.service';
import { BalanceCalculationService } from './application/balance-calculation.service';
import { GeneralLedgerService } from './application/general-ledger.service';
import { JournalController } from './interface/journal.controller';
import { JournalGetController } from './interface/journal-get.controller';
import { GeneralLedgerController } from './interface/general-ledger.controller';
import { CreateCashPaymentEntryDto } from './domain/dto/create-cash-payment-entry.dto';
import { CreateCashReceivedEntryDto } from './domain/dto/create-cash-received-entry.dto';
import { CreateBankPaymentEntryDto } from './domain/dto/create-bank-payment-entry.dto';
import { CreateBankReceiverEntryDto } from './domain/dto/reate-bank-receiver-entry.dto';
import { CreateJournalEntryDto } from './domain/dto/create-journal-entry.dto';
import { CashPaymentEntryEntity } from './domain/entity/cash-payment-entry.entity';
import { CashReceivedEntryEntity } from './domain/entity/cash-received-entry.entity';
import { BankPaymentEntryEntity } from './domain/entity/bank-payment-entry.entity';
import { BankReceiverEntryEntity } from './domain/entity/bank-receiver-entry.entity';
import { AccountBalanceEntity } from './domain/entity/account-balance.entity';
import { AccountLedgerEntity } from './domain/entity/account-ledger.entity';
import { GeneralLedgerEntity } from './domain/entity/general-ledger.entity';
import { CustomerAccountEntity } from '../account/domain/entity/customer-account.entity';
import { JwtService } from '@nestjs/jwt';
import { UserService } from '../users/application/user.service';
import { UserEntity } from '../users/domain/entities/user.entity';
import { UserTypeEntity } from '../users/domain/entities/user-type.entity';
import { BankAccountEntity } from '../account/domain/entity/bank-account.entity';
import { GeneralAccountEntity } from '../account/domain/entity/general-account.entity';
import { CurrencyStockEntity } from '../currency/domain/entities/currency-stock.entity';
import { SellingEntryEntity } from '../sale-purchase/domain/entity/selling_entries.entity';
import { PurchaseEntryEntity } from '../sale-purchase/domain/entity/purchase_entries.entity';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      JournalEntryEntity,
      CashPaymentEntryEntity,
      CashReceivedEntryEntity,
      BankPaymentEntryEntity,
      BankReceiverEntryEntity,
      AccountBalanceEntity,
      AccountLedgerEntity,
      GeneralLedgerEntity,
      CustomerAccountEntity,
      UserEntity,
      UserTypeEntity,
      BankAccountEntity,
      GeneralAccountEntity,
      CurrencyStockEntity,
      SellingEntryEntity,
      PurchaseEntryEntity,
    ]),
  ],
  providers: [JournalService, BalanceCalculationService, GeneralLedgerService, JwtService, UserService],
  controllers: [JournalController, JournalGetController, GeneralLedgerController],
  exports: [BalanceCalculationService, GeneralLedgerService],
})
export class JournalModule {}
