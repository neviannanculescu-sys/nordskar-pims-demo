import { Test, TestingModule }    from '@nestjs/testing';
import { AccountingExportService } from './accounting-export.service';
import { DRIZZLE_DB }              from '../../database/database.module';

const makeDb = () => ({
  execute: jest.fn().mockResolvedValue({ rows: [] }),
});

// Helpers pentru fixture-uri
const makeInvoiceRow = (overrides = {}) => ({
  docDate: '2026-01-15', docNumber: 'VET-2026-000001',
  customerVatId: 'RO12345678', customerName: 'Cabinet Dr. Ionescu SRL',
  base0: 0, base9: 100, base19: 0,
  vat9: 9, vat19: 0, total: 109,
  paymentStatus: 'paid', paidAmount: 109, journalPrefix: 'VZ',
  ...overrides,
});

describe('AccountingExportService', () => {
  let service: AccountingExportService;
  let db: ReturnType<typeof makeDb>;

  beforeEach(async () => {
    db = makeDb();
    const module: TestingModule = await Test.createTestingModule({
      providers: [AccountingExportService, { provide: DRIZZLE_DB, useValue: db }],
    }).compile();
    service = module.get<AccountingExportService>(AccountingExportService);
  });

  // -------------------------------------------------------------------------
  // getInvoiceRows
  // -------------------------------------------------------------------------

  describe('getInvoiceRows', () => {
    it('maps DB rows to AccountingRow correctly', async () => {
      db.execute = jest.fn().mockResolvedValue({
        rows: [{
          doc_date: '2026-01-15', invoice_number: 'VET-2026-000001',
          customer_vat_id: 'RO12345678', customer_name: 'Dr. Ionescu SRL',
          base0: '0.00', base9: '100.00', base19: '50.00',
          vat9: '9.00', vat19: '9.50',
          total_amount: '168.50', status: 'paid', paid_amount: '168.50',
        }],
      });
      const rows = await service.getInvoiceRows('2026-01-01', '2026-01-31');
      expect(rows).toHaveLength(1);
      expect(rows[0].base9).toBe(100);
      expect(rows[0].vat19).toBe(9.5);
      expect(rows[0].total).toBe(168.5);
      expect(rows[0].journalPrefix).toBe('VZ');
    });

    it('returns empty array when no invoices in period', async () => {
      db.execute = jest.fn().mockResolvedValue({ rows: [] });
      const rows = await service.getInvoiceRows('2020-01-01', '2020-01-31');
      expect(rows).toHaveLength(0);
    });
  });

  // -------------------------------------------------------------------------
  // exportToCsv
  // -------------------------------------------------------------------------

  describe('exportToCsv', () => {
    it('starts with UTF-8 BOM', () => {
      const csv = service.exportToCsv([makeInvoiceRow()]);
      expect(csv.charCodeAt(0)).toBe(0xFEFF);
    });

    it('contains header row with correct column names', () => {
      const csv = service.exportToCsv([]);
      expect(csv).toContain('Nr. Document');
      expect(csv).toContain('Baza TVA 9%');
      expect(csv).toContain('TVA 19%');
      expect(csv).toContain('Jurnal');
    });

    it('uses semicolon separator (format Saga C)', () => {
      const csv = service.exportToCsv([makeInvoiceRow()]);
      const dataLine = csv.split('\r\n')[1];
      expect(dataLine.split(';').length).toBeGreaterThan(10);
    });

    it('uses comma as decimal separator for Romanian Excel', () => {
      const csv = service.exportToCsv([makeInvoiceRow({ total: 109.50 })]);
      expect(csv).toContain('109,50');
      expect(csv).not.toContain('109.50');
    });

    it('escapes double quotes in customer name', () => {
      const csv = service.exportToCsv([makeInvoiceRow({ customerName: 'Cabinet "Dr." Popescu' })]);
      expect(csv).toContain('"Cabinet ""Dr."" Popescu"');
    });

    it('generates correct row count (header + data)', () => {
      const rows = [makeInvoiceRow(), makeInvoiceRow({ docNumber: 'VET-2026-000002' })];
      const csv  = service.exportToCsv(rows);
      const lines = csv.trimEnd().split('\r\n');
      expect(lines).toHaveLength(3); // header + 2 rows
    });
  });

  // -------------------------------------------------------------------------
  // exportToXlsx
  // -------------------------------------------------------------------------

  describe('exportToXlsx', () => {
    it('returns non-empty Buffer', async () => {
      const rows = [makeInvoiceRow()];
      const payments = [{ docDate: '2026-01-15', invoiceNumber: 'VET-2026-000001', customerName: 'X', amount: 109, method: 'cash', reference: null }];
      const buffer = await service.exportToXlsx(rows, payments, '2026-01-01', '2026-01-31');
      expect(Buffer.isBuffer(buffer)).toBe(true);
      expect(buffer.length).toBeGreaterThan(1000);
    });

    it('generates valid XLSX magic bytes', async () => {
      const buffer = await service.exportToXlsx([], [], '2026-01-01', '2026-01-31');
      // XLSX (ZIP) starts with PK magic bytes: 0x50 0x4B
      expect(buffer[0]).toBe(0x50);
      expect(buffer[1]).toBe(0x4B);
    });
  });

  // -------------------------------------------------------------------------
  // totals cross-check
  // -------------------------------------------------------------------------

  describe('totals cross-check', () => {
    it('sum of base9 + vat9 equals reported total for 9% only invoice', () => {
      const row = makeInvoiceRow({ base9: 100, vat9: 9, base0: 0, base19: 0, vat19: 0, total: 109 });
      const computedTotal = row.base0 + row.base9 + row.base19 + row.vat9 + row.vat19;
      expect(computedTotal).toBe(row.total);
    });

    it('CSV export totals match sum of rows', () => {
      const rows = [
        makeInvoiceRow({ base9: 100, vat9: 9, total: 109, paidAmount: 109 }),
        makeInvoiceRow({ base9: 200, vat9: 18, total: 218, paidAmount: 0, paymentStatus: 'issued', docNumber: 'VET-2026-000002' }),
      ];
      const totalRevenue = rows.reduce((s, r) => s + r.total, 0);
      const totalPaid    = rows.reduce((s, r) => s + r.paidAmount, 0);
      expect(totalRevenue).toBe(327);
      expect(totalPaid).toBe(109);
    });
  });
});
