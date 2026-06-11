import { Inject, Injectable, Logger } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import { DRIZZLE_DB, DrizzleDB } from '../../database/database.module';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * Three distinct margin types — never mix them in a single field:
 *
 * 1. theoreticalMargin  — (basePrice - directCostEstimate) / basePrice × 100
 *    Source: price_catalog.direct_cost_estimate (manually entered estimate).
 *    Reliability: low — only as good as the last manual update.
 *
 * 2. realizedMarginProcedure — (procedures.unit_price - avg(procedures.cost_direct))
 *                              / procedures.unit_price × 100
 *    Source: procedures.cost_direct recorded at time of service.
 *    Reliability: medium — reflects actual consumable cost per execution.
 *
 * 3. realizedMarginInvoice — (invoice_lines.unit_price - avg(invoice_lines.cost_snapshot))
 *                             / invoice_lines.unit_price × 100
 *    Source: cost_snapshot in invoice_lines.
 *    Reliability: medium — captured at billing time, may include rounding.
 *
 * Recommendation engine uses theoreticalMargin when available; falls back to
 * realizedMarginProcedure. If neither available → service cannot be evaluated.
 */

/** Static meta for frontend labels and tooltips — included in getServiceDetail response. */
export const MARGINS_META = {
  theoretical: {
    label:       'Marjă teoretică',
    source:      'price_catalog.direct_cost_estimate',
    sourceNote:  'Estimare manuală introdusă de admin în catalogul de prețuri. Se actualizează manual.',
    formula:     '(base_price − direct_cost_estimate) / base_price × 100',
    reliability: 'low' as const,
    reliabilityNote: 'Exactă doar dacă estimarea de cost a fost revizuită recent.',
  },
  realizedProc: {
    label:       'Marjă realizată — proceduri',
    source:      'procedures.cost_direct',
    sourceNote:  'Cost direct înregistrat la momentul prestării serviciului (consumabile folosite efectiv).',
    formula:     '(unit_price − cost_direct / quantity) / unit_price × 100  ·  medie 90 zile',
    reliability: 'medium' as const,
    reliabilityNote: 'Fiabilă dacă cost_direct este completat consistent la înregistrarea procedurii.',
  },
  realizedInv: {
    label:       'Marjă realizată — facturi',
    source:      'invoice_lines.cost_snapshot',
    sourceNote:  'Cost capturat automat la momentul emiterii facturii (cost_snapshot din linia de factură).',
    formula:     '(unit_price − cost_snapshot / quantity) / unit_price × 100  ·  medie 90 zile',
    reliability: 'medium' as const,
    reliabilityNote: 'Poate include rotunjiri. Reflectă costul de achiziție din stoc la data facturării.',
  },
} as const;

export type MarginsMeta = typeof MARGINS_META;

/** Evidence types for inventory → service linkage */
export type LinkEvidenceType = 'empirical_usage' | 'structural_bom';
export type LinkType         = 'co_occurrence'   | 'bom_item';

export interface TopConsumableItem {
  itemName:           string;
  inventoryItemId:    string | null;
  avgQtyPerUse:       number;
  avgCostPerUse:      number;
  consultationCount:  number;     // distinct consultations with this consumable + service
  coOccurrenceRate:   number;     // consultationCount / total procedures with this service (0-1)
  confidence:         'high' | 'medium' | 'low';  // ≥0.5 high, ≥0.25 medium, else low
  evidenceType:       LinkEvidenceType;  // always 'empirical_usage' until Phase 2 BOM
  linkType:           LinkType;          // always 'co_occurrence' until Phase 2
  phase2Note:         string;            // explicit note about BOM structural in Phase 2
}

export interface PricingMargins {
  // Theoretical margin from catalog direct_cost_estimate
  directCostEstimate:  number | null;   // RON — stored in price_catalog
  theoreticalMargin:   number | null;   // % — (base - estimate) / base × 100
  theoreticalOk:       boolean | null;  // true if >= min_margin_percent

  // Realized margin from procedures with cost_direct filled
  realizedCostAvgProc: number | null;   // RON — avg cost_direct / quantity
  realizedMarginProc:  number | null;   // % last 90 days
  realizedProcCount:   number;          // procedures with cost_direct > 0

  // Realized margin from invoice_lines.cost_snapshot
  realizedCostAvgInv:  number | null;   // RON
  realizedMarginInv:   number | null;   // % last 90 days
  realizedInvCount:    number;

  // Derived recommendation
  recommendedPrice:    number | null;   // RON at target margin
  priceDelta:          number | null;   // recommendedPrice - basePrice
  priceDeltaPercent:   number | null;   // priceDelta / basePrice × 100
}

export interface PricingServiceItem {
  serviceId:         string;
  code:              string;
  name:              string;
  serviceType:       string;
  categoryId:        string;
  categoryName:      string;
  basePrice:         number;
  vatRate:           number;
  priceWithVat:      number | null;
  minMarginPercent:  number;
  isActive:          boolean;

  margins:           PricingMargins;

  // Flagging
  isUnderpriced:     boolean;   // theoreticalMargin < minMarginPercent (when data exists)
  hasNoEstimate:     boolean;   // direct_cost_estimate IS NULL
  needsReview:       boolean;   // isUnderpriced OR realizedMarginProc significantly below theoretical

  // Usage stats (last 90 days)
  invoiceCount90d:   number;
  revenue90d:        number;
  estimatedImpact:   number | null;  // (recommendedPrice - basePrice) × invoiceCount90d
}

export interface PricingSummary {
  asOf:                  string;
  totalServices:         number;
  servicesWithEstimate:  number;
  underpricedCount:      number;
  noEstimateCount:       number;
  needsReviewCount:      number;

  totalRevenue90d:       number;
  estimatedImpactTotal:  number;   // sum of positive price deltas × invoice counts

  byCategory:  { categoryName: string; count: number; underpricedCount: number; avgMargin: number | null }[];
  byType:      { serviceType: string; count: number; underpricedCount: number; avgMargin: number | null }[];
  top10Impact: Pick<PricingServiceItem,
    'serviceId' | 'name' | 'code' | 'basePrice' | 'margins' | 'invoiceCount90d' | 'estimatedImpact'
  >[];
}

export interface PriceSimulation {
  serviceId:        string;
  name:             string;
  currentBasePrice: number;
  newBasePrice:     number;

  directCostEstimate: number | null;

  currentTheoreticalMargin: number | null;
  newTheoreticalMargin:     number | null;
  currentRealizedMargin:    number | null;
  newRealizedMargin:        number | null;

  breakEvenPrice:   number | null;  // directCostEstimate / (1 - minMarginPercent/100)
  minMarginPercent: number;

  invoiceCount90d:  number;
  revenueImpact90d: number;   // (newBasePrice - currentBasePrice) × invoiceCount90d

  isViable:         boolean;  // newTheoreticalMargin >= minMarginPercent
  warning:          string | null;
}

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

@Injectable()
export class PricingService {
  private readonly logger = new Logger(PricingService.name);

  constructor(@Inject(DRIZZLE_DB) private readonly db: DrizzleDB) {}

  // -------------------------------------------------------------------------
  // Summary
  // -------------------------------------------------------------------------

  async getSummary(): Promise<PricingSummary> {
    const all = await this._getAllPricingItems({});

    const byCategory: Record<string, { count: number; underpriced: number; margins: number[] }> = {};
    const byType:     Record<string, { count: number; underpriced: number; margins: number[] }> = {};

    let underpricedCount = 0;
    let noEstimateCount  = 0;
    let needsReviewCount = 0;
    let totalRevenue90d  = 0;
    let estimatedImpact  = 0;

    for (const s of all) {
      if (s.isUnderpriced)  underpricedCount++;
      if (s.hasNoEstimate)  noEstimateCount++;
      if (s.needsReview)    needsReviewCount++;
      totalRevenue90d += s.revenue90d;
      if (s.estimatedImpact && s.estimatedImpact > 0) estimatedImpact += s.estimatedImpact;

      const cat = s.categoryName ?? 'Necategorizat';
      byCategory[cat] = byCategory[cat] ?? { count: 0, underpriced: 0, margins: [] };
      byCategory[cat].count++;
      if (s.isUnderpriced) byCategory[cat].underpriced++;
      if (s.margins.theoreticalMargin != null) byCategory[cat].margins.push(s.margins.theoreticalMargin);

      byType[s.serviceType] = byType[s.serviceType] ?? { count: 0, underpriced: 0, margins: [] };
      byType[s.serviceType].count++;
      if (s.isUnderpriced) byType[s.serviceType].underpriced++;
      if (s.margins.theoreticalMargin != null) byType[s.serviceType].margins.push(s.margins.theoreticalMargin);
    }

    const avgOrNull = (arr: number[]) => arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : null;

    const top10 = all
      .filter(s => s.estimatedImpact != null && s.estimatedImpact > 0)
      .sort((a, b) => (b.estimatedImpact ?? 0) - (a.estimatedImpact ?? 0))
      .slice(0, 10)
      .map(({ serviceId, name, code, basePrice, margins, invoiceCount90d, estimatedImpact }) => ({
        serviceId, name, code, basePrice, margins, invoiceCount90d, estimatedImpact,
      }));

    return {
      asOf:                 new Date().toISOString(),
      totalServices:        all.length,
      servicesWithEstimate: all.filter(s => !s.hasNoEstimate).length,
      underpricedCount,
      noEstimateCount,
      needsReviewCount,
      totalRevenue90d:      Math.round(totalRevenue90d * 100) / 100,
      estimatedImpactTotal: Math.round(estimatedImpact  * 100) / 100,
      byCategory: Object.entries(byCategory)
        .map(([categoryName, v]) => ({
          categoryName,
          count:           v.count,
          underpricedCount: v.underpriced,
          avgMargin:       avgOrNull(v.margins),
        }))
        .sort((a, b) => b.underpricedCount - a.underpricedCount),
      byType: Object.entries(byType)
        .map(([serviceType, v]) => ({
          serviceType,
          count:            v.count,
          underpricedCount: v.underpriced,
          avgMargin:        avgOrNull(v.margins),
        }))
        .sort((a, b) => b.underpricedCount - a.underpricedCount),
      top10Impact: top10,
    };
  }

  // -------------------------------------------------------------------------
  // List underpriced services
  // -------------------------------------------------------------------------

  async getUnderpricedServices(params: {
    minMarginOverride?: number;
    category?:         string;
    serviceType?:      string;
    onlyUnderpriced?:  boolean;
    onlyNoEstimate?:   boolean;
    limit?:            number;
    offset?:           number;
  }): Promise<{ data: PricingServiceItem[]; total: number }> {
    const limit  = Math.min(params.limit  ?? 50, 500);
    const offset = params.offset ?? 0;

    let all = await this._getAllPricingItems({
      category:    params.category,
      serviceType: params.serviceType,
    });

    if (params.minMarginOverride != null) {
      all = all.map(s => {
        const th = s.margins.theoreticalMargin;
        return {
          ...s,
          isUnderpriced: th != null ? th < params.minMarginOverride! : false,
          needsReview:   th != null ? th < params.minMarginOverride! : s.needsReview,
        };
      });
    }

    if (params.onlyUnderpriced) all = all.filter(s => s.isUnderpriced);
    if (params.onlyNoEstimate)  all = all.filter(s => s.hasNoEstimate);

    all.sort((a, b) => {
      // Underpriced first, then by estimated impact desc
      if (a.isUnderpriced && !b.isUnderpriced) return -1;
      if (!a.isUnderpriced && b.isUnderpriced) return 1;
      return (b.estimatedImpact ?? 0) - (a.estimatedImpact ?? 0);
    });

    return { data: all.slice(offset, offset + limit), total: all.length };
  }

  // -------------------------------------------------------------------------
  // Service detail
  // -------------------------------------------------------------------------

  async getServiceDetail(serviceId: string): Promise<{
    service:        PricingServiceItem;
    marginsMeta:    MarginsMeta;
    priceHistory:   { period: string; avgPrice: number; count: number }[];
    costHistory:    { period: string; avgCostDirect: number | null; count: number }[];
    topConsumables: TopConsumableItem[];
  }> {
    const all = await this._getAllPricingItems({ serviceId });
    if (!all.length) {
      throw new Error(`Service ${serviceId} not found`);
    }
    const service = all[0];

    // Price history — monthly avg from invoice_lines last 12 months
    const priceHistRows = await this.db.execute(sql`
      SELECT
        TO_CHAR(DATE_TRUNC('month', i.issued_at), 'YYYY-MM') AS period,
        AVG(il.unit_price)::numeric(10,2)                    AS "avgPrice",
        COUNT(*)::int                                         AS count
      FROM invoice_lines il
      JOIN invoices i ON i.id = il.invoice_id
      JOIN procedures p ON p.id = il.source_id AND il.source_type = 'procedure'
      JOIN procedure_templates pt ON pt.id = p.procedure_template_id
      WHERE pt.service_id = ${serviceId}
        AND i.issued_at >= NOW() - INTERVAL '12 months'
      GROUP BY 1
      ORDER BY 1
    `);

    // Cost history from procedures.cost_direct monthly last 12 months
    const costHistRows = await this.db.execute(sql`
      SELECT
        TO_CHAR(DATE_TRUNC('month', p.performed_at), 'YYYY-MM') AS period,
        AVG(p.cost_direct / NULLIF(p.quantity, 0))::numeric(10,2) AS "avgCostDirect",
        COUNT(*) FILTER (WHERE p.cost_direct IS NOT NULL)::int     AS count
      FROM procedures p
      JOIN procedure_templates pt ON pt.id = p.procedure_template_id
      WHERE pt.service_id = ${serviceId}
        AND p.performed_at >= NOW() - INTERVAL '12 months'
        AND p.deleted_at IS NULL
      GROUP BY 1
      ORDER BY 1
    `);

    // Total distinct procedure executions in 90d for this service (denominator for coOccurrenceRate)
    const totalProcRows = await this.db.execute(sql`
      SELECT COUNT(DISTINCT p.consultation_id)::int AS total
      FROM procedures p
      JOIN procedure_templates pt ON pt.id = p.procedure_template_id
      WHERE pt.service_id = ${serviceId}
        AND p.performed_at >= NOW() - INTERVAL '90 days'
        AND p.deleted_at IS NULL
    `);
    const totalProcs = parseInt((totalProcRows.rows[0] as any)?.total ?? '0', 10) || 1;

    // Top consumables: empirical co-occurrence via treatment_lines.
    // evidenceType = 'empirical_usage' — no structural BOM yet (procedure_template_items in Phase 2).
    // Minimum confidence threshold: consultationCount >= 2.
    const consumableRows = await this.db.execute(sql`
      SELECT
        COALESCE(ii.name, tl.product_name)          AS "itemName",
        ii.id::TEXT                                  AS "inventoryItemId",
        AVG(tl.quantity_dispensed)::numeric(10,3)   AS "avgQtyPerUse",
        AVG(tl.unit_cost * tl.quantity_dispensed)::numeric(10,2) AS "avgCostPerUse",
        COUNT(DISTINCT p.consultation_id)::int       AS "consultationCount"
      FROM procedures p
      JOIN procedure_templates pt ON pt.id = p.procedure_template_id
      JOIN treatment_lines tl ON tl.consultation_id = p.consultation_id
        AND tl.deleted_at IS NULL
        AND tl.quantity_dispensed IS NOT NULL
      LEFT JOIN inventory_items ii ON ii.id = tl.inventory_item_id
      WHERE pt.service_id = ${serviceId}
        AND p.performed_at >= NOW() - INTERVAL '90 days'
        AND p.deleted_at IS NULL
      GROUP BY COALESCE(ii.name, tl.product_name), ii.id
      HAVING COUNT(DISTINCT p.consultation_id) >= 2
      ORDER BY AVG(tl.unit_cost * tl.quantity_dispensed) DESC NULLS LAST
      LIMIT 10
    `);

    const topConsumables: TopConsumableItem[] = (consumableRows.rows as any[]).map(r => {
      const cnt  = r.consultationCount as number;
      const rate = cnt / totalProcs;
      const confidence: TopConsumableItem['confidence'] =
        rate >= 0.5  ? 'high'   :
        rate >= 0.25 ? 'medium' :
        'low';
      return {
        itemName:          r.itemName,
        inventoryItemId:   r.inventoryItemId ?? null,
        avgQtyPerUse:      parseFloat(r.avgQtyPerUse  ?? '0'),
        avgCostPerUse:     parseFloat(r.avgCostPerUse ?? '0'),
        consultationCount: cnt,
        coOccurrenceRate:  Math.round(rate * 1000) / 1000,
        confidence,
        evidenceType:      'empirical_usage',
        linkType:          'co_occurrence',
        phase2Note:        'Legătura structurală BOM (procedure_template_items) va fi disponibilă în Phase 2. Până atunci, consumabilele sunt identificate prin co-ocurență în aceeași consultație.',
      };
    });

    return {
      service,
      marginsMeta:    MARGINS_META,
      priceHistory:   priceHistRows.rows as any[],
      costHistory:    costHistRows.rows  as any[],
      topConsumables,
    };
  }

  // -------------------------------------------------------------------------
  // Affected services by inventory item
  // -------------------------------------------------------------------------

  /**
   * Returns services likely affected by a cost change to the given inventory item.
   *
   * Path: inventory_item → treatment_lines → consultations → procedures →
   *       procedure_templates → price_catalog (service)
   *
   * Note: without procedure_template_items (Phase 2), this is an empirical link
   * based on co-occurrence in the same consultation — not a structural BOM relationship.
   * A service appears here if it was performed in at least one consultation where
   * this inventory item was dispensed in the last 90 days.
   */
  async getAffectedServicesByInventoryItem(inventoryItemId: string): Promise<{
    inventoryItem: { id: string; name: string; sku: string; averageCost: number | null };
    evidenceType:  LinkEvidenceType;
    linkType:      LinkType;
    phase2Note:    string;
    affectedServices: (PricingServiceItem & {
      coOccurrenceCount:          number;
      avgItemCostPerConsultation: number | null;
      confidence:                 'high' | 'medium' | 'low';
    })[];
    note: string;
  }> {
    // Fetch item info
    const itemRows = await this.db.execute(sql`
      SELECT id, name, sku, average_cost::float AS "averageCost"
      FROM inventory_items
      WHERE id = ${inventoryItemId}
    `);
    if (!itemRows.rows.length) throw new Error(`Inventory item ${inventoryItemId} not found`);
    const inventoryItem = itemRows.rows[0] as any;

    // Find service IDs co-occurring with this item
    const coRows = await this.db.execute(sql`
      SELECT
        pt.service_id                                                      AS "serviceId",
        COUNT(DISTINCT p.consultation_id)::int                            AS "coOccurrenceCount",
        AVG(tl.unit_cost * tl.quantity_dispensed)::numeric(10,2)         AS "avgItemCostPerConsultation"
      FROM treatment_lines tl
      JOIN procedures p ON p.consultation_id = tl.consultation_id
        AND p.deleted_at IS NULL
      JOIN procedure_templates pt ON pt.id = p.procedure_template_id
      WHERE tl.inventory_item_id = ${inventoryItemId}
        AND tl.deleted_at IS NULL
        AND tl.quantity_dispensed IS NOT NULL
        AND p.performed_at >= NOW() - INTERVAL '90 days'
      GROUP BY pt.service_id
      ORDER BY COUNT(DISTINCT p.consultation_id) DESC
      LIMIT 20
    `);

    const PHASE2_NOTE = 'Legătura structurală BOM (procedure_template_items) va fi disponibilă în Phase 2. Până atunci, serviciile sunt identificate prin co-ocurență în aceeași consultație — nu printr-un BOM explicit.';

    if (!coRows.rows.length) {
      return {
        inventoryItem,
        evidenceType: 'empirical_usage',
        linkType:     'co_occurrence',
        phase2Note:   PHASE2_NOTE,
        affectedServices: [],
        note: 'Nu s-au găsit servicii corelate cu acest produs în ultimele 90 de zile.',
      };
    }

    const serviceIds = (coRows.rows as any[]).map(r => r.serviceId);
    const coMap      = new Map((coRows.rows as any[]).map(r => [r.serviceId, r]));

    // Max co-occurrence count for relative confidence
    const maxCount   = Math.max(...(coRows.rows as any[]).map(r => r.coOccurrenceCount as number), 1);

    const services = await this._getAllPricingItems({ serviceIds });

    return {
      inventoryItem,
      evidenceType: 'empirical_usage',
      linkType:     'co_occurrence',
      phase2Note:   PHASE2_NOTE,
      affectedServices: services.map(s => {
        const cnt  = coMap.get(s.serviceId)?.coOccurrenceCount ?? 0;
        const rate = cnt / maxCount;
        const confidence: 'high' | 'medium' | 'low' =
          rate >= 0.5  ? 'high'   :
          rate >= 0.25 ? 'medium' :
          'low';
        return {
          ...s,
          coOccurrenceCount:           cnt,
          avgItemCostPerConsultation:  parseFloat(coMap.get(s.serviceId)?.avgItemCostPerConsultation ?? null),
          confidence,
        };
      }),
      note: 'Serviciile afișate au fost efectuate în consultații unde acest produs a fost dispensat în ultimele 90 de zile. Legătură empirică (co-ocurență), nu structurală.',
    };
  }

  // -------------------------------------------------------------------------
  // Price simulation — read-only, no DB write
  // -------------------------------------------------------------------------

  async simulatePriceChange(serviceId: string, newBasePrice: number): Promise<PriceSimulation> {
    const all = await this._getAllPricingItems({ serviceId });
    if (!all.length) throw new Error(`Service ${serviceId} not found`);
    const s = all[0];

    const dce             = s.margins.directCostEstimate;
    const minMargin       = s.minMarginPercent;
    const currentBase     = s.basePrice;
    const realizedCost    = s.margins.realizedCostAvgProc ?? s.margins.realizedCostAvgInv;

    const breakEven       = dce != null ? dce / (1 - minMargin / 100) : null;
    const newTheoMargin   = dce != null ? ((newBasePrice - dce) / newBasePrice) * 100 : null;
    const newRealMargin   = realizedCost != null
      ? ((newBasePrice - realizedCost) / newBasePrice) * 100
      : null;

    const revenueImpact90d = (newBasePrice - currentBase) * s.invoiceCount90d;

    let warning: string | null = null;
    if (newBasePrice < currentBase) {
      warning = `Preț nou (${newBasePrice} RON) sub prețul actual (${currentBase} RON) — verifică impactul venitului.`;
    }
    if (newTheoMargin != null && newTheoMargin < minMargin) {
      warning = (warning ? warning + ' ' : '') +
        `Marja teoretică nouă (${newTheoMargin.toFixed(1)}%) rămâne sub minimul de ${minMargin}%.`;
    }
    if (breakEven != null && newBasePrice < breakEven) {
      warning = (warning ? warning + ' ' : '') +
        `Prețul nou (${newBasePrice} RON) este sub prețul de break-even (${breakEven.toFixed(2)} RON) la marja minimă de ${minMargin}%.`;
    }

    return {
      serviceId,
      name:                     s.name,
      currentBasePrice:         currentBase,
      newBasePrice,
      directCostEstimate:       dce,
      currentTheoreticalMargin: s.margins.theoreticalMargin,
      newTheoreticalMargin:     newTheoMargin != null ? Math.round(newTheoMargin * 100) / 100 : null,
      currentRealizedMargin:    s.margins.realizedMarginProc ?? s.margins.realizedMarginInv,
      newRealizedMargin:        newRealMargin != null ? Math.round(newRealMargin * 100) / 100 : null,
      breakEvenPrice:           breakEven    != null ? Math.round(breakEven     * 100) / 100 : null,
      minMarginPercent:         minMargin,
      invoiceCount90d:          s.invoiceCount90d,
      revenueImpact90d:         Math.round(revenueImpact90d * 100) / 100,
      isViable:                 newTheoMargin != null ? newTheoMargin >= minMargin : true,
      warning,
    };
  }

  // -------------------------------------------------------------------------
  // Hook for AnomalyService — underpriced signal
  // -------------------------------------------------------------------------

  async getUnderpricedSignalForAnomalyEngine(): Promise<{
    underpricedCount:     number;
    noEstimateCount:      number;
    estimatedImpactTotal: number;
    criticalCount:        number;  // margin < 0 (selling below cost)
  }> {
    const summary = await this.getSummary();
    const all     = await this._getAllPricingItems({});
    const criticalCount = all.filter(s =>
      s.margins.theoreticalMargin != null && s.margins.theoreticalMargin < 0
    ).length;

    return {
      underpricedCount:     summary.underpricedCount,
      noEstimateCount:      summary.noEstimateCount,
      estimatedImpactTotal: summary.estimatedImpactTotal,
      criticalCount,
    };
  }

  // -------------------------------------------------------------------------
  // CSV export
  // -------------------------------------------------------------------------

  exportToCsv(items: PricingServiceItem[]): string {
    const header = [
      'Cod', 'Serviciu', 'Tip', 'Categorie',
      'Pret actual (RON)', 'Cost estimat (RON)',
      'Marja teoretica (%)', 'Marja minima (%)',
      'Marja realizata proc (%)', 'Marja realizata factura (%)',
      'Pret recomandat (RON)', 'Delta pret (RON)',
      'Nr. facturi 90z', 'Venit 90z (RON)', 'Impact estimat (RON)',
      'Subevat.', 'Fara estimare', 'Necesita revizuire',
    ].join(';');

    const rows = items.map(s => [
      s.code,
      s.name,
      s.serviceType,
      s.categoryName,
      s.basePrice,
      s.margins.directCostEstimate ?? '',
      s.margins.theoreticalMargin  != null ? s.margins.theoreticalMargin.toFixed(1) : '',
      s.minMarginPercent,
      s.margins.realizedMarginProc != null ? s.margins.realizedMarginProc.toFixed(1) : '',
      s.margins.realizedMarginInv  != null ? s.margins.realizedMarginInv.toFixed(1)  : '',
      s.margins.recommendedPrice   != null ? s.margins.recommendedPrice.toFixed(2)   : '',
      s.margins.priceDelta         != null ? s.margins.priceDelta.toFixed(2)         : '',
      s.invoiceCount90d,
      s.revenue90d.toFixed(2),
      s.estimatedImpact != null ? s.estimatedImpact.toFixed(2) : '',
      s.isUnderpriced  ? 'DA' : 'NU',
      s.hasNoEstimate  ? 'DA' : 'NU',
      s.needsReview    ? 'DA' : 'NU',
    ].join(';'));

    return [header, ...rows].join('\n');
  }

  // -------------------------------------------------------------------------
  // Core query — all pricing items with computed margins
  // -------------------------------------------------------------------------

  private async _getAllPricingItems(params: {
    category?:    string;
    serviceType?: string;
    serviceId?:   string;
    serviceIds?:  string[];
  }): Promise<PricingServiceItem[]> {
    const { category, serviceType, serviceId, serviceIds } = params;

    // Base data from price_catalog + categories
    const catalogRows = await this.db.execute(sql`
      SELECT
        pc.id          AS "serviceId",
        pc.code,
        pc.name,
        pc.service_type::text AS "serviceType",
        pc.category_id AS "categoryId",
        sc.name        AS "categoryName",
        pc.base_price::float            AS "basePrice",
        pc.vat_rate::float              AS "vatRate",
        pc.price_with_vat::float        AS "priceWithVat",
        pc.direct_cost_estimate::float  AS "directCostEstimate",
        pc.min_margin_percent::float    AS "minMarginPercent",
        pc.is_active                    AS "isActive"
      FROM price_catalog pc
      LEFT JOIN service_categories sc ON sc.id = pc.category_id
      WHERE pc.is_active = true
        ${category    ? sql`AND sc.name = ${category}`         : sql``}
        ${serviceType ? sql`AND pc.service_type::text = ${serviceType}` : sql``}
        ${serviceId   ? sql`AND pc.id = ${serviceId}`           : sql``}
        ${serviceIds && serviceIds.length
          ? sql`AND pc.id = ANY(${serviceIds}::uuid[])`
          : sql``}
      ORDER BY sc.name, pc.name
    `);

    if (!catalogRows.rows.length) return [];

    const ids = (catalogRows.rows as any[]).map(r => r.serviceId);

    // Realized cost and margin from procedures (last 90 days)
    const procMarginRows = await this.db.execute(sql`
      SELECT
        pt.service_id AS "serviceId",
        AVG(p.cost_direct / NULLIF(p.quantity, 0))::numeric(10,4) AS "avgCostDirect",
        AVG(
          CASE WHEN p.cost_direct IS NOT NULL AND p.unit_price > 0
               THEN (p.unit_price - p.cost_direct / NULLIF(p.quantity, 0)) / p.unit_price * 100
          END
        )::numeric(10,2) AS "avgMarginPct",
        COUNT(*) FILTER (WHERE p.cost_direct IS NOT NULL)::int AS "countWithCost"
      FROM procedures p
      JOIN procedure_templates pt ON pt.id = p.procedure_template_id
      WHERE pt.service_id = ANY(${ids}::uuid[])
        AND p.performed_at >= NOW() - INTERVAL '90 days'
        AND p.deleted_at IS NULL
      GROUP BY pt.service_id
    `);

    // Realized cost from invoice_lines.cost_snapshot (last 90 days)
    const invMarginRows = await this.db.execute(sql`
      SELECT
        pt.service_id AS "serviceId",
        AVG(il.cost_snapshot / NULLIF(il.quantity, 0))::numeric(10,4) AS "avgCostSnapshot",
        AVG(
          CASE WHEN il.cost_snapshot IS NOT NULL AND il.unit_price > 0
               THEN (il.unit_price - il.cost_snapshot / NULLIF(il.quantity, 0)) / il.unit_price * 100
          END
        )::numeric(10,2) AS "avgMarginPct",
        COUNT(*) FILTER (WHERE il.cost_snapshot IS NOT NULL)::int AS "countWithCost"
      FROM invoice_lines il
      JOIN invoices inv ON inv.id = il.invoice_id
      JOIN procedures p ON p.id = il.source_id AND il.source_type = 'procedure'
      JOIN procedure_templates pt ON pt.id = p.procedure_template_id
      WHERE pt.service_id = ANY(${ids}::uuid[])
        AND inv.issued_at >= NOW() - INTERVAL '90 days'
      GROUP BY pt.service_id
    `);

    // Invoice count + revenue last 90 days per service
    const usageRows = await this.db.execute(sql`
      SELECT
        pt.service_id AS "serviceId",
        COUNT(*)::int AS "invoiceCount90d",
        SUM(il.quantity * il.unit_price)::numeric(12,2) AS "revenue90d"
      FROM invoice_lines il
      JOIN invoices inv ON inv.id = il.invoice_id
      JOIN procedures p ON p.id = il.source_id AND il.source_type = 'procedure'
      JOIN procedure_templates pt ON pt.id = p.procedure_template_id
      WHERE pt.service_id = ANY(${ids}::uuid[])
        AND inv.issued_at >= NOW() - INTERVAL '90 days'
      GROUP BY pt.service_id
    `);

    // Build maps
    const procMap  = new Map((procMarginRows.rows as any[]).map(r => [r.serviceId, r]));
    const invMap   = new Map((invMarginRows.rows  as any[]).map(r => [r.serviceId, r]));
    const usageMap = new Map((usageRows.rows       as any[]).map(r => [r.serviceId, r]));

    return (catalogRows.rows as any[]).map(row => {
      const pm = procMap.get(row.serviceId);
      const im = invMap.get(row.serviceId);
      const um = usageMap.get(row.serviceId);

      const dce        = row.directCostEstimate != null ? parseFloat(row.directCostEstimate) : null;
      const basePrice  = parseFloat(row.basePrice);
      const minMargin  = parseFloat(row.minMarginPercent ?? '30');

      // Theoretical margin (from stored estimate)
      const theoMargin = dce != null && basePrice > 0
        ? ((basePrice - dce) / basePrice) * 100
        : null;

      // Recommended price at min_margin_percent target
      const recPrice = dce != null
        ? Math.ceil((dce / (1 - minMargin / 100)) * 100) / 100
        : null;
      const priceDelta = recPrice != null ? recPrice - basePrice : null;

      // Realized margins
      const realCostProc = pm?.avgCostDirect   != null ? parseFloat(pm.avgCostDirect) : null;
      const realMargProc = pm?.avgMarginPct    != null ? parseFloat(pm.avgMarginPct)  : null;
      const realCostInv  = im?.avgCostSnapshot != null ? parseFloat(im.avgCostSnapshot) : null;
      const realMargInv  = im?.avgMarginPct    != null ? parseFloat(im.avgMarginPct)    : null;

      const invoiceCount = um?.invoiceCount90d ?? 0;
      const revenue90d   = parseFloat(um?.revenue90d ?? '0');

      const estimatedImpact = priceDelta != null && priceDelta > 0
        ? Math.round(priceDelta * invoiceCount * 100) / 100
        : null;

      // Flags
      const isUnderpriced = theoMargin != null ? theoMargin < minMargin : false;
      const hasNoEstimate = dce == null;

      // needsReview: underpriced, OR no estimate with usage, OR realized margin significantly below theoretical
      const realizedBelowTheo = theoMargin != null && realMargProc != null
        && (theoMargin - realMargProc) > 10;
      const needsReview = isUnderpriced || (hasNoEstimate && invoiceCount > 0) || realizedBelowTheo;

      const margins: PricingMargins = {
        directCostEstimate:  dce,
        theoreticalMargin:   theoMargin  != null ? Math.round(theoMargin  * 100) / 100 : null,
        theoreticalOk:       theoMargin  != null ? theoMargin >= minMargin : null,
        realizedCostAvgProc: realCostProc != null ? Math.round(realCostProc * 100) / 100 : null,
        realizedMarginProc:  realMargProc != null ? Math.round(realMargProc * 100) / 100 : null,
        realizedProcCount:   pm?.countWithCost ?? 0,
        realizedCostAvgInv:  realCostInv != null ? Math.round(realCostInv * 100) / 100 : null,
        realizedMarginInv:   realMargInv != null ? Math.round(realMargInv * 100) / 100 : null,
        realizedInvCount:    im?.countWithCost ?? 0,
        recommendedPrice:    recPrice   != null ? Math.round(recPrice   * 100) / 100 : null,
        priceDelta:          priceDelta != null ? Math.round(priceDelta * 100) / 100 : null,
        priceDeltaPercent:   priceDelta != null && basePrice > 0
          ? Math.round((priceDelta / basePrice) * 10000) / 100
          : null,
      };

      return {
        serviceId:        row.serviceId,
        code:             row.code,
        name:             row.name,
        serviceType:      row.serviceType,
        categoryId:       row.categoryId,
        categoryName:     row.categoryName ?? 'Necategorizat',
        basePrice,
        vatRate:          parseFloat(row.vatRate),
        priceWithVat:     row.priceWithVat != null ? parseFloat(row.priceWithVat) : null,
        minMarginPercent: minMargin,
        isActive:         row.isActive,
        margins,
        isUnderpriced,
        hasNoEstimate,
        needsReview,
        invoiceCount90d:  invoiceCount,
        revenue90d,
        estimatedImpact,
      } as PricingServiceItem;
    });
  }
}
