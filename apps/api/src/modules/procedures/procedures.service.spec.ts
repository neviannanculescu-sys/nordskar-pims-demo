import { Test, TestingModule } from '@nestjs/testing';
import { NotFoundException, BadRequestException } from '@nestjs/common';
import { ProceduresService } from './procedures.service';
import { DRIZZLE_DB }        from '../../database/database.module';

const makeTx = (rows: unknown[] = []) => ({
  execute:   jest.fn().mockResolvedValue(undefined),
  insert:    jest.fn().mockReturnThis(),
  values:    jest.fn().mockReturnThis(),
  update:    jest.fn().mockReturnThis(),
  set:       jest.fn().mockReturnThis(),
  where:     jest.fn().mockReturnThis(),
  returning: jest.fn().mockResolvedValue(rows),
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

const CTX = { userId: 'user-1', ip: '127.0.0.1', sessionId: 'sess-1' };

const PROC = (o: Partial<Record<string, unknown>> = {}) => ({
  id: 'proc-1', consultationId: 'cons-1', veterinarianId: 'vet-1',
  performedAt: new Date(), name: 'X-Ray', quantity: '1', unitPrice: '50.00',
  totalPrice: '50.00', isBillable: true, deletedAt: null, ...o,
});

const OPEN_CONS = { status: 'open' };

describe('ProceduresService', () => {
  let service: ProceduresService;
  let db: ReturnType<typeof makeDb>;

  beforeEach(async () => {
    db = makeDb();
    const module: TestingModule = await Test.createTestingModule({
      providers: [ProceduresService, { provide: DRIZZLE_DB, useValue: db }],
    }).compile();
    service = module.get<ProceduresService>(ProceduresService);
  });

  describe('findOneOrFail', () => {
    it('returns procedure when found', async () => {
      db.limit = jest.fn().mockResolvedValue([PROC()]);
      await expect(service.findOneOrFail('proc-1')).resolves.toMatchObject({ id: 'proc-1' });
    });
    it('throws NotFoundException when missing', async () => {
      db.limit = jest.fn().mockResolvedValue([]);
      await expect(service.findOneOrFail('x')).rejects.toThrow(NotFoundException);
    });
  });

  describe('create', () => {
    it('throws BadRequestException on completed consultation', async () => {
      db.limit = jest.fn().mockResolvedValue([{ status: 'completed' }]);
      await expect(service.create(
        { consultationId: 'cons-1', veterinarianId: 'vet-1', performedAt: new Date().toISOString(),
          name: 'X-Ray', unitPrice: '50' },
        CTX,
      )).rejects.toThrow(BadRequestException);
    });

    it('creates procedure on open consultation', async () => {
      const created = PROC();
      let call = 0;
      db.limit = jest.fn().mockImplementation(() => {
        call++;
        return call === 1 ? Promise.resolve([OPEN_CONS]) : Promise.resolve([]);
      });
      db.transaction = jest.fn().mockImplementation(async (fn: (tx: ReturnType<typeof makeTx>) => Promise<unknown>) =>
        fn(makeTx([created])),
      );
      await expect(service.create(
        { consultationId: 'cons-1', veterinarianId: 'vet-1', performedAt: new Date().toISOString(),
          name: 'X-Ray', unitPrice: '50' },
        CTX,
      )).resolves.toMatchObject({ id: 'proc-1' });
    });
  });

  describe('update', () => {
    it('blocks update when consultation is cancelled', async () => {
      let call = 0;
      db.limit = jest.fn().mockImplementation(() => {
        call++;
        if (call === 1) return Promise.resolve([PROC()]);
        return Promise.resolve([{ status: 'cancelled' }]);
      });
      await expect(service.update('proc-1', { name: 'Ultrasound' }, CTX))
        .rejects.toThrow(BadRequestException);
    });
  });

  describe('softDelete', () => {
    it('throws BadRequestException on completed consultation', async () => {
      let call = 0;
      db.limit = jest.fn().mockImplementation(() => {
        call++;
        if (call === 1) return Promise.resolve([PROC()]);
        return Promise.resolve([{ status: 'completed' }]);
      });
      await expect(service.softDelete('proc-1', CTX)).rejects.toThrow(BadRequestException);
    });
  });
});
