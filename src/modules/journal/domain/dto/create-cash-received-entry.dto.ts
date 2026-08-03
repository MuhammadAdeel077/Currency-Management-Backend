import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsNumber, IsString, IsUUID } from 'class-validator';

export class CreateCashReceivedEntryDto {
  @ApiProperty({ example: '2025-10-26', description: 'Date of the transaction' })
  @IsNotEmpty()
  date: string;

  @ApiProperty({ example: 'cr-account-id', description: 'Credit Account (Jama) ID' })
  @IsNotEmpty()
  crAccountId: string;

  @ApiProperty({ example: 'uuid-of-cash-general-account', description: 'Debit Account (Cash-type General Account) ID' })
  @IsUUID()
  drAccountId: string;

  @ApiProperty({ example: 10000, description: 'Transaction Amount' })
  @IsNumber()
  amount: number;

  @ApiProperty({ example: 'Cash received from customer', description: 'Description of the transaction' })
  @IsString()
  description: string;
}
