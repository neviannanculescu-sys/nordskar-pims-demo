import { Test, TestingModule } from '@nestjs/testing';
import {
  NotFoundException, BadRequestException, UnprocessableEntityException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SpvService }    from './spv.service';
import { AnafApiClient } from './anaf-api.client';
import { XsdValidator }  from './xml/xsd.validator';
import { DRIZZLE_DB }    from '../../database/database.module';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const makeTx = () => ({
  execute:   jest.fn().mockResolvedValue(undefined),
  insert:    jest.fn().mockReturnThis(),
  values:    jest.fn().mockReturnThis(),
  update:    jest.fn().mockReturnThis(),
  set:       jest.fn().mockReturnThis(),
  where:     jest.fn().mockReturnThis(),
  returning: jest.fn().mockResolvedValue([{ id: 'sub-1' }]),
});

const makeDb = () => ({
  select:      jest.fn().mockReturnThis(),
  from:        jest.fn().mockReturnThis(),
  where:       jest.fn().mockReturnThis(),
  limit:       jest.fn().mockResolvedValue([]),
  orderBy:     jest.fn().mockResolvedValue([]),
  insert:      jest.fn().mockReturnThis(),
  update:      jest.fn().mockReturnThis(),
  set:         jest.fn().mockReturnThis(),
  returning:   jest.fn().mockResolvedValue([]),
  execute:     jest.fn().mockResolvedValue({ rows: [] }),
  transaction: jest.fn().mockImplementation(
    (fn: (tx: ReturnType<typeof makeTx>) => Promise<unknown>) => fn(makeTx()),
  ),
});

const makeAnafClient = () => ({
  getAccessToken:    jest.fn().mockResolvedValue('mock-token'),
  uploadInvoice:     jest.fn().mockResolvedValue({ executionStatus: 0, uploadIndex: '999888' }),
  getStatus:         jest.fn().mockResolvedValue({ stare: 'ok', downloadId: '777' }),
  downloadResponse:  jest.fn().mockResolvedValue({
    responseXml:  '<ConfirmareInregistrare xmlns:ns2="mfinante.ro"><Confirmare stare="ok"/></ConfirmareInregistrare>',
    rawZipBase64: 'base64==',
  }),
});

const makeXsdValidator = () => ({
  validateStructure: jest.fn().mockReturnValue({ valid: true, errors: [] }),
  validateWithXsd:   jest.fn().mockResolvedValue({ valid: true, errors: [] }),
});

const makeConfig = () => ({
  get: jest.fn().mockImplementation((key: string, def: string) => {
    const map: Record<string, string> = {
      CLINIC_NAME:        'Cabinet Dr. Popescu',
      CLINIC_VAT_NUMBER:  'RO12345678',
      CLINIC_STREET:      'Str. Unirii 1',
      CLINIC_CITY:        'Cluj-Napoca',
      CLINIC_ZIP:         '400000',
      CLINIC_IBAN:        'RO49AAAA1B31007593840000',
      CLINIC_CIF:         '12345678',
    };
    return map[key] ?? def;
  }),
});

const CTX = { userId: 'user-1', ip: '127.0.0.1', sessionId: 'sess-1' };

const ISSUED_INVOICE = {
  id: 'inv-1', invoiceNumber: 'VET-2026-000001', status: 'issued',
  ownerId: 'owner-1', consultationId: 'cons-1',
  subtotal: '100.00', vatAmount: '9.00', totalAmount: '109.00',
  currency: 'RON', issuedAt: new Date('2026-01-15'),
  dueDate: '2026-01-30', notes: null, deletedAt: null, stornoOfInvoiceId: null,
};

const OWNER = {
  id: 'owner-1', type: 'individual', firstName: 'Ion', lastName: 'Popescu',
  companyName: null, cui: null,
  addressStreet: 'Str. Unirii 1', addressCity: 'Cluj-Napoca',
  addressZip: '400000', addressCountry: 'RO',
};

const LINES = [{
  id: 'line-1', invoiceId: 'inv-1', description: 'Consultație', position: 0,
  quantity: '1.000', unitPrice: '100.00', vatRate: '9', lineTotal: '100.00',
  unit: 'buc', costSnapshot: null,
}];

const SUBMISSION = {
  id: 'sub-1', invoiceId: 'inv-1', invoiceNumber: 'VET-2026-000001',
  status: 'uploaded', uploadIndex: '999888', downloadId: null,
  xmlContent: '<xml/>', xmlSha256: 'abc', retryCount: 0,
  submittedAt: new Date(), errorMessage: null,
};

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------

describe('SpvService', () => {
  let service: SpvService;
  let db: ReturnType<typeof makeDb>;
  let anaf: ReturnType<typeof makeAnafClient>;
  let xsd: ReturnType<typeof makeXsdValidator>;

  beforeEach(async () => {
    db   = makeDb();
    anaf = makeAnafClient();
    xsd  = makeXsdValidator();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SpvService,
        { provide: DRIZZLE_DB,   useValue: db },
        { provide: AnafApiClient, useValue: anaf },
        { provide: XsdValidator, useValue: xsd },
        { provide: ConfigService, useValue: makeConfig() },
      ],
    }).compile();

    service = module.get<SpvService>(SpvService);
  });

  // -------------------------------------------------------------------------
  // generateXml
  // -------------------------------------------------------------------------

  describe('generateXml', () => {
    it('throws when invoice not found', async () => {
      db.limit = jest.fn().mockResolvedValue([]);
      await expect(service.generateXml('missing')).rejects.toThrow(NotFoundException);
    });

    it('throws when invoice has no invoice number (not issued)', async () => {
      db.limit = jest.fn()
        .mockResolvedValueOnce([{ ...ISSUED_INVOICE, invoiceNumber: null }]);
      await expect(service.generateXml('inv-1')).rejects.toThrow(UnprocessableEntityException);
    });

    it('generates valid XML with correct structure', async () => {
      db.limit = jest.fn()
        .mockResolvedValueOnce([ISSUED_INVOICE])
        .mockResolvedValueOnce([OWNER]);
      db.orderBy = jest.fn().mockResolvedValueOnce(LINES);

      const { xml, sha256 } = await service.generateXml('inv-1');

      expect(xml).toContain('CIUS-RO:1.0.1');
      expect(xml).toContain('VET-2026-000001');
      expect(xml).toContain('380');         // typeCode = commercial invoice
      expect(xml).toContain('RON');
      expect(xml).toContain('Consultație');
      expect(sha256).toHaveLength(64);
    });

    it('generates typeCode 381 for storno invoice', async () => {
      db.limit = jest.fn()
        .mockResolvedValueOnce([{ ...ISSUED_INVOICE, stornoOfInvoiceId: 'orig-inv' }])
        .mockResolvedValueOnce([OWNER])
        .mockResolvedValueOnce([{ invoiceNumber: 'VET-2026-000001' }]); // getInvoiceNumber
      db.orderBy = jest.fn().mockResolvedValueOnce(LINES);

      const { xml } = await service.generateXml('inv-1');
      expect(xml).toContain('381');
    });
  });

  // -------------------------------------------------------------------------
  // validateXml
  // -------------------------------------------------------------------------

  describe('validateXml', () => {
    it('returns valid when structural and XSD pass', async () => {
      const result = await service.validateXml('<Invoice>...</Invoice>');
      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it('returns errors when structural validation fails', async () => {
      xsd.validateStructure = jest.fn().mockReturnValue({
        valid:  false,
        errors: ['Element obligatoriu lipsă: Număr factură (ID)'],
      });
      const result = await service.validateXml('<broken/>');
      expect(result.valid).toBe(false);
      expect(result.errors).toHaveLength(1);
    });
  });

  // -------------------------------------------------------------------------
  // submit — happy path
  // -------------------------------------------------------------------------

  describe('submit', () => {
    it('throws when invoice not found', async () => {
      db.execute = jest.fn().mockResolvedValue({ rows: [] }); // no active submission
      db.limit   = jest.fn().mockResolvedValue([]);           // invoice not found
      await expect(service.submit('missing', CTX)).rejects.toThrow(NotFoundException);
    });

    it('throws when invoice is in draft status', async () => {
      // submit() uses db.select().limit() for both: active submission check AND invoice check
      (db.limit as jest.Mock)
        .mockResolvedValueOnce([])  // active submission check → none found
        .mockResolvedValueOnce([{ ...ISSUED_INVOICE, status: 'draft', invoiceNumber: null }]); // invoice
      await expect(service.submit('inv-1', CTX)).rejects.toThrow(BadRequestException);
    });

    it('throws when active submission already exists', async () => {
      // First db.limit call = active submission check → returns existing submission
      (db.limit as jest.Mock).mockResolvedValueOnce([{ id: 'existing-sub', status: 'processing' }]);
      await expect(service.submit('inv-1', CTX)).rejects.toThrow(BadRequestException);
    });

    it('happy path: submits, records uploadIndex, returns uploaded submission', async () => {
      (db.limit as jest.Mock)
        .mockResolvedValueOnce([])                                                         // active submission check
        .mockResolvedValueOnce([{ status: 'issued', invoiceNumber: 'VET-2026-000001' }])  // invoice status check
        .mockResolvedValueOnce([ISSUED_INVOICE])                                           // loadInvoiceForXml
        .mockResolvedValueOnce([OWNER])                                                    // owner
        .mockResolvedValueOnce([SUBMISSION]);                                              // findSubmissionOrFail

      db.orderBy = jest.fn().mockResolvedValueOnce(LINES);

      db.transaction = jest.fn().mockImplementation(
        async (fn: (tx: ReturnType<typeof makeTx>) => Promise<unknown>) => {
          const tx = makeTx();
          tx.returning = jest.fn().mockResolvedValue([{ id: 'sub-1' }]);
          return fn(tx);
        },
      );

      const result = await service.submit('inv-1', CTX);
      expect(result.uploadIndex).toBe('999888');
      expect(anaf.uploadInvoice).toHaveBeenCalledTimes(1);
    });

    it('marks submission as error when ANAF upload fails', async () => {
      anaf.uploadInvoice = jest.fn().mockResolvedValue({
        executionStatus: 1, uploadIndex: '', errorMessage: 'CIF furnizor invalid',
      });
      (db.limit as jest.Mock)
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([{ status: 'issued', invoiceNumber: 'VET-2026-000001' }])
        .mockResolvedValueOnce([ISSUED_INVOICE])
        .mockResolvedValueOnce([OWNER]);
      db.orderBy = jest.fn().mockResolvedValueOnce(LINES);
      db.transaction = jest.fn().mockImplementation(
        async (fn: (tx: ReturnType<typeof makeTx>) => Promise<unknown>) => fn(makeTx()),
      );

      await expect(service.submit('inv-1', CTX)).rejects.toThrow(BadRequestException);
    });

    it('marks submission as error on network failure', async () => {
      anaf.uploadInvoice = jest.fn().mockRejectedValue(new Error('ECONNREFUSED'));
      (db.limit as jest.Mock)
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([{ status: 'issued', invoiceNumber: 'VET-2026-000001' }])
        .mockResolvedValueOnce([ISSUED_INVOICE])
        .mockResolvedValueOnce([OWNER]);
      db.orderBy = jest.fn().mockResolvedValueOnce(LINES);
      db.transaction = jest.fn().mockImplementation(
        async (fn: (tx: ReturnType<typeof makeTx>) => Promise<unknown>) => fn(makeTx()),
      );

      await expect(service.submit('inv-1', CTX)).rejects.toThrow(BadRequestException);
    });
  });

  // -------------------------------------------------------------------------
  // pollStatus — happy path (ok) și NOK
  // -------------------------------------------------------------------------

  describe('pollStatus', () => {
    it('throws when submission not found', async () => {
      db.limit = jest.fn().mockResolvedValue([]);
      await expect(service.pollStatus('missing', CTX)).rejects.toThrow(NotFoundException);
    });

    it('throws when status is not uploaded/processing', async () => {
      db.limit = jest.fn().mockResolvedValueOnce([{ ...SUBMISSION, status: 'accepted' }]);
      await expect(service.pollStatus('sub-1', CTX)).rejects.toThrow(BadRequestException);
    });

    it('happy path: ok → accepted + response saved', async () => {
      anaf.getStatus = jest.fn().mockResolvedValue({ stare: 'ok', downloadId: '777' });
      anaf.downloadResponse = jest.fn().mockResolvedValue({
        responseXml:  '<ConfirmareInregistrare><Confirmare stare="ok"/></ConfirmareInregistrare>',
        rawZipBase64: 'zip64',
      });

      db.limit = jest.fn()
        .mockResolvedValueOnce([SUBMISSION])                       // findSubmissionOrFail
        .mockResolvedValueOnce([{ ...SUBMISSION, status: 'accepted' }]); // final fetch

      const result = await service.pollStatus('sub-1', CTX);
      expect(anaf.downloadResponse).toHaveBeenCalledWith('777');
      expect(result.status).toBe('accepted');
    });

    it('NOK path: rejected + human explanation saved', async () => {
      anaf.getStatus = jest.fn().mockResolvedValue({ stare: 'nok', downloadId: '888' });
      anaf.downloadResponse = jest.fn().mockResolvedValue({
        responseXml:  '<Erori><Eroare errorCode="E0001" errorMessage="CIF furnizor invalid"/></Erori>',
        rawZipBase64: 'zip64',
      });

      db.limit = jest.fn()
        .mockResolvedValueOnce([SUBMISSION])
        .mockResolvedValueOnce([{ ...SUBMISSION, status: 'rejected', errorMessage: 'CIF furnizor invalid' }]);

      const result = await service.pollStatus('sub-1', CTX);
      expect(result.status).toBe('rejected');
    });

    it('in prelucrare: transitions uploaded → processing', async () => {
      anaf.getStatus = jest.fn().mockResolvedValue({ stare: 'in prelucrare' });

      db.limit = jest.fn()
        .mockResolvedValueOnce([SUBMISSION])
        .mockResolvedValueOnce([{ ...SUBMISSION, status: 'processing' }]);

      const result = await service.pollStatus('sub-1', CTX);
      expect(result.status).toBe('processing');
    });
  });

  // -------------------------------------------------------------------------
  // alertUnconfirmedSubmissions
  // -------------------------------------------------------------------------

  describe('alertUnconfirmedSubmissions', () => {
    it('returns empty array when no stale submissions', async () => {
      db.execute = jest.fn().mockResolvedValue({ rows: [] });
      const alerts = await service.alertUnconfirmedSubmissions();
      expect(alerts).toHaveLength(0);
    });

    it('returns stale submissions with daysPending calculated', async () => {
      const oldDate = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000); // 7 days ago
      db.execute = jest.fn().mockResolvedValue({
        rows: [{ id: 'sub-old', invoice_number: 'VET-2026-000001', submitted_at: oldDate }],
      });
      const alerts = await service.alertUnconfirmedSubmissions();
      expect(alerts).toHaveLength(1);
      expect(alerts[0].daysPending).toBeGreaterThanOrEqual(7);
      expect(alerts[0].submissionId).toBe('sub-old');
    });
  });

  // -------------------------------------------------------------------------
  // XML structure — unit test on generator directly
  // -------------------------------------------------------------------------

  describe('XML generator (direct)', () => {
    it('produces XML with mandatory CIUS-RO elements', async () => {
      db.limit = jest.fn()
        .mockResolvedValueOnce([ISSUED_INVOICE])
        .mockResolvedValueOnce([OWNER]);
      db.orderBy = jest.fn().mockResolvedValueOnce(LINES);

      const { xml } = await service.generateXml('inv-1');

      // Elementele obligatorii CIUS-RO
      expect(xml).toContain('UBLVersionID');
      expect(xml).toContain('CustomizationID');
      expect(xml).toContain('IssueDate');
      expect(xml).toContain('InvoiceTypeCode');
      expect(xml).toContain('DocumentCurrencyCode');
      expect(xml).toContain('AccountingSupplierParty');
      expect(xml).toContain('AccountingCustomerParty');
      expect(xml).toContain('TaxTotal');
      expect(xml).toContain('LegalMonetaryTotal');
      expect(xml).toContain('InvoiceLine');
      expect(xml).toContain('unitCode');     // obligatoriu pe InvoicedQuantity
      expect(xml).toContain('currencyID');   // obligatoriu pe sume monetare
    });
  });
});
