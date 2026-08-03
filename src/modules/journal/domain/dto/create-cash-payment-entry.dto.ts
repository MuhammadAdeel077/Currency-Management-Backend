import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsNumber, IsOptional, IsString, IsUUID } from 'class-validator';

export class CreateCashPaymentEntryDto {
  @ApiProperty({ example: '2025-10-26', description: 'Date of the transaction' })
  @IsNotEmpty()
  date: string;

  @ApiProperty({ example: 'uuid-of-cash-general-account', description: 'Credit Account (Cash-type General Account) ID' })
  @IsUUID()
  crAccountId: string;

  @ApiProperty({ example: 'dr-account-id', description: 'Debit Account (Banam) ID' })
  @IsNotEmpty()
  drAccountId: string;

  @ApiProperty({ example: 7500, description: 'Transaction Amount' })
  @IsNumber()
  @IsOptional()
  amount: number;

  @ApiProperty({ example: 'Payment for office supplies', description: 'Description of the transaction' })
  @IsString()
  @IsOptional()
  description: string;
}
