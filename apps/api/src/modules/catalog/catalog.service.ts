import {
  Inject, Injectable, NotFoundException,
  ConflictException, BadRequestException, Logger,
} from '@nestjs/common';
import { eq, and, isNull, ilike, lte, gte, or, isNotNull, count, SQL, sql } from 'drizzle-orm';
import { DRIZZLE_DB, DrizzleDB }           from '../../database/database.module';
import { priceCatalogTable, procedureTemplatesTable, serviceCategoriesTable } from '../../database/schema';
import { withAuditContext, AuditContext }   from '../../common/helpers/audit.helper';
import { paginate }                         from '../../common/types/api-response.types';
import { CreatePriceCatalogDto }            from './dto/create-price-catalog.dto';
import { CreateProcedureTemplateDto }       from './dto/create-procedure-template.dto';
import { PartialType } from '@nestjs/mapped-types';

class UpdatePriceCatalogDto extends PartialType(CreatePriceCatalogDto) {}
class UpdateProcedureTemplateDto extends PartialType(CreateProcedureTemplateDto) {}

@Injectable()
export class CatalogService {
  private readonly logger = new Logger(CatalogService.name);

  constructor(@Inject(DRIZZLE_DB) private readonly db: DrizzleDB) {}

  // ---------------------------------------------------------------------------
  // Service categories
  // ---------------------------------------------------------------------------

  async findAllCategories() {
    return this.db
      .select()
      .from(serviceCategoriesTable)
      .where(eq(serviceCategoriesTable.isActive, true))
      .orderBy(serviceCategoriesTable.name);
  }

  // ---------------------------------------------------------------------------
  // Price catalog
  // ---------------------------------------------------------------------------

  async findAllPrices(params: {
    search?: string;
    serviceType?: string;
    categoryId?: string;
    isActive?: boolean;
    validOn?: string;
    page?: number;
    limit?: number;
  }) {
    const page  = params.page  ?? 1;
    const limit = params.limit ?? 50;

    const conditions: SQL[] = [];

    if (params.isActive !== undefined) conditions.push(eq(priceCatalogTable.isActive, params.isActive));
    if (params.serviceType)            conditions.push(eq(priceCatalogTable.serviceType, params.serviceType as never));
    if (params.categoryId)             conditions.push(eq(priceCatalogTable.categoryId, params.categoryId));
    if (params.search) {
      conditions.push(
        or(
          ilike(priceCatalogTable.name, `%${params.search}%`),
          ilike(priceCatalogTable.code, `%${params.search}%`),
        )!,
      );
    }
    if (params.validOn) {
      const d = params.validOn;
      conditions.push(lte(priceCatalogTable.validFrom, d));
      conditions.push(
        or(isNull(priceCatalogTable.validTo), gte(priceCatalogTable.validTo, d))!,
      );
    }

    const where = conditions.length ? and(...conditions) : undefined;

    const [{ value: total }] = await this.db
      .select({ value: count() })
      .from(priceCatalogTable)
      .where(where);

    const items = await this.db
      .select()
      .from(priceCatalogTable)
      .where(where)
      .orderBy(priceCatalogTable.code)
      .limit(limit)
      .offset((page - 1) * limit);

    return paginate(items, Number(total), page, limit);
  }

  async findPriceOrFail(id: string) {
    const [item] = await this.db
      .select()
      .from(priceCatalogTable)
      .where(eq(priceCatalogTable.id, id))
      .limit(1);
    if (!item) throw new NotFoundException(`Price catalog entry ${id} not found`);
    return item;
  }

  async createPrice(dto: CreatePriceCatalogDto, ctx: AuditContext) {
    const [existing] = await this.db
      .select({ id: priceCatalogTable.id })
      .from(priceCatalogTable)
      .where(eq(priceCatalogTable.code, dto.code))
      .limit(1);
    if (existing) throw new ConflictException(`Service code '${dto.code}' already exists`);

    const [created] = await withAuditContext(this.db, ctx, (tx) =>
      tx.insert(priceCatalogTable).values({
        code:                  dto.code,
        name:                  dto.name,
        description:           dto.description,
        categoryId:            dto.categoryId,
        serviceType:           dto.serviceType as never,
        basePrice:             dto.basePrice,
        vatRate:               dto.vatRate       ?? '9',
        directCostEstimate:    dto.directCostEstimate,
        minMarginPercent:      dto.minMarginPercent,
        estimatedDurationMin:  dto.estimatedDurationMin,
        isEmergencySurcharge:  dto.isEmergencySurcharge  ?? false,
        emergencyMultiplier:   dto.emergencyMultiplier   ?? '1.5',
        requiresApprovalAbove: dto.requiresApprovalAbove,
        isActive:              dto.isActive  ?? true,
        validFrom:             dto.validFrom ?? new Date().toISOString().slice(0, 10),
        validTo:               dto.validTo,
        updatedBy:             ctx.userId,
      }).returning(),
    );
    this.logger.log(`Price catalog entry created: ${created.code} by ${ctx.userId}`);
    return created;
  }

  async updatePrice(id: string, dto: UpdatePriceCatalogDto & Partial<CreatePriceCatalogDto>, ctx: AuditContext) {
    await this.findPriceOrFail(id);

    if (dto.validTo) {
      const current = await this.findPriceOrFail(id);
      if (dto.validTo < (current.validFrom as string)) {
        throw new BadRequestException('valid_to cannot be before valid_from');
      }
    }

    const [updated] = await withAuditContext(this.db, ctx, (tx) =>
      tx.update(priceCatalogTable).set({
        ...(dto.name                 !== undefined && { name:                 dto.name }),
        ...(dto.description          !== undefined && { description:          dto.description }),
        ...(dto.categoryId           !== undefined && { categoryId:           dto.categoryId }),
        ...(dto.serviceType          !== undefined && { serviceType:          dto.serviceType as never }),
        ...(dto.basePrice            !== undefined && { basePrice:            dto.basePrice }),
        ...(dto.vatRate              !== undefined && { vatRate:              dto.vatRate }),
        ...(dto.directCostEstimate   !== undefined && { directCostEstimate:   dto.directCostEstimate }),
        ...(dto.minMarginPercent     !== undefined && { minMarginPercent:     dto.minMarginPercent }),
        ...(dto.estimatedDurationMin !== undefined && { estimatedDurationMin: dto.estimatedDurationMin }),
        ...(dto.isEmergencySurcharge !== undefined && { isEmergencySurcharge: dto.isEmergencySurcharge }),
        ...(dto.emergencyMultiplier  !== undefined && { emergencyMultiplier:  dto.emergencyMultiplier }),
        ...(dto.requiresApprovalAbove !== undefined && { requiresApprovalAbove: dto.requiresApprovalAbove }),
        ...(dto.isActive             !== undefined && { isActive:             dto.isActive }),
        ...(dto.validFrom            !== undefined && { validFrom:            dto.validFrom }),
        ...(dto.validTo              !== undefined && { validTo:              dto.validTo }),
        updatedAt: new Date(),
        updatedBy: ctx.userId,
      }).where(eq(priceCatalogTable.id, id)).returning(),
    );
    return updated;
  }

  // ---------------------------------------------------------------------------
  // Procedure templates
  // ---------------------------------------------------------------------------

  async findAllTemplates(params: { isActive?: boolean; serviceId?: string }) {
    const conditions: SQL[] = [];
    if (params.isActive  !== undefined) conditions.push(eq(procedureTemplatesTable.isActive,  params.isActive));
    if (params.serviceId)               conditions.push(eq(procedureTemplatesTable.serviceId, params.serviceId));

    return this.db
      .select()
      .from(procedureTemplatesTable)
      .where(conditions.length ? and(...conditions) : undefined)
      .orderBy(procedureTemplatesTable.name);
  }

  async findTemplateOrFail(id: string) {
    const [t] = await this.db
      .select()
      .from(procedureTemplatesTable)
      .where(eq(procedureTemplatesTable.id, id))
      .limit(1);
    if (!t) throw new NotFoundException(`Procedure template ${id} not found`);
    return t;
  }

  async createTemplate(dto: CreateProcedureTemplateDto, ctx: AuditContext) {
    // Verify referenced service exists
    await this.findPriceOrFail(dto.serviceId);

    const [created] = await withAuditContext(this.db, ctx, (tx) =>
      tx.insert(procedureTemplatesTable).values({
        serviceId:           dto.serviceId,
        name:                dto.name,
        description:         dto.description,
        estimatedTimeMin:    dto.estimatedTimeMin,
        requiresAnesthesia:  dto.requiresAnesthesia  ?? false,
        requiresLab:         dto.requiresLab         ?? false,
        preProcedureNotes:   dto.preProcedureNotes,
        postProcedureNotes:  dto.postProcedureNotes,
        isActive:            dto.isActive ?? true,
      }).returning(),
    );
    return created;
  }

  async updateTemplate(id: string, dto: UpdateProcedureTemplateDto & Partial<CreateProcedureTemplateDto>, ctx: AuditContext) {
    await this.findTemplateOrFail(id);
    if (dto.serviceId) await this.findPriceOrFail(dto.serviceId);

    const [updated] = await withAuditContext(this.db, ctx, (tx) =>
      tx.update(procedureTemplatesTable).set({
        ...(dto.serviceId           !== undefined && { serviceId:           dto.serviceId }),
        ...(dto.name                !== undefined && { name:                dto.name }),
        ...(dto.description         !== undefined && { description:         dto.description }),
        ...(dto.estimatedTimeMin    !== undefined && { estimatedTimeMin:    dto.estimatedTimeMin }),
        ...(dto.requiresAnesthesia  !== undefined && { requiresAnesthesia:  dto.requiresAnesthesia }),
        ...(dto.requiresLab         !== undefined && { requiresLab:         dto.requiresLab }),
        ...(dto.preProcedureNotes   !== undefined && { preProcedureNotes:   dto.preProcedureNotes }),
        ...(dto.postProcedureNotes  !== undefined && { postProcedureNotes:  dto.postProcedureNotes }),
        ...(dto.isActive            !== undefined && { isActive:            dto.isActive }),
        updatedAt: new Date(),
      }).where(eq(procedureTemplatesTable.id, id)).returning(),
    );
    return updated;
  }
}
