import { pgTable, uuid, varchar, numeric, integer, timestamp } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { invoicesTable } from './invoices';

export const invoiceLinesTable = pgTable('invoice_lines', {
  id:           uuid('id').primaryKey().defaultRandom(),
  invoiceId:    uuid('invoice_id').notNull().references(() => invoicesTable.id),

  // Origine linie — nullable pentru linii manuale sau storno
  sourceId:     uuid('source_id'),
  sourceType:   varchar('source_type', { length: 20 }),  // 'procedure' | 'treatment_line' | 'manual'

  // Snapshot complet la momentul creării draft-ului
  description:  varchar('description', { length: 500 }).notNull(),
  quantity:     numeric('quantity',   { precision: 8,  scale: 3 }).notNull(),
  unit:         varchar('unit', { length: 30 }),
  unitPrice:    numeric('unit_price', { precision: 10, scale: 2 }).notNull(),
  vatRate:      numeric('vat_rate',   { precision: 5,  scale: 2 }).notNull().default('9'),

  // Coloane generate — PostgreSQL le calculează, aplicația nu le scrie niciodată
  lineTotal:    numeric('line_total', { precision: 10, scale: 2 }).generatedAlwaysAs(
    sql`quantity * unit_price`,
  ),
  vatAmount:    numeric('vat_amount', { precision: 10, scale: 2 }).generatedAlwaysAs(
    sql`ROUND(quantity * unit_price * vat_rate / 100, 2)`,
  ),

  costSnapshot: numeric('cost_snapshot', { precision: 10, scale: 2 }),
  position:     integer('position').notNull().default(0),

  createdAt:    timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});
