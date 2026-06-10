import {
  IsDateString, IsOptional, IsEnum, IsUUID, IsIn,
} from 'class-validator';

export enum ReportPeriod {
  DAY    = 'day',
  WEEK   = 'week',
  MONTH  = 'month',
  YEAR   = 'year',
  CUSTOM = 'custom',
}

export enum ExportFormat {
  JSON = 'json',
  CSV  = 'csv',
  XLSX = 'xlsx',
}

export class ReportFiltersDto {
  /** Data de start (YYYY-MM-DD) */
  @IsDateString()
  dateFrom!: string;

  /** Data de sfârșit (YYYY-MM-DD) — inclusiv */
  @IsDateString()
  dateTo!: string;

  @IsOptional() @IsUUID()
  veterinarianId?: string;

  @IsOptional() @IsEnum(ExportFormat)
  format?: ExportFormat;
}

export class AccountingExportDto extends ReportFiltersDto {
  /**
   * Prefix jurnal contabil (e.g. 'VZ' = vânzări, 'IN' = încasări).
   * Compatibil Saga C / WinMentor.
   */
  @IsOptional()
  @IsIn(['VZ', 'IN', 'ST'])
  journalPrefix?: string;
}
