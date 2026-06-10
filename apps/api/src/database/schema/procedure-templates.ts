import { pgTable, uuid, varchar, text, boolean, integer, timestamp } from 'drizzle-orm/pg-core';
import { priceCatalogTable } from './price-catalog';

export const procedureTemplatesTable = pgTable('procedure_templates', {
  id:          uuid('id').primaryKey().defaultRandom(),
  serviceId:   uuid('service_id').notNull().references(() => priceCatalogTable.id),

  name:        varchar('name', { length: 200 }).notNull(),
  description: text('description'),

  estimatedTimeMin:    integer('estimated_time_min'),
  requiresAnesthesia:  boolean('requires_anesthesia').notNull().default(false),
  requiresLab:         boolean('requires_lab').notNull().default(false),

  preProcedureNotes:  text('pre_procedure_notes'),
  postProcedureNotes: text('post_procedure_notes'),

  isActive: boolean('is_active').notNull().default(true),

  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }),
});

// procedure_template_items (consumables per template) added in Phase 2
// when inventory_items table is stable.
