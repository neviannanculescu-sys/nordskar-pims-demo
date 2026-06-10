import {
  IsUUID, IsOptional, IsString, IsDateString,
  IsArray, ValidateNested, IsNumberString, IsEnum,
  IsInt, Min, IsNotEmpty,
} from 'class-validator';
import { Type } from 'class-transformer';

export class InvoiceLineInputDto {
  /** Omis pentru linii manuale */
  @IsOptional() @IsUUID()
  sourceId?: string;

  @IsOptional() @IsString()
  sourceType?: 'procedure' | 'treatment_line' | 'manual';

  @IsString() @IsNotEmpty()
  description!: string;

  @IsNumberString()
  quantity!: string;

  @IsOptional() @IsString()
  unit?: string;

  @IsNumberString()
  unitPrice!: string;

  /** TVA: 0, 9 sau 19 */
  @IsOptional() @IsNumberString()
  vatRate?: string;

  @IsOptional() @IsNumberString()
  costSnapshot?: string;

  @IsOptional() @IsInt() @Min(0)
  position?: number;
}

export class CreateInvoiceDraftDto {
  @IsUUID()
  ownerId!: string;

  /** Dacă furnizat, liniile sunt pre-populate din billing_candidates */
  @IsOptional() @IsUUID()
  consultationId?: string;

  /** Linii manuale — folosite când consultationId lipsește sau pentru adăugare manuală */
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => InvoiceLineInputDto)
  lines?: InvoiceLineInputDto[];

  @IsOptional() @IsDateString()
  dueDate?: string;

  @IsOptional() @IsString()
  notes?: string;

  @IsOptional() @IsString()
  series?: string;
}
