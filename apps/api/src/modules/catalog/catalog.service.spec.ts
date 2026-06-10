import { Test, TestingModule } from '@nestjs/testing';
import { NotFoundException, ConflictException, BadRequestException } from '@nestjs/common';
import { CatalogService } from './catalog.service';
import { DRIZZLE_DB }     from '../../database/database.module';

const makeTx = (rows: unknown[] = [{ id: 'new-1' }]) => ({
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
  transaction: jest.fn().mockImplementation(
    (fn: (tx: ReturnType<typeof makeTx>) => Promise<unknown>) => fn(makeTx()),
  ),
});

const CTX = { userId: 'user-1', ip: '127.0.0.1', sessionId: 'sess-1' };

const PRICE = (o: Partial<Record<string, unknown>> = {}) => ({
  id: 'price-1', code: 'CONSULT-01', name: 'Consultation', serviceType: 'consultation',
  basePrice: '100.00', vatRate: '9', validFrom: '2024-01-01', validTo: null,
  isActive: true, ...o,
});

const TEMPLATE = (o: Partial<Record<string, unknown>> = {}) => ({
  id: 'tpl-1', serviceId: 'price-1', name: 'Basic consult template',
  isActive: true, requiresAnesthesia: false, requiresLab: false, ...o,
});

describe('CatalogService', () => {
  let service: CatalogService;
  let db: ReturnType<typeof makeDb>;

  beforeEach(async () => {
    db = makeDb();
    const module: TestingModule = await Test.createTestingModule({
      providers: [CatalogService, { provide: DRIZZLE_DB, useValue: db }],
    }).compile();
    service = module.get<CatalogService>(CatalogService);
  });

  // ---------------------------------------------------------------------------
  // Price catalog
  // ---------------------------------------------------------------------------

  describe('findPriceOrFail', () => {
    it('returns entry when found', async () => {
      db.limit = jest.fn().mockResolvedValue([PRICE()]);
      await expect(service.findPriceOrFail('price-1')).resolves.toMatchObject({ id: 'price-1' });
    });
    it('throws NotFoundException when not found', async () => {
      db.limit = jest.fn().mockResolvedValue([]);
      await expect(service.findPriceOrFail('x')).rejects.toThrow(NotFoundException);
    });
  });

  describe('createPrice', () => {
    it('rejects duplicate code', async () => {
      db.limit = jest.fn().mockResolvedValue([{ id: 'existing' }]);
      await expect(
        service.createPrice({ code: 'CONSULT-01', name: 'X', serviceType: 'consultation' as never, basePrice: '100' } as any, CTX),
      ).rejects.toThrow(ConflictException);
    });

    it('creates when code is unique', async () => {
      db.limit = jest.fn().mockResolvedValue([]);
      db.transaction = jest.fn().mockImplementation(
        (fn: (tx: ReturnType<typeof makeTx>) => Promise<unknown>) => fn(makeTx([PRICE()])),
      );
      const result = await service.createPrice(
        { code: 'NEW-01', name: 'New', serviceType: 'consultation' as never, basePrice: '80' } as any,
        CTX,
      );
      expect(result).toMatchObject({ id: 'price-1' });
    });
  });

  describe('updatePrice', () => {
    it('throws when validTo < validFrom', async () => {
      // findPriceOrFail twice (exists check + current fetch for validTo guard)
      db.limit = jest.fn()
        .mockResolvedValueOnce([PRICE({ validFrom: '2024-06-01' })])
        .mockResolvedValueOnce([PRICE({ validFrom: '2024-06-01' })]);
      await expect(
        service.updatePrice('price-1', { validTo: '2024-01-01' }, CTX),
      ).rejects.toThrow(BadRequestException);
    });

    it('updates when validTo >= validFrom', async () => {
      db.limit = jest.fn()
        .mockResolvedValueOnce([PRICE({ validFrom: '2024-01-01' })])
        .mockResolvedValueOnce([PRICE({ validFrom: '2024-01-01' })]);
      db.transaction = jest.fn().mockImplementation(
        (fn: (tx: ReturnType<typeof makeTx>) => Promise<unknown>) =>
          fn(makeTx([PRICE({ validTo: '2025-12-31' })])),
      );
      const result = await service.updatePrice('price-1', { validTo: '2025-12-31' }, CTX);
      expect(result).toMatchObject({ validTo: '2025-12-31' });
    });
  });

  // ---------------------------------------------------------------------------
  // Procedure templates
  // ---------------------------------------------------------------------------

  describe('findTemplateOrFail', () => {
    it('returns template when found', async () => {
      db.limit = jest.fn().mockResolvedValue([TEMPLATE()]);
      await expect(service.findTemplateOrFail('tpl-1')).resolves.toMatchObject({ id: 'tpl-1' });
    });
    it('throws NotFoundException when not found', async () => {
      db.limit = jest.fn().mockResolvedValue([]);
      await expect(service.findTemplateOrFail('x')).rejects.toThrow(NotFoundException);
    });
  });

  describe('createTemplate', () => {
    it('rejects when referenced service does not exist', async () => {
      db.limit = jest.fn().mockResolvedValue([]); // service lookup fails
      await expect(
        service.createTemplate({ serviceId: 'missing', name: 'T' } as any, CTX),
      ).rejects.toThrow(NotFoundException);
    });

    it('creates template when service exists', async () => {
      db.limit = jest.fn().mockResolvedValue([PRICE()]); // service lookup succeeds
      db.transaction = jest.fn().mockImplementation(
        (fn: (tx: ReturnType<typeof makeTx>) => Promise<unknown>) => fn(makeTx([TEMPLATE()])),
      );
      const result = await service.createTemplate(
        { serviceId: 'price-1', name: 'T' } as any,
        CTX,
      );
      expect(result).toMatchObject({ id: 'tpl-1' });
    });
  });

  describe('updateTemplate', () => {
    it('rejects when new serviceId does not exist', async () => {
      db.limit = jest.fn()
        .mockResolvedValueOnce([TEMPLATE()])   // findTemplateOrFail
        .mockResolvedValueOnce([]);             // findPriceOrFail — not found
      await expect(
        service.updateTemplate('tpl-1', { serviceId: 'missing' }, CTX),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('findAllCategories', () => {
    it('returns active categories ordered by name', async () => {
      const cats = [{ id: 'c1', name: 'A' }, { id: 'c2', name: 'B' }];
      db.orderBy = jest.fn().mockResolvedValue(cats);
      const result = await service.findAllCategories();
      expect(result).toHaveLength(2);
    });
  });
});
