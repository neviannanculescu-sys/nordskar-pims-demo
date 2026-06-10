import { PartialType } from '@nestjs/mapped-types';
import { IsOptional, IsBoolean, IsDateString } from 'class-validator';
import { CreatePetDto } from './create-pet.dto';

export class UpdatePetDto extends PartialType(CreatePetDto) {
  @IsOptional()
  @IsBoolean()
  isDeceased?: boolean;

  @IsOptional()
  @IsDateString()
  deceasedDate?: string;
}
