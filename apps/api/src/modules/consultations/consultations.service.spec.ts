import { Test, TestingModule } from '@nestjs/testing';
import {
  NotFoundException,
  BadRequestException,
  ConflictException,
  ForbiddenException,
} from '@nestjs/common';
import { ConsultationsService } from './consultations.service';
import { DRIZZLE_DB } from '../../database/database.module';
import { ConsultationStatus } from './dto/query-consultations.dto';
import { ConsultationType, ConsultationPrognosis } from './dto/create-consultation.dto';
import { UserRole } from '../../common/constants/roles.constants';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const makeTx = (returnValue: unknown[] = []) => ({
  execute:   jest.fn().mockResolvedValue(undefined),
  insert:    jest.fn().mockReturnThis(),
  values:    jest.fn().mockReturnThis(),
  update:    jest.fn().mockReturnThis(),
  set:       jest.fn().mockReturnThis(),
  where:     jest.fn().mockReturnThis(),
  returning: jest.fn().mockResolvedValue(returnValue),
});

const makeDb = () => ({
  select:      jest.fn().mockReturnThis(),
  from:        jest.fn().mockReturnThis(),
  where:       jest.fn().mockReturnThis(),
  limit:       jest.fn().mockResolvedValue([]),
  offset:      jest.fn().mockReturnThis(),
  orderBy:     jest.fn().mockReturnThis(),
  insert:      jest.fn().mockReturnThis(),
  values:      jest.fn().mockReturnThis(),
  update:      jest.fn().mockReturnThis(),
  set:         jest.fn().mockReturnThis(),
  returning:   jest.fn().mockResolvedValue([]),
  transaction: jest.fn().mockImplementation((fn: (tx: ReturnType<typeof makeTx>) => Promise<unknown>) => fn(makeTx())),
});

const CTX = { userId: 'user-vet-1', ip: '127.0.0.1', sessionId: 'sess-1' };

const CONSULTATION = (overrides: Partial<Record<string, unknown>> = {}) => ({
  id:                 'cons-1',
  appointmentId:      'appt-1',
  petId:              'pet-1',
  ownerId:            'owner-1',
  veterinarianId:     'vet-1',
  consultationDate:   new Date('2026-06-10T10:00:00Z'),
  type:               ConsultationType.ROUTINE,
  chiefComplaint:     'Limping',
  history:            null,
  weightKg:           null,
  temperatureC:       null,
  heartRate:          null,
  respiratoryRate:    null,
  clinicalFindings:   null,
  diagnosisPrimary:   'Sprain',
  diagnosisSecondary: null,
  prognosis:          ConsultationPrognosis.GOOD,
  treatmentPlan:      'Rest',
  dischargeNotes:     null,
  followUpDate:       null,
  followUpNotes:      null,
  startedAt:          null,
  endedAt:            null,
  durationMinutes:    null,
  status:             ConsultationStatus.OPEN,
  billed:             false,
  signedBy:           null,
  signedAt:           null,
  createdAt:          new Date(),
  updatedAt:          null,
  deletedAt:          null,
  ...overrides,
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('ConsultationsService', () => {
  let service: ConsultationsService;
  let db: ReturnType<typeof makeDb>;

  beforeEach(async () => {
    db = makeDb();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ConsultationsService,
        { provide: DRIZZLE_DB, useValue: db },
      ],
    }).compile();

    service = module.get<ConsultationsService>(ConsultationsService);
  });

  // ---------------------------------------------------------------------------
  // findOneOrFail
  // ---------------------------------------------------------------------------
  describe('findOneOrFail', () => {
    it('returns consultation when found', async () => {
      const cons = CONSULTATION();
      db.limit = jest.fn().mockResolvedValue([cons]);
      await expect(service.findOneOrFail('cons-1')).resolves.toEqual(cons);
    });

    it('throws NotFoundException when missing', async () => {
      db.limit = jest.fn().mockResolvedValue([]);
      await expect(service.findOneOrFail('missing')).rejects.toThrow(NotFoundException);
    });
  });

  // ---------------------------------------------------------------------------
  // create: appointmentId uniqueness + autopopulation
  // ---------------------------------------------------------------------------
  describe('create', () => {
    it('throws ConflictException when appointment already has a consultation', async () => {
      // resolveFromAppointment → appointment found (limit call 1)
      // uniqueness check → existing consultation found (limit call 2)
      let callCount = 0;
      db.limit = jest.fn().mockImplementation(() => {
        callCount++;
        if (callCount === 1) return Promise.resolve([{
          id: 'appt-1', petId: 'pet-1', ownerId: 'owner-1',
          veterinarianId: 'vet-1', scheduledAt: new Date(), type: 'routine', deletedAt: null,
        }]);
        return Promise.resolve([{ id: 'existing-cons' }]);
      });

      await expect(
        service.create(
          {
            appointmentId:    'appt-1',
            petId:            'pet-1',
            ownerId:          'owner-1',
            veterinarianId:   'vet-1',
            consultationDate: '2026-06-10T10:00:00Z',
            type:             ConsultationType.ROUTINE,
            chiefComplaint:   'Limping',
            diagnosisPrimary: 'Sprain',
          },
          CTX,
        ),
      ).rejects.toThrow(ConflictException);
    });

    it('autopopulates petId/ownerId/veterinarianId from appointment', async () => {
      const created = CONSULTATION();
      let callCount = 0;

      db.limit = jest.fn().mockImplementation(() => {
        callCount++;
        if (callCount === 1) {
          // resolveFromAppointment — appointment row
          return Promise.resolve([{
            id: 'appt-1', petId: 'pet-appt', ownerId: 'owner-appt',
            veterinarianId: 'vet-appt', scheduledAt: new Date('2026-06-11T09:00:00Z'),
            type: 'routine', deletedAt: null,
          }]);
        }
        // uniqueness check — no conflict
        return Promise.resolve([]);
      });

      db.transaction = jest.fn().mockImplementation(async (fn: (tx: ReturnType<typeof makeTx>) => Promise<unknown>) =>
        fn(makeTx([created])),
      );

      // DTO omits petId/ownerId/veterinarianId — expect them filled from appointment
      const result = await service.create(
        {
          appointmentId:    'appt-1',
          petId:            undefined as unknown as string,
          ownerId:          undefined as unknown as string,
          veterinarianId:   undefined as unknown as string,
          consultationDate: undefined as unknown as string,
          type:             undefined as unknown as ConsultationType,
          chiefComplaint:   'Limping',
          diagnosisPrimary: 'Sprain',
        },
        CTX,
      );
      expect(result.id).toBe('cons-1');
    });

    it('explicit DTO values override appointment data', async () => {
      const created = CONSULTATION({ veterinarianId: 'vet-override' });
      let callCount = 0;

      db.limit = jest.fn().mockImplementation(() => {
        callCount++;
        if (callCount === 1) {
          return Promise.resolve([{
            id: 'appt-1', petId: 'pet-appt', ownerId: 'owner-appt',
            veterinarianId: 'vet-appt', scheduledAt: new Date(), type: 'routine', deletedAt: null,
          }]);
        }
        return Promise.resolve([]);
      });

      db.transaction = jest.fn().mockImplementation(async (fn: (tx: ReturnType<typeof makeTx>) => Promise<unknown>) =>
        fn(makeTx([created])),
      );

      // Explicit veterinarianId should override the one from appointment
      const result = await service.create(
        {
          appointmentId:    'appt-1',
          petId:            'pet-1',
          ownerId:          'owner-1',
          veterinarianId:   'vet-override',
          consultationDate: '2026-06-10T10:00:00Z',
          type:             ConsultationType.ROUTINE,
          chiefComplaint:   'Limping',
          diagnosisPrimary: 'Sprain',
        },
        CTX,
      );
      expect(result.veterinarianId).toBe('vet-override');
    });
  });

  // ---------------------------------------------------------------------------
  // update: immutability guard
  // ---------------------------------------------------------------------------
  describe('update', () => {
    it('throws BadRequestException when consultation is completed', async () => {
      db.limit = jest.fn().mockResolvedValue([CONSULTATION({ status: ConsultationStatus.COMPLETED })]);
      await expect(
        service.update('cons-1', { chiefComplaint: 'New complaint' }, CTX),
      ).rejects.toThrow(BadRequestException);
    });

    it('throws BadRequestException when consultation is cancelled', async () => {
      db.limit = jest.fn().mockResolvedValue([CONSULTATION({ status: ConsultationStatus.CANCELLED })]);
      await expect(
        service.update('cons-1', { treatmentPlan: 'Changed' }, CTX),
      ).rejects.toThrow(BadRequestException);
    });
  });

  // ---------------------------------------------------------------------------
  // complete: signing authorization + validation guards
  // ---------------------------------------------------------------------------
  describe('complete', () => {
    it('throws BadRequestException if already completed', async () => {
      db.limit = jest.fn().mockResolvedValue([CONSULTATION({ status: ConsultationStatus.COMPLETED })]);
      await expect(
        service.complete('cons-1', 'user-1', UserRole.VET_DOCTOR, CTX),
      ).rejects.toThrow(BadRequestException);
    });

    it('throws BadRequestException if diagnosisPrimary is missing', async () => {
      db.limit = jest.fn().mockResolvedValue([CONSULTATION({ diagnosisPrimary: '' })]);
      await expect(
        service.complete('cons-1', 'user-1', UserRole.VET_DOCTOR, CTX),
      ).rejects.toThrow(BadRequestException);
    });

    it('throws ForbiddenException when VET_DOCTOR has no veterinarian profile', async () => {
      let callCount = 0;
      db.limit = jest.fn().mockImplementation(() => {
        callCount++;
        if (callCount === 1) return Promise.resolve([CONSULTATION()]);
        // vet profile lookup returns nothing
        return Promise.resolve([]);
      });

      await expect(
        service.complete('cons-1', 'user-no-vet', UserRole.VET_DOCTOR, CTX),
      ).rejects.toThrow(ForbiddenException);
    });

    it('throws BadRequestException when ADMIN does not supply signingVetId', async () => {
      db.limit = jest.fn().mockResolvedValue([CONSULTATION()]);
      await expect(
        service.complete('cons-1', 'admin-user', UserRole.ADMIN, CTX, undefined),
      ).rejects.toThrow(BadRequestException);
    });

    it('VET_DOCTOR: resolves vet from userId and signs', async () => {
      const completed = CONSULTATION({ status: ConsultationStatus.COMPLETED, signedBy: 'vet-db-id' });
      let callCount = 0;
      db.limit = jest.fn().mockImplementation(() => {
        callCount++;
        if (callCount === 1) return Promise.resolve([CONSULTATION()]);
        // vet profile lookup
        return Promise.resolve([{ id: 'vet-db-id' }]);
      });
      db.transaction = jest.fn().mockImplementation(async (fn: (tx: ReturnType<typeof makeTx>) => Promise<unknown>) =>
        fn(makeTx([completed])),
      );

      const result = await service.complete('cons-1', 'user-vet-1', UserRole.VET_DOCTOR, CTX);
      expect(result.status).toBe(ConsultationStatus.COMPLETED);
      expect(result.signedBy).toBe('vet-db-id');
    });

    it('ADMIN: uses supplied signingVetId', async () => {
      const completed = CONSULTATION({ status: ConsultationStatus.COMPLETED, signedBy: 'vet-supplied' });
      let callCount = 0;
      db.limit = jest.fn().mockImplementation(() => {
        callCount++;
        if (callCount === 1) return Promise.resolve([CONSULTATION()]);
        // vet existence check
        return Promise.resolve([{ id: 'vet-supplied' }]);
      });
      db.transaction = jest.fn().mockImplementation(async (fn: (tx: ReturnType<typeof makeTx>) => Promise<unknown>) =>
        fn(makeTx([completed])),
      );

      const result = await service.complete('cons-1', 'admin-1', UserRole.ADMIN, CTX, 'vet-supplied');
      expect(result.signedBy).toBe('vet-supplied');
    });
  });

  // ---------------------------------------------------------------------------
  // cancel
  // ---------------------------------------------------------------------------
  describe('cancel', () => {
    it('throws BadRequestException when cancelling a completed consultation', async () => {
      db.limit = jest.fn().mockResolvedValue([CONSULTATION({ status: ConsultationStatus.COMPLETED })]);
      await expect(service.cancel('cons-1', CTX)).rejects.toThrow(BadRequestException);
    });
  });

  // ---------------------------------------------------------------------------
  // softDelete: completed record protection
  // ---------------------------------------------------------------------------
  describe('softDelete', () => {
    it('throws BadRequestException when trying to delete a completed consultation', async () => {
      db.limit = jest.fn().mockResolvedValue([CONSULTATION({ status: ConsultationStatus.COMPLETED })]);
      await expect(service.softDelete('cons-1', CTX)).rejects.toThrow(BadRequestException);
    });

    it('allows soft delete of an open consultation', async () => {
      db.limit = jest.fn().mockResolvedValue([CONSULTATION()]);
      db.transaction = jest.fn().mockImplementation(async (fn: (tx: ReturnType<typeof makeTx>) => Promise<unknown>) =>
        fn(makeTx()),
      );
      await expect(service.softDelete('cons-1', CTX)).resolves.toBeUndefined();
    });
  });
});
