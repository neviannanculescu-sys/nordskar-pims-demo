import { Inject, Injectable } from '@nestjs/common';
import { eq, and, isNull } from 'drizzle-orm';
import { DRIZZLE_DB, DrizzleDB } from '../../database/database.module';
import { usersTable } from '../../database/schema';

@Injectable()
export class UsersService {
  constructor(@Inject(DRIZZLE_DB) private readonly db: DrizzleDB) {}

  async findByEmail(email: string) {
    const [user] = await this.db
      .select()
      .from(usersTable)
      .where(and(eq(usersTable.email, email), isNull(usersTable.deletedAt)))
      .limit(1);
    return user ?? null;
  }

  async findActiveById(id: string) {
    const [user] = await this.db
      .select()
      .from(usersTable)
      .where(
        and(
          eq(usersTable.id, id),
          eq(usersTable.isActive, true),
          isNull(usersTable.deletedAt),
        ),
      )
      .limit(1);
    return user ?? null;
  }

  async updateLastLogin(id: string): Promise<void> {
    await this.db
      .update(usersTable)
      .set({ lastLoginAt: new Date() })
      .where(eq(usersTable.id, id));
  }
}
