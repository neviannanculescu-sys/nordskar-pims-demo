import {
  IsUUID, IsString, IsNotEmpty, IsOptional,
  IsBoolean, IsInt, Min,
} from 'class-validator';

export class CreateProcedureTemplateDto {
  @IsUUID()
  serviceId!: string;

  @IsString() @IsNotEmpty()
  name!: string;

  @IsOptional() @IsString()
  description?: string;

  @IsOptional() @IsInt() @Min(1)
  estimatedTimeMin?: number;

  @IsOptional() @IsBoolean()
  requiresAnesthesia?: boolean;

  @IsOptional() @IsBoolean()
  requiresLab?: boolean;

  @IsOptional() @IsString()
  preProcedureNotes?: string;

  @IsOptional() @IsString()
  postProcedureNotes?: string;

  @IsOptional() @IsBoolean()
  isActive?: boolean;
}
