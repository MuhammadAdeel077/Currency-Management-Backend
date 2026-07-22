// src/auth/guards/is-admin.guard.ts
import {
  CanActivate,
  ExecutionContext,
  Injectable,
  ForbiddenException,
} from '@nestjs/common';
import { UserService } from '../../modules/users/application/user.service';
import { Request } from 'express';

@Injectable()
export class IsAdminGuard implements CanActivate {
  constructor(private readonly usersService: UserService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest() as Request;

    const userId = request.userId;
    if (!userId) throw new ForbiddenException(['No user found in request']);

    const { user } = await this.usersService.findUserById(userId);
    if (!user) throw new ForbiddenException(['User not found']);

    const { userType } = await this.usersService.findUserTypeByName('admin');
    if (!userType) throw new ForbiddenException(['Invalid user type']);

    // The role now lives directly on the users table.
    if (user.user_type_id !== userType.id) {
      throw new ForbiddenException(['Admin privileges required']);
    }

    // adminId is now simply the user's own id — all account/journal data
    // is scoped by this value.
    request.adminId = user.id;

    return true;
  }
}
