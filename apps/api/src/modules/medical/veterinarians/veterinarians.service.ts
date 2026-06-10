import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { and, eq, isNull } from 'drizzle-orm';
import { DRIZZLE_DB, DrizzleDB } from '../../../database/database.module';
import { veterinariansTable } from '../../../database/schema';

@Injectable()
export class VeterinariansService {
  constructor(@Inject(DRIZZLE_DB) private readonly db: DrizzleDB) {}

  findAll() {
    return this.db
      .select()
      .from(veterinariansTable)
      .where(
        and(
          eq(veterinariansTable.isAvailable, true),
          isNull(veterinariansTable.deletedAt),
        ),
      )
      .orderBy(veterinariansTable.lastName);
  }

  async findOneOrFail(id: string) {
    const [vet] = await this.db
      .select()
      .from(veterinariansTable)
      .where(
        and(eq(veterinariansTable.id, id), isNull(veterinariansTable.deletedAt)),
      )
      .limit(1);

    if (!vet) throw new NotFoundException(`Veterinarian ${id} not found`);
    return vet;
  }
}
