import { pgTable, uuid, varchar, numeric, text, timestamp, date } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { invoiceStatusEnum } from './enums';
import { ownersTable } from './owners';
import { consultationsTable } from './consultations';
import { usersTable } from './users';

export const invoicesTable = pgTable('invoices', {
  id:                   uuid('id').primaryKey().defaultRandom(),
  // Generat la emitere (issue()), nu la creare draft
  invoiceNumber:        varchar('invoice_number', { length: 30 }).unique(),
  series:               varchar('series', { length: 10 }).notNull().default('VET'),
  ownerId:              uuid('owner_id').notNull().references(() => ownersTable.id),
  consultationId:       uuid('consultation_id').references(() => consultationsTable.id),
  // Self-referential: nota de credit indică factura originală
  stornoOfInvoiceId:    uuid('storno_of_invoice_id'),

  status:               invoiceStatusEnum('status').notNull().default('draft'),
  issuedAt:             timestamp('issued_at', { withTimezone: true }),
  dueDate:              date('due_date'),

  // Snapshot financiar — calculat la issue() din linii
  subtotal:             numeric('subtotal',     { precision: 12, scale: 2 }).notNull().default('0'),
  vatAmount:            numeric('vat_amount',   { precision: 12, scale: 2 }).notNull().default('0'),
  totalAmount:          numeric('total_amount', { precision: 12, scale: 2 }).notNull().default('0'),
  paidAmount:           numeric('paid_amount',  { precision: 12, scale: 2 }).notNull().default('0'),
  currency:             varchar('currency', { length: 3 }).notNull().default('RON'),

  // Snapshot date facturare proprietar (copiat la emitere)
  billingName:          varchar('billing_name', { length: 300 }),
  billingAddress:       text('billing_address'),
  billingCui:           varchar('billing_cui', { length: 20 }),

  notes:                text('notes'),
  issuedBy:             uuid('issued_by').references(() => usersTable.id),
  cancelledAt:          timestamp('cancelled_at', { withTimezone: true }),
  cancelReason:         text('cancel_reason'),

  createdAt:            timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt:            timestamp('updated_at', { withTimezone: true }),
  deletedAt:            timestamp('deleted_at', { withTimezone: true }),
  createdBy:            uuid('created_by').references(() => usersTable.id),
});

// Constrângeri suplimentare în migrarea SQL:
// - CHECK: storno_of_invoice_id IS NULL OR storno_of_invoice_id != id
// - CHECK: paid_amount >= 0
// - CHECK: total_amount = subtotal + vat_amount (validat aplicativ înainte de issue)
// - FK self-ref: storno_of_invoice_id → invoices(id) (nu poate fi exprimat inline în Drizzle)
// - UNIQUE (storno_of_invoice_id) WHERE storno_of_invoice_id IS NOT NULL — o singură notă de credit per factură
