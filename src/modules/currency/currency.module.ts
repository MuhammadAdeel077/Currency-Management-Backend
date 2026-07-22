import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { CurrencyAccountController } from './interface/currency.controller';
import { CurrencyAccountService } from './application/currency.service';
import { UserService } from '../users/application/user.service';
import { JwtService } from '@nestjs/jwt';
import { CustomerCurrencyAccountEntity } from './domain/entities/currencies-account.entity';
import { UserEntity } from '../users/domain/entities/user.entity';
import { UserTypeEntity } from '../users/domain/entities/user-type.entity';
import { CustomerCurrencyEntryEntity } from './domain/entities/currency-entry.entity';
import { AddCurrencyEntity } from '../account/domain/entity/currency.entity';
import { RedisService } from '../../shared/modules/redis/redis.service';
import { JournalCurrencyEntryEntity } from './domain/entities/create-currency-journal-entry';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      CustomerCurrencyAccountEntity,
      UserEntity,
      UserTypeEntity,
      CustomerCurrencyEntryEntity,
      AddCurrencyEntity,
      JournalCurrencyEntryEntity
    ]),
  ],
  controllers: [CurrencyAccountController],
  providers: [CurrencyAccountService, UserService, JwtService, RedisService],
  exports: [CurrencyAccountService],
})
export class CurrencyModule {}
