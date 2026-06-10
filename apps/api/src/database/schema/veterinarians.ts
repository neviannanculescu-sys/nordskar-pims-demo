import { pgTable, uuid, varchar, boolean, numeric, text, timestamp } from 'drizzle-orm/pg-core';
import { usersTable } from './users';

export const veterinariansTable = pgTable('veterinarians', {
  id: uuid('id').primaryKey().defaultRandom(),
  // Relație 1:1 cu users — un user poate fi cel mult un medic
  userId: uuid('user_id').notNull().unique().references(() => usersTable.id),
  firstName: varchar('first_name', { length: 100 }).notNull(),
  lastName: varchar('last_name', { length: 100 }).notNull(),
  // Număr parafă CMVRO — unic la nivel național
  licenseNumber: varchar('license_number', { length: 50 }).notNull().unique(),
  specializations: text('specializations').array(),
  isSurgeon: boolean('is_surgeon').notNull().default(false),
  isAvailable: boolean('is_available').notNull().default(true),
  consultationRate: numeric('consultation_rate', { precision: 8, scale: 2 }),
  // Culoare hex #RRGGBB pentru calendar vizual
  colorInCalendar: varchar('color_in_calendar', { length: 7 }),
  signatureImageUrl: text('signature_image_url'),
  notes: text('notes'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  deletedAt: timestamp('deleted_at', { withTimezone: true }),
});

// CHECK constraint pentru format culoare hex aplicat în migrarea SQL
