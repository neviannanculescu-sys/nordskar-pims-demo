import {
  IsUUID,
  IsDateString,
  IsString,
  IsNotEmpty,
  IsOptional,
  IsNumberString,
  IsBoolean,
} from 'class-validator';

export class CreateProcedureDto {
  @IsUUID()
  consultationId!: string;

  @IsOptional()
  @IsUUID()
  procedureTemplateId?: string;

  @IsUUID()
  veterinarianId!: string;

  @IsDateString()
  performedAt!: string;

  @IsString()
  @IsNotEmpty()
  name!: string;

  @IsOptional()
  @IsString()
  description?: string;

  /** Defaults to 1 if omitted */
  @IsOptional()
  @IsNumberString()
  quantity?: string;

  @IsOptional()
  @IsString()
  unit?: string;

  @IsNumberString()
  unitPrice!: string;

  /** Direct consumables cost — used for margin reporting */
  @IsOptional()
  @IsNumberString()
  costDirect?: string;

  @IsOptional()
  @IsBoolean()
  isBillable?: boolean;

  @IsOptional()
  @IsString()
  notes?: string;
}
