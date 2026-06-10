import { pgTable, uuid, varchar, numeric, text, timestamp } from 'drizzle-orm/pg-core';
import { usersTable } from './users';

export const anomaliesTable = pgTable('anomalies', {
  id:                uuid('id').primaryKey().defaultRandom(),
  fingerprint:       varchar('fingerprint', { length: 200 }).notNull().unique(),

  type:              varchar('type', { length: 60 }).notNull(),
  title:             varchar('title', { length: 200 }).notNull(),
  description:       text('description').notNull(),
  sourceModule:      varchar('source_module', { length: 50 }).notNull(),
  severity:          varchar('severity', { length: 20 }).notNull(),

  metricValue:       numeric('metric_value',   { precision: 14, scale: 4 }),
  baselineValue:     numeric('baseline_value', { precision: 14, scale: 4 }),
  threshold:         numeric('threshold',      { precision: 14, scale: 4 }),

  relatedEntityType: varchar('related_entity_type', { length: 50 }),
  relatedEntityId:   uuid('related_entity_id'),

  suggestedAction:   text('suggested_action'),

  status:            varchar('status', { length: 20 }).notNull().default('open'),
  ackedAt:           timestamp('acked_at',    { withTimezone: true }),
  ackedBy:           uuid('acked_by').references(() => usersTable.id),
  resolvedAt:        timestamp('resolved_at', { withTimezone: true }),
  resolvedBy:        uuid('resolved_by').references(() => usersTable.id),

  rangeKey:          varchar('range_key', { length: 10 }).notNull().default('today'),
  detectedAt:        timestamp('detected_at', { withTimezone: true }).notNull().defaultNow(),
  createdAt:         timestamp('created_at',  { withTimezone: true }).notNull().defaultNow(),
  updatedAt:         timestamp('updated_at',  { withTimezone: true }).notNull().defaultNow(),
});
