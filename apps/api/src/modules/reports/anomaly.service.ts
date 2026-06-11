import { Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { sql } from 'drizzle-orm';
import { DRIZZLE_DB, DrizzleDB } from '../../database/database.module';
import { ReconciliationService } from './reconciliation.service';
import { DeadStockService }      from './dead-stock.service';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type AnomalySeverity = 'info' | 'warning' | 'critical';
export type AnomalyStatus   = 'open' | 'ack' | 'resolved';
export type AnomalyModule   = 'financial' | 'operational' | 'inventory' | 'spv' | 'audit';

export interface AnomalyRecord {
  id:                string;
  fingerprint:       string;
  type:              string;
  title:             string;
  description:       string;
  sourceModule:      AnomalyModule;
  severity:          AnomalySeverity;
  metricValue:       number | null;
  baselineValue:     number | null;
  threshold:         number | null;
  relatedEntityType: string | null;
  relatedEntityId:   string | null;
  suggestedAction:   string | null;
  status:            AnomalyStatus;
  ackedAt:           Date | null;
  ackedBy:           string | null;
  resolvedAt:        Date | null;
  resolvedBy:        string | null;
  rangeKey:          string;
  detectedAt:        Date;
}

interface DetectedAnomaly {
  fingerprint:       string;
  type:              string;
  title:             string;
  description:       string;
  sourceModule:      AnomalyModule;
  severity:          AnomalySeverity;
  metricValue:       number | null;
  baselineValue:     number | null;
  threshold:         number | null;
  relatedEntityType: string | null;
  relatedEntityId:   string | null;
  suggestedAction:   string | null;
  rangeKey:          string;
}

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

@Injectable()
export class AnomalyService {
  private readonly logger = new Logger(AnomalyService.name);

  constructor(
    @Inject(DRIZZLE_DB) private readonly db: DrizzleDB,
    private readonly reconciliationService: ReconciliationService,
    private readonly deadStockService:      DeadStockService,
  ) {}

  // -------------------------------------------------------------------------
  // Public API
  // -------------------------------------------------------------------------

  async list(params: {
    status?: string;
    severity?: string;
    sourceModule?: string;
    limit?: number;
    offset?: number;
  }): Promise<{ data: AnomalyRecord[]; total: number }> {
    const limit  = Math.min(params.limit  ?? 50, 200);
    const offset = params.offset ?? 0;

    const rows = await this.db.execute(sql`
      SELECT
        id, fingerprint, type, title, description,
        source_module   AS "sourceModule",
        severity,
        metric_value    AS "metricValue",
        baseline_value  AS "baselineValue",
        threshold,
        related_entity_type AS "relatedEntityType",
        related_entity_id   AS "relatedEntityId",
        suggested_action    AS "suggestedAction",
        status,
        acked_at    AS "ackedAt",
        acked_by    AS "ackedBy",
        resolved_at AS "resolvedAt",
        resolved_by AS "resolvedBy",
        range_key   AS "rangeKey",
        detected_at AS "detectedAt"
      FROM anomalies
      WHERE 1=1
        ${params.status       ? sql`AND status        = ${params.status}`       : sql``}
        ${params.severity     ? sql`AND severity      = ${params.severity}`     : sql``}
        ${params.sourceModule ? sql`AND source_module = ${params.sourceModule}` : sql``}
      ORDER BY
        CASE severity WHEN 'critical' THEN 1 WHEN 'warning' THEN 2 ELSE 3 END,
        detected_at DESC
      LIMIT ${limit} OFFSET ${offset}
    `);

    const countRows = await this.db.execute(sql`
      SELECT COUNT(*)::int AS cnt
      FROM anomalies
      WHERE 1=1
        ${params.status       ? sql`AND status        = ${params.status}`       : sql``}
        ${params.severity     ? sql`AND severity      = ${params.severity}`     : sql``}
        ${params.sourceModule ? sql`AND source_module = ${params.sourceModule}` : sql``}
    `);

    return {
      data:  rows.rows as unknown as AnomalyRecord[],
      total: (countRows.rows[0] as any).cnt ?? 0,
    };
  }

  async getSummary(): Promise<{
    total: number;
    bySeverity: Record<AnomalySeverity, number>;
    byModule:   Record<AnomalyModule, number>;
    byStatus:   Record<AnomalyStatus, number>;
    criticalOpen: number;
  }> {
    const rows = await this.db.execute(sql`
      SELECT
        severity,
        source_module AS "sourceModule",
        status,
        COUNT(*)::int AS cnt
      FROM anomalies
      GROUP BY severity, source_module, status
    `);

    const bySeverity: any = { info: 0, warning: 0, critical: 0 };
    const byModule:   any = { financial: 0, operational: 0, inventory: 0, spv: 0, audit: 0 };
    const byStatus:   any = { open: 0, ack: 0, resolved: 0 };
    let total = 0;
    let criticalOpen = 0;

    for (const r of rows.rows as any[]) {
      const cnt = r.cnt;
      total += cnt;
      bySeverity[r.severity]     = (bySeverity[r.severity]     ?? 0) + cnt;
      byModule[r.sourceModule]   = (byModule[r.sourceModule]   ?? 0) + cnt;
      byStatus[r.status]         = (byStatus[r.status]         ?? 0) + cnt;
      if (r.severity === 'critical' && r.status !== 'resolved') criticalOpen += cnt;
    }

    return { total, bySeverity, byModule, byStatus, criticalOpen };
  }

  async getById(id: string): Promise<AnomalyRecord> {
    const rows = await this.db.execute(sql`
      SELECT
        id, fingerprint, type, title, description,
        source_module   AS "sourceModule",
        severity,
        metric_value    AS "metricValue",
        baseline_value  AS "baselineValue",
        threshold,
        related_entity_type AS "relatedEntityType",
        related_entity_id   AS "relatedEntityId",
        suggested_action    AS "suggestedAction",
        status,
        acked_at    AS "ackedAt",
        acked_by    AS "ackedBy",
        resolved_at AS "resolvedAt",
        resolved_by AS "resolvedBy",
        range_key   AS "rangeKey",
        detected_at AS "detectedAt"
      FROM anomalies
      WHERE id = ${id}
    `);

    if (!rows.rows.length) throw new NotFoundException(`Anomaly ${id} not found`);
    return rows.rows[0] as unknown as AnomalyRecord;
  }

  async ack(id: string, userId: string): Promise<AnomalyRecord> {
    await this.db.execute(sql`
      UPDATE anomalies
      SET status    = 'ack',
          acked_at  = NOW(),
          acked_by  = ${userId},
          updated_at = NOW()
      WHERE id = ${id}
        AND status = 'open'
    `);
    return this.getById(id);
  }

  async resolve(id: string, userId: string): Promise<AnomalyRecord> {
    await this.db.execute(sql`
      UPDATE anomalies
      SET status      = 'resolved',
          resolved_at = NOW(),
          resolved_by = ${userId},
          updated_at  = NOW()
      WHERE id = ${id}
        AND status IN ('open', 'ack')
    `);
    return this.getById(id);
  }

  async runDetection(): Promise<{ inserted: number; updated: number; total: number }> {
    this.logger.log('AnomalyService: starting detection run');
    const detected = await this._detectAll();
    const { inserted, updated } = await this._upsertAll(detected);
    this.logger.log(`AnomalyService: done — inserted=${inserted} updated=${updated}`);
    return { inserted, updated, total: detected.length };
  }

  // -------------------------------------------------------------------------
  // Scheduled run — daily at 20:30 (after reconciliation at 20:00)
  // -------------------------------------------------------------------------

  @Cron('30 20 * * *', { name: 'anomaly-detection-daily', timeZone: 'Europe/Bucharest' })
  async scheduledRun(): Promise<void> {
    try { await this.runDetection(); }
    catch (err) { this.logger.error('Scheduled anomaly detection failed', err); }
  }

  // -------------------------------------------------------------------------
  // Detection orchestrator
  // -------------------------------------------------------------------------

  private async _detectAll(): Promise<DetectedAnomaly[]> {
    const results = await Promise.allSettled([
      this._detectRevenueDrop(),
      this._detectTimeToBill(),
      this._detectSpvErrorRate(),
      this._detectNoShowSpike(),
      this._detectUnbilledServices(),
      this._detectStockRisk(),
      this._detectDeadStock(),
      this._detectAuditRisk(),
    ]);

    const all: DetectedAnomaly[] = [];
    for (const r of results) {
      if (r.status === 'fulfilled') all.push(...r.value);
      else this.logger.warn('Detector failed', r.reason);
    }
    return all;
  }

  // -------------------------------------------------------------------------
  // Detector 1 — RevenueDropAnomaly
  // -------------------------------------------------------------------------

  private async _detectRevenueDrop(): Promise<DetectedAnomaly[]> {
    const rows = await this.db.execute(sql`
      WITH daily AS (
        SELECT
          DATE(created_at AT TIME ZONE 'Europe/Bucharest') AS day,
          COALESCE(SUM(amount), 0) AS revenue
        FROM payments
        WHERE created_at >= NOW() - INTERVAL '31 days'
          AND status = 'confirmed'
        GROUP BY 1
      ),
      today_rev AS (
        SELECT COALESCE(SUM(amount), 0) AS rev
        FROM payments
        WHERE DATE(created_at AT TIME ZONE 'Europe/Bucharest') = CURRENT_DATE
          AND status = 'confirmed'
      ),
      baseline AS (
        SELECT COALESCE(AVG(revenue), 0) AS avg_rev
        FROM daily
        WHERE day < CURRENT_DATE AND day >= CURRENT_DATE - 30
      )
      SELECT
        t.rev   AS "todayRevenue",
        b.avg_rev AS "baselineRevenue"
      FROM today_rev t, baseline b
    `);

    if (!rows.rows.length) return [];
    const { todayRevenue, baselineRevenue } = rows.rows[0] as any;
    const today    = parseFloat(todayRevenue   ?? '0');
    const baseline = parseFloat(baselineRevenue ?? '0');

    if (baseline === 0) return [];

    const ratio = today / baseline;
    if (ratio >= 0.70) return [];

    const severity: AnomalySeverity = ratio < 0.50 ? 'critical' : 'warning';
    const pct = Math.round((1 - ratio) * 100);
    const today_str = new Date().toISOString().slice(0, 10);

    return [{
      fingerprint:       `revenue_drop:today:${today_str}:global`,
      type:              'revenue_drop',
      title:             `Venit zilnic scăzut cu ${pct}% față de medie`,
      description:       `Venitul de astăzi (${today.toFixed(2)} RON) reprezintă ${Math.round(ratio * 100)}% din media ultimelor 30 de zile (${baseline.toFixed(2)} RON). Scădere de ${pct}%.`,
      sourceModule:      'financial',
      severity,
      metricValue:       today,
      baselineValue:     baseline,
      threshold:         severity === 'critical' ? baseline * 0.50 : baseline * 0.70,
      relatedEntityType: null,
      relatedEntityId:   null,
      suggestedAction:   'Verifică programările anulate sau plățile înregistrate manual. Compară cu ziua echivalentă din săptămâna precedentă.',
      rangeKey:          'today',
    }];
  }

  // -------------------------------------------------------------------------
  // Detector 2 — TimeToBillAnomaly
  // -------------------------------------------------------------------------

  private async _detectTimeToBill(): Promise<DetectedAnomaly[]> {
    const rows = await this.db.execute(sql`
      WITH ttb AS (
        SELECT
          c.id         AS consultation_id,
          c.signed_at,
          i.issued_at,
          EXTRACT(EPOCH FROM (i.issued_at - c.signed_at)) / 3600.0 AS hours_to_bill
        FROM consultations c
        JOIN invoice_lines il ON il.consultation_id = c.id
        JOIN invoices i       ON i.id = il.invoice_id
        WHERE c.signed_at IS NOT NULL
          AND i.issued_at IS NOT NULL
          AND c.signed_at >= NOW() - INTERVAL '30 days'
      )
      SELECT
        AVG(hours_to_bill)::numeric(10,2) AS "avgHours",
        COUNT(*) FILTER (WHERE hours_to_bill > 24)::int AS "countOver24h"
      FROM ttb
    `);

    const result: DetectedAnomaly[] = [];
    if (!rows.rows.length) return result;

    const { avgHours, countOver24h } = rows.rows[0] as any;
    const avg    = parseFloat(avgHours   ?? '0');
    const over24 = parseInt(countOver24h ?? '0', 10);
    const today_str = new Date().toISOString().slice(0, 10);

    if (avg > 2) {
      const severity: AnomalySeverity = avg > 8 ? 'critical' : 'warning';
      result.push({
        fingerprint:       `time_to_bill_avg:30d:${today_str}:global`,
        type:              'time_to_bill_avg',
        title:             `Timp mediu facturare: ${avg.toFixed(1)}h (prag: 2h)`,
        description:       `Media timpului de la semnarea consultației până la emiterea facturii este ${avg.toFixed(1)} ore în ultimele 30 de zile. Pragul acceptat este 2 ore.`,
        sourceModule:      'operational',
        severity,
        metricValue:       avg,
        baselineValue:     null,
        threshold:         2,
        relatedEntityType: null,
        relatedEntityId:   null,
        suggestedAction:   'Verifică fluxul de facturare. Poate fi nevoie de reminder automat pentru recepție după semnarea consultației.',
        rangeKey:          '30d',
      });
    }

    if (over24 > 0) {
      result.push({
        fingerprint:       `time_to_bill_over24h:today:${today_str}:global`,
        type:              'time_to_bill_over24h',
        title:             `${over24} consultații nefacturate după 24h`,
        description:       `${over24} consultații semnate în ultimele 30 de zile au fost facturate după mai mult de 24 de ore de la semnare. Risc de pierdere venituri.`,
        sourceModule:      'operational',
        severity:          'critical',
        metricValue:       over24,
        baselineValue:     0,
        threshold:         0,
        relatedEntityType: 'consultation',
        relatedEntityId:   null,
        suggestedAction:   'Rulează reconcilierea G-15 pentru lista completă a consultațiilor nefacturate.',
        rangeKey:          '30d',
      });
    }

    return result;
  }

  // -------------------------------------------------------------------------
  // Detector 3 — SpvErrorRateAnomaly
  // -------------------------------------------------------------------------

  private async _detectSpvErrorRate(): Promise<DetectedAnomaly[]> {
    const rows = await this.db.execute(sql`
      SELECT
        COUNT(*) FILTER (WHERE status IN ('rejected','error'))::int AS "errCount",
        COUNT(*)::int AS "totalCount"
      FROM spv_submissions
      WHERE submitted_at >= NOW() - INTERVAL '30 days'
    `);

    if (!rows.rows.length) return [];
    const { errCount, totalCount } = rows.rows[0] as any;
    const errs  = parseInt(errCount   ?? '0', 10);
    const total = parseInt(totalCount ?? '0', 10);

    if (total === 0) return [];

    const rate = errs / total;
    if (rate < 0.05) return [];

    const severity: AnomalySeverity = rate >= 0.15 ? 'critical' : 'warning';
    const pct = Math.round(rate * 100);
    const today_str = new Date().toISOString().slice(0, 10);

    return [{
      fingerprint:       `spv_error_rate:30d:${today_str}:global`,
      type:              'spv_error_rate',
      title:             `Rată erori SPV: ${pct}% (${errs}/${total} trimiteri)`,
      description:       `${errs} din ${total} trimiteri SPV din ultimele 30 de zile s-au finalizat cu status rejected sau error (${pct}%). Praguri: warning >5%, critical >15%.`,
      sourceModule:      'spv',
      severity,
      metricValue:       rate * 100,
      baselineValue:     null,
      threshold:         severity === 'critical' ? 15 : 5,
      relatedEntityType: 'spv_submission',
      relatedEntityId:   null,
      suggestedAction:   'Verifică răspunsurile ANAF din secțiunea SPV. Erorile frecvente pot indica XML malformat sau CUI invalid.',
      rangeKey:          '30d',
    }];
  }

  // -------------------------------------------------------------------------
  // Detector 4 — NoShowSpikeAnomaly
  // -------------------------------------------------------------------------

  private async _detectNoShowSpike(): Promise<DetectedAnomaly[]> {
    const rows = await this.db.execute(sql`
      SELECT
        COUNT(*) FILTER (WHERE status = 'noshow')::int  AS "noshowCount",
        COUNT(*) FILTER (WHERE status NOT IN ('scheduled','cancelled'))::int AS "totalFinalized"
      FROM appointments
      WHERE scheduled_at >= NOW() - INTERVAL '7 days'
    `);

    if (!rows.rows.length) return [];
    const { noshowCount, totalFinalized } = rows.rows[0] as any;
    const noshow = parseInt(noshowCount    ?? '0', 10);
    const total  = parseInt(totalFinalized ?? '0', 10);

    if (total === 0 || noshow === 0) return [];

    const rate = noshow / total;
    if (rate < 0.15) return [];

    const pct = Math.round(rate * 100);
    const today_str = new Date().toISOString().slice(0, 10);

    return [{
      fingerprint:       `noshow_spike:7d:${today_str}:global`,
      type:              'noshow_spike',
      title:             `Rată no-show ridicată: ${pct}% în ultimele 7 zile`,
      description:       `${noshow} din ${total} programări finalizate în ultimele 7 zile au avut status no-show (${pct}%). Pragul de alertă este 15%.`,
      sourceModule:      'operational',
      severity:          'warning',
      metricValue:       rate * 100,
      baselineValue:     null,
      threshold:         15,
      relatedEntityType: 'appointment',
      relatedEntityId:   null,
      suggestedAction:   'Analizează distribuția no-show pe zile și veterinari. Consideră reminder SMS/email înainte de programare.',
      rangeKey:          '7d',
    }];
  }

  // -------------------------------------------------------------------------
  // Detector 5 — UnbilledServicesAnomaly (consumă reconciliation)
  // -------------------------------------------------------------------------

  private async _detectUnbilledServices(): Promise<DetectedAnomaly[]> {
    const fromDate = new Date();
    fromDate.setDate(fromDate.getDate() - 30);
    const from = fromDate.toISOString().slice(0, 10);
    const to   = new Date().toISOString().slice(0, 10);

    const summary = await this.reconciliationService.getSummary(from, to);
    const today_str = new Date().toISOString().slice(0, 10);
    const result: DetectedAnomaly[] = [];

    if (summary.totalCases === 0) return result;

    const criticalVal = summary.bySeverity?.critical ?? 0;
    const totalVal    = summary.totalCases;
    const totalAmt    = summary.totalValue ?? 0;

    const severity: AnomalySeverity =
      criticalVal > 0                   ? 'critical' :
      totalVal    > 5 || totalAmt > 100 ? 'warning'  :
      'info';

    result.push({
      fingerprint:       `unbilled_services:30d:${today_str}:global`,
      type:              'unbilled_services',
      title:             `${totalVal} servicii nefacturate (${totalAmt.toFixed(2)} RON)`,
      description:       `Reconcilierea G-15 a identificat ${totalVal} servicii prestate dar nefacturate în ultimele 30 de zile, cu valoare totală estimată ${totalAmt.toFixed(2)} RON. Critical: ${criticalVal}.`,
      sourceModule:      'financial',
      severity,
      metricValue:       totalAmt,
      baselineValue:     0,
      threshold:         100,
      relatedEntityType: null,
      relatedEntityId:   null,
      suggestedAction:   'Accesează pagina Reconciliere G-15 pentru lista detaliată și acțiunile recomandate per caz.',
      rangeKey:          '30d',
    });

    return result;
  }

  // -------------------------------------------------------------------------
  // Detector 6 — StockRiskAnomaly
  // -------------------------------------------------------------------------

  private async _detectStockRisk(): Promise<DetectedAnomaly[]> {
    const rows = await this.db.execute(sql`
      SELECT
        id,
        name,
        current_stock,
        minimum_stock,
        expiry_date,
        CASE
          WHEN expiry_date IS NOT NULL AND expiry_date <= CURRENT_DATE + 7  THEN 'expiry_7d'
          WHEN expiry_date IS NOT NULL AND expiry_date <= CURRENT_DATE + 30 THEN 'expiry_30d'
          WHEN minimum_stock IS NOT NULL AND current_stock <= minimum_stock  THEN 'below_min'
          ELSE 'ok'
        END AS risk_type
      FROM inventory_items
      WHERE deleted_at IS NULL
        AND (
          (minimum_stock IS NOT NULL AND current_stock <= minimum_stock)
          OR (expiry_date IS NOT NULL AND expiry_date <= CURRENT_DATE + 30)
        )
      ORDER BY
        CASE
          WHEN expiry_date IS NOT NULL AND expiry_date <= CURRENT_DATE + 7 THEN 1
          WHEN minimum_stock IS NOT NULL AND current_stock <= minimum_stock  THEN 2
          ELSE 3
        END
      LIMIT 50
    `);

    const result: DetectedAnomaly[] = [];
    const today_str = new Date().toISOString().slice(0, 10);

    for (const item of rows.rows as any[]) {
      const { id, name, current_stock, minimum_stock, expiry_date, risk_type } = item;

      if (risk_type === 'expiry_7d') {
        result.push({
          fingerprint:       `stock_expiry_7d:today:${today_str}:${id}`,
          type:              'stock_expiry_7d',
          title:             `${name} — expiră în ≤7 zile`,
          description:       `Produsul "${name}" expiră pe ${expiry_date ? new Date(expiry_date).toISOString().slice(0, 10) : '?'}. Stoc curent: ${current_stock}.`,
          sourceModule:      'inventory',
          severity:          'critical',
          metricValue:       current_stock,
          baselineValue:     null,
          threshold:         null,
          relatedEntityType: 'inventory_item',
          relatedEntityId:   id,
          suggestedAction:   'Verifică posibilitatea de returnare sau utilizare accelerată. Notifică veterinarii responsabili.',
          rangeKey:          'today',
        });
      } else if (risk_type === 'expiry_30d') {
        result.push({
          fingerprint:       `stock_expiry_30d:today:${today_str}:${id}`,
          type:              'stock_expiry_30d',
          title:             `${name} — expiră în ≤30 zile`,
          description:       `Produsul "${name}" expiră pe ${expiry_date ? new Date(expiry_date).toISOString().slice(0, 10) : '?'}. Stoc curent: ${current_stock}.`,
          sourceModule:      'inventory',
          severity:          'warning',
          metricValue:       current_stock,
          baselineValue:     null,
          threshold:         null,
          relatedEntityType: 'inventory_item',
          relatedEntityId:   id,
          suggestedAction:   'Planifică utilizarea stocului înainte de expirare. Verifică comenzile viitoare.',
          rangeKey:          'today',
        });
      } else if (risk_type === 'below_min') {
        result.push({
          fingerprint:       `stock_below_min:today:${today_str}:${id}`,
          type:              'stock_below_min',
          title:             `${name} — stoc sub minim (${current_stock}/${minimum_stock})`,
          description:       `Stocul produsului "${name}" (${current_stock}) este la sau sub nivelul minim configurtat (${minimum_stock}).`,
          sourceModule:      'inventory',
          severity:          'warning',
          metricValue:       current_stock,
          baselineValue:     minimum_stock,
          threshold:         minimum_stock,
          relatedEntityType: 'inventory_item',
          relatedEntityId:   id,
          suggestedAction:   'Inițiază comandă de reaprovizionare. Verifică consumul mediu zilnic.',
          rangeKey:          'today',
        });
      }
    }

    return result;
  }

  // -------------------------------------------------------------------------
  // Detector 7 — AuditRiskAnomaly
  // -------------------------------------------------------------------------

  private async _detectAuditRisk(): Promise<DetectedAnomaly[]> {
    const today_str = new Date().toISOString().slice(0, 10);
    const result: DetectedAnomaly[] = [];

    // 7a. Discounturi mari (>30%)
    const discountRows = await this.db.execute(sql`
      SELECT COUNT(*)::int AS cnt
      FROM invoice_lines
      WHERE discount_pct > 30
        AND created_at >= NOW() - INTERVAL '7 days'
    `);
    const discountCount = parseInt((discountRows.rows[0] as any)?.cnt ?? '0', 10);
    if (discountCount > 0) {
      result.push({
        fingerprint:       `audit_large_discounts:7d:${today_str}:global`,
        type:              'audit_large_discounts',
        title:             `${discountCount} linii factură cu discount >30% în ultimele 7 zile`,
        description:       `${discountCount} linii de factură au discount mai mare de 30% în ultimele 7 zile. Necesită verificare manuală.`,
        sourceModule:      'audit',
        severity:          discountCount > 5 ? 'critical' : 'warning',
        metricValue:       discountCount,
        baselineValue:     0,
        threshold:         1,
        relatedEntityType: 'invoice_line',
        relatedEntityId:   null,
        suggestedAction:   'Verifică autorizarea discounturilor. Discounturile >30% ar trebui să aibă aprobare manager.',
        rangeKey:          '7d',
      });
    }

    // 7b. Stornări multiple (credit notes)
    const creditRows = await this.db.execute(sql`
      SELECT COUNT(*)::int AS cnt
      FROM invoices
      WHERE type = 'credit_note'
        AND created_at >= NOW() - INTERVAL '7 days'
    `);
    const creditCount = parseInt((creditRows.rows[0] as any)?.cnt ?? '0', 10);
    if (creditCount >= 3) {
      result.push({
        fingerprint:       `audit_credit_notes:7d:${today_str}:global`,
        type:              'audit_credit_notes',
        title:             `${creditCount} note de credit emise în ultimele 7 zile`,
        description:       `${creditCount} note de credit (stornări) în ultimele 7 zile depășesc pragul normal. Verifică motivele stornărilor.`,
        sourceModule:      'audit',
        severity:          creditCount >= 5 ? 'critical' : 'warning',
        metricValue:       creditCount,
        baselineValue:     null,
        threshold:         3,
        relatedEntityType: 'invoice',
        relatedEntityId:   null,
        suggestedAction:   'Analizează motivele stornărilor. Verifică dacă există pattern pe același utilizator sau client.',
        rangeKey:          '7d',
      });
    }

    // 7c. Activitate în afara orelor normale (înainte de 07:00 sau după 22:00)
    const offHoursRows = await this.db.execute(sql`
      SELECT COUNT(*)::int AS cnt
      FROM audit_logs
      WHERE created_at >= NOW() - INTERVAL '7 days'
        AND (
          EXTRACT(HOUR FROM created_at AT TIME ZONE 'Europe/Bucharest') < 7
          OR EXTRACT(HOUR FROM created_at AT TIME ZONE 'Europe/Bucharest') >= 22
        )
        AND action IN ('invoice.issued', 'payment.confirmed', 'invoice_line.created', 'price_catalog.updated')
    `);
    const offHours = parseInt((offHoursRows.rows[0] as any)?.cnt ?? '0', 10);
    if (offHours > 0) {
      result.push({
        fingerprint:       `audit_off_hours:7d:${today_str}:global`,
        type:              'audit_off_hours_activity',
        title:             `${offHours} acțiuni sensibile în afara orelor normale (7-22)`,
        description:       `${offHours} operațiuni financiare (facturare, plăți, modificări catalog) au fost efectuate în afara orelor normale de lucru (07:00–22:00) în ultimele 7 zile.`,
        sourceModule:      'audit',
        severity:          'warning',
        metricValue:       offHours,
        baselineValue:     0,
        threshold:         0,
        relatedEntityType: null,
        relatedEntityId:   null,
        suggestedAction:   'Verifică jurnalul de audit pentru activitate neobișnuită. Confirmă că utilizatorii activi sunt autorizați.',
        rangeKey:          '7d',
      });
    }

    return result;
  }

  // -------------------------------------------------------------------------
  // Detector 8 — DeadStockAnomaly (consumă DeadStockService)
  // -------------------------------------------------------------------------

  private async _detectDeadStock(): Promise<DetectedAnomaly[]> {
    const ds = await this.deadStockService.getSummaryForAnomalyEngine();
    const today_str = new Date().toISOString().slice(0, 10);
    const result: DetectedAnomaly[] = [];

    if (ds.totalSkuAffected === 0) return result;

    const severity: AnomalySeverity =
      ds.criticalValueBlocked > 500 || ds.percentBlocked > 20 ? 'critical' :
      ds.totalValueBlocked    > 200 || ds.percentBlocked > 10 ? 'warning'  :
      'info';

    result.push({
      fingerprint:       `dead_stock:30d:${today_str}:global`,
      type:              'dead_stock',
      title:             `Stoc mort: ${ds.totalSkuAffected} SKU, ${ds.totalValueBlocked.toFixed(2)} RON blocați`,
      description:       `${ds.totalSkuAffected} produse active fără mișcare în ultimele 90 de zile, cu valoare totală blocată de ${ds.totalValueBlocked.toFixed(2)} RON (${ds.percentBlocked.toFixed(1)}% din stocul total). Valoare critică (365+ zile): ${ds.criticalValueBlocked.toFixed(2)} RON.`,
      sourceModule:      'inventory',
      severity,
      metricValue:       ds.totalValueBlocked,
      baselineValue:     0,
      threshold:         200,
      relatedEntityType: null,
      relatedEntityId:   null,
      suggestedAction:   'Accesează raportul G-13 Stoc Mort pentru lista completă și recomandările per produs (reducere preț, retur furnizor, casare).',
      rangeKey:          '30d',
    });

    return result;
  }

  // -------------------------------------------------------------------------
  // DB upsert
  // -------------------------------------------------------------------------

  private async _upsertAll(detected: DetectedAnomaly[]): Promise<{ inserted: number; updated: number }> {
    let inserted = 0;
    let updated  = 0;

    for (const a of detected) {
      const existing = await this.db.execute(sql`
        SELECT id, status FROM anomalies WHERE fingerprint = ${a.fingerprint}
      `);

      if (!existing.rows.length) {
        await this.db.execute(sql`
          INSERT INTO anomalies (
            fingerprint, type, title, description, source_module, severity,
            metric_value, baseline_value, threshold,
            related_entity_type, related_entity_id,
            suggested_action, status, range_key, detected_at, updated_at
          ) VALUES (
            ${a.fingerprint}, ${a.type}, ${a.title}, ${a.description},
            ${a.sourceModule}, ${a.severity},
            ${a.metricValue ?? null}, ${a.baselineValue ?? null}, ${a.threshold ?? null},
            ${a.relatedEntityType ?? null}, ${a.relatedEntityId ?? null},
            ${a.suggestedAction ?? null}, 'open', ${a.rangeKey}, NOW(), NOW()
          )
        `);
        inserted++;
      } else {
        const row = existing.rows[0] as any;
        // Preserve ack/resolved status; only update metric values when still open
        if (row.status === 'open') {
          await this.db.execute(sql`
            UPDATE anomalies
            SET title          = ${a.title},
                description    = ${a.description},
                severity       = ${a.severity},
                metric_value   = ${a.metricValue ?? null},
                baseline_value = ${a.baselineValue ?? null},
                threshold      = ${a.threshold ?? null},
                detected_at    = NOW(),
                updated_at     = NOW()
            WHERE fingerprint = ${a.fingerprint}
              AND status = 'open'
          `);
          updated++;
        }
        // If ack'd or resolved — keep as-is, do not reset
      }
    }

    return { inserted, updated };
  }
}
