import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ChqInwardEntryEntity } from './domain/entity/chq-inward-entry.entity';
import { DashboardService } from './application/dashboard.service';
import { DashboardStatsService } from './application/dashboard-stats.service';
import { DashboardController } from './interface/dashboard.controller';
import { DashboardStatsController } from './interface/dashboard-stats.controller';
import { CustomerAccountEntity } from '../account/domain/entity/customer-account.entity';
import { AddChqRefBankEntity } from '../account/domain/entity/add-chq-ref-bank.entity';
import { JwtService } from '@nestjs/jwt';
import { UserService } from '../users/application/user.service';
import { UserEntity } from '../users/domain/entities/user.entity';
import { UserTypeEntity } from '../users/domain/entities/user-type.entity';
import { ChqOutwardEntryEntity } from './domain/entity/chq-outward-entry.entity';
import { BankAccountEntity } from '../account/domain/entity/bank-account.entity';
import { SellingEntryEntity } from '../sale-purchase/domain/entity/selling_entries.entity';
import { PurchaseEntryEntity } from '../sale-purchase/domain/entity/purchase_entries.entity';
import { CurrencyStockEntity } from '../currency/domain/entities/currency-stock.entity';
import { AddCurrencyEntity } from '../account/domain/entity/currency.entity';
import { AccountBalanceEntity } from '../journal/domain/entity/account-balance.entity';
import { RedisService } from '../../shared/modules/redis/redis.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      ChqInwardEntryEntity,
      ChqOutwardEntryEntity,
      CustomerAccountEntity,
      BankAccountEntity,
      AddChqRefBankEntity,
      SellingEntryEntity,
      PurchaseEntryEntity,
      CurrencyStockEntity,
      AddCurrencyEntity,
      AccountBalanceEntity,
      UserEntity,
      UserTypeEntity,
    ]),
  ],
  controllers: [DashboardController, DashboardStatsController],
  providers: [DashboardService, DashboardStatsService, RedisService, JwtService, UserService],
})
export class DashboardModule {}
