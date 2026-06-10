import { pgTable, uuid, varchar, text, jsonb, timestamp } from 'drizzle-orm/pg-core';
import { spvSubmissionsTable } from './spv-submissions';

export const spvResponsesTable = pgTable('spv_responses', {
  id:                 uuid('id').primaryKey().defaultRandom(),
  submissionId:       uuid('submission_id').notNull().references(() => spvSubmissionsTable.id),

  // Starea returnată de ANAF: 'ok' | 'nok' | 'in prelucrare' | 'eroare'
  anafStatus:         varchar('anaf_status', { length: 30 }).notNull(),
  // Mesaj brut de stare de la ANAF (câmpul "mesaj" din răspuns JSON)
  anafMessage:        text('anaf_message'),

  // Lista de erori structurată din XML-ul de răspuns ANAF (din ZIP)
  // Exemplu: [{ "errorCode": "E001", "errorMessage": "CIF furnizor invalid" }]
  errorDetails:       jsonb('error_details'),

  // Explicație în română generată de mapperul de erori ANAF
  // SECURITY: nu conține date personale (CNP, CUI) — doar coduri și texte standard
  humanExplanation:   text('human_explanation'),

  // XML-ul brut de răspuns ANAF (conținut ZIP dezarhivat)
  // Stocat pentru audit și retrimitere manuală
  rawResponseXml:     text('raw_response_xml'),

  receivedAt:         timestamp('received_at', { withTimezone: true }).notNull().defaultNow(),
  createdAt:          timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

// Răspunsurile SPV nu se șterg niciodată — sunt audit trail fiscal
