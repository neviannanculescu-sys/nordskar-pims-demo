import { pgTable, uuid, varchar, boolean } from 'drizzle-orm/pg-core';

export const serviceCategoriesTable = pgTable('service_categories', {
  id:       uuid('id').primaryKey().defaultRandom(),
  name:     varchar('name', { length: 100 }).notNull(),
  // Self-referential: NULL = root category
  parentId: uuid('parent_id'),
  color:    varchar('color', { length: 7 }),
  isActive: boolean('is_active').notNull().default(true),
});
// FK self-reference and CHECK (color format) in migration SQL
