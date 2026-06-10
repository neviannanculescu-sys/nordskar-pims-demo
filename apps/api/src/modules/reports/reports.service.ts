import { Inject, Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { sql } from 'drizzle-orm';
import { DRIZZLE_DB, DrizzleDB } from '../../database/database.module';

// ---------------------------------------------------------------------------
// Tipuri de răspuns rapoarte
// ---------------------------------------------------------------------------

export interface RevenueRow {
  period:          string;
  invoiceCount:    number;
  subtotal:        number;
  vatAmount:       number;
  totalAmount:     number;
  paidAmount:      number;
  outstanding:     number;
}

export interface ServiceRevenueRow {
  sourceType:  string;
  description: string;
  quantity:    number;
  lineTotal:   number;
  vatAmount:   number;
}

export interface VetPerformanceRow {
  veterinarianId:    string;
  veterinarianName:  string;
  consultationCount: number;
  procedureCount:    number;
  totalRevenue:      number;
}

export interface OutstandingInvoiceRow {
  invoiceId:     string;
  invoiceNumber: string;
  ownerName:     string;
  issuedAt:      string;
  dueDate:       string | null;
  totalAmount:   number;
  paidAmount:    number;
  outstanding:   number;
  daysOverdue:   number;
}

export interface InventoryConsumptionRow {
  inventoryItemId: string;
  sku:             string;
  name:            string;
  totalDispensed:  number;
  unit:            string;
  totalCost:       number;
}

export interface UnbilledConsultationRow {
  consultationId:   string;
  consultationDate: string;
  unbilledProcedures: number;
  unbilledMedications: number;
  estimatedTotal:   number;
  daysSinceConsultation: number;
}

export interface DashboardSummary {
  today:   { consultations: number; invoicesIssued: number; revenue: number };
  month:   { consultations: number; invoicesIssued: number; revenue: number; outstanding: number };
  spv:     { pending: number; accepted: number; rejected: number };
  stock:   { lowStockItems: number };
}

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

@Injectable()
export class ReportsService {
  private readonly logger = new Logger(ReportsService.name);

  constructor(@Inject(DRIZZLE_DB) private readonly db: DrizzleDB) {}

  // -------------------------------------------------------------------------
  // 1. Venituri pe perioadă (grupate zilnic / lunar)
  // -------------------------------------------------------------------------

  async revenueByPeriod(params: {
    dateFrom: string;
    dateTo:   string;
    groupBy:  'day' | 'month';
  }): Promise<RevenueRow[]> {
    const truncFn = params.groupBy === 'month' ? 'month' : 'day';

    const rows = await this.db.execute<{
      period: string;
      invoice_count: string;
      subtotal: string;
      vat_amount: string;
      total_amount: string;
      paid_amount: string;
    }>(sql`
      SELECT
        TO_CHAR(DATE_TRUNC(${truncFn}, issued_at), 'YYYY-MM-DD') AS period,
        COUNT(*)::TEXT                                             AS invoice_count,
        SUM(subtotal)::TEXT                                        AS subtotal,
        SUM(vat_amount)::TEXT                                      AS vat_amount,
        SUM(total_amount)::TEXT                                    AS total_amount,
        SUM(paid_amount)::TEXT                                     AS paid_amount
      FROM invoices
      WHERE deleted_at IS NULL
        AND status NOT IN ('draft', 'cancelled', 'storno')
        AND issued_at::DATE BETWEEN ${params.dateFrom} AND ${params.dateTo}
      GROUP BY DATE_TRUNC(${truncFn}, issued_at)
      ORDER BY DATE_TRUNC(${truncFn}, issued_at)
    `);

    return rows.rows.map((r) => {
      const total = parseFloat(r.total_amount ?? '0');
      const paid  = parseFloat(r.paid_amount  ?? '0');
      return {
        period:       r.period,
        invoiceCount: parseInt(r.invoice_count, 10),
        subtotal:     parseFloat(r.subtotal   ?? '0'),
        vatAmount:    parseFloat(r.vat_amount ?? '0'),
        totalAmount:  total,
        paidAmount:   paid,
        outstanding:  +(total - paid).toFixed(2),
      };
    });
  }

  // -------------------------------------------------------------------------
  // 2. Venituri pe tip serviciu (proceduri vs medicamente)
  // -------------------------------------------------------------------------

  async revenueByService(params: { dateFrom: string; dateTo: string }): Promise<ServiceRevenueRow[]> {
    const rows = await this.db.execute<{
      source_type: string;
      description: string;
      quantity: string;
      line_total: string;
      vat_amount: string;
    }>(sql`
      SELECT
        il.source_type,
        il.description,
        SUM(il.quantity)::TEXT   AS quantity,
        SUM(il.line_total)::TEXT AS line_total,
        SUM(il.vat_amount)::TEXT AS vat_amount
      FROM invoice_lines il
      JOIN invoices i ON i.id = il.invoice_id
      WHERE i.deleted_at IS NULL
        AND i.status NOT IN ('draft', 'cancelled', 'storno')
        AND i.issued_at::DATE BETWEEN ${params.dateFrom} AND ${params.dateTo}
      GROUP BY il.source_type, il.description
      ORDER BY SUM(il.line_total) DESC
    `);

    return rows.rows.map((r) => ({
      sourceType:  r.source_type,
      description: r.description,
      quantity:    parseFloat(r.quantity  ?? '0'),
      lineTotal:   parseFloat(r.line_total ?? '0'),
      vatAmount:   parseFloat(r.vat_amount ?? '0'),
    }));
  }

  // -------------------------------------------------------------------------
  // 3. Performanță medici veterinari
  // -------------------------------------------------------------------------

  async vetPerformance(params: {
    dateFrom:       string;
    dateTo:         string;
    veterinarianId?: string;
  }): Promise<VetPerformanceRow[]> {
    const vetFilter = params.veterinarianId
      ? sql`AND v.id = ${params.veterinarianId}`
      : sql``;

    const rows = await this.db.execute<{
      veterinarian_id:    string;
      veterinarian_name:  string;
      consultation_count: string;
      procedure_count:    string;
      total_revenue:      string;
    }>(sql`
      SELECT
        v.id                                           AS veterinarian_id,
        u.first_name || ' ' || u.last_name            AS veterinarian_name,
        COUNT(DISTINCT c.id)::TEXT                     AS consultation_count,
        COUNT(DISTINCT p.id)::TEXT                     AS procedure_count,
        COALESCE(SUM(il.line_total), 0)::TEXT          AS total_revenue
      FROM veterinarians v
      JOIN users u ON u.id = v.user_id
      LEFT JOIN consultations c
        ON c.veterinarian_id = v.id
        AND c.deleted_at IS NULL
        AND c.consultation_date::DATE BETWEEN ${params.dateFrom} AND ${params.dateTo}
      LEFT JOIN procedures p
        ON p.veterinarian_id = v.id
        AND p.deleted_at IS NULL
        AND p.performed_at::DATE BETWEEN ${params.dateFrom} AND ${params.dateTo}
      LEFT JOIN invoice_lines il ON il.source_id = p.id AND il.source_type = 'procedure'
      LEFT JOIN invoices i ON i.id = il.invoice_id
        AND i.status NOT IN ('draft', 'cancelled', 'storno')
      WHERE v.deleted_at IS NULL AND u.deleted_at IS NULL
      ${vetFilter}
      GROUP BY v.id, u.first_name, u.last_name
      ORDER BY COALESCE(SUM(il.line_total), 0) DESC
    `);

    return rows.rows.map((r) => ({
      veterinarianId:    r.veterinarian_id,
      veterinarianName:  r.veterinarian_name,
      consultationCount: parseInt(r.consultation_count, 10),
      procedureCount:    parseInt(r.procedure_count, 10),
      totalRevenue:      parseFloat(r.total_revenue ?? '0'),
    }));
  }

  // -------------------------------------------------------------------------
  // 4. Facturi restante (emise, neîncasate complet)
  // -------------------------------------------------------------------------

  async outstandingInvoices(params: {
    asOfDate?: string;
    dueBefore?: string;
  }): Promise<OutstandingInvoiceRow[]> {
    const asOf = params.asOfDate ?? new Date().toISOString().slice(0, 10);
    const dueFilter = params.dueBefore
      ? sql`AND i.due_date <= ${params.dueBefore}`
      : sql``;

    const rows = await this.db.execute<{
      invoice_id:     string;
      invoice_number: string;
      owner_name:     string;
      issued_at:      string;
      due_date:       string | null;
      total_amount:   string;
      paid_amount:    string;
    }>(sql`
      SELECT
        i.id                                             AS invoice_id,
        i.invoice_number,
        COALESCE(i.billing_name, 'Necunoscut')          AS owner_name,
        i.issued_at::DATE::TEXT                         AS issued_at,
        i.due_date::TEXT                                AS due_date,
        i.total_amount::TEXT                            AS total_amount,
        i.paid_amount::TEXT                             AS paid_amount
      FROM invoices i
      WHERE i.deleted_at IS NULL
        AND i.status IN ('issued', 'partially_paid')
        AND i.issued_at::DATE <= ${asOf}
        ${dueFilter}
      ORDER BY i.due_date ASC NULLS LAST, i.issued_at ASC
    `);

    const today = new Date(asOf).getTime();
    return rows.rows.map((r) => {
      const total       = parseFloat(r.total_amount ?? '0');
      const paid        = parseFloat(r.paid_amount  ?? '0');
      const outstanding = +(total - paid).toFixed(2);
      const dueTs       = r.due_date ? new Date(r.due_date).getTime() : null;
      const daysOverdue = dueTs ? Math.max(0, Math.floor((today - dueTs) / 86_400_000)) : 0;
      return {
        invoiceId:     r.invoice_id,
        invoiceNumber: r.invoice_number,
        ownerName:     r.owner_name,
        issuedAt:      r.issued_at,
        dueDate:       r.due_date,
        totalAmount:   total,
        paidAmount:    paid,
        outstanding,
        daysOverdue,
      };
    });
  }

  // -------------------------------------------------------------------------
  // 5. Consum inventar pe perioadă
  // -------------------------------------------------------------------------

  async inventoryConsumption(params: { dateFrom: string; dateTo: string }): Promise<InventoryConsumptionRow[]> {
    const rows = await this.db.execute<{
      inventory_item_id: string;
      sku:               string;
      name:              string;
      total_dispensed:   string;
      unit:              string;
      total_cost:        string;
    }>(sql`
      SELECT
        ii.id                          AS inventory_item_id,
        ii.sku,
        ii.name,
        SUM(tl.quantity_dispensed)     AS total_dispensed,
        ii.unit_of_measure             AS unit,
        SUM(tl.quantity_dispensed * tl.unit_cost) AS total_cost
      FROM treatment_lines tl
      JOIN inventory_items ii ON ii.id = tl.inventory_item_id
      JOIN consultations c ON c.id = tl.consultation_id
      WHERE tl.deleted_at IS NULL
        AND tl.is_dispensed = TRUE
        AND c.consultation_date::DATE BETWEEN ${params.dateFrom} AND ${params.dateTo}
      GROUP BY ii.id, ii.sku, ii.name, ii.unit_of_measure
      ORDER BY SUM(tl.quantity_dispensed * tl.unit_cost) DESC NULLS LAST
    `);

    return rows.rows.map((r) => ({
      inventoryItemId: r.inventory_item_id,
      sku:             r.sku,
      name:            r.name,
      totalDispensed:  parseFloat(r.total_dispensed ?? '0'),
      unit:            r.unit,
      totalCost:       parseFloat(r.total_cost ?? '0'),
    }));
  }

  // -------------------------------------------------------------------------
  // 6. Servicii nefacturate — consultații semnate cu proceduri/medicamente
  //    nebilate (sursă: billing_candidates VIEW + consultations)
  // -------------------------------------------------------------------------

  async getUnbilledServices(params: {
    dateFrom?: string;
    dateTo?:   string;
  } = {}): Promise<UnbilledConsultationRow[]> {
    const dateFromFilter = params.dateFrom
      ? sql`AND c.consultation_date::DATE >= ${params.dateFrom}`
      : sql``;
    const dateToFilter = params.dateTo
      ? sql`AND c.consultation_date::DATE <= ${params.dateTo}`
      : sql``;

    const rows = await this.db.execute<{
      consultation_id:        string;
      consultation_date:      string;
      unbilled_procedures:    string;
      unbilled_medications:   string;
      estimated_total:        string;
      days_since_consultation: string;
    }>(sql`
      SELECT
        c.id                                                            AS consultation_id,
        c.consultation_date::DATE::TEXT                                 AS consultation_date,
        COUNT(p.id)  FILTER (WHERE p.id IS NOT NULL)::TEXT              AS unbilled_procedures,
        COUNT(tl.id) FILTER (WHERE tl.id IS NOT NULL)::TEXT             AS unbilled_medications,
        COALESCE(
          SUM(pc.price_with_vat) FILTER (WHERE p.id IS NOT NULL), 0
        ) +
        COALESCE(
          SUM(tl.quantity_dispensed * tl.unit_cost * 1.09) FILTER (WHERE tl.id IS NOT NULL), 0
        )                                                               AS estimated_total,
        EXTRACT(DAY FROM NOW() - c.consultation_date)::TEXT            AS days_since_consultation
      FROM consultations c
      LEFT JOIN procedures p
        ON p.consultation_id = c.id
        AND p.deleted_at IS NULL
        AND p.is_billable = TRUE
        AND p.billed = FALSE
        AND p.signed_by IS NOT NULL
      LEFT JOIN price_catalog pc ON pc.id = p.procedure_template_id
      LEFT JOIN treatment_lines tl
        ON tl.consultation_id = c.id
        AND tl.deleted_at IS NULL
        AND tl.is_dispensed = TRUE
        AND tl.is_billable = TRUE
        AND tl.billed = FALSE
      WHERE c.deleted_at IS NULL
        AND c.signed_by IS NOT NULL
        AND c.billed = FALSE
        ${dateFromFilter}
        ${dateToFilter}
      GROUP BY c.id, c.consultation_date
      HAVING COUNT(p.id) > 0 OR COUNT(tl.id) > 0
      ORDER BY c.consultation_date ASC
    `);

    return rows.rows.map((r) => ({
      consultationId:       r.consultation_id,
      consultationDate:     r.consultation_date,
      unbilledProcedures:   parseInt(r.unbilled_procedures   ?? '0', 10),
      unbilledMedications:  parseInt(r.unbilled_medications  ?? '0', 10),
      estimatedTotal:       parseFloat(r.estimated_total     ?? '0'),
      daysSinceConsultation: parseInt(r.days_since_consultation ?? '0', 10),
    }));
  }

  // -------------------------------------------------------------------------
  // 7. Dashboard summary (today + luna curentă + SPV + stocuri)
  // -------------------------------------------------------------------------

  async dashboardSummary(): Promise<DashboardSummary> {
    const todayStr  = new Date().toISOString().slice(0, 10);
    const monthStart = todayStr.slice(0, 8) + '01';

    const todayStats = await this.db.execute<{
      consultations: string; invoices: string; revenue: string;
    }>(sql`
      SELECT
        (SELECT COUNT(*) FROM consultations
         WHERE deleted_at IS NULL AND consultation_date::DATE = ${todayStr})::TEXT AS consultations,
        (SELECT COUNT(*) FROM invoices
         WHERE deleted_at IS NULL AND status NOT IN ('draft','cancelled','storno')
           AND issued_at::DATE = ${todayStr})::TEXT                                 AS invoices,
        COALESCE((SELECT SUM(total_amount) FROM invoices
         WHERE deleted_at IS NULL AND status NOT IN ('draft','cancelled','storno')
           AND issued_at::DATE = ${todayStr}), 0)::TEXT                             AS revenue
    `);

    const monthStats = await this.db.execute<{
      consultations: string; invoices: string; revenue: string; outstanding: string;
    }>(sql`
      SELECT
        (SELECT COUNT(*) FROM consultations
         WHERE deleted_at IS NULL AND consultation_date::DATE BETWEEN ${monthStart} AND ${todayStr})::TEXT AS consultations,
        (SELECT COUNT(*) FROM invoices
         WHERE deleted_at IS NULL AND status NOT IN ('draft','cancelled','storno')
           AND issued_at::DATE BETWEEN ${monthStart} AND ${todayStr})::TEXT                                 AS invoices,
        COALESCE((SELECT SUM(total_amount) FROM invoices
         WHERE deleted_at IS NULL AND status NOT IN ('draft','cancelled','storno')
           AND issued_at::DATE BETWEEN ${monthStart} AND ${todayStr}), 0)::TEXT                             AS revenue,
        COALESCE((SELECT SUM(total_amount - paid_amount) FROM invoices
         WHERE deleted_at IS NULL AND status IN ('issued','partially_paid')), 0)::TEXT                      AS outstanding
    `);

    const spvStats = await this.db.execute<{
      pending: string; accepted: string; rejected: string;
    }>(sql`
      SELECT
        COUNT(*) FILTER (WHERE status IN ('uploaded','processing'))::TEXT AS pending,
        COUNT(*) FILTER (WHERE status = 'accepted')::TEXT                 AS accepted,
        COUNT(*) FILTER (WHERE status = 'rejected')::TEXT                 AS rejected
      FROM spv_submissions
    `);

    const stockStats = await this.db.execute<{ low_stock: string }>(sql`
      SELECT COUNT(*)::TEXT AS low_stock
      FROM inventory_items
      WHERE deleted_at IS NULL
        AND is_active = TRUE
        AND min_stock_level IS NOT NULL
        AND current_stock < min_stock_level
    `);

    const today  = todayStats.rows[0]       as Record<string, string>;
    const month  = monthStats.rows[0]       as Record<string, string>;
    const spv    = spvStats.rows[0]         as Record<string, string>;
    const stock  = stockStats.rows[0]       as Record<string, string>;

    return {
      today: {
        consultations:  parseInt(today['consultations'] ?? '0', 10),
        invoicesIssued: parseInt(today['invoices']      ?? '0', 10),
        revenue:        parseFloat(today['revenue']     ?? '0'),
      },
      month: {
        consultations:  parseInt(month['consultations'] ?? '0', 10),
        invoicesIssued: parseInt(month['invoices']      ?? '0', 10),
        revenue:        parseFloat(month['revenue']     ?? '0'),
        outstanding:    parseFloat(month['outstanding'] ?? '0'),
      },
      spv: {
        pending:  parseInt(spv['pending']  ?? '0', 10),
        accepted: parseInt(spv['accepted'] ?? '0', 10),
        rejected: parseInt(spv['rejected'] ?? '0', 10),
      },
      stock: {
        lowStockItems: parseInt(stock['low_stock'] ?? '0', 10),
      },
    };
  }

  // -------------------------------------------------------------------------
  // Job automat: raport zilnic la 07:30
  // Loghează sumarul operațional și serviciile nefacturate.
  // Notificările externe (email, Slack) se configurează prin hooks la nivel
  // de aplicație — acest job doar produce datele structurate.
  // -------------------------------------------------------------------------

  @Cron('30 7 * * *', { name: 'daily-report', timeZone: 'Europe/Bucharest' })
  async runDailyReport(): Promise<void> {
    const today = new Date().toISOString().slice(0, 10);
    this.logger.log({ event: 'daily_report_start', date: today });

    try {
      const [summary, unbilled] = await Promise.all([
        this.dashboardSummary(),
        this.getUnbilledServices(),
      ]);

      this.logger.log({
        event:                 'daily_report_complete',
        date:                  today,
        todayConsultations:    summary.today.consultations,
        todayRevenue:          summary.today.revenue,
        monthRevenue:          summary.month.revenue,
        monthOutstanding:      summary.month.outstanding,
        spvPending:            summary.spv.pending,
        spvRejected:           summary.spv.rejected,
        lowStockItems:         summary.stock.lowStockItems,
        unbilledConsultations: unbilled.length,
        unbilledEstimatedTotal: unbilled.reduce((s, r) => s + r.estimatedTotal, 0),
      });

      if (summary.spv.rejected > 0) {
        this.logger.warn({
          event:   'daily_report_spv_alert',
          rejected: summary.spv.rejected,
          message: 'Există facturi respinse de ANAF. Verificați modulul SPV.',
        });
      }

      if (unbilled.length > 0) {
        this.logger.warn({
          event:   'daily_report_unbilled_alert',
          count:   unbilled.length,
          message: 'Există consultații semnate cu servicii nefacturate.',
        });
      }
    } catch (err) {
      this.logger.error({ event: 'daily_report_error', error: (err as Error).message });
    }
  }
}
