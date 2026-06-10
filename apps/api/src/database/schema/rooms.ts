import { pgTable, uuid, varchar, boolean, text, timestamp } from 'drizzle-orm/pg-core';
import { roomTypeEnum } from './enums';

// Rooms nu are deleted_at — e tabel de configurare, is_active este suficient
export const roomsTable = pgTable('rooms', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: varchar('name', { length: 100 }).notNull().unique(),
  roomType: roomTypeEnum('room_type').notNull().default('consultation'),
  floor: varchar('floor', { length: 20 }),
  notes: text('notes'),
  isActive: boolean('is_active').notNull().default(true),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});
