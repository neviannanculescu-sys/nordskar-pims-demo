import { pgTable, uuid, varchar, text, boolean, numeric, timestamp } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { consultationsTable }      from './consultations';
import { veterinariansTable }      from './veterinarians';
import { procedureTemplatesTable } from './procedure-templates';

export const proceduresTable = pgTable('procedures', {
  id: uuid('id').primaryKey().defaultRandom(),

  consultationId: uuid('consultation_id')
    .notNull()
    .references(() => consultationsTable.id),

  // FK to procedure_templates — now wired; was nullable debt from 0003
  procedureTemplateId: uuid('procedure_template_id')
    .references(() => procedureTemplatesTable.id),

  veterinarianId: uuid('veterinarian_id')
    .notNull()
    .references(() => veterinariansTable.id),

  performedAt: timestamp('performed_at', { withTimezone: true }).notNull(),

  name:        varchar('name', { length: 200 }).notNull(),
  description: text('description'),

  // Quantity + pricing snapshot at time of service
  quantity:   numeric('quantity',    { precision: 8,  scale: 2 }).notNull().default('1'),
  unit:       varchar('unit',        { length: 50 }),
  unitPrice:  numeric('unit_price',  { precision: 10, scale: 2 }).notNull(),
  totalPrice: numeric('total_price', { precision: 10, scale: 2 })
    .generatedAlwaysAs(sql`quantity * unit_price`),

  // Direct cost of consumables used (for margin calculation)
  costDirect: numeric('cost_direct', { precision: 10, scale: 2 }),

  isBillable: boolean('is_billable').notNull().default(true),
  notes:      text('notes'),

  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }),
  deletedAt: timestamp('deleted_at', { withTimezone: true }),
});

// CHECK constraints applied in migration SQL:
//   quantity > 0
//   unit_price >= 0
