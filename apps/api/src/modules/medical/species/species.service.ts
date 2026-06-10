import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import { DRIZZLE_DB, DrizzleDB } from '../../../database/database.module';
import { speciesTable, breedsTable } from '../../../database/schema';

@Injectable()
export class SpeciesService {
  constructor(@Inject(DRIZZLE_DB) private readonly db: DrizzleDB) {}

  findAll() {
    return this.db
      .select()
      .from(speciesTable)
      .where(eq(speciesTable.isActive, true))
      .orderBy(speciesTable.nameRo);
  }

  async findOneOrFail(id: string) {
    const [species] = await this.db
      .select()
      .from(speciesTable)
      .where(eq(speciesTable.id, id))
      .limit(1);

    if (!species) throw new NotFoundException(`Species ${id} not found`);
    return species;
  }

  async findBreedsBySpecies(speciesId: string) {
    await this.findOneOrFail(speciesId);

    return this.db
      .select()
      .from(breedsTable)
      .where(eq(breedsTable.speciesId, speciesId))
      .orderBy(breedsTable.name);
  }
}
