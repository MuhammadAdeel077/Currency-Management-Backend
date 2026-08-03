import { Entity, PrimaryGeneratedColumn, Column, ManyToOne, JoinColumn } from 'typeorm';
import { CustomerAccountEntity } from '../../../account/domain/entity/customer-account.entity';
import { GeneralAccountEntity } from '../../../account/domain/entity/general-account.entity';

@Entity('cash_received_entries')
export class CashReceivedEntryEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'date' })
  date: string;

  @ManyToOne(() => CustomerAccountEntity, { eager: true })
  @JoinColumn({ name: 'crAccountId' })
  crAccount: CustomerAccountEntity;

  // Debit Account (Dr) - Cash-type General Account
  @ManyToOne(() => GeneralAccountEntity, { eager: true })
  @JoinColumn({ name: 'drAccountId' })
  drAccount: GeneralAccountEntity;

  @Column({ name: 'legacy_dr_account', type: 'varchar', nullable: true })
  legacyDrAccount?: string;

  @Column({ type: 'decimal',
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
  amount: number;

  @Column({ type: 'varchar', length: 255, nullable: true })
  description: string;

  @Column({ name: 'admin_id', type: 'uuid', nullable: false })
  adminId: string;
}
