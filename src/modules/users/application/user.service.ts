import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { UserEntity } from '../domain/entities/user.entity';
import { Repository } from 'typeorm';
import { IChangePassword, IUpdateProfile } from '../domain/types/user.types';
import { QueryDeepPartialEntity } from 'typeorm/query-builder/QueryPartialEntity';
import bcrypt from 'bcrypt';
import { UserTypeEntity } from '../domain/entities/user-type.entity';
import { PaginatedUsersResponse } from '../../admin/domain/types/paginatedUserType';
import { FilterUserDto } from '../../admin/domain/dtos/filter-user.dto';
import { PaginationDto } from '../../../shared/modules/dtos/pagination.dto';

@Injectable()
export class UserService {
  constructor(
    @InjectRepository(UserEntity)
    private userRepository: Repository<UserEntity>,
    @InjectRepository(UserTypeEntity)
    private userTypeEntity: Repository<UserTypeEntity>,
  ) {}
  async updateProfile(body: IUpdateProfile) {
    const user = await this.userRepository.findOneBy({
      id: body.userId,
    });

    if (!user) {
      throw new NotFoundException(['No such user exists with this id']);
    }

    const updatedBody: QueryDeepPartialEntity<UserEntity> = {};
    if (body?.name) {
      updatedBody.name = body.name;
    }

    if (body?.email) {
      if (body?.email !== user?.email) {
        const emailExists = await this.userRepository.findOneBy({
          email: body.email,
        });

        if (emailExists) {
          throw new ConflictException([
            'This email address is already in use. Please use a different email.',
          ]);
        }
      }
      updatedBody.email = body.email;
    }

    if (body?.phone) {
      if (body?.phone !== user?.phone) {
        const phoneExists = await this.userRepository.findOneBy({
          phone: body.phone,
        });

        if (phoneExists) {
          throw new ConflictException([
            'This phone number is already registered. Please use a different number.',
          ]);
        }
      }
      updatedBody.phone = body.phone;
    }

    const updated = await this.userRepository
      .createQueryBuilder()
      .update(UserEntity)
      .set(updatedBody)
      .where('id = :id', { id: body.userId })
      .returning([
        'id',
        'name',
        'email',
        'phone',
        'email_is_verified',
        'created_at',
        'updated_at',
      ])
      .execute();

    return { user: updated.raw[0] };
  }

  async changePassword(body: IChangePassword) {
    const user = await this.userRepository.findOneBy({
      id: body.userId,
    });

    if (!user) {
      throw new NotFoundException(['No such user exists with this id']);
    }

    const match = await bcrypt.compare(body.previous_password, user.password);
    if (!match) {
      throw new ForbiddenException(['The current password you entered is incorrect. Please try again.']);
    }

    const hashedPassword = await bcrypt.hash(body.new_password, 10);

    await this.userRepository
      .createQueryBuilder()
      .update(UserEntity)
      .set({
        password: hashedPassword,
      })
      .where('id = :id', { id: body.userId })

      .execute();

    return { message: 'Password updated successfully' };
  }

  // for generic user table check (for all user types)
  async findUserById(userId: string) {
    const user = await this.userRepository.findOneBy({
      id: userId,
    });

    if (!user) {
      throw new NotFoundException(['The specified user could not be found.']);
    }

    return { user };
  }

  async findUserTypeByName(name: string) {
    const userType = await this.userTypeEntity.findOneBy({
      name: name,
    });

    if (!userType) {
      throw new NotFoundException([
        'The specified user role/type could not be found in the system. Please contact support.',
      ]);
    }

    return { userType };
  }

  async findUserBlockStatus(userId: string): Promise<boolean> {
    const findUser = await this.userRepository.findOne({
      where: { id: userId },
    });

    if (!findUser) {
      throw new NotFoundException('The specified user could not be found.');
    }

    return findUser.block_status;
  }

  async searchUser(body: FilterUserDto) {
    const { search, status } = body;
    const query = this.userRepository.createQueryBuilder('user');

    if (search) {
      query.andWhere('user.name ILIKE :search OR user.email ILIKE :search', {
        search: `%${search}%`,
      });
    }

    if (status) {
      if (status.toLowerCase() === 'blocked') {
        query.andWhere('user.block_status = :blocked', { blocked: true });
      } else if (status.toLowerCase() === 'active') {
        query.andWhere('user.block_status = :blocked', { blocked: false });
      }
    }

    const users = await query.getMany();
    return users;
  }

  // List users of a given type (e.g. all customers) directly from the
  // users table now that profiles/admins/customers tables are gone.
  async getUsersByType(
    typeName: string,
    body: PaginationDto,
  ): Promise<PaginatedUsersResponse> {
    const { offset, limit } = body;

    const query = this.userRepository
      .createQueryBuilder('user')
      .leftJoin('user.userType', 'userType')
      .where('userType.name = :typeName', { typeName })
      .select([
        'user.id',
        'user.name',
        'user.email',
        'user.phone',
        'user.dateOfBirth',
        'user.block_status',
        'user.account_balance',
        'user.balance_in',
        'user.createdAt',
      ])
      .skip((offset - 1) * limit)
      .take(limit);

    const [data, total] = await query.getManyAndCount();

    return {
      data,
      total,
      offset,
      limit,
    };
  }
}
