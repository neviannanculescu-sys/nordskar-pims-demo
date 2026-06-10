import {
  Inject,
  Injectable,
  NotFoundException,
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Logger,
} from '@nestjs/common';
import {
  eq,
  and,
  isNull,
  gte,
  lte,
  count,
  SQL,
} from 'drizzle-orm';
import { DRIZZLE_DB, DrizzleDB } from '../../database/database.module';
import { consultationsTable, veterinariansTable, appointmentsTable } from '../../database/schema';
import { withAuditContext, AuditContext } from '../../common/helpers/audit.helper';
import { paginate } from '../../common/types/api-response.types';
import { UserRole } from '../../common/constants/roles.constants';
import { CreateConsultationDto } from './dto/create-consultation.dto';
import { UpdateConsultationDto } from './dto/update-consultation.dto';
import { QueryConsultationsDto, ConsultationStatus } from './dto/query-consultations.dto';

// ---------------------------------------------------------------------------
// Rules
// ---------------------------------------------------------------------------

/** Statuses that lock a consultation against any field edits */
const IMMUTABLE_STATUSES: ConsultationStatus[] = [
  ConsultationStatus.COMPLETED,
  ConsultationStatus.CANCELLED,
];

/**
 * Appointment type → Consultation type mapping.
 * Used during autopopulation when appointmentId is provided.
 */
const APPT_TYPE_TO_CONSULT_TYPE: Record<string, string> = {
  routine:         'routine',
  emergency:       'emergency',
  followup:        'followup',
  surgery:         'routine',    // surgery is an appointment category; consultation type stays routine
  hospitalization: 'routine',
  vaccination:     'routine',
  other:           'routine',
};

@Injectable()
export class ConsultationsService {
  private readonly logger = new Logger(ConsultationsService.name);

  constructor(@Inject(DRIZZLE_DB) private readonly db: DrizzleDB) {}

  // ---------------------------------------------------------------------------
  // Read
  // ---------------------------------------------------------------------------

  async findAll(query: QueryConsultationsDto) {
    const page   = query.page  ?? 1;
    const limit  = query.limit ?? 50;
    const offset = (page - 1) * limit;

    const conditions: SQL[] = [isNull(consultationsTable.deletedAt)];

    if (query.petId)          conditions.push(eq(consultationsTable.petId,          query.petId));
    if (query.ownerId)        conditions.push(eq(consultationsTable.ownerId,        query.ownerId));
    if (query.veterinarianId) conditions.push(eq(consultationsTable.veterinarianId, query.veterinarianId));
    if (query.status)         conditions.push(eq(consultationsTable.status,         query.status));
    if (query.type)           conditions.push(eq(consultationsTable.type,           query.type));
    if (query.dateFrom)       conditions.push(gte(consultationsTable.consultationDate, new Date(query.dateFrom)));
    if (query.dateTo)         conditions.push(lte(consultationsTable.consultationDate, new Date(query.dateTo)));

    const where = and(...conditions);

    const [{ value: total }] = await this.db
      .select({ value: count() })
      .from(consultationsTable)
      .where(where);

    const items = await this.db
      .select()
      .from(consultationsTable)
      .where(where)
      .orderBy(consultationsTable.consultationDate)
      .limit(limit)
      .offset(offset);

    return paginate(items, Number(total), page, limit);
  }

  async findOneOrFail(id: string) {
    const [consultation] = await this.db
      .select()
      .from(consultationsTable)
      .where(and(eq(consultationsTable.id, id), isNull(consultationsTable.deletedAt)))
      .limit(1);

    if (!consultation) throw new NotFoundException(`Consultation ${id} not found`);
    return consultation;
  }

  // ---------------------------------------------------------------------------
  // Create
  // ---------------------------------------------------------------------------

  async create(dto: CreateConsultationDto, ctx: AuditContext) {
    // Autopopulate fields from the linked appointment when appointmentId is present
    const resolved = await this.resolveFromAppointment(dto);

    // Ensure uniqueness: one active consultation per appointment
    if (resolved.appointmentId) {
      const [existing] = await this.db
        .select({ id: consultationsTable.id })
        .from(consultationsTable)
        .where(
          and(
            eq(consultationsTable.appointmentId, resolved.appointmentId),
            isNull(consultationsTable.deletedAt),
          ),
        )
        .limit(1);

      if (existing) {
        throw new ConflictException(
          `A consultation already exists for appointment ${resolved.appointmentId} (id: ${existing.id})`,
        );
      }
    }

    const [created] = await withAuditContext(this.db, ctx, (tx) =>
      tx
        .insert(consultationsTable)
        .values({
          appointmentId:      resolved.appointmentId,
          petId:              resolved.petId,
          ownerId:            resolved.ownerId,
          veterinarianId:     resolved.veterinarianId,
          consultationDate:   new Date(resolved.consultationDate),
          type:               resolved.type as never,
          chiefComplaint:     resolved.chiefComplaint,
          history:            resolved.history,
          weightKg:           resolved.weightKg,
          temperatureC:       resolved.temperatureC,
          heartRate:          resolved.heartRate,
          respiratoryRate:    resolved.respiratoryRate,
          clinicalFindings:   resolved.clinicalFindings,
          diagnosisPrimary:   resolved.diagnosisPrimary,
          diagnosisSecondary: resolved.diagnosisSecondary,
          prognosis:          resolved.prognosis,
          treatmentPlan:      resolved.treatmentPlan,
          dischargeNotes:     resolved.dischargeNotes,
          followUpDate:       resolved.followUpDate,
          followUpNotes:      resolved.followUpNotes,
          startedAt:          resolved.startedAt ? new Date(resolved.startedAt) : undefined,
          endedAt:            resolved.endedAt   ? new Date(resolved.endedAt)   : undefined,
          status:             'open',
        })
        .returning(),
    );

    this.logger.log(`Consultation created: ${created.id} for pet ${resolved.petId} by user ${ctx.userId}`);
    return created;
  }

  // ---------------------------------------------------------------------------
  // Update — only while status = 'open'
  // ---------------------------------------------------------------------------

  async update(id: string, dto: UpdateConsultationDto & Partial<CreateConsultationDto>, ctx: AuditContext) {
    const consultation = await this.findOneOrFail(id);

    if (IMMUTABLE_STATUSES.includes(consultation.status as ConsultationStatus)) {
      throw new BadRequestException(
        `Consultation status '${consultation.status}' is immutable. ` +
        `Only open consultations can be edited.`,
      );
    }

    const [updated] = await withAuditContext(this.db, ctx, (tx) =>
      tx
        .update(consultationsTable)
        .set({
          ...(dto.consultationDate   && { consultationDate:   new Date(dto.consultationDate) }),
          ...(dto.type               !== undefined && { type:               dto.type }),
          ...(dto.chiefComplaint     !== undefined && { chiefComplaint:     dto.chiefComplaint }),
          ...(dto.history            !== undefined && { history:            dto.history }),
          ...(dto.weightKg           !== undefined && { weightKg:           dto.weightKg }),
          ...(dto.temperatureC       !== undefined && { temperatureC:       dto.temperatureC }),
          ...(dto.heartRate          !== undefined && { heartRate:          dto.heartRate }),
          ...(dto.respiratoryRate    !== undefined && { respiratoryRate:    dto.respiratoryRate }),
          ...(dto.clinicalFindings   !== undefined && { clinicalFindings:   dto.clinicalFindings }),
          ...(dto.diagnosisPrimary   !== undefined && { diagnosisPrimary:   dto.diagnosisPrimary }),
          ...(dto.diagnosisSecondary !== undefined && { diagnosisSecondary: dto.diagnosisSecondary }),
          ...(dto.prognosis          !== undefined && { prognosis:          dto.prognosis }),
          ...(dto.treatmentPlan      !== undefined && { treatmentPlan:      dto.treatmentPlan }),
          ...(dto.dischargeNotes     !== undefined && { dischargeNotes:     dto.dischargeNotes }),
          ...(dto.followUpDate       !== undefined && { followUpDate:       dto.followUpDate }),
          ...(dto.followUpNotes      !== undefined && { followUpNotes:      dto.followUpNotes }),
          ...(dto.startedAt && { startedAt: new Date(dto.startedAt) }),
          ...(dto.endedAt   && { endedAt:   new Date(dto.endedAt) }),
          updatedAt: new Date(),
        })
        .where(eq(consultationsTable.id, id))
        .returning(),
    );

    return updated;
  }

  // ---------------------------------------------------------------------------
  // Complete — signs + seals the consultation
  //
  // Authorization rules:
  //   - Only VET_DOCTOR and ADMIN may call this (enforced by @Roles in controller).
  //   - For VET_DOCTOR: we resolve their veterinarian record from userId and use
  //     that as signedBy — a doctor can only sign with their own parafă.
  //   - For ADMIN: they must supply an explicit veterinarianId via the body because
  //     admins are not necessarily veterinarians. The controller passes this through.
  //     If not supplied, the operation is rejected — a consultation cannot be sealed
  //     without an identified signing veterinarian.
  // ---------------------------------------------------------------------------

  async complete(
    id:              string,
    actorUserId:     string,
    actorRole:       UserRole,
    ctx:             AuditContext,
    signingVetId?:   string,   // required when actorRole = ADMIN; derived automatically for VET_DOCTOR
  ) {
    const consultation = await this.findOneOrFail(id);

    if (consultation.status !== 'open') {
      throw new BadRequestException(
        `Cannot complete consultation with status '${consultation.status}'.`,
      );
    }

    if (!consultation.chiefComplaint || !consultation.diagnosisPrimary) {
      throw new BadRequestException(
        'Consultation must have chiefComplaint and diagnosisPrimary before completing.',
      );
    }

    let resolvedVetId: string;

    if (actorRole === UserRole.VET_DOCTOR) {
      // Resolve veterinarian record from the JWT subject (user.id → vet.id)
      const [vet] = await this.db
        .select({ id: veterinariansTable.id })
        .from(veterinariansTable)
        .where(eq(veterinariansTable.userId, actorUserId))
        .limit(1);

      if (!vet) {
        throw new ForbiddenException(
          `User ${actorUserId} has role vet_doctor but has no veterinarian profile. ` +
          `Contact an administrator to link the profile.`,
        );
      }
      resolvedVetId = vet.id;
    } else {
      // ADMIN must supply an explicit veterinarian
      if (!signingVetId) {
        throw new BadRequestException(
          'Admins must supply signingVetId when completing a consultation.',
        );
      }
      // Verify the vet exists
      const [vet] = await this.db
        .select({ id: veterinariansTable.id })
        .from(veterinariansTable)
        .where(and(eq(veterinariansTable.id, signingVetId), isNull(veterinariansTable.deletedAt)))
        .limit(1);

      if (!vet) throw new NotFoundException(`Veterinarian ${signingVetId} not found`);
      resolvedVetId = vet.id;
    }

    const [updated] = await withAuditContext(this.db, ctx, (tx) =>
      tx
        .update(consultationsTable)
        .set({
          status:    'completed',
          signedBy:  resolvedVetId,
          signedAt:  new Date(),
          updatedAt: new Date(),
        })
        .where(eq(consultationsTable.id, id))
        .returning(),
    );

    this.logger.log(`Consultation ${id} completed + signed by vet ${resolvedVetId} (user ${actorUserId})`);
    return updated;
  }

  // ---------------------------------------------------------------------------
  // Cancel — only open, never delete
  // ---------------------------------------------------------------------------

  async cancel(id: string, ctx: AuditContext) {
    const consultation = await this.findOneOrFail(id);

    if (consultation.status !== 'open') {
      throw new BadRequestException(
        `Cannot cancel consultation with status '${consultation.status}'.`,
      );
    }

    const [updated] = await withAuditContext(this.db, ctx, (tx) =>
      tx
        .update(consultationsTable)
        .set({ status: 'cancelled', updatedAt: new Date() })
        .where(eq(consultationsTable.id, id))
        .returning(),
    );

    this.logger.log(`Consultation ${id} cancelled by user ${ctx.userId}`);
    return updated;
  }

  // ---------------------------------------------------------------------------
  // Soft delete — only ADMIN, blocked for completed consultations
  // ---------------------------------------------------------------------------

  async softDelete(id: string, ctx: AuditContext) {
    const consultation = await this.findOneOrFail(id);

    if (consultation.status === 'completed') {
      throw new BadRequestException(
        'Completed consultations cannot be deleted. They are part of the permanent medical record.',
      );
    }

    await withAuditContext(this.db, ctx, (tx) =>
      tx
        .update(consultationsTable)
        .set({ deletedAt: new Date(), updatedAt: new Date() })
        .where(eq(consultationsTable.id, id)),
    );

    this.logger.log(`Consultation ${id} soft-deleted by user ${ctx.userId}`);
  }

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

  /**
   * When appointmentId is provided, fetches the appointment and fills in
   * petId, ownerId, veterinarianId, consultationDate, and type if the caller
   * did not supply them explicitly.
   *
   * Explicit values in the DTO always take priority over the appointment data —
   * this allows overrides (e.g. a different vet steps in).
   */
  private async resolveFromAppointment(dto: CreateConsultationDto): Promise<CreateConsultationDto> {
    if (!dto.appointmentId) return dto;

    const [appt] = await this.db
      .select()
      .from(appointmentsTable)
      .where(and(eq(appointmentsTable.id, dto.appointmentId), isNull(appointmentsTable.deletedAt)))
      .limit(1);

    if (!appt) {
      throw new NotFoundException(`Appointment ${dto.appointmentId} not found`);
    }

    return {
      ...dto,
      petId:            dto.petId            ?? appt.petId,
      ownerId:          dto.ownerId          ?? appt.ownerId,
      veterinarianId:   dto.veterinarianId   ?? appt.veterinarianId ?? dto.veterinarianId!,
      consultationDate: dto.consultationDate ?? appt.scheduledAt.toISOString(),
      type:             dto.type             ?? (APPT_TYPE_TO_CONSULT_TYPE[appt.type] as never),
    };
  }
}
