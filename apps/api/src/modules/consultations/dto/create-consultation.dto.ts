import {
  IsUUID,
  IsDateString,
  IsEnum,
  IsOptional,
  IsString,
  IsNotEmpty,
  IsNumberString,
  IsInt,
  Min,
  Max,
} from 'class-validator';

export enum ConsultationType {
  ROUTINE          = 'routine',
  EMERGENCY        = 'emergency',
  FOLLOWUP         = 'followup',
  SECOND_OPINION   = 'second_opinion',
  TELECONSULTATION = 'teleconsultation',
}

export enum ConsultationPrognosis {
  GOOD    = 'good',
  GUARDED = 'guarded',
  POOR    = 'poor',
  UNKNOWN = 'unknown',
}

export class CreateConsultationDto {
  /** Nullable: walk-in without prior appointment */
  @IsOptional()
  @IsUUID()
  appointmentId?: string;

  @IsUUID()
  petId!: string;

  @IsUUID()
  ownerId!: string;

  @IsUUID()
  veterinarianId!: string;

  @IsDateString()
  consultationDate!: string;

  @IsEnum(ConsultationType)
  type!: ConsultationType;

  // Anamnesis
  @IsString()
  @IsNotEmpty()
  chiefComplaint!: string;

  @IsOptional()
  @IsString()
  history?: string;

  // Vitals
  @IsOptional()
  @IsNumberString()
  weightKg?: string;

  @IsOptional()
  @IsNumberString()
  temperatureC?: string;

  @IsOptional()
  @IsInt()
  @Min(10)
  @Max(500)
  heartRate?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(200)
  respiratoryRate?: number;

  @IsOptional()
  @IsString()
  clinicalFindings?: string;

  // Diagnosis
  @IsString()
  @IsNotEmpty()
  diagnosisPrimary!: string;

  @IsOptional()
  @IsString()
  diagnosisSecondary?: string;

  @IsOptional()
  @IsEnum(ConsultationPrognosis)
  prognosis?: ConsultationPrognosis;

  // Plan
  @IsOptional()
  @IsString()
  treatmentPlan?: string;

  @IsOptional()
  @IsString()
  dischargeNotes?: string;

  @IsOptional()
  @IsDateString()
  followUpDate?: string;

  @IsOptional()
  @IsString()
  followUpNotes?: string;

  // Timing
  @IsOptional()
  @IsDateString()
  startedAt?: string;

  @IsOptional()
  @IsDateString()
  endedAt?: string;
}
