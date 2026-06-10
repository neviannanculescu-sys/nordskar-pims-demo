import { pgTable, uuid, varchar, text, boolean, numeric, integer, date, timestamp } from 'drizzle-orm/pg-core';
import { pgEnum } from 'drizzle-orm/pg-core';
import { consultationsTable }  from './consultations';
import { veterinariansTable }  from './veterinarians';
import { usersTable }          from './users';
import { inventoryItemsTable } from './inventory-items';

export const treatmentRouteEnum = pgEnum('treatment_route', [
  'oral', 'iv', 'im', 'sc', 'topical', 'ophthalmic', 'other',
]);

export const treatmentLinesTable = pgTable('treatment_lines', {
  id: uuid('id').primaryKey().defaultRandom(),

  consultationId: uuid('consultation_id')
    .notNull()
    .references(() => consultationsTable.id),

  // FK to inventory_items — now wired; was nullable debt from 0003.
  // Still nullable: walk-in prescriptions without a catalog item remain valid.
  // Backfill procedure: when inventory module ships, run UPDATE to link existing lines.
  inventoryItemId: uuid('inventory_item_id')
    .references(() => inventoryItemsTable.id),

  prescribedBy: uuid('prescribed_by')
    .notNull()
    .references(() => veterinariansTable.id),

  administeredBy: uuid('administered_by')
    .references(() => usersTable.id),

  // Prescription fields
  productName: varchar('product_name', { length: 200 }).notNull(),
  dose:        varchar('dose',        { length: 100 }).notNull(),
  frequency:   varchar('frequency',   { length: 100 }),
  route:       treatmentRouteEnum('route'),
  durationDays: integer('duration_days'),
  startDate:   date('start_date'),
  endDate:     date('end_date'),

  // Dispensing
  quantityDispensed: numeric('quantity_dispensed', { precision: 8, scale: 3 }),
  quantityUnit:      varchar('quantity_unit',      { length: 30 }),

  // Traceability — legally required for controlled/tracked medications
  lotNumber:  varchar('lot_number',  { length: 50 }),
  expiryDate: date('expiry_date'),

  // Pricing snapshot at time of service
  unitCost:  numeric('unit_cost',  { precision: 10, scale: 2 }),  // stock cost (FIFO/FEFO, filled Phase 2)
  unitPrice: numeric('unit_price', { precision: 10, scale: 2 }),  // sale price to client

  isBillable:   boolean('is_billable').notNull().default(true),
  // False until physically dispensed from stock — triggers stock movement in Phase 2
  isDispensed:  boolean('is_dispensed').notNull().default(false),

  administeredAt: timestamp('administered_at', { withTimezone: true }),
  notes:          text('notes'),

  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }),
  deletedAt: timestamp('deleted_at', { withTimezone: true }),
});

// CHECK constraints applied in migration SQL:
//   quantity_dispensed > 0 (when not null)
//   unit_price >= 0 (when not null)
//   end_date >= start_date (when both not null)
