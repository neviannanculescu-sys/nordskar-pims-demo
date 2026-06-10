import { pgTable, uuid, varchar, boolean, text, timestamp } from 'drizzle-orm/pg-core';
import { ownerTypeEnum, preferredChannelEnum } from './enums';
import { usersTable } from './users';

export const ownersTable = pgTable('owners', {
  id: uuid('id').primaryKey().defaultRandom(),
  type: ownerTypeEnum('type').notNull(),

  // Persoană fizică
  firstName: varchar('first_name', { length: 100 }),
  lastName: varchar('last_name', { length: 100 }),
  cnp: varchar('cnp', { length: 13 }),

  // Persoană juridică
  companyName: varchar('company_name', { length: 200 }),
  cui: varchar('cui', { length: 20 }),
  vatPayer: boolean('vat_payer').notNull().default(false),

  // Adresă
  addressStreet: varchar('address_street', { length: 200 }),
  addressCity: varchar('address_city', { length: 100 }),
  addressCounty: varchar('address_county', { length: 100 }),
  addressZip: varchar('address_zip', { length: 10 }),
  addressCountry: varchar('address_country', { length: 50 }).notNull().default('RO'),

  // Contact
  phonePrimary: varchar('phone_primary', { length: 20 }).notNull(),
  phoneSecondary: varchar('phone_secondary', { length: 20 }),
  email: varchar('email', { length: 150 }),
  whatsapp: varchar('whatsapp', { length: 20 }),
  preferredChannel: preferredChannelEnum('preferred_channel'),

  // GDPR — stocare date personale necesită consimțământ explicit
  gdprConsent: boolean('gdpr_consent').notNull().default(false),
  gdprConsentDate: timestamp('gdpr_consent_date', { withTimezone: true }),

  notes: text('notes'),
  isActive: boolean('is_active').notNull().default(true),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }),
  deletedAt: timestamp('deleted_at', { withTimezone: true }),
  createdBy: uuid('created_by').references(() => usersTable.id),
});

// CHECK constraints aplicate în migrarea SQL (Drizzle nu suportă CHECK inline per tabel):
// - type='individual' → first_name + last_name NOT NULL
// - type='company'    → company_name + cui NOT NULL
// - cnp: dacă prezent, lungime 13
// Validarea algoritmică CNP/CUI rămâne la nivel aplicație (nu e potrivită pentru CHECK simplu)
