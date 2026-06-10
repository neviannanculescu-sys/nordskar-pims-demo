import { pgTable, uuid, varchar, boolean, unique } from 'drizzle-orm/pg-core';
import { speciesTable } from './species';

export const breedsTable = pgTable(
  'breeds',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    speciesId: uuid('species_id').notNull().references(() => speciesTable.id),
    name: varchar('name', { length: 150 }).notNull(),
    isActive: boolean('is_active').notNull().default(true),
  },
  (table) => ({
    uniqueSpeciesName: unique('uq_breeds_species_name').on(table.speciesId, table.name),
  }),
);
