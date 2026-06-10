import {
  Inject,
  Injectable,
  NotFoundException,
  ConflictException,
  BadRequestException,
  ForbiddenException,
  Logger,
  UnprocessableEntityException,
} from '@nestjs/common';
import {
  eq,
  and,
  ne,
  isNull,
  notInArray,
  gte,
  lt,
  lte,
  count,
  sql,
  SQL,
} from 'drizzle-orm';
import { DRIZZLE_DB, DrizzleDB } from '../../database/database.module';
import { appointmentsTable } from '../../database/schema';
import { withAuditContext, AuditContext } from '../../common/helpers/audit.helper';
import { paginate } from '../../common/types/api-response.types';
import { UserRole } from '../../common/constants/roles.constants';
import { CreateAppointmentDto } from './dto/create-appointment.dto';
import { UpdateAppointmentDto } from './dto/update-appointment.dto';
import {
  AppointmentStatus,
  CalendarView,
  CancelAppointmentDto,
  QueryAppointmentsDto,
  QueryCalendarDto,
} from './dto/query-appointments.dto';

// ---------------------------------------------------------------------------
// Status machine
// ---------------------------------------------------------------------------

const VALID_TRANSITIONS: Readonly<Record<AppointmentStatus, AppointmentStatus[]>> = {
  [AppointmentStatus.SCHEDULED]:   [AppointmentStatus.CONFIRMED, AppointmentStatus.CANCELLED, AppointmentStatus.NO_SHOW],
  [AppointmentStatus.CONFIRMED]:   [AppointmentStatus.CHECKED_IN, AppointmentStatus.CANCELLED, AppointmentStatus.NO_SHOW],
  [AppointmentStatus.CHECKED_IN]:  [AppointmentStatus.IN_PROGRESS, AppointmentStatus.CANCELLED],
  [AppointmentStatus.IN_PROGRESS]: [AppointmentStatus.COMPLETED, AppointmentStatus.CANCELLED],
  [AppointmentStatus.COMPLETED]:   [],
  [AppointmentStatus.CANCELLED]:   [],
  [AppointmentStatus.NO_SHOW]:     [],
};

/** Roles that may trigger each target status */
const TRANSITION_ROLES: Readonly<Record<AppointmentStatus, UserRole[]>> = {
  [AppointmentStatus.SCHEDULED]:   [],
  [AppointmentStatus.CONFIRMED]:   [UserRole.ADMIN, UserRole.RECEPTIONIST],
  [AppointmentStatus.CHECKED_IN]:  [UserRole.ADMIN, UserRole.RECEPTIONIST, UserRole.ASSISTANT],
  [AppointmentStatus.IN_PROGRESS]: [UserRole.ADMIN, UserRole.VET_DOCTOR, UserRole.ASSISTANT],
  [AppointmentStatus.COMPLETED]:   [UserRole.ADMIN, UserRole.VET_DOCTOR],
  [AppointmentStatus.CANCELLED]:   [UserRole.ADMIN, UserRole.RECEPTIONIST, UserRole.VET_DOCTOR],
  [AppointmentStatus.NO_SHOW]:     [UserRole.ADMIN, UserRole.RECEPTIONIST],
};

/** Terminal or in-flight statuses that block basic field edits */
const EDIT_LOCKED_STATUSES: AppointmentStatus[] = [
  AppointmentStatus.CHECKED_IN,
  AppointmentStatus.IN_PROGRESS,
  AppointmentStatus.COMPLETED,
  AppointmentStatus.CANCELLED,
  AppointmentStatus.NO_SHOW,
];

/** Max retroactive window (ms) for RECEPTIONIST / ASSISTANT */
const RETROACTIVE_WINDOW_MS = 4 * 60 * 60 * 1000; // 4 hours

/** Roles that may schedule freely in the past */
const UNRESTRICTED_PAST_ROLES: UserRole[] = [UserRole.ADMIN, UserRole.VET_DOCTOR];

/** These statuses free up the slot for new bookings */
const FREE_STATUSES = [
  AppointmentStatus.CANCELLED,
  AppointmentStatus.NO_SHOW,
] as const;

@Injectable()
export class AppointmentsService {
  private readonly logger = new Logger(AppointmentsService.name);

  constructor(@Inject(DRIZZLE_DB) private readonly db: DrizzleDB) {}

  // ---------------------------------------------------------------------------
  // Read
  // ---------------------------------------------------------------------------

  async findAll(query: QueryAppointmentsDto) {
    const page   = query.page  ?? 1;
    const limit  = query.limit ?? 50;
    const offset = (page - 1) * limit;

    const conditions: SQL[] = [isNull(appointmentsTable.deletedAt)];

    if (query.veterinarianId) conditions.push(eq(appointmentsTable.veterinarianId, query.veterinarianId));
    if (query.ownerId)        conditions.push(eq(appointmentsTable.ownerId,        query.ownerId));
    if (query.petId)          conditions.push(eq(appointmentsTable.petId,          query.petId));
    if (query.status)         conditions.push(eq(appointmentsTable.status,         query.status));
    if (query.type)           conditions.push(eq(appointmentsTable.type,           query.type));
    if (query.dateFrom)       conditions.push(gte(appointmentsTable.scheduledAt,   new Date(query.dateFrom)));
    if (query.dateTo)         conditions.push(lte(appointmentsTable.scheduledAt,   new Date(query.dateTo)));

    const where = and(...conditions);

    const [{ value: total }] = await this.db
      .select({ value: count() })
      .from(appointmentsTable)
      .where(where);

    const items = await this.db
      .select()
      .from(appointmentsTable)
      .where(where)
      .orderBy(appointmentsTable.scheduledAt)
      .limit(limit)
      .offset(offset);

    return paginate(items, Number(total), page, limit);
  }

  async findOneOrFail(id: string) {
    const [appt] = await this.db
      .select()
      .from(appointmentsTable)
      .where(and(eq(appointmentsTable.id, id), isNull(appointmentsTable.deletedAt)))
      .limit(1);

    if (!appt) throw new NotFoundException(`Appointment ${id} not found`);
    return appt;
  }

  async getCalendar(query: QueryCalendarDto) {
    const anchor = new Date(query.date);
    anchor.setHours(0, 0, 0, 0);

    let rangeStart: Date;
    let rangeEnd: Date;

    if (query.view === CalendarView.WEEK) {
      // Normalize to ISO Monday
      const dow = anchor.getDay() === 0 ? 6 : anchor.getDay() - 1;
      rangeStart = new Date(anchor);
      rangeStart.setDate(anchor.getDate() - dow);
      rangeEnd = new Date(rangeStart);
      rangeEnd.setDate(rangeStart.getDate() + 7);
    } else {
      rangeStart = anchor;
      rangeEnd   = new Date(anchor);
      rangeEnd.setDate(anchor.getDate() + 1);
    }

    const conditions: SQL[] = [
      isNull(appointmentsTable.deletedAt),
      gte(appointmentsTable.scheduledAt, rangeStart),
      lt(appointmentsTable.scheduledAt,  rangeEnd),
    ];

    if (query.veterinarianId) conditions.push(eq(appointmentsTable.veterinarianId, query.veterinarianId));
    if (query.roomId)         conditions.push(eq(appointmentsTable.roomId,         query.roomId));

    return this.db
      .select()
      .from(appointmentsTable)
      .where(and(...conditions))
      .orderBy(appointmentsTable.scheduledAt);
  }

  // ---------------------------------------------------------------------------
  // Create
  // ---------------------------------------------------------------------------

  async create(dto: CreateAppointmentDto, ctx: AuditContext & { role: UserRole }) {
    const scheduledAt = new Date(dto.scheduledAt);
    const durationMin = dto.durationMin ?? 30;

    this.validatePastDate(scheduledAt, ctx.role);
    await this.checkConflicts({ scheduledAt, durationMin, veterinarianId: dto.veterinarianId, roomId: dto.roomId });

    const [created] = await withAuditContext(this.db, ctx, (tx) =>
      tx
        .insert(appointmentsTable)
        .values({
          petId:          dto.petId,
          ownerId:        dto.ownerId,
          veterinarianId: dto.veterinarianId,
          roomId:         dto.roomId,
          scheduledAt,
          durationMin,
          type:           dto.type,
          status:         'scheduled',
          reason:         dto.reason,
          notes:          dto.notes,
          source:         dto.source,
          createdBy:      ctx.userId,
        })
        .returning(),
    );

    this.logger.log(`Appointment created: ${created.id} by user ${ctx.userId}`);
    return created;
  }

  // ---------------------------------------------------------------------------
  // Update basic fields (blocked once checked_in or beyond)
  // ---------------------------------------------------------------------------

  async update(id: string, dto: UpdateAppointmentDto, ctx: AuditContext) {
    const appt = await this.findOneOrFail(id);

    if (EDIT_LOCKED_STATUSES.includes(appt.status as AppointmentStatus)) {
      throw new BadRequestException(
        `Appointment status '${appt.status}' does not allow field edits. ` +
        `Cancel and create a new appointment instead.`,
      );
    }

    const newScheduledAt = dto.scheduledAt ? new Date(dto.scheduledAt) : appt.scheduledAt;
    const newDuration    = dto.durationMin ?? appt.durationMin;
    const newVetId       = dto.veterinarianId !== undefined ? dto.veterinarianId  : appt.veterinarianId  ?? undefined;
    const newRoomId      = dto.roomId         !== undefined ? dto.roomId          : appt.roomId          ?? undefined;

    const rescheduling = dto.scheduledAt || dto.durationMin !== undefined || dto.veterinarianId !== undefined || dto.roomId !== undefined;
    if (rescheduling) {
      await this.checkConflicts({
        scheduledAt:    newScheduledAt,
        durationMin:    newDuration,
        veterinarianId: newVetId,
        roomId:         newRoomId,
        excludeId:      id,
      });
    }

    const [updated] = await withAuditContext(this.db, ctx, (tx) =>
      tx
        .update(appointmentsTable)
        .set({
          ...(dto.veterinarianId !== undefined && { veterinarianId: dto.veterinarianId }),
          ...(dto.roomId         !== undefined && { roomId:         dto.roomId }),
          ...(dto.scheduledAt                  && { scheduledAt:    new Date(dto.scheduledAt) }),
          ...(dto.durationMin    !== undefined && { durationMin:    dto.durationMin }),
          ...(dto.type           !== undefined && { type:           dto.type }),
          ...(dto.reason         !== undefined && { reason:         dto.reason }),
          ...(dto.notes          !== undefined && { notes:          dto.notes }),
          ...(dto.source         !== undefined && { source:         dto.source }),
          updatedAt: new Date(),
        })
        .where(eq(appointmentsTable.id, id))
        .returning(),
    );

    return updated;
  }

  // ---------------------------------------------------------------------------
  // Status transitions
  // ---------------------------------------------------------------------------

  async confirm(id: string, actorRole: UserRole, ctx: AuditContext) {
    return this.transition(id, AppointmentStatus.CONFIRMED, actorRole, ctx);
  }

  async checkIn(id: string, actorRole: UserRole, ctx: AuditContext) {
    return this.transition(id, AppointmentStatus.CHECKED_IN, actorRole, ctx);
  }

  async start(id: string, actorRole: UserRole, ctx: AuditContext) {
    return this.transition(id, AppointmentStatus.IN_PROGRESS, actorRole, ctx);
  }

  async complete(id: string, actorRole: UserRole, ctx: AuditContext) {
    return this.transition(id, AppointmentStatus.COMPLETED, actorRole, ctx);
  }

  async cancel(id: string, dto: CancelAppointmentDto, actorRole: UserRole, ctx: AuditContext) {
    if (dto.reason) {
      // Prepend cancellation reason to notes before the status audit record
      const appt = await this.findOneOrFail(id);
      await withAuditContext(this.db, ctx, (tx) =>
        tx
          .update(appointmentsTable)
          .set({ notes: `[CANCELLED] ${dto.reason}${appt.notes ? ' | ' + appt.notes : ''}`, updatedAt: new Date() })
          .where(eq(appointmentsTable.id, id)),
      );
    }
    return this.transition(id, AppointmentStatus.CANCELLED, actorRole, ctx);
  }

  async noShow(id: string, actorRole: UserRole, ctx: AuditContext) {
    return this.transition(id, AppointmentStatus.NO_SHOW, actorRole, ctx);
  }

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

  private async transition(
    id: string,
    target: AppointmentStatus,
    actorRole: UserRole,
    ctx: AuditContext,
  ) {
    const appt   = await this.findOneOrFail(id);
    const current = appt.status as AppointmentStatus;

    const validNext = VALID_TRANSITIONS[current];
    if (!validNext.includes(target)) {
      throw new BadRequestException(
        `Cannot transition '${current}' → '${target}'. ` +
        `Allowed next states: [${validNext.join(', ') || 'none — terminal state'}]`,
      );
    }

    const allowedRoles = TRANSITION_ROLES[target];
    if (!allowedRoles.includes(actorRole)) {
      throw new ForbiddenException(
        `Role '${actorRole}' cannot move appointment to '${target}'`,
      );
    }

    const [updated] = await withAuditContext(this.db, ctx, (tx) =>
      tx
        .update(appointmentsTable)
        .set({ status: target, updatedAt: new Date() })
        .where(eq(appointmentsTable.id, id))
        .returning(),
    );

    this.logger.log(`Appointment ${id}: ${current} → ${target} by ${ctx.userId}`);
    return updated;
  }

  private validatePastDate(scheduledAt: Date, role: UserRole): void {
    const now = Date.now();
    if (scheduledAt.getTime() >= now) return; // future date — always ok

    if (UNRESTRICTED_PAST_ROLES.includes(role)) return; // ADMIN / VET_DOCTOR unrestricted

    const cutoff = now - RETROACTIVE_WINDOW_MS;
    if (scheduledAt.getTime() < cutoff) {
      throw new UnprocessableEntityException(
        `Role '${role}' may only create appointments up to 4 hours in the past. ` +
        `Scheduled time ${scheduledAt.toISOString()} exceeds this window.`,
      );
    }
  }

  /**
   * Detects overlapping bookings for the same veterinarian and/or room.
   *
   * Two appointments overlap when:
   *   existingStart < newEnd  AND  existingEnd > newStart
   *
   * Cancelled and no_show appointments do not hold their slots.
   */
  private async checkConflicts(params: {
    scheduledAt:    Date;
    durationMin:    number;
    veterinarianId?: string;
    roomId?:         string;
    excludeId?:      string;
  }): Promise<void> {
    const { scheduledAt, durationMin, veterinarianId, roomId, excludeId } = params;
    const endTime = new Date(scheduledAt.getTime() + durationMin * 60_000);

    // Reusable overlap + housekeeping conditions (excludes free slots and deleted rows)
    const overlapBase: SQL[] = [
      isNull(appointmentsTable.deletedAt),
      notInArray(appointmentsTable.status, [...FREE_STATUSES]),
      lt(appointmentsTable.scheduledAt, endTime),
      sql`${appointmentsTable.scheduledAt} + (${appointmentsTable.durationMin} * INTERVAL '1 minute') > ${scheduledAt}`,
    ];
    if (excludeId) overlapBase.push(ne(appointmentsTable.id, excludeId));

    if (veterinarianId) {
      const [conflict] = await this.db
        .select({ id: appointmentsTable.id, scheduledAt: appointmentsTable.scheduledAt })
        .from(appointmentsTable)
        .where(and(eq(appointmentsTable.veterinarianId, veterinarianId), ...overlapBase))
        .limit(1);

      if (conflict) {
        throw new ConflictException(
          `Veterinarian already has an appointment overlapping ${scheduledAt.toISOString()} ` +
          `(conflicting id: ${conflict.id})`,
        );
      }
    }

    if (roomId) {
      const [conflict] = await this.db
        .select({ id: appointmentsTable.id, scheduledAt: appointmentsTable.scheduledAt })
        .from(appointmentsTable)
        .where(and(eq(appointmentsTable.roomId, roomId), ...overlapBase))
        .limit(1);

      if (conflict) {
        throw new ConflictException(
          `Room already has an appointment overlapping ${scheduledAt.toISOString()} ` +
          `(conflicting id: ${conflict.id})`,
        );
      }
    }
  }
}
