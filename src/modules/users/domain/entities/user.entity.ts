import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  Index,
  ManyToOne,
  JoinColumn,
} from 'typeorm';
import { UserTypeEntity } from './user-type.entity';
@Entity('users')
export class UserEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index({ unique: true })
  @Column({ type: 'varchar', nullable: true, default: null })
  email: string;

  @Index({ unique: true })
  @Column({ type: 'varchar', nullable: true })
  phone: string;

  @Column({ name: 'password', type: 'varchar', nullable: true })
  password: string;

  @Column({ type: 'varchar', nullable: true })
  name: string;

  // Role of the user (admin / customer / superAdmin ...) — replaces the
  // old user_profiles + admins + customers + super_admins tables.
  @Column({ name: 'user_type_id', type: 'uuid', nullable: true })
  user_type_id: string;

  @ManyToOne(() => UserTypeEntity, { eager: true })
  @JoinColumn({ name: 'user_type_id' })
  userType: UserTypeEntity;

  // Free-form sub-type label previously stored on the admins table
  // (e.g. 'admin'). Kept for backward compatibility of responses.
  @Column({ type: 'varchar', nullable: true })
  type: string;

  // Previously stored on the customers table.
  @Column({ name: 'date_of_birth', type: 'date', nullable: true })
  dateOfBirth: Date;

  @Column({ name: 'email_is_verified', type: 'boolean', default: false })
  email_is_verified: boolean;

  @Column({ name: 'block_status', type: 'bool', default: false })
  block_status: boolean;

  // Previously the super_admins.is_active flag. Defaults active.
  @Column({ name: 'is_active', type: 'boolean', default: true })
  is_active: boolean;

  @Column({type: 'decimal',
    precision: 30,
    scale: 2,
    default: 0,
    transformer: {
      to: (value: number | null | undefined) =>
        value !== null && value !== undefined
          ? Number(value).toFixed(2)
          : '0.00', // safe fallback
      from: (value: string | null) =>
        value !== null ? parseFloat(value) : 0,
    },})
  account_balance: number;

  @Column({type: "varchar", default: "PKR"})
  balance_in: string

  @Column({ name: 'last_login', type: Date, nullable: true })
  last_login: Date;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}
