import {
  IsUUID, IsEnum, IsNumberString, IsOptional,
  IsString, IsDateString,
} from 'class-validator';

export enum StockMovementType {
  PURCHASE_RECEIPT     = 'purchase_receipt',
  CONSULTATION_USE     = 'consultation_use',
  HOSPITALIZATION_USE  = 'hospitalization_use',
  DIRECT_SALE          = 'direct_sale',
  ADJUSTMENT_POSITIVE  = 'adjustment_positive',
  ADJUSTMENT_NEGATIVE  = 'adjustment_negative',
  RETURN_TO_SUPPLIER   = 'return_to_supplier',
  EXPIRED_DISPOSAL     = 'expired_disposal',
  THEFT_LOSS           = 'theft_loss',
}

export class CreateStockMovementDto {
  @IsUUID()
  inventoryItemId!: string;

  @IsEnum(StockMovementType)
  movementType!: StockMovementType;

  /** Positive = inbound, negative = outbound */
  @IsNumberString()
  quantity!: string;

  @IsOptional() @IsString()
  referenceType?: string;

  @IsOptional() @IsUUID()
  referenceId?: string;

  @IsOptional() @IsNumberString()
  unitCost?: string;

  @IsOptional() @IsString()
  lotNumber?: string;

  @IsOptional() @IsDateString()
  expiryDate?: string;

  @IsOptional() @IsString()
  notes?: string;
}
