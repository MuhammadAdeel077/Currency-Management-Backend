import { UserEntity } from '../../../users/domain/entities/user.entity';
export interface PaginatedUsersResponse {
  data: UserEntity[];
  total: number;
  offset: number;
  limit: number;
}
