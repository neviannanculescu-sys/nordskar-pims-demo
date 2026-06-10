import { Test, TestingModule } from '@nestjs/testing';
import { NotFoundException, ConflictException, BadRequestException, ForbiddenException } from '@nestjs/common';
import { AppointmentsService } from './appointments.service';
import { DRIZZLE_DB } from '../../database/database.module';
import { AppointmentStatus } from './dto/query-appointments.dto';
import { AppointmentType } from './dto/create-appointment.dto';
import { UserRole } from '../../common/constants/roles.constants';

// ---------------------------------------------------------------------------
// Minimal mock factory — each test overrides what it needs
// ---------------------------------------------------------------------------
const makeDb = (overrides: Record<string, unknown> = {}) => ({
  select: jest.fn().mockReturnThis(),
  from:   jest.fn().mockReturnThis(),
  where:  jest.fn().mockReturnThis(),
  limit:  jest.fn().mockReturnThis(),
  offset: jest.fn().mockReturnThis(),
  orderBy: jest.fn().mockReturnThis(),
  insert: jest.fn().mockReturnThis(),
  values: jest.fn().mockReturnThis(),
  update: jest.fn().mockReturnThis(),
  set:    jest.fn().mockReturnThis(),
  returning: jest.fn().mockResolvedValue([]),
  transaction: jest.fn().mockImplementation((fn) => fn({ // tx mirrors db
    execute: jest.fn().mockResolvedValue(undefined),
    insert:  jest.fn().mockReturnThis(),
    values:  jest.fn().mockReturnThis(),
    update:  jest.fn().mockReturnThis(),
    set:     jest.fn().mockReturnThis(),
    where:   jest.fn().mockReturnThis(),
    returning: jest.fn().mockResolvedValue([]),
  })),
  ...overrides,
});

const CTX = { userId: 'user-1', ip: '127.0.0.1', sessionId: 'sess-1', role: UserRole.ADMIN };

const APPT = (overrides: Partial<Record<string, unknown>> = {}) => ({
  id:             'appt-1',
  petId:          'pet-1',
  ownerId:        'owner-1',
  veterinarianId: 'vet-1',
  roomId:         'room-1',
  scheduledAt:    new Date('2026-06-10T10:00:00Z'),
  durationMin:    30,
  type:           'routine',
  status:         AppointmentStatus.SCHEDULED,
  reason:         'Check-up',
  notes:          null,
  source:         null,
  createdBy:      'user-1',
  deletedAt:      null,
  ...overrides,
});

describe('AppointmentsService', () => {
  let service: AppointmentsService;
  let db: ReturnType<typeof makeDb>;

  beforeEach(async () => {
    db = makeDb();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AppointmentsService,
        { provide: DRIZZLE_DB, useValue: db },
      ],
    }).compile();

    service = module.get<AppointmentsService>(AppointmentsService);
  });

  // ---------------------------------------------------------------------------
  // findOneOrFail
  // ---------------------------------------------------------------------------
  describe('findOneOrFail', () => {
    it('returns the appointment when found', async () => {
      const appt = APPT();
      db.limit = jest.fn().mockResolvedValue([appt]);

      const result = await service.findOneOrFail('appt-1');
      expect(result).toEqual(appt);
    });

    it('throws NotFoundException when not found', async () => {
      db.limit = jest.fn().mockResolvedValue([]);
      await expect(service.findOneOrFail('missing')).rejects.toThrow(NotFoundException);
    });
  });

  // ---------------------------------------------------------------------------
  // Status machine: transition validation
  // ---------------------------------------------------------------------------
  describe('transition validation', () => {
    it('throws BadRequestException for invalid transition completed → confirmed', async () => {
      const appt = APPT({ status: AppointmentStatus.COMPLETED });
      db.limit = jest.fn().mockResolvedValue([appt]);

      await expect(
        service.confirm('appt-1', UserRole.ADMIN, CTX),
      ).rejects.toThrow(BadRequestException);
    });

    it('throws ForbiddenException when role cannot perform transition', async () => {
      // VET_DOCTOR cannot confirm (only ADMIN and RECEPTIONIST can)
      const appt = APPT({ status: AppointmentStatus.SCHEDULED });
      db.limit = jest.fn().mockResolvedValue([appt]);

      await expect(
        service.confirm('appt-1', UserRole.VET_DOCTOR, CTX),
      ).rejects.toThrow(ForbiddenException);
    });

    it('completes scheduled → confirmed for ADMIN', async () => {
      const appt    = APPT({ status: AppointmentStatus.SCHEDULED });
      const updated = APPT({ status: AppointmentStatus.CONFIRMED });

      db.limit = jest.fn().mockResolvedValue([appt]);
      // transaction returns the updated record
      db.transaction = jest.fn().mockImplementation(async (fn) => {
        const tx = {
          execute:   jest.fn().mockResolvedValue(undefined),
          update:    jest.fn().mockReturnThis(),
          set:       jest.fn().mockReturnThis(),
          where:     jest.fn().mockReturnThis(),
          returning: jest.fn().mockResolvedValue([updated]),
        };
        return fn(tx);
      });

      const result = await service.confirm('appt-1', UserRole.ADMIN, CTX);
      expect(result.status).toBe(AppointmentStatus.CONFIRMED);
    });
  });

  // ---------------------------------------------------------------------------
  // update: locked status guard
  // ---------------------------------------------------------------------------
  describe('update', () => {
    it('throws BadRequestException when appointment is checked_in', async () => {
      const appt = APPT({ status: AppointmentStatus.CHECKED_IN });
      db.limit = jest.fn().mockResolvedValue([appt]);

      await expect(
        service.update('appt-1', { reason: 'new reason' }, CTX),
      ).rejects.toThrow(BadRequestException);
    });

    it('throws BadRequestException when appointment is completed', async () => {
      const appt = APPT({ status: AppointmentStatus.COMPLETED });
      db.limit = jest.fn().mockResolvedValue([appt]);

      await expect(
        service.update('appt-1', { reason: 'edit' }, CTX),
      ).rejects.toThrow(BadRequestException);
    });
  });

  // ---------------------------------------------------------------------------
  // cancel: notes prepend
  // ---------------------------------------------------------------------------
  describe('cancel', () => {
    it('throws BadRequestException when appointment is already cancelled', async () => {
      const appt = APPT({ status: AppointmentStatus.CANCELLED });

      // findOneOrFail called 1x for cancel's own notesUpdate, 1x inside transition
      db.limit = jest.fn().mockResolvedValue([appt]);

      await expect(
        service.cancel('appt-1', { reason: 'duplicate' }, UserRole.ADMIN, CTX),
      ).rejects.toThrow(BadRequestException);
    });
  });

  // ---------------------------------------------------------------------------
  // noShow: RECEPTIONIST allowed, VET_DOCTOR not allowed
  // ---------------------------------------------------------------------------
  describe('noShow', () => {
    it('allows RECEPTIONIST to mark no_show from scheduled', async () => {
      const appt    = APPT({ status: AppointmentStatus.SCHEDULED });
      const updated = APPT({ status: AppointmentStatus.NO_SHOW });

      db.limit = jest.fn().mockResolvedValue([appt]);
      db.transaction = jest.fn().mockImplementation(async (fn) => {
        const tx = {
          execute:   jest.fn().mockResolvedValue(undefined),
          update:    jest.fn().mockReturnThis(),
          set:       jest.fn().mockReturnThis(),
          where:     jest.fn().mockReturnThis(),
          returning: jest.fn().mockResolvedValue([updated]),
        };
        return fn(tx);
      });

      const result = await service.noShow('appt-1', UserRole.RECEPTIONIST, CTX);
      expect(result.status).toBe(AppointmentStatus.NO_SHOW);
    });

    it('throws ForbiddenException for VET_DOCTOR on no_show', async () => {
      const appt = APPT({ status: AppointmentStatus.SCHEDULED });
      db.limit = jest.fn().mockResolvedValue([appt]);

      await expect(
        service.noShow('appt-1', UserRole.VET_DOCTOR, CTX),
      ).rejects.toThrow(ForbiddenException);
    });
  });

  // ---------------------------------------------------------------------------
  // checkConflicts: ConflictException on vet overlap
  // ---------------------------------------------------------------------------
  describe('create (conflict detection)', () => {
    it('throws ConflictException when vet has overlapping appointment', async () => {
      // checkConflicts inner query returns a conflict
      db.limit = jest.fn().mockResolvedValue([{ id: 'conflict-appt', scheduledAt: new Date() }]);

      const dto = {
        petId:          'pet-1',
        ownerId:        'owner-1',
        veterinarianId: 'vet-1',
        scheduledAt:    '2026-06-10T10:00:00Z',
        durationMin:    30,
        type:           AppointmentType.ROUTINE,
        reason:         'Check-up',
      };

      await expect(service.create(dto, CTX)).rejects.toThrow(ConflictException);
    });
  });
});
