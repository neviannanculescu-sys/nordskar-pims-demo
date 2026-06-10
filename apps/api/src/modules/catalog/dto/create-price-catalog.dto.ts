import {
  IsString, IsNotEmpty, IsOptional, IsEnum,
  IsNumberString, IsBoolean, IsDateString, IsUUID, IsInt, Min,
} from 'class-validator';

export enum ServiceType {
  CONSULTATION    = 'consultation',
  EMERGENCY       = 'emergency',
  SURGERY         = 'surgery',
  ANESTHESIA      = 'anesthesia',
  HOSPITALIZATION = 'hospitalization',
  LAB_TEST        = 'lab_test',
  IMAGING         = 'imaging',
  VACCINATION     = 'vaccination',
  TREATMENT       = 'treatment',
  PROCEDURE       = 'procedure',
  PRODUCT         = 'product',
  PACKAGE         = 'package',
  OTHER           = 'other',
}

export class CreatePriceCatalogDto {
  @IsString() @IsNotEmpty()
  code!: string;

  @IsString() @IsNotEmpty()
  name!: string;

  @IsOptional() @IsString()
  description?: string;

  @IsUUID()
  categoryId!: string;

  @IsEnum(ServiceType)
  serviceType!: ServiceType;

  @IsNumberString()
  basePrice!: string;

  /** 0, 9, or 19 */
  @IsOptional() @IsNumberString()
  vatRate?: string;

  @IsOptional() @IsNumberString()
  directCostEstimate?: string;

  @IsOptional() @IsNumberString()
  minMarginPercent?: string;

  @IsOptional() @IsInt() @Min(1)
  estimatedDurationMin?: number;

  @IsOptional() @IsBoolean()
  isEmergencySurcharge?: boolean;

  @IsOptional() @IsNumberString()
  emergencyMultiplier?: string;

  @IsOptional() @IsNumberString()
  requiresApprovalAbove?: string;

  @IsOptional() @IsBoolean()
  isActive?: boolean;

  @IsOptional() @IsDateString()
  validFrom?: string;

  @IsOptional() @IsDateString()
  validTo?: string;
}
