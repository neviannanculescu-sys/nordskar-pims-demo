import { pgTable, uuid, varchar, text, boolean, numeric, timestamp } from 'drizzle-orm/pg-core';
import { pgEnum } from 'drizzle-orm/pg-core';

export const inventoryCategoryEnum = pgEnum('inventory_category', [
  'medication', 'consumable', 'food', 'product_for_sale', 'equipment', 'other',
]);

export const inventoryItemsTable = pgTable('inventory_items', {
  id:          uuid('id').primaryKey().defaultRandom(),
  sku:         varchar('sku',  { length: 50  }).notNull().unique(),
  name:        varchar('name', { length: 200 }).notNull(),
  genericName: varchar('generic_name', { length: 200 }),

  category:    inventoryCategoryEnum('category').notNull(),
  subcategory: varchar('subcategory', { length: 100 }),

  // Special classification
  isControlled:          boolean('is_controlled').notNull().default(false),
  requiresPrescription:  boolean('requires_prescription').notNull().default(false),
  isForSale:             boolean('is_for_sale').notNull().default(true),

  // Identity
  manufacturer: varchar('manufacturer', { length: 200 }),
  barcode:      varchar('barcode', { length: 50 }),

  // Units of measure
  unitOfMeasure:    varchar('unit_of_measure', { length: 30 }).notNull(),
  baseUnit:         varchar('base_unit',        { length: 30 }),
  conversionFactor: numeric('conversion_factor', { precision: 10, scale: 4 }),

  // Stock levels
  currentStock:    numeric('current_stock',   { precision: 10, scale: 3 }).notNull().default('0'),
  minStockLevel:   numeric('min_stock_level', { precision: 10, scale: 3 }),
  maxStockLevel:   numeric('max_stock_level', { precision: 10, scale: 3 }),
  reorderQuantity: numeric('reorder_quantity',{ precision: 10, scale: 3 }),

  // Pricing
  lastPurchasePrice: numeric('last_purchase_price', { precision: 10, scale: 4 }),
  averageCost:       numeric('average_cost',         { precision: 10, scale: 4 }),
  salePrice:         numeric('sale_price',           { precision: 10, scale: 2 }),
  vatRate:           numeric('vat_rate',             { precision: 5,  scale: 2 }).notNull().default('9'),

  storageLocation:   varchar('storage_location', { length: 100 }),
  storageConditions: text('storage_conditions'),

  isActive: boolean('is_active').notNull().default(true),

  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }),
  deletedAt: timestamp('deleted_at', { withTimezone: true }),
});

// CHECK constraints in migration SQL:
//   current_stock >= 0
//   vat_rate IN (0, 9, 19)
//   sale_price >= 0 (when not null)
