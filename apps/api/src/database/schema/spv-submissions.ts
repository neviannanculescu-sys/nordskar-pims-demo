import { pgTable, uuid, varchar, text, integer, timestamp } from 'drizzle-orm/pg-core';
import { spvSubmissionStatusEnum } from './enums';
import { invoicesTable } from './invoices';
import { usersTable } from './users';

export const spvSubmissionsTable = pgTable('spv_submissions', {
  id:                 uuid('id').primaryKey().defaultRandom(),
  invoiceId:          uuid('invoice_id').notNull().references(() => invoicesTable.id),
  // Denormalizat — invoiceNumber poate fi null pe draft, capturat la submit
  invoiceNumber:      varchar('invoice_number', { length: 30 }),

  status:             spvSubmissionStatusEnum('status').notNull().default('pending'),

  // Numărul de înregistrare returnat de ANAF după upload reușit
  uploadIndex:        varchar('upload_index', { length: 50 }),
  // ID pentru descărcare răspuns ZIP (returnat de polling când stare=ok/nok)
  downloadId:         varchar('download_id', { length: 50 }),

  // XML-ul generat — păstrat pentru re-submitere și audit
  // SECURITY: nu conține token OAuth — credențialele sunt în env/vault
  xmlContent:         text('xml_content').notNull(),
  xmlSha256:          varchar('xml_sha256', { length: 64 }).notNull(),

  submittedAt:        timestamp('submitted_at', { withTimezone: true }),
  submittedBy:        uuid('submitted_by').references(() => usersTable.id),
  lastPolledAt:       timestamp('last_polled_at', { withTimezone: true }),
  acceptedAt:         timestamp('accepted_at', { withTimezone: true }),
  rejectedAt:         timestamp('rejected_at', { withTimezone: true }),

  // Mesaj de eroare în română — explicat pentru utilizator final
  errorMessage:       text('error_message'),
  // Numărul de reîncercări (max 3 automat, după manual)
  retryCount:         integer('retry_count').notNull().default(0),

  createdAt:          timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt:          timestamp('updated_at', { withTimezone: true }),
});

// Constrângeri în migrare:
// - UNIQUE (invoice_id) WHERE status IN ('pending','uploading','uploaded','processing','accepted')
//   → o singură submission activă per factură
// - upload_index NOT NULL când status IN ('uploaded','processing','accepted','rejected')
