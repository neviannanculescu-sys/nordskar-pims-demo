import { Test, TestingModule } from '@nestjs/testing';
import {
  NotFoundException, BadRequestException,
  UnprocessableEntityException, ConflictException,
} from '@nestjs/common';
import { InvoicesService } from './invoices.service';
import { DRIZZLE_DB }      from '../../database/database.module';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const makeTx = () => ({
  execute:   jest.fn().mockResolvedValue([{ nextval: '1' }]),
  insert:    jest.fn().mockReturnThis(),
  values:    jest.fn().mockReturnThis(),
  update:    jest.fn().mockReturnThis(),
  set:       jest.fn().mockReturnThis(),
  where:     jest.fn().mockReturnThis(),
  returning: jest.fn().mockResolvedValue([{ id: 'new-1' }]),
});

const makeDb = () => ({
  select:      jest.fn().mockReturnThis(),
  from:        jest.fn().mockReturnThis(),
  where:       jest.fn().mockReturnThis(),
  limit:       jest.fn().mockResolvedValue([]),
  offset:      jest.fn().mockReturnThis(),
  orderBy:     jest.fn().mockResolvedValue([]),
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

const OWNER = {
  id: 'owner-1', type: 'individual',
  firstName: 'Ion', lastName: 'Popescu',
  addressStreet: 'Str. Unirii 1', addressCity: 'Cluj-Napoca',
  addressCounty: 'Cluj', addressZip: '400000', addressCountry: 'RO',
  deletedAt: null,
};

const CONS = {
  id: 'cons-1', ownerId: 'owner-1', signedBy: 'vet-1',
  billed: false, deletedAt: null,
};

const LINES = [{
  id: 'line-1', invoiceId: 'inv-1', description: 'Consultation', position: 0,
  quantity: '1.000', unitPrice: '100.00', vatRate: '9', lineTotal: '100.00',
  sourceId: 'proc-1', sourceType: 'procedure', costSnapshot: null, unit: null,
}];

const DRAFT = {
  id: 'inv-1', series: 'VET', ownerId: 'owner-1', consultationId: 'cons-1',
  status: 'draft', subtotal: '100.00', vatAmount: '9.00', totalAmount: '109.00',
  paidAmount: '0', currency: 'RON', invoiceNumber: null, deletedAt: null,
  stornoOfInvoiceId: null,
};

const ISSUED = { ...DRAFT, status: 'issued', invoiceNumber: 'VET-2026-000001', issuedAt: new Date() };

/**
 * Sets up db.limit and db.orderBy as queues for findOneOrFail.
 * findOneOrFail issues: limit(1) → orderBy(lines) → orderBy(payments).
 * Call once per expected findOneOrFail invocation in the test.
 */
function queueFindOne(
  db: ReturnType<typeof makeDb>,
  invoice: object,
  lines: unknown[] = LINES,
  payments: unknown[] = [],
) {
  (db.limit as jest.Mock).mockResolvedValueOnce([invoice]);
  (db.orderBy as jest.Mock)
    .mockResolvedValueOnce(lines)
    .mockResolvedValueOnce(payments);
}

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------

describe('InvoicesService', () => {
  let service: InvoicesService;
  let db: ReturnType<typeof makeDb>;

  beforeEach(async () => {
    db = makeDb();
    const module: TestingModule = await Test.createTestingModule({
      providers: [InvoicesService, { provide: DRIZZLE_DB, useValue: db }],
    }).compile();
    service = module.get<InvoicesService>(InvoicesService);
  });

  // -------------------------------------------------------------------------
  // findOneOrFail
  // -------------------------------------------------------------------------

  describe('findOneOrFail', () => {
    it('returns invoice with lines and payments', async () => {
      queueFindOne(db, DRAFT);
      const result = await service.findOneOrFail('inv-1');
      expect(result).toMatchObject({ id: 'inv-1', status: 'draft' });
      expect(result.lines).toHaveLength(1);
      expect(result.payments).toHaveLength(0);
    });

    it('throws NotFoundException when missing', async () => {
      // db.limit already returns [] by default
      await expect(service.findOneOrFail('x')).rejects.toThrow(NotFoundException);
    });
  });

  // -------------------------------------------------------------------------
  // createDraft
  // -------------------------------------------------------------------------

  describe('createDraft', () => {
    it('throws when owner not found', async () => {
      // db.limit returns [] → owner not found
      await expect(
        service.createDraft({ ownerId: 'bad', lines: [{ description: 'X', quantity: '1', unitPrice: '10' }] }, CTX),
      ).rejects.toThrow(NotFoundException);
    });

    it('throws when consultation not signed', async () => {
      (db.limit as jest.Mock)
        .mockResolvedValueOnce([OWNER])
        .mockResolvedValueOnce([{ ...CONS, signedBy: null }]);
      await expect(
        service.createDraft({ ownerId: 'owner-1', consultationId: 'cons-1' }, CTX),
      ).rejects.toThrow(UnprocessableEntityException);
    });

    it('throws when consultation already billed', async () => {
      (db.limit as jest.Mock)
        .mockResolvedValueOnce([OWNER])
        .mockResolvedValueOnce([{ ...CONS, billed: true }]);
      await expect(
        service.createDraft({ ownerId: 'owner-1', consultationId: 'cons-1' }, CTX),
      ).rejects.toThrow(ConflictException);
    });

    it('throws when billing_candidates empty and no manual lines', async () => {
      (db.limit as jest.Mock)
        .mockResolvedValueOnce([OWNER])
        .mockResolvedValueOnce([CONS]);
      db.execute = jest.fn().mockResolvedValue({ rows: [] });
      await expect(
        service.createDraft({ ownerId: 'owner-1', consultationId: 'cons-1' }, CTX),
      ).rejects.toThrow(UnprocessableEntityException);
    });

    it('throws when lines array is empty and no consultationId', async () => {
      (db.limit as jest.Mock).mockResolvedValueOnce([OWNER]);
      await expect(
        service.createDraft({ ownerId: 'owner-1', lines: [] }, CTX),
      ).rejects.toThrow(UnprocessableEntityException);
    });

    it('creates draft with manual lines', async () => {
      (db.limit as jest.Mock).mockResolvedValueOnce([OWNER]);
      db.transaction = jest.fn().mockImplementation(
        (fn: (tx: ReturnType<typeof makeTx>) => Promise<unknown>) => {
          const tx = makeTx();
          tx.returning = jest.fn().mockResolvedValue([DRAFT]);
          return fn(tx);
        },
      );
      queueFindOne(db, DRAFT);

      const result = await service.createDraft({
        ownerId: 'owner-1',
        lines:   [{ description: 'Consult', quantity: '1', unitPrice: '100.00', vatRate: '9' }],
      }, CTX);
      expect(result.status).toBe('draft');
    });

    it('pre-populates from billing_candidates when consultationId given', async () => {
      (db.limit as jest.Mock)
        .mockResolvedValueOnce([OWNER])
        .mockResolvedValueOnce([CONS]);
      db.execute = jest.fn().mockResolvedValue({
        rows: [{
          source_id: 'proc-1', source_type: 'procedure', description: 'X-Ray',
          quantity: '1.000', unit: 'buc', unit_price: '150.00', vat_rate: '9',
          unit_cost: '80.00', service_date: new Date(),
        }],
      });
      db.transaction = jest.fn().mockImplementation(
        (fn: (tx: ReturnType<typeof makeTx>) => Promise<unknown>) => {
          const tx = makeTx();
          tx.returning = jest.fn().mockResolvedValue([DRAFT]);
          return fn(tx);
        },
      );
      queueFindOne(db, DRAFT);

      const result = await service.createDraft({ ownerId: 'owner-1', consultationId: 'cons-1' }, CTX);
      expect(result.status).toBe('draft');
    });
  });

  // -------------------------------------------------------------------------
  // issue
  // -------------------------------------------------------------------------

  describe('issue', () => {
    it('throws when not in draft status', async () => {
      queueFindOne(db, ISSUED);
      await expect(service.issue('inv-1', CTX)).rejects.toThrow(BadRequestException);
    });

    it('throws when draft has no lines', async () => {
      queueFindOne(db, DRAFT, []);
      await expect(service.issue('inv-1', CTX)).rejects.toThrow(UnprocessableEntityException);
    });

    it('issues a draft invoice and returns issued state', async () => {
      queueFindOne(db, DRAFT);                // first findOneOrFail in issue()
      (db.limit as jest.Mock).mockResolvedValueOnce([OWNER]); // owner lookup
      db.transaction = jest.fn().mockImplementation(
        async (fn: (tx: ReturnType<typeof makeTx>) => Promise<unknown>) => {
          const tx = makeTx();
          tx.execute = jest.fn().mockResolvedValue([{ nextval: '42' }]);
          return fn(tx);
        },
      );
      queueFindOne(db, { ...ISSUED, invoiceNumber: 'VET-2026-000042' }); // final findOneOrFail

      const result = await service.issue('inv-1', CTX);
      expect(result.status).toBe('issued');
    });
  });

  // -------------------------------------------------------------------------
  // cancel
  // -------------------------------------------------------------------------

  describe('cancel', () => {
    it('cancels a draft', async () => {
      queueFindOne(db, DRAFT);
      db.transaction = jest.fn().mockResolvedValue(undefined);
      queueFindOne(db, { ...DRAFT, status: 'cancelled' });

      const result = await service.cancel('inv-1', 'duplicate', CTX);
      expect(result.status).toBe('cancelled');
    });

    it('throws when cancelling an issued invoice', async () => {
      queueFindOne(db, ISSUED);
      await expect(service.cancel('inv-1', 'reason', CTX)).rejects.toThrow(BadRequestException);
    });
  });

  // -------------------------------------------------------------------------
  // storno
  // -------------------------------------------------------------------------

  describe('storno', () => {
    it('throws when invoice is in draft status', async () => {
      queueFindOne(db, DRAFT);
      await expect(service.storno('inv-1', CTX)).rejects.toThrow(BadRequestException);
    });

    it('throws when storno already exists', async () => {
      queueFindOne(db, ISSUED);
      (db.limit as jest.Mock).mockResolvedValueOnce([{ id: 'existing-storno' }]);
      await expect(service.storno('inv-1', CTX)).rejects.toThrow(ConflictException);
    });

    it('creates credit note for issued invoice', async () => {
      const CREDIT = { ...ISSUED, id: 'credit-1', totalAmount: '-109.00', stornoOfInvoiceId: 'inv-1' };

      queueFindOne(db, ISSUED);                         // findOneOrFail inside storno
      (db.limit as jest.Mock).mockResolvedValueOnce([]); // no existing storno
      db.transaction = jest.fn().mockImplementation(
        async (fn: (tx: ReturnType<typeof makeTx>) => Promise<unknown>) => {
          const tx = makeTx();
          tx.execute = jest.fn().mockResolvedValue([{ nextval: '2' }]);
          tx.returning = jest.fn().mockResolvedValue([CREDIT]);
          return fn(tx);
        },
      );
      queueFindOne(db, CREDIT, [{ ...LINES[0], description: '[STORNO] Consultation', quantity: '-1.000' }]);

      const result = await service.storno('inv-1', CTX);
      expect(result.stornoOfInvoiceId).toBe('inv-1');
    });
  });

  // -------------------------------------------------------------------------
  // addPayment
  // -------------------------------------------------------------------------

  describe('addPayment', () => {
    it('throws when invoice status is not issued or partially_paid', async () => {
      queueFindOne(db, DRAFT);
      await expect(
        service.addPayment('inv-1', { amount: '50', paymentMethod: 'cash' as never }, CTX),
      ).rejects.toThrow(BadRequestException);
    });

    it('throws when payment would exceed remaining balance', async () => {
      queueFindOne(db, ISSUED);
      await expect(
        service.addPayment('inv-1', { amount: '200', paymentMethod: 'cash' as never }, CTX),
      ).rejects.toThrow(BadRequestException);
    });

    it('transitions to partially_paid on partial payment', async () => {
      queueFindOne(db, ISSUED);
      db.transaction = jest.fn().mockResolvedValue(undefined);
      queueFindOne(db, { ...ISSUED, status: 'partially_paid', paidAmount: '50.00' });

      const result = await service.addPayment('inv-1', { amount: '50', paymentMethod: 'cash' as never }, CTX);
      expect(result.status).toBe('partially_paid');
      expect(result.paidAmount).toBe('50.00');
    });

    it('transitions to paid on full payment', async () => {
      queueFindOne(db, ISSUED);
      db.transaction = jest.fn().mockResolvedValue(undefined);
      queueFindOne(db, { ...ISSUED, status: 'paid', paidAmount: '109.00' });

      const result = await service.addPayment('inv-1', { amount: '109', paymentMethod: 'card' as never }, CTX);
      expect(result.status).toBe('paid');
    });

    it('transitions to paid when total paid reaches invoice total', async () => {
      const partiallyPaid = { ...ISSUED, status: 'partially_paid', paidAmount: '59.00' };
      queueFindOne(db, partiallyPaid);
      db.transaction = jest.fn().mockResolvedValue(undefined);
      queueFindOne(db, { ...partiallyPaid, status: 'paid', paidAmount: '109.00' });

      const result = await service.addPayment('inv-1', { amount: '50', paymentMethod: 'bank_transfer' as never }, CTX);
      expect(result.status).toBe('paid');
    });
  });

  // -------------------------------------------------------------------------
  // computeTotals — tested via createDraft
  // -------------------------------------------------------------------------

  describe('computeTotals', () => {
    it('correctly sums subtotal and VAT across multiple lines with different rates', async () => {
      (db.limit as jest.Mock).mockResolvedValueOnce([OWNER]);

      let capturedInsert: Record<string, unknown> = {};
      db.transaction = jest.fn().mockImplementation(
        async (fn: (tx: ReturnType<typeof makeTx>) => Promise<unknown>) => {
          const tx = makeTx();
          tx.values = jest.fn().mockImplementation((v: Record<string, unknown>) => {
            if (v['subtotal'] !== undefined) capturedInsert = v;
            return tx;
          });
          tx.returning = jest.fn().mockResolvedValue([DRAFT]);
          return fn(tx);
        },
      );
      queueFindOne(db, DRAFT);

      await service.createDraft({
        ownerId: 'owner-1',
        lines: [
          { description: 'A', quantity: '2', unitPrice: '50.00', vatRate: '9'  },  // net=100, vat=9
          { description: 'B', quantity: '1', unitPrice: '20.00', vatRate: '19' },  // net=20,  vat=3.80
        ],
      }, CTX);

      // subtotal=120, vatAmount=12.80, totalAmount=132.80
      expect(capturedInsert['subtotal']).toBe('120.00');
      expect(capturedInsert['vatAmount']).toBe('12.80');
      expect(capturedInsert['totalAmount']).toBe('132.80');
    });
  });
});
