import {
  IsString, IsNotEmpty, IsOptional, IsEnum,
  IsNumberString, IsBoolean,
} from 'class-validator';

export enum InventoryCategory {
  MEDICATION       = 'medication',
  CONSUMABLE       = 'consumable',
  FOOD             = 'food',
  PRODUCT_FOR_SALE = 'product_for_sale',
  EQUIPMENT        = 'equipment',
  OTHER            = 'other',
}

export class CreateInventoryItemDto {
  @IsString() @IsNotEmpty()
  sku!: string;

  @IsString() @IsNotEmpty()
  name!: string;

  @IsOptional() @IsString()
  genericName?: string;

  @IsEnum(InventoryCategory)
  category!: InventoryCategory;

  @IsOptional() @IsString()
  subcategory?: string;

  @IsOptional() @IsBoolean()
  isControlled?: boolean;

  @IsOptional() @IsBoolean()
  requiresPrescription?: boolean;

  @IsOptional() @IsBoolean()
  isForSale?: boolean;

  @IsOptional() @IsString()
  manufacturer?: string;

  @IsOptional() @IsString()
  barcode?: string;

  @IsString() @IsNotEmpty()
  unitOfMeasure!: string;

  @IsOptional() @IsString()
  baseUnit?: string;

  @IsOptional() @IsNumberString()
  conversionFactor?: string;

  @IsOptional() @IsNumberString()
  minStockLevel?: string;

  @IsOptional() @IsNumberString()
  maxStockLevel?: string;

  @IsOptional() @IsNumberString()
  reorderQuantity?: string;

  @IsOptional() @IsNumberString()
  salePrice?: string;

  /** 0, 9, or 19 */
  @IsOptional() @IsNumberString()
  vatRate?: string;

  @IsOptional() @IsString()
  storageLocation?: string;

  @IsOptional() @IsString()
  storageConditions?: string;

  @IsOptional() @IsBoolean()
  isActive?: boolean;
}
