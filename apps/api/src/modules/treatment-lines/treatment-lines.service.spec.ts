import { Test, TestingModule } from '@nestjs/testing';
import { NotFoundException, BadRequestException } from '@nestjs/common';
import { TreatmentLinesService } from './treatment-lines.service';
import { DRIZZLE_DB }            from '../../database/database.module';

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

const LINE = (o: Partial<Record<string, unknown>> = {}) => ({
  id: 'line-1', consultationId: 'cons-1', prescribedBy: 'vet-1',
  productName: 'Amoxicillin', dose: '10mg/kg', isDispensed: false,
  isBillable: true, deletedAt: null, administeredAt: null, ...o,
});

const OPEN_CONS = { status: 'open' };

describe('TreatmentLinesService', () => {
  let service: TreatmentLinesService;
  let db: ReturnType<typeof makeDb>;

  beforeEach(async () => {
    db = makeDb();
    const module: TestingModule = await Test.createTestingModule({
      providers: [TreatmentLinesService, { provide: DRIZZLE_DB, useValue: db }],
    }).compile();
    service = module.get<TreatmentLinesService>(TreatmentLinesService);
  });

  describe('findOneOrFail', () => {
    it('returns line when found', async () => {
      db.limit = jest.fn().mockResolvedValue([LINE()]);
      await expect(service.findOneOrFail('line-1')).resolves.toMatchObject({ id: 'line-1' });
    });
    it('throws NotFoundException when missing', async () => {
      db.limit = jest.fn().mockResolvedValue([]);
      await expect(service.findOneOrFail('x')).rejects.toThrow(NotFoundException);
    });
  });

  describe('create', () => {
    it('rejects on completed consultation', async () => {
      db.limit = jest.fn().mockResolvedValue([{ status: 'completed' }]);
      await expect(service.create(
        { consultationId: 'cons-1', prescribedBy: 'vet-1', productName: 'Drug', dose: '5mg/kg' },
        CTX,
      )).rejects.toThrow(BadRequestException);
    });

    it('creates line on open consultation', async () => {
      const created = LINE();
      let call = 0;
      db.limit = jest.fn().mockImplementation(() => {
        call++;
        return call === 1 ? Promise.resolve([OPEN_CONS]) : Promise.resolve([]);
      });
      db.transaction = jest.fn().mockImplementation(async (fn: (tx: ReturnType<typeof makeTx>) => Promise<unknown>) =>
        fn(makeTx([created])),
      );
      await expect(service.create(
        { consultationId: 'cons-1', prescribedBy: 'vet-1', productName: 'Drug', dose: '5mg/kg' },
        CTX,
      )).resolves.toMatchObject({ id: 'line-1', isDispensed: false });
    });
  });

  describe('update', () => {
    it('blocks update when line is already dispensed', async () => {
      db.limit = jest.fn().mockResolvedValue([LINE({ isDispensed: true })]);
      await expect(service.update('line-1', { dose: '20mg/kg' }, CTX))
        .rejects.toThrow(BadRequestException);
    });
  });

  describe('dispense', () => {
    it('throws when already dispensed', async () => {
      db.limit = jest.fn().mockResolvedValue([LINE({ isDispensed: true })]);
      await expect(service.dispense('line-1', CTX)).rejects.toThrow(BadRequestException);
    });

    it('marks line as dispensed on open consultation', async () => {
      const dispensed = LINE({ isDispensed: true, administeredAt: new Date() });
      let call = 0;
      db.limit = jest.fn().mockImplementation(() => {
        call++;
        if (call === 1) return Promise.resolve([LINE()]);       // findOneOrFail (initial read)
        if (call === 2) return Promise.resolve([OPEN_CONS]);    // assertConsultationEditable
        return Promise.resolve([dispensed]);                    // findOneOrFail (re-fetch after dispense)
      });
      db.transaction = jest.fn().mockImplementation(async (fn: (tx: ReturnType<typeof makeTx>) => Promise<unknown>) =>
        fn(makeTx([dispensed])),
      );
      const result = await service.dispense('line-1', CTX);
      expect(result.isDispensed).toBe(true);
    });
  });

  describe('softDelete', () => {
    it('blocks deletion of dispensed line', async () => {
      db.limit = jest.fn().mockResolvedValue([LINE({ isDispensed: true })]);
      await expect(service.softDelete('line-1', CTX)).rejects.toThrow(BadRequestException);
    });
  });
});
