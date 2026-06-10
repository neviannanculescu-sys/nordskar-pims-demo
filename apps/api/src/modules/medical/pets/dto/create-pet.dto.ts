import {
  IsString,
  IsOptional,
  IsEnum,
  IsBoolean,
  IsUUID,
  IsDateString,
  IsNumber,
  Min,
  MaxLength,
} from 'class-validator';
import { Type } from 'class-transformer';

export enum PetGender {
  MALE    = 'male',
  FEMALE  = 'female',
  UNKNOWN = 'unknown',
}

export class CreatePetDto {
  @IsString()
  @MaxLength(100)
  name!: string;

  @IsUUID()
  speciesId!: string;

  @IsOptional()
  @IsUUID()
  breedId?: string;

  @IsEnum(PetGender)
  gender!: PetGender;

  @IsOptional()
  @IsBoolean()
  isNeutered?: boolean;

  @IsOptional()
  @IsDateString()
  dateOfBirth?: string;

  @IsOptional()
  @IsString()
  @MaxLength(50)
  approximateAge?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  color?: string;

  @IsOptional()
  @IsString()
  markings?: string;

  @IsOptional()
  @IsString()
  @MaxLength(50)
  chipNumber?: string;

  @IsOptional()
  @IsString()
  @MaxLength(50)
  tattoo?: string;

  @IsOptional()
  @IsString()
  @MaxLength(50)
  passportNumber?: string;

  @IsOptional()
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  weightKg?: number;

  @IsOptional()
  @IsString()
  notes?: string;

  @IsOptional()
  @IsString()
  allergies?: string;

  @IsOptional()
  @IsString()
  chronicConditions?: string;
}
