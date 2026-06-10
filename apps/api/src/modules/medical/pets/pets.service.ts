import {
  Inject,
  Injectable,
  NotFoundException,
  ConflictException,
  Logger,
} from '@nestjs/common';
import { eq, and, isNull, isNotNull, count, SQL } from 'drizzle-orm';
import { DRIZZLE_DB, DrizzleDB } from '../../../database/database.module';
import { petsTable, ownersTable } from '../../../database/schema';
import { withAuditContext, AuditContext } from '../../../common/helpers/audit.helper';
import { CreatePetDto } from './dto/create-pet.dto';
import { UpdatePetDto } from './dto/update-pet.dto';
import { QueryPetsDto } from './dto/query-pets.dto';
import { paginate } from '../../../common/types/api-response.types';

@Injectable()
export class PetsService {
  private readonly logger = new Logger(PetsService.name);

  constructor(@Inject(DRIZZLE_DB) private readonly db: DrizzleDB) {}

  async findByOwner(ownerId: string, query: QueryPetsDto) {
    const page   = query.page  ?? 1;
    const limit  = query.limit ?? 20;
    const offset = (page - 1) * limit;

    const conditions: SQL[] = [
      eq(petsTable.ownerId, ownerId),
      isNull(petsTable.deletedAt),
    ];

    if (query.speciesId) {
      conditions.push(eq(petsTable.speciesId, query.speciesId));
    }
    if (query.activeOnly !== false) {
      conditions.push(eq(petsTable.isActive, true));
    }

    const where = and(...conditions);

    const [{ value: total }] = await this.db
      .select({ value: count() })
      .from(petsTable)
      .where(where);

    const items = await this.db
      .select()
      .from(petsTable)
      .where(where)
      .orderBy(petsTable.createdAt)
      .limit(limit)
      .offset(offset);

    return paginate(items, Number(total), page, limit);
  }

  async findOneOrFail(id: string) {
    const [pet] = await this.db
      .select()
      .from(petsTable)
      .where(and(eq(petsTable.id, id), isNull(petsTable.deletedAt)))
      .limit(1);

    if (!pet) {
      throw new NotFoundException(`Pet ${id} not found`);
    }
    return pet;
  }

  async create(ownerId: string, dto: CreatePetDto, ctx: AuditContext) {
    // Verify owner exists and is not deleted
    const [owner] = await this.db
      .select({ id: ownersTable.id })
      .from(ownersTable)
      .where(and(eq(ownersTable.id, ownerId), isNull(ownersTable.deletedAt)))
      .limit(1);

    if (!owner) {
      throw new NotFoundException(`Owner ${ownerId} not found`);
    }

    // Chip number uniqueness check
    if (dto.chipNumber) {
      const [existing] = await this.db
        .select({ id: petsTable.id })
        .from(petsTable)
        .where(
          and(
            eq(petsTable.chipNumber, dto.chipNumber),
            isNull(petsTable.deletedAt),
          ),
        )
        .limit(1);

      if (existing) {
        throw new ConflictException(
          `Chip number ${dto.chipNumber} is already registered (pet id: ${existing.id})`,
        );
      }
    }

    const [created] = await withAuditContext(this.db, ctx, (tx) =>
      tx
        .insert(petsTable)
        .values({
          ownerId,
          name:              dto.name,
          speciesId:         dto.speciesId,
          breedId:           dto.breedId,
          gender:            dto.gender,
          isNeutered:        dto.isNeutered,
          dateOfBirth:       dto.dateOfBirth,
          approximateAge:    dto.approximateAge,
          color:             dto.color,
          markings:          dto.markings,
          chipNumber:        dto.chipNumber,
          tattoo:            dto.tattoo,
          passportNumber:    dto.passportNumber,
          weightKg:          dto.weightKg?.toString(),
          notes:             dto.notes,
          allergies:         dto.allergies,
          chronicConditions: dto.chronicConditions,
        })
        .returning(),
    );

    this.logger.log(`Pet created: ${created.id} for owner ${ownerId} by user ${ctx.userId}`);
    return created;
  }

  async update(id: string, dto: UpdatePetDto & Partial<CreatePetDto>, ctx: AuditContext) {
    await this.findOneOrFail(id);

    const [updated] = await withAuditContext(this.db, ctx, (tx) =>
      tx
        .update(petsTable)
        .set({
          ...(dto.name              !== undefined && { name:              dto.name }),
          ...(dto.speciesId         !== undefined && { speciesId:         dto.speciesId }),
          ...(dto.breedId           !== undefined && { breedId:           dto.breedId }),
          ...(dto.gender            !== undefined && { gender:            dto.gender }),
          ...(dto.isNeutered        !== undefined && { isNeutered:        dto.isNeutered }),
          ...(dto.dateOfBirth       !== undefined && { dateOfBirth:       dto.dateOfBirth }),
          ...(dto.approximateAge    !== undefined && { approximateAge:    dto.approximateAge }),
          ...(dto.color             !== undefined && { color:             dto.color }),
          ...(dto.markings          !== undefined && { markings:          dto.markings }),
          ...(dto.chipNumber        !== undefined && { chipNumber:        dto.chipNumber }),
          ...(dto.tattoo            !== undefined && { tattoo:            dto.tattoo }),
          ...(dto.passportNumber    !== undefined && { passportNumber:    dto.passportNumber }),
          ...(dto.weightKg          !== undefined && { weightKg:          dto.weightKg?.toString() }),
          ...(dto.notes             !== undefined && { notes:             dto.notes }),
          ...(dto.allergies         !== undefined && { allergies:         dto.allergies }),
          ...(dto.chronicConditions !== undefined && { chronicConditions: dto.chronicConditions }),
          ...(dto.isDeceased        !== undefined && { isDeceased:        dto.isDeceased }),
          ...(dto.deceasedDate      !== undefined && { deceasedDate:      dto.deceasedDate }),
          updatedAt: new Date(),
        })
        .where(eq(petsTable.id, id))
        .returning(),
    );

    return updated;
  }

  async softDelete(id: string, ctx: AuditContext): Promise<void> {
    await this.findOneOrFail(id);

    await withAuditContext(this.db, ctx, (tx) =>
      tx
        .update(petsTable)
        .set({ deletedAt: new Date(), isActive: false, updatedAt: new Date() })
        .where(eq(petsTable.id, id)),
    );

    this.logger.log(`Pet ${id} soft-deleted by user ${ctx.userId}`);
  }
}
