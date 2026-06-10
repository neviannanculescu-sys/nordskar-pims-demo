import {
  Controller, Get, Query, Res, UseGuards,
  BadRequestException,
} from '@nestjs/common';
import { Response } from 'express';
import { JwtAuthGuard }  from '../auth/guards/jwt-auth.guard';
import { RolesGuard }    from '../auth/guards/roles.guard';
import { Roles }         from '../auth/decorators/roles.decorator';
import { UserRole }      from '../../database/schema';
import { MEDICAL_ROLES } from '../../common/constants/roles.constants';
import { ReportsService }          from './reports.service';
import { AccountingExportService } from './accounting-export.service';
import { KpiService }              from './kpi.service';
import { ReportFiltersDto, AccountingExportDto, ExportFormat } from './dto/report-filters.dto';

// Rapoartele financiare sunt vizibile și pentru ACCOUNTANT
const REPORT_ROLES = [...MEDICAL_ROLES, UserRole.ACCOUNTANT] as const;
const ACCOUNTING_ROLES = [UserRole.ADMIN, UserRole.ACCOUNTANT] as const;

@Controller('reports')
@UseGuards(JwtAuthGuard, RolesGuard)
export class ReportsController {
  constructor(
    private readonly reportsService:          ReportsService,
    private readonly accountingExportService: AccountingExportService,
    private readonly kpiService:              KpiService,
  ) {}

  // -------------------------------------------------------------------------
  // Dashboard
  // -------------------------------------------------------------------------

  @Get('dashboard')
  @Roles(...REPORT_ROLES)
  dashboard() {
    return this.reportsService.dashboardSummary();
  }

  // -------------------------------------------------------------------------
  // Raport zilnic complet (manual sau cron 07:30)
  // -------------------------------------------------------------------------

  @Get('daily')
  @Roles(...REPORT_ROLES)
  dailyReport() {
    return this.reportsService.getDailyReport();
  }

  // -------------------------------------------------------------------------
  // Rapoarte operaționale
  // -------------------------------------------------------------------------

  @Get('revenue/by-period')
  @Roles(...REPORT_ROLES)
  revenueByPeriod(
    @Query('dateFrom') dateFrom: string,
    @Query('dateTo')   dateTo:   string,
    @Query('groupBy')  groupBy:  'day' | 'month' = 'day',
  ) {
    if (!dateFrom || !dateTo) throw new BadRequestException('dateFrom și dateTo sunt obligatorii');
    return this.reportsService.revenueByPeriod({ dateFrom, dateTo, groupBy });
  }

  @Get('revenue/by-service')
  @Roles(...REPORT_ROLES)
  revenueByService(
    @Query('dateFrom') dateFrom: string,
    @Query('dateTo')   dateTo:   string,
  ) {
    if (!dateFrom || !dateTo) throw new BadRequestException('dateFrom și dateTo sunt obligatorii');
    return this.reportsService.revenueByService({ dateFrom, dateTo });
  }

  @Get('vets/performance')
  @Roles(...REPORT_ROLES)
  vetPerformance(
    @Query('dateFrom')        dateFrom:        string,
    @Query('dateTo')          dateTo:          string,
    @Query('veterinarianId')  veterinarianId?: string,
  ) {
    if (!dateFrom || !dateTo) throw new BadRequestException('dateFrom și dateTo sunt obligatorii');
    return this.reportsService.vetPerformance({ dateFrom, dateTo, veterinarianId });
  }

  @Get('invoices/outstanding')
  @Roles(...REPORT_ROLES)
  outstandingInvoices(
    @Query('asOfDate')  asOfDate?:  string,
    @Query('dueBefore') dueBefore?: string,
  ) {
    return this.reportsService.outstandingInvoices({ asOfDate, dueBefore });
  }

  @Get('inventory/consumption')
  @Roles(...REPORT_ROLES)
  inventoryConsumption(
    @Query('dateFrom') dateFrom: string,
    @Query('dateTo')   dateTo:   string,
  ) {
    if (!dateFrom || !dateTo) throw new BadRequestException('dateFrom și dateTo sunt obligatorii');
    return this.reportsService.inventoryConsumption({ dateFrom, dateTo });
  }

  // -------------------------------------------------------------------------
  // Servicii nefacturate (consultații semnate, nebilate)
  // -------------------------------------------------------------------------

  @Get('unbilled-services')
  @Roles(...REPORT_ROLES)
  unbilledServices(
    @Query('dateFrom') dateFrom?: string,
    @Query('dateTo')   dateTo?:   string,
  ) {
    return this.reportsService.getUnbilledServices({ dateFrom, dateTo });
  }

  // -------------------------------------------------------------------------
  // Export contabilitate — CSV sau XLSX
  // -------------------------------------------------------------------------

  @Get('accounting/export')
  @Roles(...ACCOUNTING_ROLES)
  async accountingExport(
    @Query('dateFrom') dateFrom: string,
    @Query('dateTo')   dateTo:   string,
    @Query('format')   format:   ExportFormat = ExportFormat.XLSX,
    @Res() res: Response,
  ) {
    if (!dateFrom || !dateTo) throw new BadRequestException('dateFrom și dateTo sunt obligatorii');

    const invoiceRows = await this.accountingExportService.getInvoiceRows(dateFrom, dateTo);
    const paymentRows = await this.accountingExportService.getPaymentRows(dateFrom, dateTo);
    const slug        = `${dateFrom}_${dateTo}`;

    if (format === ExportFormat.CSV) {
      const csv = this.accountingExportService.exportToCsv(invoiceRows);
      res.set({
        'Content-Type':        'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="jurnal_vanzari_${slug}.csv"`,
      });
      return res.send(csv);
    }

    if ((format as string) === 'json') {
      return res.json(invoiceRows);
    }

    // XLSX (default)
    const buffer = await this.accountingExportService.exportToXlsx(invoiceRows, paymentRows, dateFrom, dateTo);
    res.set({
      'Content-Type':        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': `attachment; filename="contabilitate_${slug}.xlsx"`,
      'Content-Length':      buffer.length,
    });
    return res.send(buffer);
  }

  @Get('accounting/payments/export')
  @Roles(...ACCOUNTING_ROLES)
  async paymentsExport(
    @Query('dateFrom') dateFrom: string,
    @Query('dateTo')   dateTo:   string,
    @Res() res: Response,
  ) {
    if (!dateFrom || !dateTo) throw new BadRequestException('dateFrom și dateTo sunt obligatorii');
    const rows = await this.accountingExportService.getPaymentRows(dateFrom, dateTo);
    const csv  = this.accountingExportService.exportPaymentsToCsv(rows);
    res.set({
      'Content-Type':        'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="incasari_${dateFrom}_${dateTo}.csv"`,
    });
    return res.send(csv);
  }

  // -------------------------------------------------------------------------
  // Jurnal casă (numerar)
  // -------------------------------------------------------------------------

  @Get('accounting/exports/cash')
  @Roles(...ACCOUNTING_ROLES)
  async cashJournalExport(
    @Query('dateFrom') dateFrom: string,
    @Query('dateTo')   dateTo:   string,
    @Query('format')   format:   string = 'json',
    @Res() res: Response,
  ) {
    if (!dateFrom || !dateTo) throw new BadRequestException('dateFrom și dateTo sunt obligatorii');
    const rows = await this.accountingExportService.getCashJournal(dateFrom, dateTo);
    if (format === 'csv') {
      const csv = this.accountingExportService.exportPaymentJournalToCsv(rows, 'CASA');
      res.set({
        'Content-Type':        'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="jurnal_casa_${dateFrom}_${dateTo}.csv"`,
      });
      return res.send(csv);
    }
    return res.json(rows);
  }

  // -------------------------------------------------------------------------
  // Jurnal bancă (card + transfer)
  // -------------------------------------------------------------------------

  @Get('accounting/exports/bank')
  @Roles(...ACCOUNTING_ROLES)
  async bankJournalExport(
    @Query('dateFrom') dateFrom: string,
    @Query('dateTo')   dateTo:   string,
    @Query('format')   format:   string = 'json',
    @Res() res: Response,
  ) {
    if (!dateFrom || !dateTo) throw new BadRequestException('dateFrom și dateTo sunt obligatorii');
    const rows = await this.accountingExportService.getBankJournal(dateFrom, dateTo);
    if (format === 'csv') {
      const csv = this.accountingExportService.exportPaymentJournalToCsv(rows, 'BANCA');
      res.set({
        'Content-Type':        'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="jurnal_banca_${dateFrom}_${dateTo}.csv"`,
      });
      return res.send(csv);
    }
    return res.json(rows);
  }

  // -------------------------------------------------------------------------
  // Registru cumpărări
  // -------------------------------------------------------------------------

  @Get('accounting/exports/purchases')
  @Roles(...ACCOUNTING_ROLES)
  async purchasesExport(
    @Query('dateFrom') dateFrom: string,
    @Query('dateTo')   dateTo:   string,
    @Query('format')   format:   string = 'json',
    @Res() res: Response,
  ) {
    if (!dateFrom || !dateTo) throw new BadRequestException('dateFrom și dateTo sunt obligatorii');
    const rows = await this.accountingExportService.getPurchaseRegistry(dateFrom, dateTo);
    if (format === 'csv') {
      const csv = this.accountingExportService.exportPurchasesToCsv(rows);
      res.set({
        'Content-Type':        'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="registru_cumparari_${dateFrom}_${dateTo}.csv"`,
      });
      return res.send(csv);
    }
    return res.json(rows);
  }

  // -------------------------------------------------------------------------
  // Reconciliere — sumar TVA + discrepanțe
  // -------------------------------------------------------------------------

  @Get('accounting/reconciliation')
  @Roles(...ACCOUNTING_ROLES)
  reconciliation(
    @Query('dateFrom') dateFrom: string,
    @Query('dateTo')   dateTo:   string,
  ) {
    if (!dateFrom || !dateTo) throw new BadRequestException('dateFrom și dateTo sunt obligatorii');
    return this.accountingExportService.getReconciliationSummary(dateFrom, dateTo);
  }

  // -------------------------------------------------------------------------
  // KPI Management — Sesiunea 7
  // -------------------------------------------------------------------------

  @Get('kpi/dashboard')
  @Roles(...REPORT_ROLES)
  kpiDashboard(@Query('date') date?: string) {
    return this.kpiService.getKpiDashboard(date);
  }

  @Get('kpi/week-over-week')
  @Roles(...REPORT_ROLES)
  kpiWeekOverWeek(@Query('date') date?: string) {
    return this.kpiService.getWeekOverWeek(date);
  }

  @Get('kpi/financial')
  @Roles(...REPORT_ROLES)
  kpiFinancial(
    @Query('from') from: string,
    @Query('to')   to:   string,
  ) {
    if (!from || !to) throw new BadRequestException('from și to sunt obligatorii');
    return this.kpiService.getKpiFinancial(from, to);
  }

  @Get('kpi/operations')
  @Roles(...REPORT_ROLES)
  kpiOperations(
    @Query('from') from: string,
    @Query('to')   to:   string,
  ) {
    if (!from || !to) throw new BadRequestException('from și to sunt obligatorii');
    return this.kpiService.getKpiOperations(from, to);
  }

  @Get('kpi/inventory')
  @Roles(...REPORT_ROLES)
  kpiInventory(
    @Query('from') from: string,
    @Query('to')   to:   string,
  ) {
    if (!from || !to) throw new BadRequestException('from și to sunt obligatorii');
    return this.kpiService.getKpiInventory(from, to);
  }

  @Get('kpi/spv')
  @Roles(...REPORT_ROLES)
  kpiSpv(
    @Query('from') from: string,
    @Query('to')   to:   string,
  ) {
    if (!from || !to) throw new BadRequestException('from și to sunt obligatorii');
    return this.kpiService.getKpiSpv(from, to);
  }
}
