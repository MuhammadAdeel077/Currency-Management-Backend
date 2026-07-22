//auth.module.ts
import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { UserEntity } from '../users/domain/entities/user.entity';
import { UserTypeEntity } from '../users/domain/entities/user-type.entity';
import { JwtService } from '@nestjs/jwt';
import { AuthController } from './interface/auth.controller';
import { AuthService } from './application/auth.service';
// import { MailModule } from 'src/shared/modules/mail/mail.module';
import { OtpSignupEntity } from '../otp/domain/entities/otp-signup.entity';
import { OtpEntity } from '../otp/domain/entities/otp.entity';
import { UserModule } from '../users/user.module';
@Module({
  imports: [
    // MailModule,
    TypeOrmModule.forFeature([
      UserEntity,
      UserTypeEntity,
      OtpSignupEntity,
      OtpEntity,
    ]),
    UserModule,
  ],
  providers: [
    AuthService,
    JwtService,
    OtpSignupEntity,
  ],
  controllers: [AuthController],
})
export class AuthModule {}
