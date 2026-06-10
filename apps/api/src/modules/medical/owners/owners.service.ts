import {
  Inject,
  Injectable,
  NotFoundException,
  ConflictException,
  Logger,
} from '@nestjs/common';
import { eq, and, isNull, ilike, or, count, SQL } from 'drizzle-orm';
import { DRIZZLE_DB, DrizzleDB } from '../../../database/database.module';
import { ownersTable } from '../../../database/schema';
import { withAuditContext, AuditContext } from '../../../common/helpers/audit.helper';
import { CreateOwnerDto } from './dto/create-owner.dto';
import { UpdateOwnerDto } from './dto/update-owner.dto';
import { QueryOwnersDto } from './dto/query-owners.dto';
import { paginate } from '../../../common/types/api-response.types';

@Injectable()
export class OwnersService {
  private readonly logger = new Logger(OwnersService.name);

  constructor(@Inject(DRIZZLE_DB) private readonly db: DrizzleDB) {}

  async findAll(query: QueryOwnersDto) {
    const page  = query.page  ?? 1;
    const limit = query.limit ?? 20;
    const offset = (page - 1) * limit;

    const conditions: SQL[] = [isNull(ownersTable.deletedAt)];

    if (query.type) {
      conditions.push(eq(ownersTable.type, query.type));
    }

    if (query.search) {
      const term = `%${query.search}%`;
      conditions.push(
        or(
          ilike(ownersTable.firstName,   term),
          ilike(ownersTable.lastName,    term),
          ilike(ownersTable.companyName, term),
          ilike(ownersTable.phonePrimary, term),
          ilike(ownersTable.email,       term),
        ) as SQL,
      );
    }

    const where = and(...conditions);

    const [{ value: total }] = await this.db
      .select({ value: count() })
      .from(ownersTable)
      .where(where);

    const items = await this.db
      .select()
      .from(ownersTable)
      .where(where)
      .orderBy(ownersTable.createdAt)
      .limit(limit)
      .offset(offset);

    return paginate(items, Number(total), page, limit);
  }

  async findOneOrFail(id: string) {
    const [owner] = await this.db
      .select()
      .from(ownersTable)
      .where(and(eq(ownersTable.id, id), isNull(ownersTable.deletedAt)))
      .limit(1);

    if (!owner) {
      throw new NotFoundException(`Owner ${id} not found`);
    }
    return owner;
  }

  async create(dto: CreateOwnerDto, ctx: AuditContext) {
    // Duplicate phone check
    const [existing] = await this.db
      .select({ id: ownersTable.id })
      .from(ownersTable)
      .where(
        and(
          eq(ownersTable.phonePrimary, dto.phonePrimary),
          isNull(ownersTable.deletedAt),
        ),
      )
      .limit(1);

    if (existing) {
      throw new ConflictException(
        `An owner with phone ${dto.phonePrimary} already exists (id: ${existing.id})`,
      );
    }

    const [created] = await withAuditContext(this.db, ctx, (tx) =>
      tx
        .insert(ownersTable)
        .values({
          type:             dto.type,
          firstName:        dto.firstName,
          lastName:         dto.lastName,
          cnp:              dto.cnp,
          companyName:      dto.companyName,
          cui:              dto.cui,
          vatPayer:         dto.vatPayer ?? false,
          addressStreet:    dto.addressStreet,
          addressCity:      dto.addressCity,
          addressCounty:    dto.addressCounty,
          addressZip:       dto.addressZip,
          addressCountry:   dto.addressCountry ?? 'RO',
          phonePrimary:     dto.phonePrimary,
          phoneSecondary:   dto.phoneSecondary,
          email:            dto.email,
          whatsapp:         dto.whatsapp,
          preferredChannel: dto.preferredChannel,
          gdprConsent:      dto.gdprConsent,
          gdprConsentDate:  dto.gdprConsent ? new Date() : null,
          notes:            dto.notes,
          createdBy:        ctx.userId,
        })
        .returning(),
    );

    this.logger.log(`Owner created: ${created.id} by user ${ctx.userId}`);
    return created;
  }

  async update(id: string, dto: UpdateOwnerDto & Partial<CreateOwnerDto>, ctx: AuditContext) {
    await this.findOneOrFail(id);

    const [updated] = await withAuditContext(this.db, ctx, (tx) =>
      tx
        .update(ownersTable)
        .set({
          ...(dto.firstName        !== undefined && { firstName:        dto.firstName }),
          ...(dto.lastName         !== undefined && { lastName:         dto.lastName }),
          ...(dto.companyName      !== undefined && { companyName:      dto.companyName }),
          ...(dto.cui              !== undefined && { cui:              dto.cui }),
          ...(dto.vatPayer         !== undefined && { vatPayer:         dto.vatPayer }),
          ...(dto.addressStreet    !== undefined && { addressStreet:    dto.addressStreet }),
          ...(dto.addressCity      !== undefined && { addressCity:      dto.addressCity }),
          ...(dto.addressCounty    !== undefined && { addressCounty:    dto.addressCounty }),
          ...(dto.addressZip       !== undefined && { addressZip:       dto.addressZip }),
          ...(dto.addressCountry   !== undefined && { addressCountry:   dto.addressCountry }),
          ...(dto.phonePrimary     !== undefined && { phonePrimary:     dto.phonePrimary }),
          ...(dto.phoneSecondary   !== undefined && { phoneSecondary:   dto.phoneSecondary }),
          ...(dto.email            !== undefined && { email:            dto.email }),
          ...(dto.whatsapp         !== undefined && { whatsapp:         dto.whatsapp }),
          ...(dto.preferredChannel !== undefined && { preferredChannel: dto.preferredChannel }),
          ...(dto.notes            !== undefined && { notes:            dto.notes }),
          ...(dto.gdprConsent      !== undefined && {
            gdprConsent:     dto.gdprConsent,
            gdprConsentDate: dto.gdprConsent ? new Date() : null,
          }),
          updatedAt: new Date(),
        })
        .where(eq(ownersTable.id, id))
        .returning(),
    );

    return updated;
  }

  async softDelete(id: string, ctx: AuditContext): Promise<void> {
    await this.findOneOrFail(id);

    await withAuditContext(this.db, ctx, (tx) =>
      tx
        .update(ownersTable)
        .set({ deletedAt: new Date(), isActive: false, updatedAt: new Date() })
        .where(eq(ownersTable.id, id)),
    );

    this.logger.log(`Owner ${id} soft-deleted by user ${ctx.userId}`);
  }
}
