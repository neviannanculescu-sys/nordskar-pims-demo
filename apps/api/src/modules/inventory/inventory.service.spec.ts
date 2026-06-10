import { Test, TestingModule } from '@nestjs/testing';
import { NotFoundException, ConflictException, BadRequestException } from '@nestjs/common';
import { InventoryService } from './inventory.service';
import { DRIZZLE_DB }       from '../../database/database.module';

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
  execute:     jest.fn().mockResolvedValue({ rows: [] }),
  transaction: jest.fn().mockImplementation(
    (fn: (tx: ReturnType<typeof makeTx>) => Promise<unknown>) => fn(makeTx()),
  ),
});

const CTX = { userId: 'user-1', ip: '127.0.0.1', sessionId: 'sess-1' };

const ITEM = (o: Partial<Record<string, unknown>> = {}) => ({
  id: 'item-1', sku: 'MED-001', name: 'Amoxicillin 250mg', category: 'medication',
  currentStock: '100.000', isActive: true, deletedAt: null,
  minStockLevel: '20.000', unitOfMeasure: 'tablet', ...o,
});

const MOVEMENT = (o: Partial<Record<string, unknown>> = {}) => ({
  id: 'mov-1', inventoryItemId: 'item-1', movementType: 'purchase_receipt',
  quantity: '50.000', stockBefore: '100.000', stockAfter: '150.000', ...o,
});

describe('InventoryService', () => {
  let service: InventoryService;
  let db: ReturnType<typeof makeDb>;

  beforeEach(async () => {
    db = makeDb();
    const module: TestingModule = await Test.createTestingModule({
      providers: [InventoryService, { provide: DRIZZLE_DB, useValue: db }],
    }).compile();
    service = module.get<InventoryService>(InventoryService);
  });

  // ---------------------------------------------------------------------------
  // Inventory items
  // ---------------------------------------------------------------------------

  describe('findItemOrFail', () => {
    it('returns item when found', async () => {
      db.limit = jest.fn().mockResolvedValue([ITEM()]);
      await expect(service.findItemOrFail('item-1')).resolves.toMatchObject({ id: 'item-1' });
    });
    it('throws NotFoundException when not found', async () => {
      db.limit = jest.fn().mockResolvedValue([]);
      await expect(service.findItemOrFail('x')).rejects.toThrow(NotFoundException);
    });
  });

  describe('createItem', () => {
    it('rejects duplicate SKU', async () => {
      db.limit = jest.fn().mockResolvedValue([{ id: 'existing' }]);
      await expect(
        service.createItem({ sku: 'MED-001', name: 'X', category: 'medication' as never, unitOfMeasure: 'tab' } as any, CTX),
      ).rejects.toThrow(ConflictException);
    });

    it('creates when SKU is unique', async () => {
      db.limit = jest.fn().mockResolvedValue([]); // no duplicate
      db.transaction = jest.fn().mockImplementation(
        (fn: (tx: ReturnType<typeof makeTx>) => Promise<unknown>) => fn(makeTx([ITEM()])),
      );
      const result = await service.createItem(
        { sku: 'NEW-001', name: 'New', category: 'medication' as never, unitOfMeasure: 'tab' } as any,
        CTX,
      );
      expect(result).toMatchObject({ id: 'item-1' });
    });
  });

  describe('softDeleteItem', () => {
    it('soft-deletes an existing item', async () => {
      db.limit = jest.fn().mockResolvedValue([ITEM()]);
      db.transaction = jest.fn().mockImplementation(
        (fn: (tx: ReturnType<typeof makeTx>) => Promise<unknown>) => fn(makeTx([])),
      );
      await expect(service.softDeleteItem('item-1', CTX)).resolves.toBeUndefined();
    });

    it('throws when item not found', async () => {
      db.limit = jest.fn().mockResolvedValue([]);
      await expect(service.softDeleteItem('x', CTX)).rejects.toThrow(NotFoundException);
    });
  });

  // ---------------------------------------------------------------------------
  // Stock movements
  // ---------------------------------------------------------------------------

  describe('addMovement', () => {
    it('rejects zero quantity', async () => {
      db.limit = jest.fn().mockResolvedValue([ITEM()]);
      await expect(
        service.addMovement({ inventoryItemId: 'item-1', movementType: 'adjustment_negative' as never, quantity: '0' }, CTX),
      ).rejects.toThrow(BadRequestException);
    });

    it('rejects when stock would go negative', async () => {
      db.limit = jest.fn().mockResolvedValue([ITEM({ currentStock: '5.000' })]);
      await expect(
        service.addMovement({ inventoryItemId: 'item-1', movementType: 'consultation_use' as never, quantity: '-10' }, CTX),
      ).rejects.toThrow(BadRequestException);
    });

    it('records positive movement and updates stock', async () => {
      db.limit = jest.fn().mockResolvedValue([ITEM({ currentStock: '100.000' })]);
      db.transaction = jest.fn().mockImplementation(
        (fn: (tx: ReturnType<typeof makeTx>) => Promise<unknown>) =>
          fn(makeTx([MOVEMENT({ stockBefore: '100.000', stockAfter: '150.000' })])),
      );
      const result = await service.addMovement(
        { inventoryItemId: 'item-1', movementType: 'purchase_receipt' as never, quantity: '50' },
        CTX,
      );
      expect(result).toMatchObject({ stockAfter: '150.000' });
    });

    it('records negative movement when sufficient stock exists', async () => {
      db.limit = jest.fn().mockResolvedValue([ITEM({ currentStock: '100.000' })]);
      db.transaction = jest.fn().mockImplementation(
        (fn: (tx: ReturnType<typeof makeTx>) => Promise<unknown>) =>
          fn(makeTx([MOVEMENT({ quantity: '-20', stockBefore: '100.000', stockAfter: '80.000' })])),
      );
      const result = await service.addMovement(
        { inventoryItemId: 'item-1', movementType: 'consultation_use' as never, quantity: '-20' },
        CTX,
      );
      expect(result).toMatchObject({ stockAfter: '80.000' });
    });
  });

  describe('getMovementHistory', () => {
    it('throws when item not found', async () => {
      db.limit = jest.fn().mockResolvedValue([]);
      await expect(service.getMovementHistory('x')).rejects.toThrow(NotFoundException);
    });

    it('returns movement list for valid item', async () => {
      db.limit = jest.fn()
        .mockResolvedValueOnce([ITEM()])   // findItemOrFail
        .mockResolvedValueOnce([MOVEMENT()]); // history
      const result = await service.getMovementHistory('item-1');
      expect(result).toHaveLength(1);
    });
  });
});
