import { pgTable, uuid, integer, boolean, date, numeric, text, timestamp } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { consultationTypeEnum, consultationStatusEnum, consultationPrognosisEnum } from './enums';
import { petsTable } from './pets';
import { ownersTable } from './owners';
import { veterinariansTable } from './veterinarians';
import { appointmentsTable } from './appointments';

export const consultationsTable = pgTable('consultations', {
  id: uuid('id').primaryKey().defaultRandom(),
  // Nullable: consultație walk-in fără programare prealabilă
  appointmentId: uuid('appointment_id').references(() => appointmentsTable.id),
  petId: uuid('pet_id').notNull().references(() => petsTable.id),
  ownerId: uuid('owner_id').notNull().references(() => ownersTable.id),
  veterinarianId: uuid('veterinarian_id').notNull().references(() => veterinariansTable.id),
  consultationDate: timestamp('consultation_date', { withTimezone: true }).notNull(),
  type: consultationTypeEnum('type').notNull(),

  // Anamnesis
  chiefComplaint: text('chief_complaint').notNull(),
  history: text('history'),

  // Examen clinic
  weightKg: numeric('weight_kg', { precision: 5, scale: 2 }),
  temperatureC: numeric('temperature_c', { precision: 4, scale: 1 }),
  heartRate: integer('heart_rate'),
  respiratoryRate: integer('respiratory_rate'),
  clinicalFindings: text('clinical_findings'),

  // Diagnostic
  diagnosisPrimary: text('diagnosis_primary').notNull(),
  diagnosisSecondary: text('diagnosis_secondary'),
  prognosis: consultationPrognosisEnum('prognosis'),

  // Plan și discharge
  treatmentPlan: text('treatment_plan'),
  dischargeNotes: text('discharge_notes'),
  followUpDate: date('follow_up_date'),
  followUpNotes: text('follow_up_notes'),

  // Status
  status: consultationStatusEnum('status').notNull().default('open'),
  // CRITIC: factură poate fi emisă doar când billed = false și signed_by IS NOT NULL
  billed: boolean('billed').notNull().default(false),
  // invoice_id adăugat în migrarea Fazei 2 când tabelul invoices există

  // Durată
  startedAt: timestamp('started_at', { withTimezone: true }),
  endedAt: timestamp('ended_at', { withTimezone: true }),
  // Coloană generată — calculată automat de PostgreSQL
  durationMinutes: integer('duration_minutes').generatedAlwaysAs(
    sql`FLOOR(EXTRACT(EPOCH FROM (ended_at - started_at)) / 60)`,
  ),

  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }),
  deletedAt: timestamp('deleted_at', { withTimezone: true }),

  // Semnătura digitală a medicului — OBLIGATORIE înainte de facturare
  signedBy: uuid('signed_by').references(() => veterinariansTable.id),
  signedAt: timestamp('signed_at', { withTimezone: true }),
});

// CHECK constraints în migrarea SQL:
// - signed_at IS NOT NULL → signed_by IS NOT NULL (nu poate exista dată semnare fără medic)
// - ended_at >= started_at (când ambele sunt setate)
