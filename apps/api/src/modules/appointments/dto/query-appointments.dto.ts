import {
  IsOptional,
  IsUUID,
  IsEnum,
  IsDateString,
  IsInt,
  IsString,
  Min,
  Max,
} from 'class-validator';
import { Type } from 'class-transformer';
import { AppointmentType } from './create-appointment.dto';

export enum AppointmentStatus {
  SCHEDULED   = 'scheduled',
  CONFIRMED   = 'confirmed',
  CHECKED_IN  = 'checked_in',
  IN_PROGRESS = 'in_progress',
  COMPLETED   = 'completed',
  CANCELLED   = 'cancelled',
  NO_SHOW     = 'no_show',
}

export enum CalendarView {
  DAY  = 'day',
  WEEK = 'week',
}

export class QueryAppointmentsDto {
  @IsOptional()
  @IsUUID()
  veterinarianId?: string;

  @IsOptional()
  @IsUUID()
  ownerId?: string;

  @IsOptional()
  @IsUUID()
  petId?: string;

  @IsOptional()
  @IsEnum(AppointmentStatus)
  status?: AppointmentStatus;

  @IsOptional()
  @IsEnum(AppointmentType)
  type?: AppointmentType;

  @IsOptional()
  @IsDateString()
  dateFrom?: string;

  @IsOptional()
  @IsDateString()
  dateTo?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number = 1;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number = 50;
}

export class QueryCalendarDto {
  @IsOptional()
  @IsUUID()
  veterinarianId?: string;

  @IsOptional()
  @IsUUID()
  roomId?: string;

  @IsDateString()
  date!: string;

  @IsOptional()
  @IsEnum(CalendarView)
  view?: CalendarView = CalendarView.DAY;
}

export class CancelAppointmentDto {
  @IsOptional()
  @IsString()
  reason?: string;
}
