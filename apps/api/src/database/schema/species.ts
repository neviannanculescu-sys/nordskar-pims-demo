import { pgTable, uuid, varchar, boolean } from 'drizzle-orm/pg-core';

export const speciesTable = pgTable('species', {
  id: uuid('id').primaryKey().defaultRandom(),
  nameRo: varchar('name_ro', { length: 100 }).notNull(),
  nameEn: varchar('name_en', { length: 100 }),
  isActive: boolean('is_active').notNull().default(true),
});
