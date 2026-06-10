import { pgTable, uuid, varchar, text, boolean, numeric, integer, date, timestamp } from 'drizzle-orm/pg-core';
import { pgEnum } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { serviceCategoriesTable } from './service-categories';
import { usersTable } from './users';

export const serviceTypeEnum = pgEnum('service_type', [
  'consultation', 'emergency', 'surgery', 'anesthesia',
  'hospitalization', 'lab_test', 'imaging', 'vaccination',
  'treatment', 'procedure', 'product', 'package', 'other',
]);

export const priceCatalogTable = pgTable('price_catalog', {
  id:          uuid('id').primaryKey().defaultRandom(),
  code:        varchar('code', { length: 30 }).notNull().unique(),
  name:        varchar('name', { length: 200 }).notNull(),
  description: text('description'),

  categoryId:  uuid('category_id').notNull().references(() => serviceCategoriesTable.id),
  serviceType: serviceTypeEnum('service_type').notNull(),

  // Pricing
  basePrice:       numeric('base_price',    { precision: 10, scale: 2 }).notNull(),
  vatRate:         numeric('vat_rate',      { precision: 5,  scale: 2 }).notNull().default('9'),
  priceWithVat:    numeric('price_with_vat',{ precision: 10, scale: 2 })
    .generatedAlwaysAs(sql`base_price * (1 + vat_rate / 100.0)`),

  directCostEstimate: numeric('direct_cost_estimate', { precision: 10, scale: 2 }),
  minMarginPercent:   numeric('min_margin_percent',   { precision: 5,  scale: 2 }).default('30'),

  estimatedDurationMin: integer('estimated_duration_min'),

  // Emergency surcharge
  isEmergencySurcharge: boolean('is_emergency_surcharge').notNull().default(false),
  emergencyMultiplier:  numeric('emergency_multiplier', { precision: 4, scale: 2 }).default('1.5'),

  // Requires manager approval above this amount
  requiresApprovalAbove: numeric('requires_approval_above', { precision: 10, scale: 2 }),

  isActive:  boolean('is_active').notNull().default(true),
  validFrom: date('valid_from').notNull().default(sql`CURRENT_DATE`),
  validTo:   date('valid_to'),

  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }),
  updatedBy: uuid('updated_by').references(() => usersTable.id),
});

// CHECK constraints in migration SQL:
//   base_price >= 0
//   vat_rate IN (0, 9, 19)
//   valid_to IS NULL OR valid_to >= valid_from
//   emergency_multiplier >= 1
