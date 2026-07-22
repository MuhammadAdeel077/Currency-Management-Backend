import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { SalePurchaseService } from './application/entry.service';

import { CurrencyAccountEntity } from '../account/domain/entity/currency-account.entity';
import { CustomerAccountEntity } from '../account/domain/entity/customer-account.entity';
import { PurchaseEntryEntity } from './domain/entity/purchase_entries.entity';
import { SellingEntryEntity } from './domain/entity/selling_entries.entity';
import { SalePurchaseController } from './interface/entry.controller';
import { JwtService } from '@nestjs/jwt';
import { UserService } from '../users/application/user.service';
import { UserEntity } from '../users/domain/entities/user.entity';
import { UserTypeEntity } from '../users/domain/entities/user-type.entity';
import { AddCurrencyEntity } from '../account/domain/entity/currency.entity';
import { CurrencyRelationEntity } from './domain/entity/currencyRelation.entity';
import { RedisService } from '../../shared/modules/redis/redis.service';
import { CurrencyStockEntity } from '../currency/domain/entities/currency-stock.entity';
import { CurrencyBalanceEntity } from '../currency/domain/entities/currency-balance.entity';
import { BankAccountEntity } from '../account/domain/entity/bank-account.entity';
import { CustomerCurrencyAccountEntity } from '../currency/domain/entities/currencies-account.entity';
import { AccountBalanceEntity } from '../journal/domain/entity/account-balance.entity';
import { AccountLedgerEntity } from '../journal/domain/entity/account-ledger.entity';
import { GeneralLedgerEntity } from '../journal/domain/entity/general-ledger.entity';
import { GeneralLedgerService } from '../journal/application/general-ledger.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      PurchaseEntryEntity,
      SellingEntryEntity,
      CurrencyAccountEntity,
      CustomerAccountEntity,
      UserEntity,
      UserTypeEntity,
      AddCurrencyEntity,
      CurrencyRelationEntity,
      CurrencyStockEntity,
      CurrencyBalanceEntity,
      BankAccountEntity,
      CustomerCurrencyAccountEntity,
      AccountBalanceEntity,
      AccountLedgerEntity,
      GeneralLedgerEntity,
    ]),
  ],
  controllers: [SalePurchaseController],
  providers: [SalePurchaseService, GeneralLedgerService, JwtService, UserService, RedisService],
  exports: [SalePurchaseService],
})
export class SalePurchaseModule {}
