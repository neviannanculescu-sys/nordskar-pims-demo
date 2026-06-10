import { pgTable, uuid, varchar, boolean, date, numeric, text, timestamp } from 'drizzle-orm/pg-core';
import { petGenderEnum } from './enums';
import { ownersTable } from './owners';
import { speciesTable } from './species';
import { breedsTable } from './breeds';

export const petsTable = pgTable('pets', {
  id: uuid('id').primaryKey().defaultRandom(),
  ownerId: uuid('owner_id').notNull().references(() => ownersTable.id),
  name: varchar('name', { length: 100 }).notNull(),
  speciesId: uuid('species_id').notNull().references(() => speciesTable.id),
  breedId: uuid('breed_id').references(() => breedsTable.id),
  gender: petGenderEnum('gender').notNull(),
  isNeutered: boolean('is_neutered'),
  dateOfBirth: date('date_of_birth'),
  // Câmp alternativ când data exactă nu este cunoscută
  approximateAge: varchar('approximate_age', { length: 50 }),
  color: varchar('color', { length: 100 }),
  markings: text('markings'),
  // Număr microcip — unic global
  chipNumber: varchar('chip_number', { length: 50 }).unique(),
  tattoo: varchar('tattoo', { length: 50 }),
  passportNumber: varchar('passport_number', { length: 50 }),
  // Ultima greutate înregistrată — actualizată la fiecare consultație
  weightKg: numeric('weight_kg', { precision: 5, scale: 2 }),
  photoUrl: text('photo_url'),
  isDeceased: boolean('is_deceased').notNull().default(false),
  deceasedDate: date('deceased_date'),
  notes: text('notes'),
  // CRITIC: câmpul alergii trebuie vizibil proeminent în UI
  allergies: text('allergies'),
  chronicConditions: text('chronic_conditions'),
  isActive: boolean('is_active').notNull().default(true),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }),
  deletedAt: timestamp('deleted_at', { withTimezone: true }),
});

// CHECK constraint în migrarea SQL: dacă is_deceased = TRUE atunci deceased_date NOT NULL
