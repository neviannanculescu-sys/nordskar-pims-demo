import {
  Controller, Get, Post, Patch, Query, Param, Body, Res, UseGuards,
  BadRequestException, ForbiddenException, ParseUUIDPipe, Request,
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
import { ReconciliationService, UnbilledType, RecTaskStatus } from './reconciliation.service';
import { AnomalyService }          from './anomaly.service';
import { DeadStockService }        from './dead-stock.service';
import { PricingService }          from './pricing.service';
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
    private readonly reconciliationService:   ReconciliationService,
    private readonly anomalyService:          AnomalyService,
    private readonly deadStockService:        DeadStockService,
    private readonly pricingService:          PricingService,
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

  // -------------------------------------------------------------------------
  // Reconciliere servicii prestate vs. facturate — G-15 (Sesiunea 8)
  // -------------------------------------------------------------------------

  @Get('reconciliation/unbilled/summary')
  @Roles(...REPORT_ROLES)
  reconciliationSummary(
    @Query('from') from?: string,
    @Query('to')   to?:   string,
  ) {
    return this.reconciliationService.getSummary(from, to);
  }

  @Get('reconciliation/unbilled/:consultationId')
  @Roles(...REPORT_ROLES)
  reconciliationDetail(@Param('consultationId', ParseUUIDPipe) consultationId: string) {
    return this.reconciliationService.getDetail(consultationId);
  }

  @Get('reconciliation/unbilled')
  @Roles(...REPORT_ROLES)
  reconciliationUnbilled(
    @Query('from')        from?:        string,
    @Query('to')          to?:          string,
    @Query('type')        type?:        string,
    @Query('minSeverity') minSeverity?: string,
  ) {
    return this.reconciliationService.getUnbilledItems({
      from,
      to,
      type:        type        as UnbilledType | undefined,
      minSeverity: minSeverity as 'info' | 'warning' | 'critical' | undefined,
    });
  }

  @Post('reconciliation/unbilled/run')
  @Roles(...REPORT_ROLES)
  reconciliationRun(
    @Query('from') from?: string,
    @Query('to')   to?:   string,
  ) {
    return this.reconciliationService.getSummary(from, to);
  }

  // -------------------------------------------------------------------------
  // G-15 Task management — human-triggered action items
  // -------------------------------------------------------------------------

  @Post('reconciliation/tasks')
  @Roles(...REPORT_ROLES)
  createRecTask(
    @Body() body: {
      sourceEntityId: string;
      sourceType:     string;
      consultationId?: string;
      description:    string;
      assignedTo?:    string;
      note?:          string;
      estimatedValue?: number;
    },
    @Request() req: any,
  ) {
    if (!body.sourceEntityId || !body.sourceType || !body.description) {
      throw new BadRequestException('sourceEntityId, sourceType și description sunt obligatorii');
    }
    return this.reconciliationService.createTask({
      sourceEntityId: body.sourceEntityId,
      sourceType:     body.sourceType as UnbilledType,
      consultationId: body.consultationId ?? null,
      description:    body.description,
      assignedTo:     body.assignedTo,
      note:           body.note,
      estimatedValue: body.estimatedValue,
      createdBy:      req.user.id,
    });
  }

  @Get('reconciliation/tasks')
  @Roles(...REPORT_ROLES)
  listRecTasks(
    @Query('status')         status?:         string,
    @Query('sourceType')     sourceType?:     string,
    @Query('sourceEntityId') sourceEntityId?: string,
    @Query('limit')          limit?:          string,
    @Query('offset')         offset?:         string,
  ) {
    return this.reconciliationService.listTasks({
      status:         status         as RecTaskStatus | undefined,
      sourceType:     sourceType     as UnbilledType  | undefined,
      sourceEntityId,
      limit:          limit  ? parseInt(limit,  10) : undefined,
      offset:         offset ? parseInt(offset, 10) : undefined,
    });
  }

  @Patch('reconciliation/tasks/:id/status')
  @Roles(...REPORT_ROLES)
  async updateRecTaskStatus(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: { status: string },
    @Request() req: any,
  ) {
    const valid: RecTaskStatus[] = ['open', 'in_progress', 'done', 'dismissed'];
    if (!valid.includes(body.status as RecTaskStatus)) {
      throw new BadRequestException(`status trebuie să fie unul din: ${valid.join(', ')}`);
    }
    const task = await this.reconciliationService.getTask(id);
    if (!task) throw new BadRequestException(`Task-ul ${id} nu există.`);
    if (task.createdBy !== req.user.id && req.user.role !== UserRole.ADMIN) {
      throw new ForbiddenException('Doar creatorul task-ului sau un ADMIN poate modifica statusul.');
    }
    return this.reconciliationService.updateTaskStatus(id, body.status as RecTaskStatus, req.user.id);
  }

  @Get('reconciliation/tasks/for-entity/:sourceEntityId')
  @Roles(...REPORT_ROLES)
  recTasksForEntity(@Param('sourceEntityId') sourceEntityId: string) {
    return this.reconciliationService.getTasksForSourceEntity(sourceEntityId);
  }

  /** Rulează scenariile de acceptanță pe cele 4 tipuri de surse. Doar ADMIN. */
  @Get('reconciliation/acceptance-check')
  @Roles(UserRole.ADMIN)
  recAcceptanceCheck(@Request() req: any) {
    return this.reconciliationService.runAcceptanceCheck(req.user.id);
  }

  // -------------------------------------------------------------------------
  // G-05 Anomaly Detection — Sesiunea 9
  // -------------------------------------------------------------------------

  @Get('anomalies')
  @Roles(...REPORT_ROLES)
  listAnomalies(
    @Query('status')       status?:       string,
    @Query('severity')     severity?:     string,
    @Query('sourceModule') sourceModule?: string,
    @Query('limit')        limit?:        string,
    @Query('offset')       offset?:       string,
  ) {
    return this.anomalyService.list({
      status,
      severity,
      sourceModule,
      limit:  limit  ? parseInt(limit,  10) : undefined,
      offset: offset ? parseInt(offset, 10) : undefined,
    });
  }

  @Get('anomalies/summary')
  @Roles(...REPORT_ROLES)
  anomalySummary() {
    return this.anomalyService.getSummary();
  }

  @Get('anomalies/:id')
  @Roles(...REPORT_ROLES)
  anomalyDetail(@Param('id', ParseUUIDPipe) id: string) {
    return this.anomalyService.getById(id);
  }

  @Post('anomalies/run')
  @Roles(...REPORT_ROLES)
  runAnomalyDetection() {
    return this.anomalyService.runDetection();
  }

  @Post('anomalies/:id/ack')
  @Roles(...REPORT_ROLES)
  ackAnomaly(
    @Param('id', ParseUUIDPipe) id: string,
    @Request() req: any,
  ) {
    return this.anomalyService.ack(id, req.user.id);
  }

  @Post('anomalies/:id/resolve')
  @Roles(...REPORT_ROLES)
  resolveAnomaly(
    @Param('id', ParseUUIDPipe) id: string,
    @Request() req: any,
  ) {
    return this.anomalyService.resolve(id, req.user.id);
  }

  // -------------------------------------------------------------------------
  // G-13 Dead Stock — Sesiunea 10
  // -------------------------------------------------------------------------

  @Get('inventory/dead-stock/summary')
  @Roles(...REPORT_ROLES)
  deadStockSummary(@Query('range') range?: string) {
    return this.deadStockService.getSummary(range ? parseInt(range, 10) : 90);
  }

  @Get('inventory/dead-stock/run')
  @Roles(...REPORT_ROLES)
  deadStockRunGet() {
    return this.deadStockService.run();
  }

  @Post('inventory/dead-stock/run')
  @Roles(...REPORT_ROLES)
  deadStockRun() {
    return this.deadStockService.run();
  }

  @Get('inventory/dead-stock/:inventoryItemId')
  @Roles(...REPORT_ROLES)
  deadStockDetail(@Param('inventoryItemId', ParseUUIDPipe) inventoryItemId: string) {
    return this.deadStockService.getDetail(inventoryItemId);
  }

  // -------------------------------------------------------------------------
  // G-04 Pricing — Sesiunea 11
  // -------------------------------------------------------------------------

  @Get('pricing/summary')
  @Roles(...REPORT_ROLES)
  pricingSummary() {
    return this.pricingService.getSummary();
  }

  @Get('pricing/underpriced')
  @Roles(...REPORT_ROLES)
  pricingUnderpriced(
    @Query('minMarginOverride') minMarginOverride?: string,
    @Query('category')          category?:          string,
    @Query('serviceType')       serviceType?:       string,
    @Query('onlyUnderpriced')   onlyUnderpriced?:   string,
    @Query('onlyNoEstimate')    onlyNoEstimate?:    string,
    @Query('limit')             limit?:             string,
    @Query('offset')            offset?:            string,
    @Query('format')            format?:            string,
    @Res({ passthrough: true }) res?: Response,
  ) {
    const params = {
      minMarginOverride: minMarginOverride ? parseFloat(minMarginOverride) : undefined,
      category,
      serviceType,
      onlyUnderpriced: onlyUnderpriced === 'true',
      onlyNoEstimate:  onlyNoEstimate  === 'true',
      limit:           limit  ? parseInt(limit,  10) : undefined,
      offset:          offset ? parseInt(offset, 10) : undefined,
    };

    if (format === 'csv') {
      return this.pricingService.getUnderpricedServices(params).then(({ data }) => {
        const csv = this.pricingService.exportToCsv(data);
        res!.set({
          'Content-Type':        'text/csv; charset=utf-8',
          'Content-Disposition': `attachment; filename="propuneri_preturi_${new Date().toISOString().slice(0, 10)}.csv"`,
        });
        return csv;
      });
    }
    return this.pricingService.getUnderpricedServices(params);
  }

  @Get('pricing/affected-by-inventory/:inventoryItemId')
  @Roles(...REPORT_ROLES)
  pricingAffectedByInventory(@Param('inventoryItemId', ParseUUIDPipe) inventoryItemId: string) {
    return this.pricingService.getAffectedServicesByInventoryItem(inventoryItemId);
  }

  @Get('pricing/:serviceId/simulate')
  @Roles(...REPORT_ROLES)
  pricingSimulate(
    @Param('serviceId', ParseUUIDPipe) serviceId: string,
    @Query('newBasePrice') newBasePrice: string,
  ) {
    if (!newBasePrice) throw new BadRequestException('newBasePrice este obligatoriu');
    const price = parseFloat(newBasePrice);
    if (isNaN(price) || price <= 0) throw new BadRequestException('newBasePrice trebuie să fie un număr pozitiv');
    return this.pricingService.simulatePriceChange(serviceId, price);
  }

  @Get('pricing/:serviceId')
  @Roles(...REPORT_ROLES)
  pricingDetail(@Param('serviceId', ParseUUIDPipe) serviceId: string) {
    return this.pricingService.getServiceDetail(serviceId);
  }

  @Get('inventory/dead-stock')
  @Roles(...REPORT_ROLES)
  deadStockList(
    @Query('range')        range?:        string,
    @Query('category')     category?:     string,
    @Query('manufacturer') manufacturer?: string,
    @Query('severity')     severity?:     string,
    @Query('limit')        limit?:        string,
    @Query('offset')       offset?:       string,
    @Query('format')       format?:       string,
    @Res({ passthrough: true }) res?: Response,
  ) {
    if (format === 'csv') {
      return this.deadStockService
        .getDeadStock({ range: range ? parseInt(range, 10) : 90, category, manufacturer, severity, limit: 500 })
        .then(({ data }) => {
          const csv = this.deadStockService.exportToCsv(data);
          res!.set({
            'Content-Type':        'text/csv; charset=utf-8',
            'Content-Disposition': `attachment; filename="stoc_mort_${new Date().toISOString().slice(0,10)}.csv"`,
          });
          return csv;
        });
    }
    return this.deadStockService.getDeadStock({
      range:        range        ? parseInt(range, 10)  : 90,
      category,
      manufacturer,
      severity,
      limit:        limit        ? parseInt(limit,  10) : undefined,
      offset:       offset       ? parseInt(offset, 10) : undefined,
    });
  }
}
