import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import { DRIZZLE_DB, DrizzleDB } from '../../../database/database.module';
import { roomsTable } from '../../../database/schema';

@Injectable()
export class RoomsService {
  constructor(@Inject(DRIZZLE_DB) private readonly db: DrizzleDB) {}

  findAll() {
    return this.db
      .select()
      .from(roomsTable)
      .where(eq(roomsTable.isActive, true))
      .orderBy(roomsTable.name);
  }

  async findOneOrFail(id: string) {
    const [room] = await this.db
      .select()
      .from(roomsTable)
      .where(eq(roomsTable.id, id))
      .limit(1);

    if (!room) throw new NotFoundException(`Room ${id} not found`);
    return room;
  }
}
