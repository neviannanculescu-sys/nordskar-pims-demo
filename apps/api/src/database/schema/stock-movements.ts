import { pgTable, uuid, varchar, text, numeric, date, timestamp } from 'drizzle-orm/pg-core';
import { pgEnum } from 'drizzle-orm/pg-core';
import { inventoryItemsTable } from './inventory-items';
import { usersTable }          from './users';

export const stockMovementTypeEnum = pgEnum('stock_movement_type', [
  'purchase_receipt',
  'consultation_use',
  'hospitalization_use',
  'direct_sale',
  'adjustment_positive',
  'adjustment_negative',
  'return_to_supplier',
  'expired_disposal',
  'theft_loss',
]);

export const stockMovementsTable = pgTable('stock_movements', {
  id: uuid('id').primaryKey().defaultRandom(),

  inventoryItemId: uuid('inventory_item_id')
    .notNull()
    .references(() => inventoryItemsTable.id),

  movementType: stockMovementTypeEnum('movement_type').notNull(),

  // Polymorphic reference — allows linking to consultation, invoice, purchase_order, etc.
  referenceType: varchar('reference_type', { length: 50 }),
  referenceId:   uuid('reference_id'),

  // Positive = inbound, negative = outbound
  quantity:    numeric('quantity',  { precision: 10, scale: 3 }).notNull(),
  unitCost:    numeric('unit_cost', { precision: 10, scale: 4 }),
  lotNumber:   varchar('lot_number', { length: 50 }),
  expiryDate:  date('expiry_date'),

  notes: text('notes'),

  performedBy: uuid('performed_by').notNull().references(() => usersTable.id),
  performedAt: timestamp('performed_at', { withTimezone: true }).notNull().defaultNow(),

  // Stock snapshot at time of movement — for audit / reconciliation
  stockBefore: numeric('stock_before', { precision: 10, scale: 3 }),
  stockAfter:  numeric('stock_after',  { precision: 10, scale: 3 }),
});

// stock_movements is append-only — no UPDATE or DELETE ever.
// CHECK constraints in migration SQL:
//   quantity <> 0
