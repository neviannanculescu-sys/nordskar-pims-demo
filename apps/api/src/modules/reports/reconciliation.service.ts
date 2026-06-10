import { Inject, Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { sql } from 'drizzle-orm';
import { DRIZZLE_DB, DrizzleDB } from '../../database/database.module';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type UnbilledType = 'consultation' | 'procedure' | 'treatment_line' | 'stock_movement';
export type Severity     = 'info' | 'warning' | 'critical';

export interface UnbilledItem {
  id:                string;   // deterministic: type + sourceEntityId
  type:              UnbilledType;
  sourceEntityId:    string;

  consultationId:    string | null;
  consultationDate:  string | null;

  petId:             string | null;
  petName:           string | null;
  ownerId:           string | null;
  ownerName:         string | null;
  veterinarianId:    string | null;
  veterinarianName:  string | null;

  description:       string;
  quantity:          number | null;
  unit:              string | null;

  estimatedValue:    number;   // with VAT
  severity:          Severity;
  daysSince:         number;
  detectedAt:        string;   // ISO timestamp of detection run

  notes:             string;
}

export interface UnbilledDetail extends UnbilledItem {
  existingInvoiceLines: {
    invoiceNumber:   string;
    description:     string;
    amount:          number;
    invoiceStatus:   string;
  }[];
  relatedItems: {
    type:         string;
    description:  string;
    estimatedValue: number;
  }[];
}

export interface ReconciliationSummary {
  asOf:              string;
  totalCases:        number;
  totalValue:        number;
  bySeverity:        { critical: number; warning: number; info: number };
  byType: {
    consultation:   { count: number; value: number };
    procedure:      { count: number; value: number };
    treatment_line: { count: number; value: number };
    stock_movement: { count: number; value: number };
  };
  top10: Pick<UnbilledItem, 'id' | 'type' | 'description' | 'estimatedValue' | 'severity' | 'ownerName' | 'petName' | 'consultationDate' | 'veterinarianName'>[];
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function parseNum(v: string | null | undefined): number {
  return parseFloat(v ?? '0') || 0;
}
function parseInt10(v: string | null | undefined): number {
  return parseInt(v ?? '0', 10) || 0;
}
function severity(value: number, daysSince: number): Severity {
  if (value > 100 || daysSince > 7)  return 'critical';
  if (value > 20  || daysSince > 3)  return 'warning';
  return 'info';
}

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

@Injectable()
export class ReconciliationService {
  private readonly logger = new Logger(ReconciliationService.name);

  constructor(@Inject(DRIZZLE_DB) private readonly db: DrizzleDB) {}

  // -------------------------------------------------------------------------
  // Core: run reconciliation and return all unbilled items for a period
  // -------------------------------------------------------------------------

  async getUnbilledItems(params: {
    from?:   string;
    to?:     string;
    type?:   UnbilledType;
    minSeverity?: Severity;
  }): Promise<UnbilledItem[]> {
    const now    = new Date();
    const today  = now.toISOString().slice(0, 10);
    const from   = params.from ?? new Date(now.getTime() - 30 * 86_400_000).toISOString().slice(0, 10);
    const to     = params.to   ?? today;
    const detectedAt = now.toISOString();

    const [consultations, procedures, treatmentLines, stockMovements] = await Promise.all([
      params.type && params.type !== 'consultation'    ? Promise.resolve([]) : this._unbilledConsultations(from, to, detectedAt),
      params.type && params.type !== 'procedure'       ? Promise.resolve([]) : this._unbilledProcedures(from, to, detectedAt),
      params.type && params.type !== 'treatment_line'  ? Promise.resolve([]) : this._unbilledTreatmentLines(from, to, detectedAt),
      params.type && params.type !== 'stock_movement'  ? Promise.resolve([]) : this._unbilledStockMovements(from, to, detectedAt),
    ]);

    const all = [...consultations, ...procedures, ...treatmentLines, ...stockMovements];

    if (params.minSeverity === 'critical') return all.filter(i => i.severity === 'critical');
    if (params.minSeverity === 'warning')  return all.filter(i => i.severity !== 'info');
    return all.sort((a, b) => b.estimatedValue - a.estimatedValue);
  }

  // -------------------------------------------------------------------------
  // Summary endpoint
  // -------------------------------------------------------------------------

  async getSummary(from?: string, to?: string): Promise<ReconciliationSummary> {
    const items = await this.getUnbilledItems({ from, to });
    const now   = new Date().toISOString();

    const byType = {
      consultation:   { count: 0, value: 0 },
      procedure:      { count: 0, value: 0 },
      treatment_line: { count: 0, value: 0 },
      stock_movement: { count: 0, value: 0 },
    };
    const bySev = { critical: 0, warning: 0, info: 0 };

    for (const item of items) {
      byType[item.type].count++;
      byType[item.type].value = +(byType[item.type].value + item.estimatedValue).toFixed(2);
      bySev[item.severity]++;
    }

    const totalValue = +items.reduce((s, i) => s + i.estimatedValue, 0).toFixed(2);

    const top10 = items
      .sort((a, b) => b.estimatedValue - a.estimatedValue)
      .slice(0, 10)
      .map(({ id, type, description, estimatedValue, severity, ownerName, petName, consultationDate, veterinarianName }) =>
        ({ id, type, description, estimatedValue, severity, ownerName, petName, consultationDate, veterinarianName }));

    return {
      asOf:       now,
      totalCases: items.length,
      totalValue,
      bySeverity: bySev,
      byType,
      top10,
    };
  }

  // -------------------------------------------------------------------------
  // Detail endpoint — single consultation
  // -------------------------------------------------------------------------

  async getDetail(consultationId: string): Promise<UnbilledDetail | null> {
    const now   = new Date();
    const from  = new Date(now.getTime() - 365 * 86_400_000).toISOString().slice(0, 10);
    const to    = now.toISOString().slice(0, 10);

    const all = await this.getUnbilledItems({ from, to });
    const base = all.find(i => i.consultationId === consultationId || i.sourceEntityId === consultationId);
    if (!base) return null;

    // All items from this consultation
    const related = all
      .filter(i => i.consultationId === consultationId && i.id !== base.id)
      .map(i => ({ type: i.type, description: i.description, estimatedValue: i.estimatedValue }));

    // Existing invoice lines for this consultation (via procedures or treatment_lines)
    const rows = await this.db.execute<{
      invoice_number: string;
      description:    string;
      line_total:     string;
      status:         string;
    }>(sql`
      SELECT DISTINCT
        i.invoice_number,
        il.description,
        il.line_total::TEXT,
        i.status
      FROM invoice_lines il
      JOIN invoices i ON i.id = il.invoice_id
      WHERE i.deleted_at IS NULL
        AND i.status NOT IN ('cancelled','storno')
        AND (
          (il.source_type = 'procedure' AND il.source_id IN (
            SELECT id FROM procedures WHERE consultation_id = ${consultationId} AND deleted_at IS NULL
          ))
          OR
          (il.source_type = 'treatment_line' AND il.source_id IN (
            SELECT id FROM treatment_lines WHERE consultation_id = ${consultationId} AND deleted_at IS NULL
          ))
        )
    `);

    return {
      ...base,
      existingInvoiceLines: rows.rows.map(r => ({
        invoiceNumber: r.invoice_number,
        description:   r.description,
        amount:        parseNum(r.line_total),
        invoiceStatus: r.status,
      })),
      relatedItems: related,
    };
  }

  // -------------------------------------------------------------------------
  // Case 1: Consultații completed (signed) fără factură și mai vechi de 2 ore
  // -------------------------------------------------------------------------

  private async _unbilledConsultations(from: string, to: string, detectedAt: string): Promise<UnbilledItem[]> {
    const rows = await this.db.execute<{
      consultation_id:    string;
      consultation_date:  string;
      pet_id:             string | null;
      pet_name:           string | null;
      owner_id:           string | null;
      owner_name:         string | null;
      vet_id:             string | null;
      vet_name:           string | null;
      estimated_value:    string;
      days_since:         string;
    }>(sql`
      SELECT
        c.id                                                         AS consultation_id,
        c.consultation_date::DATE::TEXT                              AS consultation_date,
        pt.id::TEXT                                                  AS pet_id,
        pt.name                                                      AS pet_name,
        o.id::TEXT                                                   AS owner_id,
        COALESCE(o.first_name || ' ' || o.last_name, 'Necunoscut')  AS owner_name,
        v.id::TEXT                                                   AS vet_id,
        COALESCE(u.first_name || ' ' || u.last_name, '–')           AS vet_name,
        COALESCE(
          (SELECT SUM(pc2.price_with_vat)
           FROM procedures p2 JOIN price_catalog pc2 ON pc2.id = p2.procedure_template_id
           WHERE p2.consultation_id = c.id AND p2.deleted_at IS NULL AND p2.is_billable = TRUE), 0
        ) +
        COALESCE(
          (SELECT SUM(tl2.quantity_dispensed * tl2.unit_cost * 1.09)
           FROM treatment_lines tl2
           WHERE tl2.consultation_id = c.id AND tl2.deleted_at IS NULL
             AND tl2.is_dispensed = TRUE AND tl2.is_billable = TRUE), 0
        )                                                             AS estimated_value,
        EXTRACT(DAY FROM NOW() - c.consultation_date)::TEXT          AS days_since
      FROM consultations c
      LEFT JOIN pets pt         ON pt.id = c.pet_id
      LEFT JOIN owners o        ON o.id  = c.owner_id
      LEFT JOIN veterinarians v ON v.id  = c.veterinarian_id
      LEFT JOIN users u         ON u.id  = v.user_id
      WHERE c.deleted_at IS NULL
        AND c.signed_by IS NOT NULL
        AND c.billed = FALSE
        AND c.signed_at < NOW() - INTERVAL '2 hours'
        AND c.consultation_date::DATE BETWEEN ${from} AND ${to}
      ORDER BY estimated_value DESC
    `);

    return rows.rows.map(r => {
      const val  = parseNum(r.estimated_value);
      const days = parseInt10(r.days_since);
      return {
        id:               `consultation:${r.consultation_id}`,
        type:             'consultation' as const,
        sourceEntityId:   r.consultation_id,
        consultationId:   r.consultation_id,
        consultationDate: r.consultation_date,
        petId:            r.pet_id,
        petName:          r.pet_name,
        ownerId:          r.owner_id,
        ownerName:        r.owner_name,
        veterinarianId:   r.vet_id,
        veterinarianName: r.vet_name,
        description:      'Consultație semnată fără factură',
        quantity:         null,
        unit:             null,
        estimatedValue:   +val.toFixed(2),
        severity:         severity(val, days),
        daysSince:        days,
        detectedAt,
        notes:            `Consultație semnată, nebilată de ${days} ${days === 1 ? 'zi' : 'zile'}. Valoare estimată: ${val.toFixed(2)} RON.`,
      };
    });
  }

  // -------------------------------------------------------------------------
  // Case 2: Procedures billable fără invoiceline asociată
  // -------------------------------------------------------------------------

  private async _unbilledProcedures(from: string, to: string, detectedAt: string): Promise<UnbilledItem[]> {
    const rows = await this.db.execute<{
      procedure_id:      string;
      consultation_id:   string;
      consultation_date: string;
      pet_id:            string | null;
      pet_name:          string | null;
      owner_id:          string | null;
      owner_name:        string | null;
      vet_id:            string | null;
      vet_name:          string | null;
      description:       string;
      quantity:          string;
      unit:              string | null;
      estimated_value:   string;
      days_since:        string;
    }>(sql`
      SELECT
        p.id                                                         AS procedure_id,
        c.id::TEXT                                                   AS consultation_id,
        c.consultation_date::DATE::TEXT                              AS consultation_date,
        pt.id::TEXT                                                  AS pet_id,
        pt.name                                                      AS pet_name,
        o.id::TEXT                                                   AS owner_id,
        COALESCE(o.first_name || ' ' || o.last_name, 'Necunoscut')  AS owner_name,
        COALESCE(vt.id::TEXT, '')                                    AS vet_id,
        COALESCE(u.first_name || ' ' || u.last_name, '–')           AS vet_name,
        p.name                                                       AS description,
        p.quantity::TEXT                                             AS quantity,
        p.unit,
        COALESCE(pc2.price_with_vat, p.total_price * 1.09, 0)::TEXT AS estimated_value,
        EXTRACT(DAY FROM NOW() - p.performed_at)::TEXT               AS days_since
      FROM procedures p
      JOIN consultations c  ON c.id = p.consultation_id
      LEFT JOIN pets pt     ON pt.id = c.pet_id
      LEFT JOIN owners o    ON o.id  = c.owner_id
      LEFT JOIN veterinarians vt ON vt.id = COALESCE(p.veterinarian_id, c.veterinarian_id)
      LEFT JOIN users u          ON u.id  = vt.user_id
      LEFT JOIN price_catalog pc2 ON pc2.id = p.procedure_template_id
      WHERE p.deleted_at  IS NULL
        AND c.deleted_at  IS NULL
        AND c.signed_by   IS NOT NULL
        AND p.is_billable = TRUE
        AND p.performed_at::DATE BETWEEN ${from} AND ${to}
        AND NOT EXISTS (
          SELECT 1 FROM invoice_lines il
          JOIN invoices i ON i.id = il.invoice_id
          WHERE il.source_type = 'procedure'
            AND il.source_id = p.id
            AND i.deleted_at IS NULL
            AND i.status NOT IN ('cancelled', 'storno')
        )
      ORDER BY COALESCE(pc2.price_with_vat, p.total_price * 1.09, 0) DESC
    `);

    return rows.rows.map(r => {
      const val  = parseNum(r.estimated_value);
      const days = parseInt10(r.days_since);
      return {
        id:               `procedure:${r.procedure_id}`,
        type:             'procedure' as const,
        sourceEntityId:   r.procedure_id,
        consultationId:   r.consultation_id,
        consultationDate: r.consultation_date,
        petId:            r.pet_id,
        petName:          r.pet_name,
        ownerId:          r.owner_id,
        ownerName:        r.owner_name,
        veterinarianId:   r.vet_id || null,
        veterinarianName: r.vet_name,
        description:      r.description,
        quantity:         parseNum(r.quantity),
        unit:             r.unit,
        estimatedValue:   +val.toFixed(2),
        severity:         severity(val, days),
        daysSince:        days,
        detectedAt,
        notes:            `Procedură facturabilă fără linie de factură asociată. Efectuată acum ${days} ${days === 1 ? 'zi' : 'zile'}.`,
      };
    });
  }

  // -------------------------------------------------------------------------
  // Case 3: Treatment lines dispensed + billable fără invoiceline
  // -------------------------------------------------------------------------

  private async _unbilledTreatmentLines(from: string, to: string, detectedAt: string): Promise<UnbilledItem[]> {
    const rows = await this.db.execute<{
      tl_id:             string;
      consultation_id:   string;
      consultation_date: string;
      pet_id:            string | null;
      pet_name:          string | null;
      owner_id:          string | null;
      owner_name:        string | null;
      vet_id:            string | null;
      vet_name:          string | null;
      product_name:      string;
      quantity:          string;
      unit:              string | null;
      estimated_value:   string;
      days_since:        string;
    }>(sql`
      SELECT
        tl.id                                                        AS tl_id,
        c.id::TEXT                                                   AS consultation_id,
        c.consultation_date::DATE::TEXT                              AS consultation_date,
        pt.id::TEXT                                                  AS pet_id,
        pt.name                                                      AS pet_name,
        o.id::TEXT                                                   AS owner_id,
        COALESCE(o.first_name || ' ' || o.last_name, 'Necunoscut')  AS owner_name,
        COALESCE(vt.id::TEXT, '')                                    AS vet_id,
        COALESCE(u.first_name || ' ' || u.last_name, '–')           AS vet_name,
        tl.product_name,
        tl.quantity_dispensed::TEXT                                  AS quantity,
        tl.quantity_unit                                             AS unit,
        (tl.quantity_dispensed * tl.unit_price * 1.09)::TEXT        AS estimated_value,
        EXTRACT(DAY FROM NOW() - COALESCE(tl.administered_at, tl.created_at))::TEXT AS days_since
      FROM treatment_lines tl
      JOIN consultations c   ON c.id = tl.consultation_id
      LEFT JOIN pets pt      ON pt.id = c.pet_id
      LEFT JOIN owners o     ON o.id  = c.owner_id
      LEFT JOIN veterinarians vt ON vt.id = COALESCE(tl.prescribed_by, c.veterinarian_id)
      LEFT JOIN users u          ON u.id  = vt.user_id
      WHERE tl.deleted_at    IS NULL
        AND c.deleted_at     IS NULL
        AND c.signed_by      IS NOT NULL
        AND tl.is_billable   = TRUE
        AND tl.is_dispensed  = TRUE
        AND COALESCE(tl.administered_at, tl.created_at)::DATE BETWEEN ${from} AND ${to}
        AND NOT EXISTS (
          SELECT 1 FROM invoice_lines il
          JOIN invoices i ON i.id = il.invoice_id
          WHERE il.source_type = 'treatment_line'
            AND il.source_id = tl.id
            AND i.deleted_at IS NULL
            AND i.status NOT IN ('cancelled', 'storno')
        )
      ORDER BY (tl.quantity_dispensed * tl.unit_price) DESC
    `);

    return rows.rows.map(r => {
      const val  = parseNum(r.estimated_value);
      const days = parseInt10(r.days_since);
      return {
        id:               `treatment_line:${r.tl_id}`,
        type:             'treatment_line' as const,
        sourceEntityId:   r.tl_id,
        consultationId:   r.consultation_id,
        consultationDate: r.consultation_date,
        petId:            r.pet_id,
        petName:          r.pet_name,
        ownerId:          r.owner_id,
        ownerName:        r.owner_name,
        veterinarianId:   r.vet_id || null,
        veterinarianName: r.vet_name,
        description:      r.product_name,
        quantity:         parseNum(r.quantity),
        unit:             r.unit,
        estimatedValue:   +val.toFixed(2),
        severity:         severity(val, days),
        daysSince:        days,
        detectedAt,
        notes:            `Medicament dispensat și facturabil fără linie de factură. ${parseNum(r.quantity).toFixed(2)} ${r.unit ?? ''} ${r.product_name} administrat acum ${days} ${days === 1 ? 'zi' : 'zile'}.`,
      };
    });
  }

  // -------------------------------------------------------------------------
  // Case 4: Stock movements consultation_use fără treatment_line acoperitor
  // -------------------------------------------------------------------------

  private async _unbilledStockMovements(from: string, to: string, detectedAt: string): Promise<UnbilledItem[]> {
    const rows = await this.db.execute<{
      sm_id:            string;
      inventory_name:   string;
      quantity:         string;
      unit:             string | null;
      unit_cost:        string | null;
      performed_at:     string;
      performed_by_name: string;
      days_since:       string;
    }>(sql`
      SELECT
        sm.id                                                          AS sm_id,
        ii.name                                                        AS inventory_name,
        ABS(sm.quantity)::TEXT                                         AS quantity,
        ii.unit_of_measure                                             AS unit,
        sm.unit_cost::TEXT                                             AS unit_cost,
        sm.performed_at::DATE::TEXT                                    AS performed_at,
        COALESCE(u.first_name || ' ' || u.last_name, '–')             AS performed_by_name,
        EXTRACT(DAY FROM NOW() - sm.performed_at)::TEXT               AS days_since
      FROM stock_movements sm
      JOIN inventory_items ii ON ii.id = sm.inventory_item_id
      JOIN users u            ON u.id  = sm.performed_by
      WHERE sm.movement_type = 'consultation_use'
        AND sm.performed_at::DATE BETWEEN ${from} AND ${to}
        AND (
          sm.reference_id IS NULL
          OR sm.reference_type IS DISTINCT FROM 'treatment_line'
          OR NOT EXISTS (
            SELECT 1 FROM treatment_lines tl
            WHERE tl.id = sm.reference_id
              AND tl.is_billable  = TRUE
              AND tl.is_dispensed = TRUE
              AND tl.deleted_at   IS NULL
          )
        )
      ORDER BY (ABS(sm.quantity) * COALESCE(sm.unit_cost, 0)) DESC
      LIMIT 100
    `);

    return rows.rows.map(r => {
      const qty    = parseNum(r.quantity);
      const cost   = parseNum(r.unit_cost);
      const val    = +(qty * cost * 1.09).toFixed(2);
      const days   = parseInt10(r.days_since);
      return {
        id:               `stock_movement:${r.sm_id}`,
        type:             'stock_movement' as const,
        sourceEntityId:   r.sm_id,
        consultationId:   null,
        consultationDate: r.performed_at,
        petId:            null,
        petName:          null,
        ownerId:          null,
        ownerName:        null,
        veterinarianId:   null,
        veterinarianName: r.performed_by_name,
        description:      `Consum stoc: ${r.inventory_name}`,
        quantity:         qty,
        unit:             r.unit,
        estimatedValue:   val,
        severity:         severity(val, days),
        daysSince:        days,
        detectedAt,
        notes:            `Mișcare stoc de tip consultation_use fără treatment_line facturabil asociat. Cantitate: ${qty} ${r.unit ?? ''}. Cost estimat cu TVA: ${val.toFixed(2)} RON.`,
      };
    });
  }

  // -------------------------------------------------------------------------
  // Cron: rulare zilnică la 20:00 — log summary
  // -------------------------------------------------------------------------

  @Cron('0 20 * * *', { name: 'reconciliation-daily', timeZone: 'Europe/Bucharest' })
  async runDailyReconciliation(): Promise<void> {
    const today = new Date().toISOString().slice(0, 10);
    const from  = new Date(Date.now() - 30 * 86_400_000).toISOString().slice(0, 10);

    this.logger.log({ event: 'reconciliation_start', date: today });
    try {
      const summary = await this.getSummary(from, today);
      this.logger.log({
        event:       'reconciliation_complete',
        date:        today,
        totalCases:  summary.totalCases,
        totalValue:  summary.totalValue,
        critical:    summary.bySeverity.critical,
        warning:     summary.bySeverity.warning,
      });
      if (summary.bySeverity.critical > 0) {
        this.logger.warn({
          event:   'reconciliation_critical_alert',
          count:   summary.bySeverity.critical,
          value:   summary.byType.consultation.value + summary.byType.procedure.value,
          message: `${summary.bySeverity.critical} cazuri critice de nefacturare detectate.`,
        });
      }
    } catch (err) {
      this.logger.error({ event: 'reconciliation_error', error: (err as Error).message });
    }
  }
}
