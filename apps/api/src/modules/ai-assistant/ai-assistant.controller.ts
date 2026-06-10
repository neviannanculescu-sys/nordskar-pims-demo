import { Body, Controller, Get, Post, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard }   from '../auth/guards/roles.guard';
import { Roles }        from '../auth/decorators/roles.decorator';
import { UserRole }     from '../../database/schema';
import { MEDICAL_ROLES } from '../../common/constants/roles.constants';
import { AiAssistantService, DailyReportAggregateInput } from './ai-assistant.service';
import { ReportsService } from '../reports/reports.service';
import {
  VerifyInvoiceDto,
  ExplainSpvErrorDto,
  DailyDashboardInputDto,
  ReconciliationInputDto,
} from './dto/ai-assistant.dto';

const REPORT_ROLES    = [...MEDICAL_ROLES, UserRole.ACCOUNTANT] as const;
const FINANCIAL_ROLES = [UserRole.ADMIN, UserRole.ACCOUNTANT, UserRole.RECEPTIONIST] as const;

@Controller('ai')
@UseGuards(JwtAuthGuard, RolesGuard)
export class AiAssistantController {
  constructor(
    private readonly ai:      AiAssistantService,
    private readonly reports: ReportsService,
  ) {}

  // Verificare factură înainte de emitere
  @Post('invoices/verify')
  @Roles(...FINANCIAL_ROLES)
  verifyInvoice(@Body() dto: VerifyInvoiceDto) {
    return this.ai.verifyInvoiceBeforeIssuance(dto);
  }

  // Explicare eroare SPV în limbaj uman
  @Post('spv/explain-error')
  @Roles(...FINANCIAL_ROLES)
  explainSpvError(@Body() dto: ExplainSpvErrorDto) {
    return this.ai.explainSpvError(dto.errorCode, dto.rawAnafMessage);
  }

  // Rezumat operațional zilnic
  @Post('reports/daily-summary')
  @Roles(...REPORT_ROLES)
  dailySummary(@Body() dto: DailyDashboardInputDto) {
    return this.ai.generateDailySummary(dto);
  }

  // Reconciliere servicii prestate vs facturate
  @Post('reports/reconciliation')
  @Roles(...REPORT_ROLES)
  reconciliation(@Body() dto: ReconciliationInputDto) {
    return this.ai.reconcileServicesVsBilled(dto);
  }

  // -------------------------------------------------------------------------
  // G-06: Rezumat operațional zilnic automat — agregare internă + Claude
  // Backend agregă datele singur; frontend-ul nu trimite date, doar declanșează
  // -------------------------------------------------------------------------
  @Get('daily-summary/auto')
  @Roles(...REPORT_ROLES)
  async dailySummaryAuto() {
    const [report, dashboard] = await Promise.all([
      this.reports.getDailyReport(),
      this.reports.dashboardSummary(),
    ]);

    const r = report;
    const input: DailyReportAggregateInput = {
      reportDate:            r.revenue.date,
      revenue:               r.revenue.total,
      invoiceCount:          r.revenue.invoiceCount,
      paymentsByMethod:      r.revenue.paymentsByMethod.map((p) => ({
        method: p.method,
        amount: p.amount,
        count:  p.count,
      })),
      appointmentsToday:     r.appointments.total,
      noShowYesterday:       r.noShows.count,
      overdueReceivables:    r.receivablesDueToday.count,
      overdueAmount:         r.receivablesDueToday.totalAmount,
      criticalStockItems:    r.criticalStock.count,
      expiringIn7Days:       r.expiringProducts.count,
      spvPending:            r.spv.pendingCount,
      spvRejected:           r.spv.errorCount + r.spv.rejectedCount,
      unbilledConsultations: dashboard.today.consultations,
    };

    return this.ai.generateDailySummaryFromReport(input);
  }
}
