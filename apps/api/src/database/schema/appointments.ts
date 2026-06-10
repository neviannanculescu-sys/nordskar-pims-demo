import { pgTable, uuid, integer, boolean, text, timestamp } from 'drizzle-orm/pg-core';
import { appointmentTypeEnum, appointmentStatusEnum, appointmentSourceEnum } from './enums';
import { petsTable } from './pets';
import { ownersTable } from './owners';
import { veterinariansTable } from './veterinarians';
import { roomsTable } from './rooms';
import { usersTable } from './users';

export const appointmentsTable = pgTable('appointments', {
  id: uuid('id').primaryKey().defaultRandom(),
  petId: uuid('pet_id').notNull().references(() => petsTable.id),
  ownerId: uuid('owner_id').notNull().references(() => ownersTable.id),
  // Nullable: programare fără medic alocat inițial (alocat la check-in)
  veterinarianId: uuid('veterinarian_id').references(() => veterinariansTable.id),
  roomId: uuid('room_id').references(() => roomsTable.id),
  scheduledAt: timestamp('scheduled_at', { withTimezone: true }).notNull(),
  durationMin: integer('duration_min').notNull().default(30),
  type: appointmentTypeEnum('type').notNull(),
  status: appointmentStatusEnum('status').notNull().default('scheduled'),
  reason: text('reason').notNull(),
  notes: text('notes'),
  source: appointmentSourceEnum('source'),
  reminderSent24h: boolean('reminder_sent_24h').notNull().default(false),
  reminderSent2h: boolean('reminder_sent_2h').notNull().default(false),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }),
  deletedAt: timestamp('deleted_at', { withTimezone: true }),
  createdBy: uuid('created_by').references(() => usersTable.id),
});

// CHECK constraint în migrarea SQL: duration_min > 0
