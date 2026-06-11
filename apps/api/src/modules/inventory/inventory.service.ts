import {
  Inject, Injectable, NotFoundException,
  ConflictException, BadRequestException, Logger,
} from '@nestjs/common';
import { eq, and, isNull, count, SQL, sql } from 'drizzle-orm';
import { DRIZZLE_DB, DrizzleDB }            from '../../database/database.module';
import { inventoryItemsTable, stockMovementsTable } from '../../database/schema';
import { withAuditContext, AuditContext }    from '../../common/helpers/audit.helper';
import { paginate }                          from '../../common/types/api-response.types';
import { CreateInventoryItemDto }            from './dto/create-inventory-item.dto';
import { CreateStockMovementDto }            from './dto/create-stock-movement.dto';
import { PartialType } from '@nestjs/mapped-types';

class UpdateInventoryItemDto extends PartialType(CreateInventoryItemDto) {}

@Injectable()
export class InventoryService {
  private readonly logger = new Logger(InventoryService.name);

  constructor(@Inject(DRIZZLE_DB) private readonly db: DrizzleDB) {}

  // ---------------------------------------------------------------------------
  // Inventory items
  // ---------------------------------------------------------------------------

  async findAllItems(params: {
    search?: string;
    category?: string;
    isActive?: boolean;
    lowStock?: boolean;
    page?: number;
    limit?: number;
  }) {
    const page  = params.page  ?? 1;
    const limit = params.limit ?? 50;

    const conditions: SQL[] = [isNull(inventoryItemsTable.deletedAt)];

    if (params.isActive !== undefined) conditions.push(eq(inventoryItemsTable.isActive, params.isActive));
    if (params.category)               conditions.push(eq(inventoryItemsTable.category, params.category as never));
    if (params.search) {
      conditions.push(
        sql`(${inventoryItemsTable.name} ILIKE ${'%' + params.search + '%'} OR ${inventoryItemsTable.sku} ILIKE ${'%' + params.search + '%'})`,
      );
    }
    // Low stock: current_stock < min_stock_level (only when min is set)
    if (params.lowStock) {
      conditions.push(sql`${inventoryItemsTable.minStockLevel} IS NOT NULL`);
      conditions.push(sql`${inventoryItemsTable.currentStock} < ${inventoryItemsTable.minStockLevel}`);
    }

    const where = and(...conditions);

    const [{ value: total }] = await this.db
      .select({ value: count() })
      .from(inventoryItemsTable)
      .where(where);

    const items = await this.db
      .select()
      .from(inventoryItemsTable)
      .where(where)
      .orderBy(inventoryItemsTable.name)
      .limit(limit)
      .offset((page - 1) * limit);

    return paginate(items, Number(total), page, limit);
  }

  async findItemOrFail(id: string) {
    const [item] = await this.db
      .select()
      .from(inventoryItemsTable)
      .where(and(eq(inventoryItemsTable.id, id), isNull(inventoryItemsTable.deletedAt)))
      .limit(1);
    if (!item) throw new NotFoundException(`Inventory item ${id} not found`);
    return item;
  }

  async createItem(dto: CreateInventoryItemDto, ctx: AuditContext) {
    const [existing] = await this.db
      .select({ id: inventoryItemsTable.id })
      .from(inventoryItemsTable)
      .where(eq(inventoryItemsTable.sku, dto.sku))
      .limit(1);
    if (existing) throw new ConflictException(`SKU '${dto.sku}' already exists`);

    const [created] = await withAuditContext(this.db, ctx, (tx) =>
      tx.insert(inventoryItemsTable).values({
        sku:                   dto.sku,
        name:                  dto.name,
        genericName:           dto.genericName,
        category:              dto.category as never,
        subcategory:           dto.subcategory,
        isControlled:          dto.isControlled         ?? false,
        requiresPrescription:  dto.requiresPrescription ?? false,
        isForSale:             dto.isForSale            ?? true,
        manufacturer:          dto.manufacturer,
        barcode:               dto.barcode,
        unitOfMeasure:         dto.unitOfMeasure,
        baseUnit:              dto.baseUnit,
        conversionFactor:      dto.conversionFactor,
        minStockLevel:         dto.minStockLevel,
        maxStockLevel:         dto.maxStockLevel,
        reorderQuantity:       dto.reorderQuantity,
        salePrice:             dto.salePrice,
        vatRate:               dto.vatRate ?? '9',
        storageLocation:       dto.storageLocation,
        storageConditions:     dto.storageConditions,
      }).returning(),
    );
    this.logger.log(`Inventory item created: ${created.sku} by ${ctx.userId}`);
    return created;
  }

  async updateItem(id: string, dto: UpdateInventoryItemDto & Partial<CreateInventoryItemDto>, ctx: AuditContext) {
    await this.findItemOrFail(id);
    const [updated] = await withAuditContext(this.db, ctx, (tx) =>
      tx.update(inventoryItemsTable).set({
        ...(dto.name                 !== undefined && { name:                 dto.name }),
        ...(dto.genericName          !== undefined && { genericName:          dto.genericName }),
        ...(dto.category             !== undefined && { category:             dto.category as never }),
        ...(dto.subcategory          !== undefined && { subcategory:          dto.subcategory }),
        ...(dto.isControlled         !== undefined && { isControlled:         dto.isControlled }),
        ...(dto.requiresPrescription !== undefined && { requiresPrescription: dto.requiresPrescription }),
        ...(dto.isForSale            !== undefined && { isForSale:            dto.isForSale }),
        ...(dto.manufacturer         !== undefined && { manufacturer:         dto.manufacturer }),
        ...(dto.barcode              !== undefined && { barcode:              dto.barcode }),
        ...(dto.unitOfMeasure        !== undefined && { unitOfMeasure:        dto.unitOfMeasure }),
        ...(dto.minStockLevel        !== undefined && { minStockLevel:        dto.minStockLevel }),
        ...(dto.maxStockLevel        !== undefined && { maxStockLevel:        dto.maxStockLevel }),
        ...(dto.reorderQuantity      !== undefined && { reorderQuantity:      dto.reorderQuantity }),
        ...(dto.salePrice            !== undefined && { salePrice:            dto.salePrice }),
        ...(dto.vatRate              !== undefined && { vatRate:              dto.vatRate }),
        ...(dto.storageLocation      !== undefined && { storageLocation:      dto.storageLocation }),
        ...(dto.storageConditions    !== undefined && { storageConditions:    dto.storageConditions }),
        ...(dto.isActive             !== undefined && { isActive:             dto.isActive }),
        updatedAt: new Date(),
      }).where(eq(inventoryItemsTable.id, id)).returning(),
    );
    return updated;
  }

  async softDeleteItem(id: string, ctx: AuditContext) {
    await this.findItemOrFail(id);
    await withAuditContext(this.db, ctx, (tx) =>
      tx.update(inventoryItemsTable)
        .set({ deletedAt: new Date(), updatedAt: new Date(), isActive: false })
        .where(eq(inventoryItemsTable.id, id)),
    );
    this.logger.log(`Inventory item ${id} soft-deleted by ${ctx.userId}`);
  }

  // ---------------------------------------------------------------------------
  // Stock movements — append-only
  // ---------------------------------------------------------------------------

  async addMovement(dto: CreateStockMovementDto, ctx: AuditContext) {
    const item = await this.findItemOrFail(dto.inventoryItemId);

    const qtyDelta = parseFloat(dto.quantity);
    if (qtyDelta === 0) throw new BadRequestException('quantity cannot be zero');

    const newStock = parseFloat(item.currentStock as string) + qtyDelta;
    if (newStock < 0) {
      throw new BadRequestException(
        `Insufficient stock. Current: ${item.currentStock}, requested change: ${qtyDelta}`,
      );
    }

    // Within one transaction: record movement + update current_stock atomically
    const [movement] = await withAuditContext(this.db, ctx, async (tx) => {
      const [m] = await tx.insert(stockMovementsTable).values({
        inventoryItemId: dto.inventoryItemId,
        movementType:    dto.movementType as never,
        referenceType:   dto.referenceType,
        referenceId:     dto.referenceId,
        quantity:        dto.quantity,
        unitCost:        dto.unitCost,
        lotNumber:       dto.lotNumber,
        expiryDate:      dto.expiryDate,
        notes:           dto.notes,
        performedBy:     ctx.userId,
        stockBefore:     item.currentStock as string,
        stockAfter:      newStock.toFixed(3),
      }).returning();

      await tx.update(inventoryItemsTable).set({
        currentStock:       newStock.toFixed(3),
        updatedAt:          new Date(),
        ...(dto.unitCost && parseFloat(dto.quantity) > 0 && {
          lastPurchasePrice: dto.unitCost,
        }),
      }).where(eq(inventoryItemsTable.id, dto.inventoryItemId));

      return [m];
    });

    this.logger.log(
      `Stock movement: ${dto.movementType} qty=${dto.quantity} item=${dto.inventoryItemId} ` +
      `stock ${item.currentStock}→${newStock.toFixed(3)} by ${ctx.userId}`,
    );
    return movement;
  }

  async getMovementHistory(itemId: string, limit = 50) {
    await this.findItemOrFail(itemId);
    return this.db
      .select()
      .from(stockMovementsTable)
      .where(eq(stockMovementsTable.inventoryItemId, itemId))
      .orderBy(sql`${stockMovementsTable.performedAt} DESC`)
      .limit(limit);
  }

  // ---------------------------------------------------------------------------
  // Alerts — low stock + expiring lots
  // ---------------------------------------------------------------------------

  async getAlerts() {
    const todayStr  = new Date().toISOString().slice(0, 10);
    const in7Days   = new Date(); in7Days.setDate(in7Days.getDate() + 7);
    const in30Days  = new Date(); in30Days.setDate(in30Days.getDate() + 30);
    const in7Str    = in7Days.toISOString().slice(0, 10);
    const in30Str   = in30Days.toISOString().slice(0, 10);

    const [outOfStock, lowStock, expiring7, expiring30] = await Promise.all([
      // Out of stock
      this.db.execute<{
        id: string; sku: string; name: string; current_stock: string;
        min_stock_level: string | null; unit_of_measure: string;
      }>(sql`
        SELECT id, sku, name, current_stock::TEXT, min_stock_level::TEXT, unit_of_measure
        FROM inventory_items
        WHERE deleted_at IS NULL AND is_active = TRUE
          AND current_stock::NUMERIC <= 0
        ORDER BY name
      `),

      // Low stock (below minimum, but still > 0)
      this.db.execute<{
        id: string; sku: string; name: string; current_stock: string;
        min_stock_level: string; unit_of_measure: string; deficit: string;
      }>(sql`
        SELECT
          id, sku, name,
          current_stock::TEXT,
          min_stock_level::TEXT,
          unit_of_measure,
          (min_stock_level::NUMERIC - current_stock::NUMERIC)::TEXT AS deficit
        FROM inventory_items
        WHERE deleted_at IS NULL AND is_active = TRUE
          AND min_stock_level IS NOT NULL
          AND current_stock::NUMERIC > 0
          AND current_stock::NUMERIC < min_stock_level::NUMERIC
        ORDER BY (current_stock::NUMERIC / min_stock_level::NUMERIC) ASC
      `),

      // Expiring in 7 days
      this.db.execute<{
        inventory_item_id: string; sku: string; name: string;
        lot_number: string | null; expiry_date: string; quantity: string;
        days_until_expiry: string;
      }>(sql`
        SELECT
          ii.id AS inventory_item_id,
          ii.sku, ii.name,
          sm.lot_number,
          sm.expiry_date::TEXT,
          SUM(sm.quantity)::TEXT AS quantity,
          EXTRACT(DAY FROM sm.expiry_date::TIMESTAMP - NOW())::TEXT AS days_until_expiry
        FROM stock_movements sm
        JOIN inventory_items ii ON ii.id = sm.inventory_item_id
        WHERE sm.expiry_date IS NOT NULL
          AND sm.expiry_date BETWEEN ${todayStr} AND ${in7Str}
          AND sm.movement_type = 'purchase_receipt'
          AND ii.deleted_at IS NULL
        GROUP BY ii.id, ii.sku, ii.name, sm.lot_number, sm.expiry_date
        HAVING SUM(sm.quantity) > 0
        ORDER BY sm.expiry_date ASC
      `),

      // Expiring in 30 days (excluding the 7-day window already above)
      this.db.execute<{
        inventory_item_id: string; sku: string; name: string;
        lot_number: string | null; expiry_date: string; quantity: string;
        days_until_expiry: string;
      }>(sql`
        SELECT
          ii.id AS inventory_item_id,
          ii.sku, ii.name,
          sm.lot_number,
          sm.expiry_date::TEXT,
          SUM(sm.quantity)::TEXT AS quantity,
          EXTRACT(DAY FROM sm.expiry_date::TIMESTAMP - NOW())::TEXT AS days_until_expiry
        FROM stock_movements sm
        JOIN inventory_items ii ON ii.id = sm.inventory_item_id
        WHERE sm.expiry_date IS NOT NULL
          AND sm.expiry_date > ${in7Str}
          AND sm.expiry_date <= ${in30Str}
          AND sm.movement_type = 'purchase_receipt'
          AND ii.deleted_at IS NULL
        GROUP BY ii.id, ii.sku, ii.name, sm.lot_number, sm.expiry_date
        HAVING SUM(sm.quantity) > 0
        ORDER BY sm.expiry_date ASC
      `),
    ]);

    const mapItem = (r: { id: string; sku: string; name: string; current_stock: string; min_stock_level?: string | null; unit_of_measure: string; deficit?: string }) => ({
      id:            r.id,
      sku:           r.sku,
      name:          r.name,
      currentStock:  parseFloat(r.current_stock  ?? '0'),
      minStockLevel: r.min_stock_level ? parseFloat(r.min_stock_level) : null,
      unit:          r.unit_of_measure,
      deficit:       r.deficit ? parseFloat(r.deficit) : null,
    });

    const mapLot = (r: { inventory_item_id: string; sku: string; name: string; lot_number: string | null; expiry_date: string; quantity: string; days_until_expiry: string }) => ({
      inventoryItemId: r.inventory_item_id,
      sku:             r.sku,
      name:            r.name,
      lotNumber:       r.lot_number ?? null,
      expiryDate:      r.expiry_date,
      quantity:        parseFloat(r.quantity ?? '0'),
      daysUntilExpiry: Math.max(0, parseInt(r.days_until_expiry ?? '0', 10)),
    });

    return {
      outOfStock:      outOfStock.rows.map(mapItem),
      lowStock:        lowStock.rows.map(mapItem),
      expiringIn7Days: expiring7.rows.map(mapLot),
      expiringIn30Days: expiring30.rows.map(mapLot),
    };
  }

  // ---------------------------------------------------------------------------
  // Recent movements — global feed across all items
  // ---------------------------------------------------------------------------

  async getRecentMovements(params: { limit?: number; itemId?: string }) {
    const limit  = params.limit ?? 50;
    const filter = params.itemId
      ? sql`AND sm.inventory_item_id = ${params.itemId}`
      : sql``;

    const rows = await this.db.execute<{
      id: string; inventory_item_id: string; item_name: string; item_sku: string;
      movement_type: string; quantity: string; unit_cost: string | null;
      lot_number: string | null; expiry_date: string | null;
      stock_before: string | null; stock_after: string | null;
      notes: string | null; performed_by_name: string; performed_at: string;
    }>(sql`
      SELECT
        sm.id,
        sm.inventory_item_id,
        ii.name  AS item_name,
        ii.sku   AS item_sku,
        sm.movement_type,
        sm.quantity::TEXT,
        sm.unit_cost::TEXT,
        sm.lot_number,
        sm.expiry_date::TEXT,
        sm.stock_before::TEXT,
        sm.stock_after::TEXT,
        sm.notes,
        COALESCE(u.first_name || ' ' || u.last_name, 'System') AS performed_by_name,
        sm.performed_at::TEXT
      FROM stock_movements sm
      JOIN inventory_items ii ON ii.id = sm.inventory_item_id
      LEFT JOIN users u ON u.id = sm.performed_by
      WHERE ii.deleted_at IS NULL
        ${filter}
      ORDER BY sm.performed_at DESC
      LIMIT ${limit}
    `);

    return rows.rows.map((r) => ({
      id:              r.id,
      inventoryItemId: r.inventory_item_id,
      itemName:        r.item_name,
      itemSku:         r.item_sku,
      movementType:    r.movement_type,
      quantity:        parseFloat(r.quantity   ?? '0'),
      unitCost:        r.unit_cost ? parseFloat(r.unit_cost) : null,
      lotNumber:       r.lot_number  ?? null,
      expiryDate:      r.expiry_date ?? null,
      stockBefore:     r.stock_before ? parseFloat(r.stock_before) : null,
      stockAfter:      r.stock_after  ? parseFloat(r.stock_after)  : null,
      notes:           r.notes ?? null,
      performedByName: r.performed_by_name,
      performedAt:     r.performed_at,
    }));
  }

  // ---------------------------------------------------------------------------
  // Billing candidates — read from DB view
  // ---------------------------------------------------------------------------

  async getBillingCandidates(params: {
    consultationId?: string;
    ownerId?: string;
    page?: number;
    limit?: number;
  }) {
    const page  = params.page  ?? 1;
    const limit = params.limit ?? 100;

    // Build dynamic query safely using Drizzle sql tag (parameterized)
    const filters: ReturnType<typeof sql>[] = [];
    if (params.consultationId) filters.push(sql`consultation_id = ${params.consultationId}`);
    if (params.ownerId)        filters.push(sql`owner_id = ${params.ownerId}`);

    const whereExpr = filters.length
      ? sql`WHERE ${sql.join(filters, sql` AND `)}`
      : sql``;

    const countResult = await this.db.execute(
      sql`SELECT COUNT(*) AS total FROM billing_candidates ${whereExpr}`,
    );
    const total = parseInt((countResult.rows[0] as { total: string }).total, 10);

    const rows = await this.db.execute(
      sql`SELECT * FROM billing_candidates ${whereExpr}
          ORDER BY service_date ASC
          LIMIT ${limit} OFFSET ${(page - 1) * limit}`,
    );

    return paginate(rows.rows, total, page, limit);
  }
}
