import { IsString, IsNotEmpty } from 'class-validator';

export class CancelInvoiceDto {
  @IsString() @IsNotEmpty()
  reason!: string;
}
