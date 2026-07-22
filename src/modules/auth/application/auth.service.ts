//auth.service.ts
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  HttpException,
  Injectable,
  InternalServerErrorException,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { UserEntity } from '../../users/domain/entities/user.entity';
import { Repository } from 'typeorm';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import { v4 as uuidV4 } from 'uuid';
import { UserTypeEntity } from '../../users/domain/entities/user-type.entity';
import AppDataSource from '../../../../data-source';
import {
  ISignupFirstStep,
  ISignupSecondStep,
} from '../domain/types/auth-types';
// import { MailService } from 'src/shared/modules/mail/mail.service';
// import { generateOtp } from 'src/shared/helpers/generateOTP';
import { OtpSignupEntity } from '../../otp/domain/entities/otp-signup.entity';
import * as bcrypt from 'bcrypt';

@Injectable()
export class AuthService {
  constructor(
    private readonly jwtService: JwtService,
    @InjectRepository(UserEntity)
    private userRepository: Repository<UserEntity>,
    @InjectRepository(UserTypeEntity)
    private userTypeEntity: Repository<UserTypeEntity>,
    @InjectDataSource(AppDataSource)
    private readonly dataSource: typeof AppDataSource,
    // private readonly mailService: MailService,
    @InjectRepository(OtpSignupEntity)
    private otpSignupEntity: Repository<OtpSignupEntity>,
  ) {}

  private isBcryptHash(value: string): boolean {
    return /^\$2[aby]\$\d{2}\$/.test(value);
  }

  private async validateAndUpgradePassword(
    user: UserEntity,
    plainPassword: string,
  ): Promise<boolean> {
    if (!user.password) {
      return false;
    }

    if (this.isBcryptHash(user.password)) {
      return bcrypt.compare(plainPassword, user.password);
    }

    const matchesLegacyPlaintext = plainPassword === user.password;
    if (!matchesLegacyPlaintext) {
      return false;
    }

    await this.userRepository.update(
      { id: user.id },
      { password: await bcrypt.hash(plainPassword, 10) },
    );

    return true;
  }

  async checkPhoneExistence(phone: string) {
    const user = await this.userRepository.findOne({
      where: {
        phone: phone,
      },
    });

    if (user) {
      return { exists: true };
    }

    return { exists: false };
  }

  // async signupUserAndSendOtp(
  //   body: ISignupFirstStep
  // ) {
  //   const email = body.email.toLowerCase();

  //   // Check for existing email
  //   const existingUserEmail = await this.userRepository.findOne({
  //     where: { email },
  //   });

  //   if (existingUserEmail) {
  //     throw new ConflictException(['An account with this email already exists. Please use a different email or try logging in.']);
  //   }

  //   if (!email) {
  //     throw new BadRequestException(['Email is required to send OTP']);
  //   }
  //   const otp = generateOtp();
  //   await this.otpSignupEntity.delete({ email });

  //   // 6. Save new OTP
  //   await this.otpSignupEntity.save({
  //     id: uuidV4(),
  //     email,
  //     code: otp,
  //   });

  //   try {
  //     await this.mailService.sendOtpEmail(email,'User', otp);
  //   } catch (error) {
  //     throw new BadRequestException(['Failed to send OTP email']);
  //   }

  //   return {
  //     message: 'OTP sent to email address',
  //     redirectTo: 'otp-verification',
  //     email,
  //   };
  // }

  async verifyOtpAndCreateUser(body: ISignupSecondStep) {
    const email = body.email.toLowerCase();

    const queryRunner = this.dataSource.createQueryRunner();

    await queryRunner.connect();
    await queryRunner.startTransaction();

    try {
      const savedOtp = await queryRunner.manager
        .getRepository(OtpSignupEntity)
        .findOneBy({ email });

      if (!savedOtp) {
        throw new NotFoundException([
          'OTP has expired or not found. Please request a new verification code.',
        ]);
      }

      if (savedOtp.code !== body.sentOtp) {
        throw new BadRequestException(['The verification code you entered is incorrect. Please check and try again.']);
      }

      const userType = await queryRunner.manager
        .getRepository(UserTypeEntity)
        .findOneBy({ id: body.user_type_id });
      if (!userType) {
        throw new NotFoundException(['Invalid user role. Please contact support for assistance.']);
      }
      const existingUser = await this.userRepository.findOne({
        where: { email },
      });

      if (existingUser) {
        throw new ConflictException(['An account with this email already exists. Please try logging in instead.']);
      }

      const existingphone = await this.userRepository.findOne({
        where: { phone: body.phone },
      })
      
      if (existingphone) {
        throw new ConflictException(['This phone number is already registered. Please use a different number or try logging in.']);
      }
      const tempData = await this.otpSignupEntity.findOneBy({ email });

      if (!tempData) {
        throw new NotFoundException([
          'Your signup session has expired. Please start the registration process again.',
        ]);
      }

      const userId = uuidV4();

      const hashPassword = await bcrypt.hash(body.password, 10);

      // All user data now lives directly on the users table with a
      // user_type_id pointing at the user_types lookup.
      const user = await queryRunner.manager.getRepository(UserEntity).save({
        id: userId,
        email,
        name: body.name,
        password: hashPassword,
        phone: body.phone,
        email_is_verified: true,
        user_type_id: userType.id,
        type: userType.name,
      });

      await queryRunner.commitTransaction();

      await this.otpSignupEntity.delete({ email });

      const accessToken = this.jwtService.sign(
        { id: user.id },
        {
          secret: process.env.JWT_SECRET,
          expiresIn: '30d',
        },
      );

      await this.userRepository.update(
        { id: user.id },
        { last_login: new Date() },
      );

      return {
        message: 'Signup completed successfully',
        user,
        accessToken,
      };
    } catch (err) {
      await queryRunner.rollbackTransaction();

      if (err instanceof HttpException) {
        throw err;
      }

      throw new InternalServerErrorException(
        'Unable to complete signup. Please try again later or contact support if the issue persists.',
      );
    } finally {
      await queryRunner.release();
    }
  }

  async loginAdminWithEmail(body: {
    email: string;
    password: string
  }) {
    const normalizedEmail = body.email.trim().toLowerCase();
    const rawPassword = body.password;

    const user = await this.userRepository.findOne({
      where: {
        email: normalizedEmail,
      },
    });

    if (!user) {
      throw new UnauthorizedException('Invalid credentials. Please check your email and password.');
    }

    // Check if admin is blocked
    if (user.block_status === true) {
      throw new ForbiddenException('Your account has been blocked. Please contact support for assistance.');
    }

    // Guard accounts without a local password (e.g. social-only logins) so
    // bcrypt never receives a null hash — that would surface as a 500.
    if (!user.password) {
      throw new UnauthorizedException('Invalid credentials. Please check your email and password.');
    }

    const isMatch = await this.validateAndUpgradePassword(user, rawPassword);
    if (!isMatch) {
      throw new UnauthorizedException('Invalid credentials. Please check your email and password.');
    }

    // The user's role now lives directly on the users table.
    const userType = user.user_type_id
      ? await this.userTypeEntity.findOneBy({ id: user.user_type_id })
      : null;

    const allowedTypes = ['admin', 'customer', 'superAdmin'];
    if (!userType || !allowedTypes.includes(userType.name)) {
      throw new ForbiddenException(
        'Access denied. This account does not have administrative privileges.',
      );
    }

    const mainTablesData = [
      {
        key: userType.name,
        data: {
          id: user.id,
          type: user.type,
          user_type_id: user.user_type_id,
        },
      },
    ];

    const accessToken = this.jwtService.sign(
      {
        id: user.id,
      },
      {
        secret: process.env.JWT_SECRET,
        expiresIn: '30d',
      },
    );

    await this.userRepository.update(
      { id: user.id },
      { last_login: new Date() },
    );
    return {
      user,
      adminProfiles: mainTablesData,
      accessToken,
    };
  }

  // Get Admin Profile by User ID (from JWT token)
  async getAdminProfile(userId: string) {
    const user = await this.userRepository.findOne({
      where: { id: userId },
    });

    if (!user) {
      throw new NotFoundException('User not found');
    }

    // Check if admin is blocked
    if (user.block_status === true) {
      throw new ForbiddenException('Your account has been blocked. Please contact support for assistance.');
    }

    // The user's role now lives directly on the users table.
    const userType = user.user_type_id
      ? await this.userTypeEntity.findOneBy({ id: user.user_type_id })
      : null;

    const allowedTypes = ['admin', 'customer', 'superAdmin'];
    if (!userType || !allowedTypes.includes(userType.name)) {
      throw new ForbiddenException(
        'Access denied. This account does not have administrative privileges.',
      );
    }

    const mainTablesData = [
      {
        key: userType.name,
        data: {
          id: user.id,
          type: user.type,
          user_type_id: user.user_type_id,
        },
      },
    ];

    return {
      id: user.id,
      email: user.email,
      name: user.name,
      phone: user.phone,
      block_status: user.block_status,
      account_balance: user.account_balance,
      balance_in: user.balance_in,
      email_is_verified: user.email_is_verified,
      last_login: user.last_login,
      createdAt: user.createdAt,
      updatedAt: user.updatedAt,
      adminProfiles: mainTablesData,
    };
  }
}
