import { pgTable, uuid, numeric, varchar, text, timestamp } from 'drizzle-orm/pg-core';
import { paymentMethodEnum } from './enums';
import { invoicesTable } from './invoices';
import { usersTable } from './users';

export const paymentsTable = pgTable('payments', {
  id:            uuid('id').primaryKey().defaultRandom(),
  invoiceId:     uuid('invoice_id').notNull().references(() => invoicesTable.id),
  amount:        numeric('amount', { precision: 12, scale: 2 }).notNull(),
  paymentMethod: paymentMethodEnum('payment_method').notNull(),
  paidAt:        timestamp('paid_at', { withTimezone: true }).notNull().defaultNow(),
  // Referință externă: cod autorizare card, referință transfer bancar etc.
  reference:     varchar('reference', { length: 100 }),
  notes:         text('notes'),
  recordedBy:    uuid('recorded_by').notNull().references(() => usersTable.id),
  createdAt:     timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

// CHECK în migrarea SQL: amount > 0
// Plățile nu se șterg niciodată — sunt audit trail financiar
