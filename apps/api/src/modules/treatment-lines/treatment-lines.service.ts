import {
  Inject,
  Injectable,
  NotFoundException,
  BadRequestException,
  Logger,
} from '@nestjs/common';
import { eq, and, isNull, count, SQL } from 'drizzle-orm';
import { DRIZZLE_DB, DrizzleDB }                       from '../../database/database.module';
import { treatmentLinesTable, consultationsTable }      from '../../database/schema';
import { withAuditContext, AuditContext }               from '../../common/helpers/audit.helper';
import { paginate }                                     from '../../common/types/api-response.types';
import { CreateTreatmentLineDto }                       from './dto/create-treatment-line.dto';
import { UpdateTreatmentLineDto }                       from './dto/update-treatment-line.dto';
import { QueryTreatmentLinesDto }                       from './dto/query-treatment-lines.dto';

@Injectable()
export class TreatmentLinesService {
  private readonly logger = new Logger(TreatmentLinesService.name);

  constructor(@Inject(DRIZZLE_DB) private readonly db: DrizzleDB) {}

  // ---------------------------------------------------------------------------
  // Read
  // ---------------------------------------------------------------------------

  async findAll(query: QueryTreatmentLinesDto) {
    const page   = query.page  ?? 1;
    const limit  = query.limit ?? 50;
    const offset = (page - 1) * limit;

    const conditions: SQL[] = [isNull(treatmentLinesTable.deletedAt)];

    if (query.consultationId) conditions.push(eq(treatmentLinesTable.consultationId, query.consultationId));
    if (query.prescribedBy)   conditions.push(eq(treatmentLinesTable.prescribedBy,   query.prescribedBy));
    if (query.isBillable   !== undefined) conditions.push(eq(treatmentLinesTable.isBillable,  query.isBillable));
    if (query.isDispensed  !== undefined) conditions.push(eq(treatmentLinesTable.isDispensed, query.isDispensed));

    const where = and(...conditions);

    const [{ value: total }] = await this.db
      .select({ value: count() })
      .from(treatmentLinesTable)
      .where(where);

    const items = await this.db
      .select()
      .from(treatmentLinesTable)
      .where(where)
      .orderBy(treatmentLinesTable.createdAt)
      .limit(limit)
      .offset(offset);

    return paginate(items, Number(total), page, limit);
  }

  async findOneOrFail(id: string) {
    const [line] = await this.db
      .select()
      .from(treatmentLinesTable)
      .where(and(eq(treatmentLinesTable.id, id), isNull(treatmentLinesTable.deletedAt)))
      .limit(1);

    if (!line) throw new NotFoundException(`Treatment line ${id} not found`);
    return line;
  }

  // ---------------------------------------------------------------------------
  // Create
  // ---------------------------------------------------------------------------

  async create(dto: CreateTreatmentLineDto, ctx: AuditContext) {
    await this.assertConsultationEditable(dto.consultationId);

    const [created] = await withAuditContext(this.db, ctx, (tx) =>
      tx
        .insert(treatmentLinesTable)
        .values({
          consultationId:    dto.consultationId,
          inventoryItemId:   dto.inventoryItemId,
          prescribedBy:      dto.prescribedBy,
          administeredBy:    dto.administeredBy,
          productName:       dto.productName,
          dose:              dto.dose,
          frequency:         dto.frequency,
          route:             dto.route,
          durationDays:      dto.durationDays,
          startDate:         dto.startDate,
          endDate:           dto.endDate,
          quantityDispensed: dto.quantityDispensed,
          quantityUnit:      dto.quantityUnit,
          lotNumber:         dto.lotNumber,
          expiryDate:        dto.expiryDate,
          unitCost:          dto.unitCost,
          unitPrice:         dto.unitPrice,
          isBillable:        dto.isBillable  ?? true,
          isDispensed:       false,
          administeredAt:    dto.administeredAt ? new Date(dto.administeredAt) : undefined,
          notes:             dto.notes,
        })
        .returning(),
    );

    this.logger.log(`Treatment line created: ${created.id} on consultation ${dto.consultationId}`);
    return created;
  }

  // ---------------------------------------------------------------------------
  // Update
  // ---------------------------------------------------------------------------

  async update(
    id: string,
    dto: UpdateTreatmentLineDto & Partial<CreateTreatmentLineDto>,
    ctx: AuditContext,
  ) {
    const line = await this.findOneOrFail(id);

    // Dispensed lines are locked — stock already moved
    if (line.isDispensed) {
      throw new BadRequestException(
        `Treatment line ${id} has already been dispensed and cannot be edited. ` +
        `Create a correction entry instead.`,
      );
    }

    await this.assertConsultationEditable(line.consultationId);

    const [updated] = await withAuditContext(this.db, ctx, (tx) =>
      tx
        .update(treatmentLinesTable)
        .set({
          ...(dto.inventoryItemId   !== undefined && { inventoryItemId:   dto.inventoryItemId }),
          ...(dto.administeredBy    !== undefined && { administeredBy:    dto.administeredBy }),
          ...(dto.productName       !== undefined && { productName:       dto.productName }),
          ...(dto.dose              !== undefined && { dose:              dto.dose }),
          ...(dto.frequency         !== undefined && { frequency:         dto.frequency }),
          ...(dto.route             !== undefined && { route:             dto.route }),
          ...(dto.durationDays      !== undefined && { durationDays:      dto.durationDays }),
          ...(dto.startDate         !== undefined && { startDate:         dto.startDate }),
          ...(dto.endDate           !== undefined && { endDate:           dto.endDate }),
          ...(dto.quantityDispensed !== undefined && { quantityDispensed: dto.quantityDispensed }),
          ...(dto.quantityUnit      !== undefined && { quantityUnit:      dto.quantityUnit }),
          ...(dto.lotNumber         !== undefined && { lotNumber:         dto.lotNumber }),
          ...(dto.expiryDate        !== undefined && { expiryDate:        dto.expiryDate }),
          ...(dto.unitCost          !== undefined && { unitCost:          dto.unitCost }),
          ...(dto.unitPrice         !== undefined && { unitPrice:         dto.unitPrice }),
          ...(dto.isBillable        !== undefined && { isBillable:        dto.isBillable }),
          ...(dto.administeredAt    && { administeredAt: new Date(dto.administeredAt) }),
          ...(dto.notes             !== undefined && { notes:             dto.notes }),
          updatedAt: new Date(),
        })
        .where(eq(treatmentLinesTable.id, id))
        .returning(),
    );

    return updated;
  }

  // ---------------------------------------------------------------------------
  // Dispense — marks as physically given; triggers stock movement in Phase 2
  // ---------------------------------------------------------------------------

  async dispense(id: string, ctx: AuditContext) {
    const line = await this.findOneOrFail(id);

    if (line.isDispensed) {
      throw new BadRequestException(`Treatment line ${id} is already dispensed.`);
    }

    await this.assertConsultationEditable(line.consultationId);

    const [updated] = await withAuditContext(this.db, ctx, (tx) =>
      tx
        .update(treatmentLinesTable)
        .set({
          isDispensed:    true,
          administeredAt: line.administeredAt ?? new Date(),
          updatedAt:      new Date(),
        })
        .where(eq(treatmentLinesTable.id, id))
        .returning(),
    );

    // TODO Phase 2: emit StockMovementEvent for inventory deduction
    this.logger.log(`Treatment line ${id} dispensed by user ${ctx.userId}`);
    return updated;
  }

  // ---------------------------------------------------------------------------
  // Soft delete
  // ---------------------------------------------------------------------------

  async softDelete(id: string, ctx: AuditContext) {
    const line = await this.findOneOrFail(id);

    if (line.isDispensed) {
      throw new BadRequestException(
        `Dispensed treatment line ${id} cannot be deleted. It is part of the stock audit trail.`,
      );
    }

    await this.assertConsultationEditable(line.consultationId);

    await withAuditContext(this.db, ctx, (tx) =>
      tx
        .update(treatmentLinesTable)
        .set({ deletedAt: new Date(), updatedAt: new Date() })
        .where(eq(treatmentLinesTable.id, id)),
    );

    this.logger.log(`Treatment line ${id} soft-deleted by user ${ctx.userId}`);
  }

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

  private async assertConsultationEditable(consultationId: string): Promise<void> {
    const [cons] = await this.db
      .select({ status: consultationsTable.status })
      .from(consultationsTable)
      .where(eq(consultationsTable.id, consultationId))
      .limit(1);

    if (!cons) throw new NotFoundException(`Consultation ${consultationId} not found`);

    if (cons.status === 'completed' || cons.status === 'cancelled') {
      throw new BadRequestException(
        `Cannot modify treatment lines on a '${cons.status}' consultation.`,
      );
    }
  }
}
