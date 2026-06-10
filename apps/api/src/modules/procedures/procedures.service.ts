import {
  Inject,
  Injectable,
  NotFoundException,
  BadRequestException,
  Logger,
} from '@nestjs/common';
import { eq, and, isNull, gte, lte, count, SQL } from 'drizzle-orm';
import { DRIZZLE_DB, DrizzleDB }           from '../../database/database.module';
import { proceduresTable, consultationsTable } from '../../database/schema';
import { withAuditContext, AuditContext }   from '../../common/helpers/audit.helper';
import { paginate }                         from '../../common/types/api-response.types';
import { CreateProcedureDto }               from './dto/create-procedure.dto';
import { UpdateProcedureDto }               from './dto/update-procedure.dto';
import { QueryProceduresDto }               from './dto/query-procedures.dto';

@Injectable()
export class ProceduresService {
  private readonly logger = new Logger(ProceduresService.name);

  constructor(@Inject(DRIZZLE_DB) private readonly db: DrizzleDB) {}

  // ---------------------------------------------------------------------------
  // Read
  // ---------------------------------------------------------------------------

  async findAll(query: QueryProceduresDto) {
    const page   = query.page  ?? 1;
    const limit  = query.limit ?? 50;
    const offset = (page - 1) * limit;

    const conditions: SQL[] = [isNull(proceduresTable.deletedAt)];

    if (query.consultationId)  conditions.push(eq(proceduresTable.consultationId,  query.consultationId));
    if (query.veterinarianId)  conditions.push(eq(proceduresTable.veterinarianId,  query.veterinarianId));
    if (query.isBillable !== undefined) conditions.push(eq(proceduresTable.isBillable, query.isBillable));
    if (query.dateFrom)        conditions.push(gte(proceduresTable.performedAt, new Date(query.dateFrom)));
    if (query.dateTo)          conditions.push(lte(proceduresTable.performedAt, new Date(query.dateTo)));

    const where = and(...conditions);

    const [{ value: total }] = await this.db
      .select({ value: count() })
      .from(proceduresTable)
      .where(where);

    const items = await this.db
      .select()
      .from(proceduresTable)
      .where(where)
      .orderBy(proceduresTable.performedAt)
      .limit(limit)
      .offset(offset);

    return paginate(items, Number(total), page, limit);
  }

  async findOneOrFail(id: string) {
    const [proc] = await this.db
      .select()
      .from(proceduresTable)
      .where(and(eq(proceduresTable.id, id), isNull(proceduresTable.deletedAt)))
      .limit(1);

    if (!proc) throw new NotFoundException(`Procedure ${id} not found`);
    return proc;
  }

  // ---------------------------------------------------------------------------
  // Create
  // ---------------------------------------------------------------------------

  async create(dto: CreateProcedureDto, ctx: AuditContext) {
    await this.assertConsultationEditable(dto.consultationId);

    const [created] = await withAuditContext(this.db, ctx, (tx) =>
      tx
        .insert(proceduresTable)
        .values({
          consultationId:     dto.consultationId,
          procedureTemplateId: dto.procedureTemplateId,
          veterinarianId:     dto.veterinarianId,
          performedAt:        new Date(dto.performedAt),
          name:               dto.name,
          description:        dto.description,
          quantity:           dto.quantity    ?? '1',
          unit:               dto.unit,
          unitPrice:          dto.unitPrice,
          costDirect:         dto.costDirect,
          isBillable:         dto.isBillable  ?? true,
          notes:              dto.notes,
        })
        .returning(),
    );

    this.logger.log(`Procedure created: ${created.id} on consultation ${dto.consultationId}`);
    return created;
  }

  // ---------------------------------------------------------------------------
  // Update
  // ---------------------------------------------------------------------------

  async update(id: string, dto: UpdateProcedureDto & Partial<CreateProcedureDto>, ctx: AuditContext) {
    const proc = await this.findOneOrFail(id);
    await this.assertConsultationEditable(proc.consultationId);

    const [updated] = await withAuditContext(this.db, ctx, (tx) =>
      tx
        .update(proceduresTable)
        .set({
          ...(dto.veterinarianId      !== undefined && { veterinarianId:      dto.veterinarianId }),
          ...(dto.procedureTemplateId !== undefined && { procedureTemplateId: dto.procedureTemplateId }),
          ...(dto.performedAt         && { performedAt:  new Date(dto.performedAt) }),
          ...(dto.name                !== undefined && { name:        dto.name }),
          ...(dto.description         !== undefined && { description: dto.description }),
          ...(dto.quantity            !== undefined && { quantity:    dto.quantity }),
          ...(dto.unit                !== undefined && { unit:        dto.unit }),
          ...(dto.unitPrice           !== undefined && { unitPrice:   dto.unitPrice }),
          ...(dto.costDirect          !== undefined && { costDirect:  dto.costDirect }),
          ...(dto.isBillable          !== undefined && { isBillable:  dto.isBillable }),
          ...(dto.notes               !== undefined && { notes:       dto.notes }),
          updatedAt: new Date(),
        })
        .where(eq(proceduresTable.id, id))
        .returning(),
    );

    return updated;
  }

  // ---------------------------------------------------------------------------
  // Soft delete
  // ---------------------------------------------------------------------------

  async softDelete(id: string, ctx: AuditContext) {
    const proc = await this.findOneOrFail(id);
    await this.assertConsultationEditable(proc.consultationId);

    await withAuditContext(this.db, ctx, (tx) =>
      tx
        .update(proceduresTable)
        .set({ deletedAt: new Date(), updatedAt: new Date() })
        .where(eq(proceduresTable.id, id)),
    );

    this.logger.log(`Procedure ${id} soft-deleted by user ${ctx.userId}`);
  }

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

  /**
   * Procedures cannot be added/edited/deleted on a completed or cancelled
   * consultation — the medical record is sealed.
   */
  private async assertConsultationEditable(consultationId: string): Promise<void> {
    const [cons] = await this.db
      .select({ status: consultationsTable.status })
      .from(consultationsTable)
      .where(eq(consultationsTable.id, consultationId))
      .limit(1);

    if (!cons) throw new NotFoundException(`Consultation ${consultationId} not found`);

    if (cons.status === 'completed' || cons.status === 'cancelled') {
      throw new BadRequestException(
        `Cannot modify procedures on a '${cons.status}' consultation.`,
      );
    }
  }
}
