import { Inject, Injectable, Logger } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import { DRIZZLE_DB, DrizzleDB } from '../../database/database.module';

// ---------------------------------------------------------------------------
// Helper
// ---------------------------------------------------------------------------

function parseNum(v: string | null | undefined): number {
  return parseFloat(v ?? '0') || 0;
}
function parseInt10(v: string | null | undefined): number {
  return parseInt(v ?? '0', 10) || 0;
}
function prevPeriod(from: string, to: string): { from: string; to: string } {
  const f = new Date(from);
  const t = new Date(to);
  const days = Math.round((t.getTime() - f.getTime()) / 86_400_000) + 1;
  const pf = new Date(f); pf.setDate(pf.getDate() - days);
  const pt = new Date(t); pt.setDate(pt.getDate() - days);
  return {
    from: pf.toISOString().slice(0, 10),
    to:   pt.toISOString().slice(0, 10),
  };
}

export interface KpiValue {
  value:    number;
  prev:     number | null;
  delta:    number | null;   // absolute
  deltaRel: number | null;   // percentage
  status:   'ok' | 'warning' | 'danger' | 'neutral';
}

export interface KpiDashboardResult {
  date:           string;
  revenue:        KpiValue;
  avgTicket:      KpiValue;
  timeToBill:     KpiValue;
  outstanding:    KpiValue;
  spvErrorRate:   KpiValue;
  occupancyRate:  KpiValue;
  noShowRate:     KpiValue;
  unbilledValue:  KpiValue;
  lowStockCount:  KpiValue;
}

export interface WeekOverWeekResult {
  weekStart:      string;
  prevWeekStart:  string;
  revenue:        KpiValue;
  invoiceCount:   KpiValue;
  consultations:  KpiValue;
  noShows:        KpiValue;
  avgTicket:      KpiValue;
  spvSubmissions: KpiValue;
  spvErrors:      KpiValue;
}

export interface FinancialKpiResult {
  from:             string;
  to:               string;
  revenue:          number;
  invoiceCount:     number;
  avgTicket:        number;
  outstanding:      number;
  collected:        number;
  collectionRate:   number;
  timeToBillAvgH:   number;
  topOutstanding:   { invoiceNumber: string; ownerName: string; outstanding: number; daysOverdue: number }[];
}

export interface OperationsKpiResult {
  from:            string;
  to:              string;
  appointments:    number;
  occupancyRate:   number;
  noShowRate:      number;
  noShowCount:     number;
  consultations:   number;
  unbilledCount:   number;
  unbilledValue:   number;
  suspectRows: { consultationDate: string; petName: string; ownerName: string; estimatedTotal: number; daysSince: number }[];
}

export interface InventoryKpiResult {
  from:          string;
  to:            string;
  lowStockCount: number;
  lowStockItems: { sku: string; name: string; current: number; min: number; unit: string }[];
  expiringCount: number;
  consumptionCost: number;
}

export interface SpvKpiResult {
  from:          string;
  to:            string;
  total:         number;
  accepted:      number;
  rejected:      number;
  errored:       number;
  pending:       number;
  errorRate:     number;
  problematic:   { invoiceNumber: string; status: string; submittedAt: string | null; errorMessage: string | null }[];
}

// ---------------------------------------------------------------------------
// KPI Service
// ---------------------------------------------------------------------------

@Injectable()
export class KpiService {
  private readonly logger = new Logger(KpiService.name);

  constructor(@Inject(DRIZZLE_DB) private readonly db: DrizzleDB) {}

  // -------------------------------------------------------------------------
  // GET /reports/kpi/dashboard?date=
  // -------------------------------------------------------------------------

  async getKpiDashboard(date?: string): Promise<KpiDashboardResult> {
    const today   = date ?? new Date().toISOString().slice(0, 10);
    const yest    = new Date(today); yest.setDate(yest.getDate() - 1);
    const yesterd = yest.toISOString().slice(0, 10);
    const wkFrom  = new Date(today); wkFrom.setDate(wkFrom.getDate() - 6);
    const wkFromS = wkFrom.toISOString().slice(0, 10);

    const [rev, prevRev, appt, unbilled, stock] = await Promise.all([
      // today revenue
      this.db.execute<{ total: string; invoice_count: string; avg_ticket: string }>(sql`
        SELECT
          COALESCE(SUM(total_amount), 0)::TEXT         AS total,
          COUNT(*)::TEXT                                AS invoice_count,
          COALESCE(AVG(total_amount), 0)::TEXT          AS avg_ticket
        FROM invoices
        WHERE deleted_at IS NULL
          AND status NOT IN ('draft','cancelled','storno')
          AND issued_at::DATE = ${today}
      `),
      // yesterday revenue
      this.db.execute<{ total: string; avg_ticket: string }>(sql`
        SELECT
          COALESCE(SUM(total_amount), 0)::TEXT AS total,
          COALESCE(AVG(total_amount), 0)::TEXT  AS avg_ticket
        FROM invoices
        WHERE deleted_at IS NULL
          AND status NOT IN ('draft','cancelled','storno')
          AND issued_at::DATE = ${yesterd}
      `),
      // appointments today: total, completed+no_show
      this.db.execute<{ total: string; no_show: string; occupied: string }>(sql`
        SELECT
          COUNT(*) FILTER (WHERE status != 'cancelled')::TEXT AS total,
          COUNT(*) FILTER (WHERE status = 'no_show')::TEXT    AS no_show,
          COUNT(*) FILTER (WHERE status IN ('confirmed','checked_in','in_progress','completed'))::TEXT AS occupied
        FROM appointments
        WHERE deleted_at IS NULL
          AND scheduled_at::DATE = ${today}
      `),
      // unbilled consultations (last 30 days)
      this.db.execute<{ unbilled_count: string; unbilled_value: string }>(sql`
        SELECT
          COUNT(c.id)::TEXT                   AS unbilled_count,
          COALESCE(SUM(
            COALESCE((SELECT SUM(pc2.price_with_vat) FROM procedures p2
              JOIN price_catalog pc2 ON pc2.id = p2.procedure_template_id
              WHERE p2.consultation_id = c.id AND p2.deleted_at IS NULL AND p2.is_billable = TRUE), 0) +
            COALESCE((SELECT SUM(tl2.quantity_dispensed * tl2.unit_cost * 1.09) FROM treatment_lines tl2
              WHERE tl2.consultation_id = c.id AND tl2.deleted_at IS NULL AND tl2.is_dispensed = TRUE AND tl2.is_billable = TRUE), 0)
          ), 0)::TEXT                          AS unbilled_value
        FROM consultations c
        WHERE c.deleted_at IS NULL
          AND c.signed_by IS NOT NULL
          AND c.billed = FALSE
          AND c.consultation_date::DATE >= ${wkFromS}
      `),
      // low stock
      this.db.execute<{ low_stock: string }>(sql`
        SELECT COUNT(*)::TEXT AS low_stock
        FROM inventory_items
        WHERE deleted_at IS NULL AND is_active = TRUE
          AND min_stock_level IS NOT NULL AND current_stock < min_stock_level
      `),
    ]);

    // time to bill (avg hours) — last 30 days issued invoices
    const ttbRows = await this.db.execute<{ avg_h: string }>(sql`
      SELECT COALESCE(AVG(
        EXTRACT(EPOCH FROM (i.issued_at - c.signed_at)) / 3600
      ), 0)::TEXT AS avg_h
      FROM invoices i
      JOIN invoice_lines il ON il.invoice_id = i.id AND il.source_type = 'procedure'
      JOIN procedures p     ON p.id = il.source_id
      JOIN consultations c  ON c.id = p.consultation_id
      WHERE i.deleted_at IS NULL
        AND i.status NOT IN ('draft','cancelled','storno')
        AND c.signed_at IS NOT NULL
        AND i.issued_at::DATE BETWEEN ${wkFromS} AND ${today}
    `);

    // outstanding
    const outRows = await this.db.execute<{ outstanding: string }>(sql`
      SELECT COALESCE(SUM(total_amount - paid_amount), 0)::TEXT AS outstanding
      FROM invoices
      WHERE deleted_at IS NULL AND status IN ('issued','partially_paid')
    `);

    // SPV error rate (last 30 days)
    const spvRows = await this.db.execute<{ total: string; errors: string }>(sql`
      SELECT
        COUNT(*)::TEXT AS total,
        COUNT(*) FILTER (WHERE status IN ('rejected','error'))::TEXT AS errors
      FROM spv_submissions
      WHERE created_at::DATE >= ${wkFromS}
    `);

    const r     = rev.rows[0];
    const pr    = prevRev.rows[0];
    const a     = appt.rows[0];
    const ub    = unbilled.rows[0];
    const stk   = stock.rows[0];
    const ttb   = ttbRows.rows[0];
    const out   = outRows.rows[0];
    const spv   = spvRows.rows[0];

    const totalRev    = parseNum(r?.total);
    const prevRevVal  = parseNum(pr?.total);
    const avgTicket   = parseNum(r?.avg_ticket);
    const prevAvg     = parseNum(pr?.avg_ticket);
    const ttbH        = parseNum(ttb?.avg_h);
    const outVal      = parseNum(out?.outstanding);
    const total       = parseInt10(a?.total);
    const occupied    = parseInt10(a?.occupied);
    const noShow      = parseInt10(a?.no_show);
    const occupancy   = total > 0 ? +(occupied / total * 100).toFixed(1) : 0;
    const noShowRate  = total > 0 ? +(noShow / total * 100).toFixed(1) : 0;
    const spvTotal    = parseInt10(spv?.total);
    const spvErrors   = parseInt10(spv?.errors);
    const spvErrRate  = spvTotal > 0 ? +(spvErrors / spvTotal * 100).toFixed(1) : 0;
    const unbilledCnt = parseInt10(ub?.unbilled_count);
    const unbilledVal = parseNum(ub?.unbilled_value);
    const lowStockCnt = parseInt10(stk?.low_stock);

    const mkKpi = (value: number, prev: number | null, higherIsBetter: boolean, warnThr: number, dangerThr: number): KpiValue => {
      const delta    = prev !== null ? +(value - prev).toFixed(2) : null;
      const deltaRel = prev !== null && prev !== 0 ? +(delta! / prev * 100).toFixed(1) : null;
      // status: for higher-is-better metrics, low is bad; for lower-is-better, high is bad
      let status: KpiValue['status'] = 'ok';
      if (higherIsBetter) {
        if (value <= dangerThr)      status = 'danger';
        else if (value <= warnThr)   status = 'warning';
      } else {
        if (value >= dangerThr)      status = 'danger';
        else if (value >= warnThr)   status = 'warning';
      }
      return { value, prev, delta, deltaRel, status };
    };

    return {
      date:          today,
      revenue:       mkKpi(totalRev,    prevRevVal,  true,  100,   0),
      avgTicket:     mkKpi(avgTicket,   prevAvg,     true,  50,    0),
      timeToBill:    mkKpi(ttbH,        null,        false, 24,    72),
      outstanding:   mkKpi(outVal,      null,        false, 5000,  20000),
      spvErrorRate:  mkKpi(spvErrRate,  null,        false, 10,    25),
      occupancyRate: mkKpi(occupancy,   null,        true,  60,    30),
      noShowRate:    mkKpi(noShowRate,  null,        false, 10,    20),
      unbilledValue: mkKpi(unbilledVal, null,        false, 500,   2000),
      lowStockCount: mkKpi(lowStockCnt, null,        false, 3,     10),
    };
  }

  // -------------------------------------------------------------------------
  // GET /reports/kpi/week-over-week?date=
  // -------------------------------------------------------------------------

  async getWeekOverWeek(date?: string): Promise<WeekOverWeekResult> {
    const today    = date ?? new Date().toISOString().slice(0, 10);
    const wStart   = new Date(today); wStart.setDate(wStart.getDate() - 6);
    const wStartS  = wStart.toISOString().slice(0, 10);
    const pwStart  = new Date(wStart); pwStart.setDate(pwStart.getDate() - 7);
    const pwEnd    = new Date(wStart);  pwEnd.setDate(pwEnd.getDate() - 1);
    const pwStartS = pwStart.toISOString().slice(0, 10);
    const pwEndS   = pwEnd.toISOString().slice(0, 10);

    const [curr, prev] = await Promise.all([
      this.db.execute<{
        revenue: string; invoice_count: string; consultations: string;
        no_shows: string; avg_ticket: string; spv_total: string; spv_errors: string;
      }>(sql`
        SELECT
          COALESCE((SELECT SUM(total_amount) FROM invoices WHERE deleted_at IS NULL
            AND status NOT IN ('draft','cancelled','storno')
            AND issued_at::DATE BETWEEN ${wStartS} AND ${today}), 0)::TEXT AS revenue,
          (SELECT COUNT(*) FROM invoices WHERE deleted_at IS NULL
            AND status NOT IN ('draft','cancelled','storno')
            AND issued_at::DATE BETWEEN ${wStartS} AND ${today})::TEXT     AS invoice_count,
          (SELECT COUNT(*) FROM consultations WHERE deleted_at IS NULL
            AND consultation_date::DATE BETWEEN ${wStartS} AND ${today})::TEXT AS consultations,
          (SELECT COUNT(*) FROM appointments WHERE deleted_at IS NULL
            AND status = 'no_show'
            AND scheduled_at::DATE BETWEEN ${wStartS} AND ${today})::TEXT  AS no_shows,
          COALESCE((SELECT AVG(total_amount) FROM invoices WHERE deleted_at IS NULL
            AND status NOT IN ('draft','cancelled','storno')
            AND issued_at::DATE BETWEEN ${wStartS} AND ${today}), 0)::TEXT AS avg_ticket,
          (SELECT COUNT(*) FROM spv_submissions
            WHERE created_at::DATE BETWEEN ${wStartS} AND ${today})::TEXT  AS spv_total,
          (SELECT COUNT(*) FROM spv_submissions
            WHERE status IN ('rejected','error')
            AND created_at::DATE BETWEEN ${wStartS} AND ${today})::TEXT    AS spv_errors
      `),
      this.db.execute<{
        revenue: string; invoice_count: string; consultations: string;
        no_shows: string; avg_ticket: string; spv_total: string; spv_errors: string;
      }>(sql`
        SELECT
          COALESCE((SELECT SUM(total_amount) FROM invoices WHERE deleted_at IS NULL
            AND status NOT IN ('draft','cancelled','storno')
            AND issued_at::DATE BETWEEN ${pwStartS} AND ${pwEndS}), 0)::TEXT AS revenue,
          (SELECT COUNT(*) FROM invoices WHERE deleted_at IS NULL
            AND status NOT IN ('draft','cancelled','storno')
            AND issued_at::DATE BETWEEN ${pwStartS} AND ${pwEndS})::TEXT     AS invoice_count,
          (SELECT COUNT(*) FROM consultations WHERE deleted_at IS NULL
            AND consultation_date::DATE BETWEEN ${pwStartS} AND ${pwEndS})::TEXT AS consultations,
          (SELECT COUNT(*) FROM appointments WHERE deleted_at IS NULL
            AND status = 'no_show'
            AND scheduled_at::DATE BETWEEN ${pwStartS} AND ${pwEndS})::TEXT  AS no_shows,
          COALESCE((SELECT AVG(total_amount) FROM invoices WHERE deleted_at IS NULL
            AND status NOT IN ('draft','cancelled','storno')
            AND issued_at::DATE BETWEEN ${pwStartS} AND ${pwEndS}), 0)::TEXT AS avg_ticket,
          (SELECT COUNT(*) FROM spv_submissions
            WHERE created_at::DATE BETWEEN ${pwStartS} AND ${pwEndS})::TEXT  AS spv_total,
          (SELECT COUNT(*) FROM spv_submissions
            WHERE status IN ('rejected','error')
            AND created_at::DATE BETWEEN ${pwStartS} AND ${pwEndS})::TEXT    AS spv_errors
      `),
    ]);

    const c = curr.rows[0];
    const p = prev.rows[0];

    const mk = (cVal: number, pVal: number): KpiValue => {
      const delta    = +(cVal - pVal).toFixed(2);
      const deltaRel = pVal !== 0 ? +(delta / pVal * 100).toFixed(1) : null;
      return { value: cVal, prev: pVal, delta, deltaRel, status: 'neutral' };
    };

    return {
      weekStart:      wStartS,
      prevWeekStart:  pwStartS,
      revenue:        mk(parseNum(c?.revenue),       parseNum(p?.revenue)),
      invoiceCount:   mk(parseInt10(c?.invoice_count), parseInt10(p?.invoice_count)),
      consultations:  mk(parseInt10(c?.consultations), parseInt10(p?.consultations)),
      noShows:        mk(parseInt10(c?.no_shows),      parseInt10(p?.no_shows)),
      avgTicket:      mk(parseNum(c?.avg_ticket),      parseNum(p?.avg_ticket)),
      spvSubmissions: mk(parseInt10(c?.spv_total),     parseInt10(p?.spv_total)),
      spvErrors:      mk(parseInt10(c?.spv_errors),    parseInt10(p?.spv_errors)),
    };
  }

  // -------------------------------------------------------------------------
  // GET /reports/kpi/financial?from&to
  // -------------------------------------------------------------------------

  async getKpiFinancial(from: string, to: string): Promise<FinancialKpiResult> {
    const [agg, ttb, topOut] = await Promise.all([
      this.db.execute<{
        revenue: string; invoice_count: string; avg_ticket: string;
        outstanding: string; collected: string;
      }>(sql`
        SELECT
          COALESCE(SUM(total_amount), 0)::TEXT        AS revenue,
          COUNT(*)::TEXT                               AS invoice_count,
          COALESCE(AVG(total_amount), 0)::TEXT         AS avg_ticket,
          COALESCE(SUM(total_amount - paid_amount), 0)::TEXT AS outstanding,
          COALESCE(SUM(paid_amount), 0)::TEXT          AS collected
        FROM invoices
        WHERE deleted_at IS NULL
          AND status NOT IN ('draft','cancelled','storno')
          AND issued_at::DATE BETWEEN ${from} AND ${to}
      `),
      this.db.execute<{ avg_h: string }>(sql`
        SELECT COALESCE(AVG(
          EXTRACT(EPOCH FROM (i.issued_at - c.signed_at)) / 3600
        ), 0)::TEXT AS avg_h
        FROM invoices i
        JOIN invoice_lines il ON il.invoice_id = i.id AND il.source_type = 'procedure'
        JOIN procedures p     ON p.id = il.source_id
        JOIN consultations c  ON c.id = p.consultation_id
        WHERE i.deleted_at IS NULL
          AND i.status NOT IN ('draft','cancelled','storno')
          AND c.signed_at IS NOT NULL
          AND i.issued_at::DATE BETWEEN ${from} AND ${to}
      `),
      this.db.execute<{
        invoice_number: string; owner_name: string; outstanding: string; days_overdue: string;
      }>(sql`
        SELECT
          invoice_number,
          COALESCE(billing_name, 'Necunoscut')                AS owner_name,
          (total_amount - paid_amount)::TEXT                  AS outstanding,
          GREATEST(0, EXTRACT(DAY FROM NOW() - due_date))::TEXT AS days_overdue
        FROM invoices
        WHERE deleted_at IS NULL
          AND status IN ('issued','partially_paid')
          AND issued_at::DATE BETWEEN ${from} AND ${to}
        ORDER BY (total_amount - paid_amount) DESC
        LIMIT 20
      `),
    ]);

    const a = agg.rows[0];
    const revenue   = parseNum(a?.revenue);
    const collected = parseNum(a?.collected);
    const colRate   = revenue > 0 ? +(collected / revenue * 100).toFixed(1) : 0;

    return {
      from, to,
      revenue,
      invoiceCount:   parseInt10(a?.invoice_count),
      avgTicket:      parseNum(a?.avg_ticket),
      outstanding:    parseNum(a?.outstanding),
      collected,
      collectionRate: colRate,
      timeToBillAvgH: parseNum(ttb.rows[0]?.avg_h),
      topOutstanding: topOut.rows.map((r) => ({
        invoiceNumber: r.invoice_number,
        ownerName:     r.owner_name,
        outstanding:   parseNum(r.outstanding),
        daysOverdue:   parseInt10(r.days_overdue),
      })),
    };
  }

  // -------------------------------------------------------------------------
  // GET /reports/kpi/operations?from&to
  // -------------------------------------------------------------------------

  async getKpiOperations(from: string, to: string): Promise<OperationsKpiResult> {
    const [appt, consult, unbilledRows] = await Promise.all([
      this.db.execute<{ total: string; occupied: string; no_show: string }>(sql`
        SELECT
          COUNT(*) FILTER (WHERE status != 'cancelled')::TEXT AS total,
          COUNT(*) FILTER (WHERE status IN ('confirmed','checked_in','in_progress','completed'))::TEXT AS occupied,
          COUNT(*) FILTER (WHERE status = 'no_show')::TEXT AS no_show
        FROM appointments
        WHERE deleted_at IS NULL
          AND scheduled_at::DATE BETWEEN ${from} AND ${to}
      `),
      this.db.execute<{ consultations: string }>(sql`
        SELECT COUNT(*)::TEXT AS consultations
        FROM consultations
        WHERE deleted_at IS NULL
          AND consultation_date::DATE BETWEEN ${from} AND ${to}
      `),
      this.db.execute<{
        consultation_id: string; consultation_date: string;
        pet_name: string; owner_name: string; estimated_total: string; days_since: string;
      }>(sql`
        SELECT
          c.id                                                           AS consultation_id,
          c.consultation_date::DATE::TEXT                                AS consultation_date,
          COALESCE(pt.name, 'Necunoscut')                                AS pet_name,
          COALESCE(o.first_name || ' ' || o.last_name, 'Necunoscut')    AS owner_name,
          COALESCE(
            (SELECT SUM(pc2.price_with_vat) FROM procedures p2
             JOIN price_catalog pc2 ON pc2.id = p2.procedure_template_id
             WHERE p2.consultation_id = c.id AND p2.deleted_at IS NULL AND p2.is_billable = TRUE)
          , 0) +
          COALESCE(
            (SELECT SUM(tl2.quantity_dispensed * tl2.unit_cost * 1.09) FROM treatment_lines tl2
             WHERE tl2.consultation_id = c.id AND tl2.deleted_at IS NULL
               AND tl2.is_dispensed = TRUE AND tl2.is_billable = TRUE)
          , 0)                                                            AS estimated_total,
          EXTRACT(DAY FROM NOW() - c.consultation_date)::TEXT            AS days_since
        FROM consultations c
        LEFT JOIN pets pt  ON pt.id = c.pet_id
        LEFT JOIN owners o ON o.id  = c.owner_id
        WHERE c.deleted_at IS NULL
          AND c.signed_by IS NOT NULL
          AND c.billed = FALSE
          AND c.consultation_date::DATE BETWEEN ${from} AND ${to}
          AND (
            EXISTS (SELECT 1 FROM procedures p3 WHERE p3.consultation_id = c.id
              AND p3.deleted_at IS NULL AND p3.is_billable = TRUE)
            OR
            EXISTS (SELECT 1 FROM treatment_lines tl3 WHERE tl3.consultation_id = c.id
              AND tl3.deleted_at IS NULL AND tl3.is_dispensed = TRUE AND tl3.is_billable = TRUE)
          )
        ORDER BY estimated_total DESC
        LIMIT 50
      `),
    ]);

    const a = appt.rows[0];
    const total    = parseInt10(a?.total);
    const occupied = parseInt10(a?.occupied);
    const noShow   = parseInt10(a?.no_show);
    const occRate  = total > 0 ? +(occupied / total * 100).toFixed(1) : 0;
    const nsRate   = total > 0 ? +(noShow / total * 100).toFixed(1) : 0;
    const ubTotal  = unbilledRows.rows.reduce((s, r) => s + parseNum(r.estimated_total), 0);

    return {
      from, to,
      appointments:  total,
      occupancyRate: occRate,
      noShowRate:    nsRate,
      noShowCount:   noShow,
      consultations: parseInt10(consult.rows[0]?.consultations),
      unbilledCount: unbilledRows.rows.length,
      unbilledValue: +ubTotal.toFixed(2),
      suspectRows:   unbilledRows.rows.map((r) => ({
        consultationDate: r.consultation_date,
        petName:          r.pet_name,
        ownerName:        r.owner_name,
        estimatedTotal:   parseNum(r.estimated_total),
        daysSince:        parseInt10(r.days_since),
      })),
    };
  }

  // -------------------------------------------------------------------------
  // GET /reports/kpi/inventory?from&to
  // -------------------------------------------------------------------------

  async getKpiInventory(from: string, to: string): Promise<InventoryKpiResult> {
    const [lowStock, expiring, consumption] = await Promise.all([
      this.db.execute<{ sku: string; name: string; current_stock: string; min_stock_level: string; unit_of_measure: string }>(sql`
        SELECT sku, name, current_stock::TEXT, min_stock_level::TEXT, unit_of_measure
        FROM inventory_items
        WHERE deleted_at IS NULL AND is_active = TRUE
          AND min_stock_level IS NOT NULL AND current_stock < min_stock_level
        ORDER BY (current_stock::NUMERIC / NULLIF(min_stock_level::NUMERIC, 0)) ASC
        LIMIT 50
      `),
      this.db.execute<{ expiring_count: string }>(sql`
        SELECT COUNT(DISTINCT sm.id)::TEXT AS expiring_count
        FROM stock_movements sm
        JOIN inventory_items ii ON ii.id = sm.inventory_item_id
        WHERE sm.expiry_date IS NOT NULL
          AND sm.expiry_date BETWEEN NOW() AND NOW() + INTERVAL '30 days'
          AND sm.movement_type = 'purchase_receipt'
          AND ii.deleted_at IS NULL
      `),
      this.db.execute<{ total_cost: string }>(sql`
        SELECT COALESCE(SUM(tl.quantity_dispensed * tl.unit_cost), 0)::TEXT AS total_cost
        FROM treatment_lines tl
        JOIN consultations c ON c.id = tl.consultation_id
        WHERE tl.deleted_at IS NULL
          AND tl.is_dispensed = TRUE
          AND c.consultation_date::DATE BETWEEN ${from} AND ${to}
      `),
    ]);

    return {
      from, to,
      lowStockCount:   lowStock.rows.length,
      lowStockItems:   lowStock.rows.map((r) => ({
        sku:     r.sku,
        name:    r.name,
        current: parseNum(r.current_stock),
        min:     parseNum(r.min_stock_level),
        unit:    r.unit_of_measure,
      })),
      expiringCount:   parseInt10(expiring.rows[0]?.expiring_count),
      consumptionCost: parseNum(consumption.rows[0]?.total_cost),
    };
  }

  // -------------------------------------------------------------------------
  // GET /reports/kpi/spv?from&to
  // -------------------------------------------------------------------------

  async getKpiSpv(from: string, to: string): Promise<SpvKpiResult> {
    const [agg, probs] = await Promise.all([
      this.db.execute<{ total: string; accepted: string; rejected: string; errored: string; pending: string }>(sql`
        SELECT
          COUNT(*)::TEXT                                                            AS total,
          COUNT(*) FILTER (WHERE status = 'accepted')::TEXT                        AS accepted,
          COUNT(*) FILTER (WHERE status = 'rejected')::TEXT                        AS rejected,
          COUNT(*) FILTER (WHERE status = 'error')::TEXT                           AS errored,
          COUNT(*) FILTER (WHERE status IN ('pending','uploading','uploaded','processing'))::TEXT AS pending
        FROM spv_submissions
        WHERE created_at::DATE BETWEEN ${from} AND ${to}
      `),
      this.db.execute<{
        invoice_number: string; status: string;
        submitted_at: string | null; error_message: string | null;
      }>(sql`
        SELECT
          COALESCE(ss.invoice_number, i.invoice_number) AS invoice_number,
          ss.status,
          ss.submitted_at::TEXT,
          ss.error_message
        FROM spv_submissions ss
        JOIN invoices i ON i.id = ss.invoice_id
        WHERE ss.status IN ('rejected','error')
          AND ss.created_at::DATE BETWEEN ${from} AND ${to}
        ORDER BY ss.created_at DESC
        LIMIT 50
      `),
    ]);

    const a     = agg.rows[0];
    const total = parseInt10(a?.total);
    const errs  = parseInt10(a?.rejected) + parseInt10(a?.errored);

    return {
      from, to,
      total,
      accepted:  parseInt10(a?.accepted),
      rejected:  parseInt10(a?.rejected),
      errored:   parseInt10(a?.errored),
      pending:   parseInt10(a?.pending),
      errorRate: total > 0 ? +(errs / total * 100).toFixed(1) : 0,
      problematic: probs.rows.map((r) => ({
        invoiceNumber: r.invoice_number,
        status:        r.status,
        submittedAt:   r.submitted_at ?? null,
        errorMessage:  r.error_message ?? null,
      })),
    };
  }
}
