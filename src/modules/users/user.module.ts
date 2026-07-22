import { Module } from '@nestjs/common';
import { UserService } from './application/user.service';
import { UserController } from './interface/user.controller';
import { UserEntity } from './domain/entities/user.entity';
import { TypeOrmModule } from '@nestjs/typeorm';
import { JwtService } from '@nestjs/jwt';
import { UserTypeEntity } from './domain/entities/user-type.entity';
import { CommonService } from '../../shared/modules/application/common.service';
import { CommonController } from '../../shared/modules/interface/common.controller';
import { CustomerAccountEntity } from '../account/domain/entity/customer-account.entity';
import { AddChqRefBankEntity } from '../account/domain/entity/add-chq-ref-bank.entity';
import { GeneralAccountEntity } from '../account/domain/entity/general-account.entity';
import { EmployeeAccountEntity } from '../account/domain/entity/employee-account.entity';
import { AddExpenseEntity } from '../account/domain/entity/add-expense.entity';
import { CurrencyAccountEntity } from '../account/domain/entity/currency-account.entity';
import { AddCurrencyEntity } from '../account/domain/entity/currency.entity';
import { BankAccountEntity } from '../account/domain/entity/bank-account.entity';
import { CustomerCurrencyAccountEntity } from '../currency/domain/entities/currencies-account.entity';
import { RedisService } from '../../shared/modules/redis/redis.service';
@Module({
  imports: [
    TypeOrmModule.forFeature([
      UserEntity,
      UserTypeEntity,
      CustomerAccountEntity,
      AddChqRefBankEntity,
      GeneralAccountEntity,
      EmployeeAccountEntity,
      AddExpenseEntity,
      CurrencyAccountEntity,
      AddCurrencyEntity,
      BankAccountEntity,
      CustomerCurrencyAccountEntity
    ]),
  ],
  providers: [
    UserService,
    JwtService,
    CommonService,
    RedisService
  ],
  controllers: [UserController, CommonController],
  exports: [UserService],
})
export class UserModule {}
