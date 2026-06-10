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
