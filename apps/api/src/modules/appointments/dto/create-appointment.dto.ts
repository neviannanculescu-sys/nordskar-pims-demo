import {
  IsUUID,
  IsDateString,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  Min,
  Max,
  IsNotEmpty,
} from 'class-validator';
import { Type } from 'class-transformer';

export enum AppointmentType {
  ROUTINE         = 'routine',
  EMERGENCY       = 'emergency',
  FOLLOWUP        = 'followup',
  SURGERY         = 'surgery',
  HOSPITALIZATION = 'hospitalization',
  VACCINATION     = 'vaccination',
  OTHER           = 'other',
}

export enum AppointmentSource {
  PHONE    = 'phone',
  ONLINE   = 'online',
  WALKIN   = 'walkin',
  WHATSAPP = 'whatsapp',
  INTERNAL = 'internal',
}

export class CreateAppointmentDto {
  @IsUUID()
  petId!: string;

  @IsUUID()
  ownerId!: string;

  @IsOptional()
  @IsUUID()
  veterinarianId?: string;

  @IsOptional()
  @IsUUID()
  roomId?: string;

  @IsDateString()
  scheduledAt!: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(5)
  @Max(480)
  durationMin?: number = 30;

  @IsEnum(AppointmentType)
  type!: AppointmentType;

  @IsString()
  @IsNotEmpty()
  reason!: string;

  @IsOptional()
  @IsString()
  notes?: string;

  @IsOptional()
  @IsEnum(AppointmentSource)
  source?: AppointmentSource;
}
