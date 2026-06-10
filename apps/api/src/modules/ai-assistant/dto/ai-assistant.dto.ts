import { IsString, IsNumber, IsBoolean, IsArray, IsOptional, IsIn, Min, ValidateNested, ArrayMinSize } from 'class-validator';
import { Type } from 'class-transformer';

export class VatBreakdownItemDto {
  @IsNumber() rate!: number;
  @IsNumber() base!: number;
  @IsNumber() vat!:  number;
}

export class VerifyInvoiceDto {
  @IsString()                   invoiceId!:    string;
  @IsNumber() @Min(1)           lineCount!:    number;
  @IsNumber()                   subtotal!:     number;
  @IsNumber()                   vatAmount!:    number;
  @IsNumber()                   totalAmount!:  number;
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => VatBreakdownItemDto)
  vatBreakdown!: VatBreakdownItemDto[];
  @IsIn(['individual', 'company'])  ownerType!:    'individual' | 'company';
  @IsBoolean()                      hasStornoRef!: boolean;
  @IsString()                       series!:       string;
}

export class ExplainSpvErrorDto {
  @IsString() errorCode!:       string;
  @IsString() rawAnafMessage!:  string;
}

export class DailyDashboardInputDto {
  @IsString()  date!:                   string;
  @IsNumber()  todayConsultations!:     number;
  @IsNumber()  todayRevenue!:           number;
  @IsNumber()  monthRevenue!:           number;
  @IsNumber()  monthOutstanding!:       number;
  @IsNumber()  spvPending!:             number;
  @IsNumber()  spvRejected!:            number;
  @IsNumber()  lowStockItems!:          number;
  @IsNumber()  unbilledConsultations!:  number;
  @IsNumber()  unbilledEstimatedTotal!: number;
}

export class ReconciliationInputDto {
  @IsString()  dateFrom!:              string;
  @IsString()  dateTo!:                string;
  @IsNumber()  totalConsultations!:    number;
  @IsNumber()  billedConsultations!:   number;
  @IsNumber()  unbilledConsultations!: number;
  @IsNumber()  totalRevenue!:          number;
  @IsNumber()  outstandingAmount!:     number;
  @IsNumber()  spvPending!:            number;
  @IsNumber()  spvRejected!:           number;
}
