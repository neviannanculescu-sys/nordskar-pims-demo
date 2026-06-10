import { IsNumberString, IsEnum, IsOptional, IsString, IsDateString } from 'class-validator';

export enum PaymentMethod {
  CASH          = 'cash',
  CARD          = 'card',
  BANK_TRANSFER = 'bank_transfer',
  VOUCHER       = 'voucher',
  OTHER         = 'other',
}

export class CreatePaymentDto {
  @IsNumberString()
  amount!: string;

  @IsEnum(PaymentMethod)
  paymentMethod!: PaymentMethod;

  @IsOptional() @IsDateString()
  paidAt?: string;

  @IsOptional() @IsString()
  reference?: string;

  @IsOptional() @IsString()
  notes?: string;
}
