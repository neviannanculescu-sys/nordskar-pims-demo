import { Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import { DRIZZLE_DB, DrizzleDB } from '../../database/database.module';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type DeadStockSeverity = 'info' | 'warning' | 'critical';

export type DeadStockRecommendation =
  | 'price_reduction'
  | 'return_to_supplier'
  | 'disposal'
  | 'verify_inventory'
  | 'bundle_promotion'
  | 'protocol_inclusion';

export interface DeadStockItem {
  inventoryItemId:     string;
  sku:                 string;
  name:                string;
  category:            string;
  manufacturer:        string | null;
  unitOfMeasure:       string;

  currentStock:        number;
  averageCost:         number | null;
  estimatedValueBlocked: number;

  daysSinceLastMovement: number;
  lastMovementType:    string | null;
  lastMovementAt:      Date | null;

  // Lot / expiry from latest stock_movement with expiry_date
  nearestExpiryDate:   string | null;
  lotNumber:           string | null;

  severity:            DeadStockSeverity;
  recommendations:     DeadStockRecommendation[];
  recommendationNote:  string;

  rangeKey:            number; // days threshold used in this query
}

export interface DeadStockSummary {
  asOf:                string;
  rangeKey:            number;
  totalSkuAffected:    number;
  totalValueBlocked:   number;
  totalStockValue:     number;
  percentBlocked:      number;

  by90days:   number;
  by180days:  number;
  by365days:  number;

  byCategory: { category: string; count: number; value: number }[];
  byManufacturer: { manufacturer: string; count: number; value: number }[];
  top10: Pick<DeadStockItem,
    'inventoryItemId' | 'sku' | 'name' | 'category' | 'manufacturer' |
    'estimatedValueBlocked' | 'daysSinceLastMovement' | 'severity' |
    'recommendations' | 'currentStock' | 'averageCost'
  >[];
}

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

@Injectable()
export class DeadStockService {
  private readonly logger = new Logger(DeadStockService.name);

  // Movement types that count as "consumption" — if none exist in the window,
  // the item is considered dead stock.
  private static readonly CONSUMPTION_TYPES = [
    'consultation_use',
    'hospitalization_use',
    'direct_sale',
    'expired_disposal',
  ] as const;

  constructor(@Inject(DRIZZLE_DB) private readonly db: DrizzleDB) {}

  // -------------------------------------------------------------------------
  // Public API
  // -------------------------------------------------------------------------

  async getDeadStock(params: {
    range?:        number;
    category?:     string;
    manufacturer?: string;
    severity?:     string;
    limit?:        number;
    offset?:       number;
  }): Promise<{ data: DeadStockItem[]; total: number }> {
    const range  = params.range  ?? 90;
    const limit  = Math.min(params.limit  ?? 50, 500);
    const offset = params.offset ?? 0;

    const rows = await this._queryDeadStock({ range, category: params.category, manufacturer: params.manufacturer });
    let items = rows.map(r => this._toDeadStockItem(r, range));

    if (params.severity) items = items.filter(i => i.severity === params.severity);

    const total = items.length;
    const paged = items.sort((a, b) => b.estimatedValueBlocked - a.estimatedValueBlocked)
                       .slice(offset, offset + limit);

    return { data: paged, total };
  }

  async getSummary(range = 90): Promise<DeadStockSummary> {
    const [deadRows, totalValueRow] = await Promise.all([
      this._queryDeadStock({ range }),
      this._getTotalStockValue(),
    ]);

    const items = deadRows.map(r => this._toDeadStockItem(r, range));
    items.sort((a, b) => b.estimatedValueBlocked - a.estimatedValueBlocked);

    const totalValueBlocked = items.reduce((s, i) => s + i.estimatedValueBlocked, 0);
    const totalStockValue   = totalValueRow;
    const percentBlocked    = totalStockValue > 0 ? (totalValueBlocked / totalStockValue) * 100 : 0;

    // Secondary breakdowns (all days >=90 / >=180 / >=365 regardless of range param)
    const allRows = range === 90 ? deadRows : await this._queryDeadStock({ range: 90 });
    const allItems = range === 90 ? items : allRows.map(r => this._toDeadStockItem(r, 90));

    const byCategory: Record<string, { count: number; value: number }> = {};
    const byMfr:      Record<string, { count: number; value: number }> = {};
    let by90 = 0, by180 = 0, by365 = 0;

    for (const it of allItems) {
      if (it.daysSinceLastMovement >= 90)  by90++;
      if (it.daysSinceLastMovement >= 180) by180++;
      if (it.daysSinceLastMovement >= 365) by365++;

      const cat = it.category ?? 'other';
      byCategory[cat] = byCategory[cat] ?? { count: 0, value: 0 };
      byCategory[cat].count++;
      byCategory[cat].value += it.estimatedValueBlocked;

      const mfr = it.manufacturer ?? '(necunoscut)';
      byMfr[mfr] = byMfr[mfr] ?? { count: 0, value: 0 };
      byMfr[mfr].count++;
      byMfr[mfr].value += it.estimatedValueBlocked;
    }

    return {
      asOf:              new Date().toISOString(),
      rangeKey:          range,
      totalSkuAffected:  items.length,
      totalValueBlocked: Math.round(totalValueBlocked * 100) / 100,
      totalStockValue:   Math.round(totalStockValue   * 100) / 100,
      percentBlocked:    Math.round(percentBlocked    * 100) / 100,
      by90days:  by90,
      by180days: by180,
      by365days: by365,
      byCategory: Object.entries(byCategory)
        .map(([category, v]) => ({ category, ...v, value: Math.round(v.value * 100) / 100 }))
        .sort((a, b) => b.value - a.value),
      byManufacturer: Object.entries(byMfr)
        .map(([manufacturer, v]) => ({ manufacturer, ...v, value: Math.round(v.value * 100) / 100 }))
        .sort((a, b) => b.value - a.value)
        .slice(0, 20),
      top10: items.slice(0, 10).map(({ inventoryItemId, sku, name, category, manufacturer,
        estimatedValueBlocked, daysSinceLastMovement, severity, recommendations, currentStock, averageCost }) => ({
        inventoryItemId, sku, name, category, manufacturer,
        estimatedValueBlocked, daysSinceLastMovement, severity, recommendations, currentStock, averageCost,
      })),
    };
  }

  async getDetail(inventoryItemId: string): Promise<{
    item:          DeadStockItem;
    lastMovements: any[];
    stockHistory:  any[];
  }> {
    // Base item — force range=90 to catch anything
    const rows = await this._queryDeadStock({ range: 90, inventoryItemId });
    if (!rows.length) {
      // Item exists but might be active; fetch anyway
      const fallback = await this._queryItemFallback(inventoryItemId);
      if (!fallback) throw new NotFoundException(`Inventory item ${inventoryItemId} not found`);
      const item = this._toDeadStockItem(fallback, 90);
      return { item, lastMovements: [], stockHistory: [] };
    }

    const item = this._toDeadStockItem(rows[0], 90);

    // Last 10 movements
    const movRows = await this.db.execute(sql`
      SELECT
        sm.id,
        sm.movement_type    AS "movementType",
        sm.quantity,
        sm.unit_cost        AS "unitCost",
        sm.lot_number       AS "lotNumber",
        sm.expiry_date      AS "expiryDate",
        sm.notes,
        sm.performed_at     AS "performedAt",
        sm.stock_before     AS "stockBefore",
        sm.stock_after      AS "stockAfter",
        u.first_name || ' ' || u.last_name AS "performedByName"
      FROM stock_movements sm
      LEFT JOIN users u ON u.id = sm.performed_by
      WHERE sm.inventory_item_id = ${inventoryItemId}
      ORDER BY sm.performed_at DESC
      LIMIT 10
    `);

    // Monthly consumption last 12 months
    const histRows = await this.db.execute(sql`
      SELECT
        TO_CHAR(DATE_TRUNC('month', performed_at), 'YYYY-MM') AS month,
        SUM(ABS(quantity)) FILTER (WHERE quantity < 0)::numeric(10,3) AS consumed,
        SUM(quantity)      FILTER (WHERE quantity > 0)::numeric(10,3) AS received
      FROM stock_movements
      WHERE inventory_item_id = ${inventoryItemId}
        AND performed_at >= NOW() - INTERVAL '12 months'
      GROUP BY 1
      ORDER BY 1
    `);

    return {
      item,
      lastMovements: movRows.rows as any[],
      stockHistory:  histRows.rows as any[],
    };
  }

  async run(): Promise<{ totalChecked: number; deadStockFound: number; totalValueBlocked: number }> {
    this.logger.log('DeadStockService: computing dead stock snapshot (90d threshold)');
    const rows = await this._queryDeadStock({ range: 90 });
    const items = rows.map(r => this._toDeadStockItem(r, 90));
    const totalValueBlocked = items.reduce((s, i) => s + i.estimatedValueBlocked, 0);

    // Count all active items with stock > 0
    const countRow = await this.db.execute(sql`
      SELECT COUNT(*)::int AS cnt
      FROM inventory_items
      WHERE deleted_at IS NULL AND is_active = true AND current_stock > 0
    `);

    const totalChecked = parseInt((countRow.rows[0] as any)?.cnt ?? '0', 10);
    this.logger.log(`DeadStockService: ${items.length} dead-stock items found, value=${totalValueBlocked.toFixed(2)} RON`);

    return {
      totalChecked,
      deadStockFound:    items.length,
      totalValueBlocked: Math.round(totalValueBlocked * 100) / 100,
    };
  }

  // -------------------------------------------------------------------------
  // Export CSV
  // -------------------------------------------------------------------------

  exportToCsv(items: DeadStockItem[]): string {
    const header = [
      'SKU', 'Produs', 'Categorie', 'Producator', 'UM',
      'Stoc curent', 'Cost mediu', 'Valoare blocata (RON)',
      'Ultima miscare', 'Zile fara miscare', 'Severitate', 'Recomandare',
    ].join(';');

    const rows = items.map(i => [
      i.sku,
      i.name,
      i.category,
      i.manufacturer ?? '',
      i.unitOfMeasure,
      i.currentStock,
      i.averageCost ?? '',
      i.estimatedValueBlocked.toFixed(2),
      i.lastMovementAt ? new Date(i.lastMovementAt).toISOString().slice(0, 10) : '',
      i.daysSinceLastMovement,
      i.severity,
      i.recommendationNote,
    ].join(';'));

    return [header, ...rows].join('\n');
  }

  // -------------------------------------------------------------------------
  // Hook: summary data for AnomalyService + daily/monthly report
  // -------------------------------------------------------------------------

  async getSummaryForAnomalyEngine(): Promise<{
    criticalValueBlocked: number;
    totalValueBlocked:    number;
    totalSkuAffected:     number;
    percentBlocked:       number;
  }> {
    const s = await this.getSummary(90);
    const criticalRows = (await this._queryDeadStock({ range: 365 })).map(r => this._toDeadStockItem(r, 365));
    const criticalValueBlocked = criticalRows.reduce((s, i) => s + i.estimatedValueBlocked, 0);
    return {
      criticalValueBlocked: Math.round(criticalValueBlocked * 100) / 100,
      totalValueBlocked:    s.totalValueBlocked,
      totalSkuAffected:     s.totalSkuAffected,
      percentBlocked:       s.percentBlocked,
    };
  }

  // -------------------------------------------------------------------------
  // Core query
  // -------------------------------------------------------------------------

  private async _queryDeadStock(params: {
    range:            number;
    category?:        string;
    manufacturer?:    string;
    inventoryItemId?: string;
  }): Promise<any[]> {
    const { range, category, manufacturer, inventoryItemId } = params;
    const consumptionTypes = DeadStockService.CONSUMPTION_TYPES;

    const rows = await this.db.execute(sql`
      WITH last_consumption AS (
        SELECT
          inventory_item_id,
          MAX(performed_at) AS last_at,
          (ARRAY_AGG(movement_type ORDER BY performed_at DESC))[1] AS last_type
        FROM stock_movements
        WHERE movement_type = ANY(ARRAY[${sql.raw(consumptionTypes.map(t => `'${t}'`).join(','))}]::text[])
        GROUP BY inventory_item_id
      ),
      last_any_movement AS (
        SELECT
          inventory_item_id,
          MAX(performed_at) AS last_at
        FROM stock_movements
        GROUP BY inventory_item_id
      ),
      expiry_info AS (
        SELECT DISTINCT ON (inventory_item_id)
          inventory_item_id,
          expiry_date,
          lot_number
        FROM stock_movements
        WHERE expiry_date IS NOT NULL
        ORDER BY inventory_item_id, expiry_date ASC
      )
      SELECT
        ii.id                    AS "inventoryItemId",
        ii.sku,
        ii.name,
        ii.category::text        AS category,
        ii.manufacturer,
        ii.unit_of_measure       AS "unitOfMeasure",
        ii.current_stock::float  AS "currentStock",
        ii.average_cost::float   AS "averageCost",
        lc.last_at               AS "lastConsumptionAt",
        lc.last_type             AS "lastMovementType",
        lam.last_at              AS "lastAnyMovementAt",
        ei.expiry_date           AS "nearestExpiryDate",
        ei.lot_number            AS "lotNumber",
        EXTRACT(EPOCH FROM (NOW() - COALESCE(lc.last_at, ii.created_at))) / 86400.0 AS "daysSinceLastConsumption",
        EXTRACT(EPOCH FROM (NOW() - COALESCE(lam.last_at, ii.created_at))) / 86400.0 AS "daysSinceAnyMovement"
      FROM inventory_items ii
      LEFT JOIN last_consumption lc  ON lc.inventory_item_id = ii.id
      LEFT JOIN last_any_movement lam ON lam.inventory_item_id = ii.id
      LEFT JOIN expiry_info ei       ON ei.inventory_item_id = ii.id
      WHERE ii.deleted_at IS NULL
        AND ii.is_active = true
        AND ii.current_stock > 0
        AND (lc.last_at IS NULL OR lc.last_at < NOW() - (${range} || ' days')::interval)
        ${category        ? sql`AND ii.category::text = ${category}`      : sql``}
        ${manufacturer    ? sql`AND ii.manufacturer   = ${manufacturer}`  : sql``}
        ${inventoryItemId ? sql`AND ii.id             = ${inventoryItemId}` : sql``}
      ORDER BY
        COALESCE(ii.current_stock::float * ii.average_cost::float, 0) DESC
    `);

    return rows.rows as any[];
  }

  private async _queryItemFallback(inventoryItemId: string): Promise<any | null> {
    const rows = await this.db.execute(sql`
      SELECT
        ii.id AS "inventoryItemId", ii.sku, ii.name, ii.category::text AS category,
        ii.manufacturer, ii.unit_of_measure AS "unitOfMeasure",
        ii.current_stock::float AS "currentStock", ii.average_cost::float AS "averageCost",
        NULL AS "lastConsumptionAt", NULL AS "lastMovementType", NULL AS "lastAnyMovementAt",
        NULL AS "nearestExpiryDate", NULL AS "lotNumber",
        EXTRACT(EPOCH FROM (NOW() - ii.created_at)) / 86400.0 AS "daysSinceLastConsumption",
        EXTRACT(EPOCH FROM (NOW() - ii.created_at)) / 86400.0 AS "daysSinceAnyMovement"
      FROM inventory_items ii
      WHERE ii.id = ${inventoryItemId}
    `);
    return rows.rows[0] ?? null;
  }

  private async _getTotalStockValue(): Promise<number> {
    const rows = await this.db.execute(sql`
      SELECT COALESCE(SUM(current_stock::float * average_cost::float), 0) AS total
      FROM inventory_items
      WHERE deleted_at IS NULL AND is_active = true AND current_stock > 0 AND average_cost IS NOT NULL
    `);
    return parseFloat((rows.rows[0] as any)?.total ?? '0');
  }

  // -------------------------------------------------------------------------
  // Business logic: severity + recommendation
  // -------------------------------------------------------------------------

  private _toDeadStockItem(r: any, rangeKey: number): DeadStockItem {
    const currentStock  = parseFloat(r.currentStock  ?? '0');
    const averageCost   = r.averageCost != null ? parseFloat(r.averageCost) : null;
    const valueBlocked  = averageCost != null ? Math.round(currentStock * averageCost * 100) / 100 : 0;
    const days          = Math.floor(parseFloat(r.daysSinceLastConsumption ?? r.daysSinceAnyMovement ?? '0'));
    const lastMovAt     = r.lastConsumptionAt ?? r.lastAnyMovementAt ?? null;

    const severity   = this._severity(days, valueBlocked);
    const { recs, note } = this._recommendations(days, valueBlocked, r.nearestExpiryDate, r.category);

    return {
      inventoryItemId:      r.inventoryItemId,
      sku:                  r.sku,
      name:                 r.name,
      category:             r.category ?? 'other',
      manufacturer:         r.manufacturer ?? null,
      unitOfMeasure:        r.unitOfMeasure ?? 'buc',
      currentStock,
      averageCost,
      estimatedValueBlocked: valueBlocked,
      daysSinceLastMovement: days,
      lastMovementType:     r.lastMovementType ?? null,
      lastMovementAt:       lastMovAt ? new Date(lastMovAt) : null,
      nearestExpiryDate:    r.nearestExpiryDate ?? null,
      lotNumber:            r.lotNumber ?? null,
      severity,
      recommendations:      recs,
      recommendationNote:   note,
      rangeKey,
    };
  }

  private _severity(days: number, value: number): DeadStockSeverity {
    if (days >= 365 || value >= 500) return 'critical';
    if (days >= 180 || value >= 200) return 'warning';
    return 'info';
  }

  private _recommendations(
    days: number,
    value: number,
    expiryDate: string | null,
    category: string,
  ): { recs: DeadStockRecommendation[]; note: string } {
    const recs: DeadStockRecommendation[] = [];

    // Check if expiry is near (within 90 days)
    const hasNearExpiry = expiryDate != null &&
      (new Date(expiryDate).getTime() - Date.now()) < 90 * 86400 * 1000;

    if (hasNearExpiry) {
      recs.push('verify_inventory');
      if (days >= 180) recs.push('disposal');
    }

    if (days >= 365) {
      recs.push('disposal');
      if (category !== 'equipment') recs.push('return_to_supplier');
    } else if (days >= 180) {
      recs.push('price_reduction');
      if (value >= 100) recs.push('return_to_supplier');
      recs.push('bundle_promotion');
    } else if (days >= 90) {
      recs.push('bundle_promotion');
      recs.push('protocol_inclusion');
    }

    if (!recs.length) recs.push('verify_inventory');

    // Deduplicate
    const unique = [...new Set(recs)];

    const labels: Record<DeadStockRecommendation, string> = {
      price_reduction:   'Reducere preț',
      return_to_supplier:'Retur furnizor',
      disposal:          'Casare',
      verify_inventory:  'Verificare inventar',
      bundle_promotion:  'Promovare în pachet',
      protocol_inclusion:'Includere în protocol',
    };

    const note = unique.map(r => labels[r]).join('; ');
    return { recs: unique, note };
  }
}
