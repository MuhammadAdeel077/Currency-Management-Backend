import {
  Injectable,
  CanActivate,
  ExecutionContext,
  UnauthorizedException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { UserEntity } from '../../modules/users/domain/entities/user.entity';
import { UserTypeEntity } from '../../modules/users/domain/entities/user-type.entity';

@Injectable()
export class IsSuperAdminGuard implements CanActivate {
  constructor(
    @InjectRepository(UserEntity)
    private userRepository: Repository<UserEntity>,
    @InjectRepository(UserTypeEntity)
    private userTypeRepository: Repository<UserTypeEntity>,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest();
    const tokenPayload = request.user;

    if (!tokenPayload) {
      throw new UnauthorizedException('User not authenticated');
    }

    // Check if token carries the super-admin role
    if (tokenPayload.role !== 'super-admin') {
      throw new UnauthorizedException(
        'Access denied. Super admin privileges required.',
      );
    }

    // Super admins now live in the users table with a 'superAdmin' user type.
    const superAdmin = await this.userRepository.findOne({
      where: { id: tokenPayload.id },
    });

    if (!superAdmin) {
      throw new UnauthorizedException('Super admin not found');
    }

    const superAdminType = await this.userTypeRepository.findOne({
      where: { name: 'superAdmin' },
    });

    if (!superAdminType || superAdmin.user_type_id !== superAdminType.id) {
      throw new UnauthorizedException(
        'Access denied. Super admin privileges required.',
      );
    }

    if (!superAdmin.is_active) {
      throw new UnauthorizedException('Super admin account is inactive');
    }

    return true;
  }
}
