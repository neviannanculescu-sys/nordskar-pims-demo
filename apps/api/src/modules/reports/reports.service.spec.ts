import { Test, TestingModule } from '@nestjs/testing';
import { ReportsService } from './reports.service';
import { DRIZZLE_DB }     from '../../database/database.module';

const makeDb = () => ({
  execute: jest.fn().mockResolvedValue({ rows: [] }),
});

describe('ReportsService', () => {
  let service: ReportsService;
  let db: ReturnType<typeof makeDb>;

  beforeEach(async () => {
    db = makeDb();
    const module: TestingModule = await Test.createTestingModule({
      providers: [ReportsService, { provide: DRIZZLE_DB, useValue: db }],
    }).compile();
    service = module.get<ReportsService>(ReportsService);
  });

  // -------------------------------------------------------------------------
  // revenueByPeriod
  // -------------------------------------------------------------------------

  describe('revenueByPeriod', () => {
    it('returns empty array when no invoices', async () => {
      db.execute = jest.fn().mockResolvedValue({ rows: [] });
      const result = await service.revenueByPeriod({ dateFrom: '2026-01-01', dateTo: '2026-01-31', groupBy: 'month' });
      expect(result).toHaveLength(0);
    });

    it('computes outstanding correctly', async () => {
      db.execute = jest.fn().mockResolvedValue({
        rows: [{
          period: '2026-01-01', invoice_count: '3',
          subtotal: '300.00', vat_amount: '27.00',
          total_amount: '327.00', paid_amount: '200.00',
        }],
      });
      const [row] = await service.revenueByPeriod({ dateFrom: '2026-01-01', dateTo: '2026-01-31', groupBy: 'day' });
      expect(row.outstanding).toBe(127);
      expect(row.invoiceCount).toBe(3);
    });
  });

  // -------------------------------------------------------------------------
  // revenueByService
  // -------------------------------------------------------------------------

  describe('revenueByService', () => {
    it('returns grouped service rows', async () => {
      db.execute = jest.fn().mockResolvedValue({
        rows: [
          { source_type: 'procedure', description: 'Consultație', quantity: '10.000', line_total: '1000.00', vat_amount: '90.00' },
          { source_type: 'treatment_line', description: 'Amoxicillin', quantity: '5.000', line_total: '50.00', vat_amount: '4.50' },
        ],
      });
      const result = await service.revenueByService({ dateFrom: '2026-01-01', dateTo: '2026-01-31' });
      expect(result).toHaveLength(2);
      expect(result[0].lineTotal).toBe(1000);
      expect(result[1].sourceType).toBe('treatment_line');
    });
  });

  // -------------------------------------------------------------------------
  // vetPerformance
  // -------------------------------------------------------------------------

  describe('vetPerformance', () => {
    it('returns vet performance rows', async () => {
      db.execute = jest.fn().mockResolvedValue({
        rows: [{
          veterinarian_id:    'vet-1',
          veterinarian_name:  'Dr. Ionescu',
          consultation_count: '12',
          procedure_count:    '30',
          total_revenue:      '3500.00',
        }],
      });
      const [row] = await service.vetPerformance({ dateFrom: '2026-01-01', dateTo: '2026-01-31' });
      expect(row.veterinarianName).toBe('Dr. Ionescu');
      expect(row.consultationCount).toBe(12);
      expect(row.totalRevenue).toBe(3500);
    });
  });

  // -------------------------------------------------------------------------
  // outstandingInvoices
  // -------------------------------------------------------------------------

  describe('outstandingInvoices', () => {
    it('calculates daysOverdue correctly', async () => {
      // Factură cu due_date în trecut
      const pastDate = new Date(Date.now() - 10 * 86_400_000).toISOString().slice(0, 10);
      db.execute = jest.fn().mockResolvedValue({
        rows: [{
          invoice_id: 'inv-1', invoice_number: 'VET-2026-000001',
          owner_name: 'Ion Popescu', issued_at: '2026-01-01',
          due_date: pastDate, total_amount: '109.00', paid_amount: '0',
        }],
      });
      const [row] = await service.outstandingInvoices({});
      expect(row.outstanding).toBe(109);
      expect(row.daysOverdue).toBeGreaterThanOrEqual(10);
    });

    it('returns 0 daysOverdue for invoices with no due_date', async () => {
      db.execute = jest.fn().mockResolvedValue({
        rows: [{
          invoice_id: 'inv-2', invoice_number: 'VET-2026-000002',
          owner_name: 'Maria Ionescu', issued_at: '2026-01-15',
          due_date: null, total_amount: '200.00', paid_amount: '100.00',
        }],
      });
      const [row] = await service.outstandingInvoices({});
      expect(row.outstanding).toBe(100);
      expect(row.daysOverdue).toBe(0);
    });
  });

  // -------------------------------------------------------------------------
  // inventoryConsumption
  // -------------------------------------------------------------------------

  describe('inventoryConsumption', () => {
    it('returns consumption rows ordered by cost desc', async () => {
      db.execute = jest.fn().mockResolvedValue({
        rows: [
          { inventory_item_id: 'item-1', sku: 'MED-001', name: 'Amoxicillin', total_dispensed: '50.000', unit: 'tab', total_cost: '200.00' },
          { inventory_item_id: 'item-2', sku: 'CON-001', name: 'Seringă', total_dispensed: '100.000', unit: 'buc', total_cost: '30.00' },
        ],
      });
      const result = await service.inventoryConsumption({ dateFrom: '2026-01-01', dateTo: '2026-01-31' });
      expect(result).toHaveLength(2);
      expect(result[0].totalCost).toBe(200);
    });
  });

  // -------------------------------------------------------------------------
  // getUnbilledServices
  // -------------------------------------------------------------------------

  describe('getUnbilledServices', () => {
    it('returns unbilled consultation rows', async () => {
      db.execute = jest.fn().mockResolvedValue({
        rows: [{
          consultation_id: 'c-1',
          consultation_date: '2026-06-01',
          unbilled_procedures: '2',
          unbilled_medications: '3',
          estimated_total: '350.50',
          days_since_consultation: '8',
        }],
      });
      const result = await service.getUnbilledServices({});
      expect(result).toHaveLength(1);
      expect(result[0].unbilledProcedures).toBe(2);
      expect(result[0].unbilledMedications).toBe(3);
      expect(result[0].estimatedTotal).toBe(350.5);
      expect(result[0].daysSinceConsultation).toBe(8);
    });

    it('returns empty array when all consultations are billed', async () => {
      db.execute = jest.fn().mockResolvedValue({ rows: [] });
      const result = await service.getUnbilledServices({ dateFrom: '2026-01-01', dateTo: '2026-01-31' });
      expect(result).toHaveLength(0);
    });
  });

  // -------------------------------------------------------------------------
  // runDailyReport (cron job)
  // -------------------------------------------------------------------------

  describe('runDailyReport', () => {
    it('calls dashboardSummary and getUnbilledServices', async () => {
      // 4 calls for dashboardSummary + 1 for getUnbilledServices
      db.execute = jest.fn()
        // dashboardSummary calls
        .mockResolvedValueOnce({ rows: [{ consultations: '5', invoices: '3', revenue: '300.00' }] })
        .mockResolvedValueOnce({ rows: [{ consultations: '80', invoices: '50', revenue: '5000.00', outstanding: '500.00' }] })
        .mockResolvedValueOnce({ rows: [{ pending: '0', accepted: '40', rejected: '0' }] })
        .mockResolvedValueOnce({ rows: [{ low_stock: '0' }] })
        // getUnbilledServices call
        .mockResolvedValueOnce({ rows: [] });

      await expect(service.runDailyReport()).resolves.toBeUndefined();
      expect(db.execute).toHaveBeenCalledTimes(5);
    });

    it('does not throw on DB error (catches and logs)', async () => {
      db.execute = jest.fn().mockRejectedValue(new Error('DB down'));
      await expect(service.runDailyReport()).resolves.toBeUndefined();
    });
  });

  // -------------------------------------------------------------------------
  // dashboardSummary
  // -------------------------------------------------------------------------

  describe('dashboardSummary', () => {
    it('assembles dashboard from 4 queries', async () => {
      db.execute = jest.fn()
        .mockResolvedValueOnce({ rows: [{ consultations: '5', invoices: '3', revenue: '327.00' }] })
        .mockResolvedValueOnce({ rows: [{ consultations: '80', invoices: '50', revenue: '5400.00', outstanding: '800.00' }] })
        .mockResolvedValueOnce({ rows: [{ pending: '2', accepted: '45', rejected: '1' }] })
        .mockResolvedValueOnce({ rows: [{ low_stock: '3' }] });

      const result = await service.dashboardSummary();
      expect(result.today.consultations).toBe(5);
      expect(result.today.revenue).toBe(327);
      expect(result.month.outstanding).toBe(800);
      expect(result.spv.pending).toBe(2);
      expect(result.stock.lowStockItems).toBe(3);
    });
  });
});
