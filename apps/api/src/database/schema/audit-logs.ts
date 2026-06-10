import { pgTable, uuid, varchar, text, timestamp, jsonb } from 'drizzle-orm/pg-core';
import { auditActionEnum } from './enums';
import { usersTable } from './users';

// CRITIC: Acest tabel este IMUTABIL. Nicio metodă, nicio rută, nicio migrație
// nu execută DELETE sau UPDATE pe audit_logs. Orice tentativă este o eroare.
export const auditLogsTable = pgTable('audit_logs', {
  id: uuid('id').primaryKey().defaultRandom(),
  tableName: varchar('table_name', { length: 100 }).notNull(),
  recordId: uuid('record_id').notNull(),
  action: auditActionEnum('action').notNull(),
  // Nullable la nivel DB: triggerul folosește current_setting care poate fi NULL
  // Aplicația TREBUIE să seteze app.current_user_id înainte de orice operație DB
  changedBy: uuid('changed_by').references(() => usersTable.id),
  changedAt: timestamp('changed_at', { withTimezone: true }).notNull().defaultNow(),
  // Câmpurile excluse din audit (nu apar în old_values/new_values): updated_at, password_hash
  oldValues: jsonb('old_values'),
  newValues: jsonb('new_values'),
  ipAddress: varchar('ip_address', { length: 45 }),
  userAgent: text('user_agent'),
  sessionId: varchar('session_id', { length: 100 }),
});
