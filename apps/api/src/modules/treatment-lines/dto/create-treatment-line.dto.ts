import {
  IsUUID,
  IsString,
  IsNotEmpty,
  IsOptional,
  IsEnum,
  IsNumberString,
  IsInt,
  IsBoolean,
  IsDateString,
  Min,
} from 'class-validator';

export enum TreatmentRoute {
  ORAL       = 'oral',
  IV         = 'iv',
  IM         = 'im',
  SC         = 'sc',
  TOPICAL    = 'topical',
  OPHTHALMIC = 'ophthalmic',
  OTHER      = 'other',
}

export class CreateTreatmentLineDto {
  @IsUUID()
  consultationId!: string;

  /**
   * Link to inventory — nullable until inventory module ships (Phase 2).
   * When provided: stock movement is triggered on dispense.
   */
  @IsOptional()
  @IsUUID()
  inventoryItemId?: string;

  @IsUUID()
  prescribedBy!: string;

  @IsOptional()
  @IsUUID()
  administeredBy?: string;

  // Prescription
  @IsString()
  @IsNotEmpty()
  productName!: string;

  @IsString()
  @IsNotEmpty()
  dose!: string;

  @IsOptional()
  @IsString()
  frequency?: string;

  @IsOptional()
  @IsEnum(TreatmentRoute)
  route?: TreatmentRoute;

  @IsOptional()
  @IsInt()
  @Min(1)
  durationDays?: number;

  @IsOptional()
  @IsDateString()
  startDate?: string;

  @IsOptional()
  @IsDateString()
  endDate?: string;

  // Dispensing
  @IsOptional()
  @IsNumberString()
  quantityDispensed?: string;

  @IsOptional()
  @IsString()
  quantityUnit?: string;

  // Traceability — required for controlled/tracked medications
  @IsOptional()
  @IsString()
  lotNumber?: string;

  @IsOptional()
  @IsDateString()
  expiryDate?: string;

  // Pricing
  @IsOptional()
  @IsNumberString()
  unitCost?: string;

  @IsOptional()
  @IsNumberString()
  unitPrice?: string;

  @IsOptional()
  @IsBoolean()
  isBillable?: boolean;

  @IsOptional()
  @IsDateString()
  administeredAt?: string;

  @IsOptional()
  @IsString()
  notes?: string;
}
