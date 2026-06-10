import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService }       from '@nestjs/config';
import { AiAssistantService }  from './ai-assistant.service';

// Mock Anthropic SDK
const mockCreate = jest.fn();
jest.mock('@anthropic-ai/sdk', () => ({
  default: jest.fn().mockImplementation(() => ({
    messages: { create: mockCreate },
  })),
}));

const makeTextResponse = (json: object) => ({
  content: [{ type: 'text', text: JSON.stringify(json) }],
});

const makeConfig = () => ({
  getOrThrow: jest.fn().mockReturnValue('test-api-key'),
});

describe('AiAssistantService', () => {
  let service: AiAssistantService;

  beforeEach(async () => {
    jest.clearAllMocks();
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AiAssistantService,
        { provide: ConfigService, useValue: makeConfig() },
      ],
    }).compile();
    service = module.get<AiAssistantService>(AiAssistantService);
  });

  // -------------------------------------------------------------------------
  // verifyInvoiceBeforeIssuance
  // -------------------------------------------------------------------------

  describe('verifyInvoiceBeforeIssuance', () => {
    const validInput = {
      invoiceId: 'inv-1', lineCount: 3,
      subtotal: 100, vatAmount: 9, totalAmount: 109,
      vatBreakdown: [{ rate: 9, base: 100, vat: 9 }],
      ownerType: 'company' as const, hasStornoRef: false, series: 'VET',
    };

    it('returns approved true when Claude approves', async () => {
      mockCreate.mockResolvedValueOnce(makeTextResponse({
        approved: true, issues: [], suggestions: [], summary: 'Factura este corectă.',
      }));
      const result = await service.verifyInvoiceBeforeIssuance(validInput);
      expect(result.approved).toBe(true);
      expect(result.issues).toHaveLength(0);
    });

    it('returns approved false with issues when Claude finds problems', async () => {
      mockCreate.mockResolvedValueOnce(makeTextResponse({
        approved: false,
        issues: ['Total incorect: subtotal + TVA ≠ total'],
        suggestions: ['Reverificați calculul TVA'],
        summary: 'Există o discrepanță în totaluri.',
      }));
      const result = await service.verifyInvoiceBeforeIssuance(validInput);
      expect(result.approved).toBe(false);
      expect(result.issues[0]).toContain('Total');
    });

    it('returns fallback result on API error', async () => {
      mockCreate.mockRejectedValueOnce(new Error('API error'));
      const result = await service.verifyInvoiceBeforeIssuance(validInput);
      expect(result.approved).toBe(false);
      expect(result.issues).toHaveLength(1);
      expect(result.summary).toContain('Eroare');
    });

    it('handles storno invoice (hasStornoRef=true)', async () => {
      mockCreate.mockResolvedValueOnce(makeTextResponse({
        approved: true, issues: [], suggestions: [], summary: 'Nota de credit este corectă.',
      }));
      const result = await service.verifyInvoiceBeforeIssuance({ ...validInput, hasStornoRef: true, totalAmount: -109, subtotal: -100, vatAmount: -9 });
      expect(result.approved).toBe(true);
      expect(mockCreate).toHaveBeenCalledWith(
        expect.objectContaining({ messages: expect.arrayContaining([expect.objectContaining({ content: expect.stringContaining('storno') })]) }),
      );
    });
  });

  // -------------------------------------------------------------------------
  // explainSpvError
  // -------------------------------------------------------------------------

  describe('explainSpvError', () => {
    it('returns structured explanation from Claude', async () => {
      mockCreate.mockResolvedValueOnce(makeTextResponse({
        errorCode: 'E0002',
        title: 'CIF furnizor invalid',
        explanation: 'CIF-ul furnizorului nu este valid în baza ANAF.',
        steps: ['Verificați CIF-ul în CLAUDE.md', 'Corectați în configurație'],
        disclaimer: 'Sistemul nu face corecții automate.',
      }));
      const result = await service.explainSpvError('E0002', '<mes>CIF invalid</mes>');
      expect(result.errorCode).toBe('E0002');
      expect(result.steps).toHaveLength(2);
      expect(result.disclaimer).toContain('automate');
    });

    it('returns fallback on API error', async () => {
      mockCreate.mockRejectedValueOnce(new Error('timeout'));
      const result = await service.explainSpvError('E0001', 'raw error');
      expect(result.errorCode).toBe('E0001');
      expect(result.steps.length).toBeGreaterThan(0);
      expect(result.disclaimer).toContain('automate');
    });

    it('truncates long rawAnafMessage to 500 chars in prompt', async () => {
      const longMsg = 'x'.repeat(1000);
      mockCreate.mockResolvedValueOnce(makeTextResponse({
        errorCode: 'E0001', title: 't', explanation: 'e', steps: [], disclaimer: 'd',
      }));
      await service.explainSpvError('E0001', longMsg);
      const prompt = mockCreate.mock.calls[0][0].messages[0].content as string;
      // The raw message in prompt is sliced to 500 chars
      expect(prompt).toContain('x'.repeat(500));
      expect(prompt).not.toContain('x'.repeat(501));
    });
  });

  // -------------------------------------------------------------------------
  // generateDailySummary
  // -------------------------------------------------------------------------

  describe('generateDailySummary', () => {
    const input = {
      date: '2026-06-09',
      todayConsultations: 12, todayRevenue: 1500,
      monthRevenue: 18000, monthOutstanding: 2200,
      spvPending: 1, spvRejected: 0,
      lowStockItems: 2, unbilledConsultations: 3, unbilledEstimatedTotal: 450,
    };

    it('returns narrative and priorityActions', async () => {
      mockCreate.mockResolvedValueOnce(makeTextResponse({
        narrative: 'Ziua a fost activă cu 12 consultații și venituri de 1.500 RON.',
        priorityActions: ['Facturați cele 3 consultații nefacturate', 'Reaprovizionați 2 produse'],
      }));
      const result = await service.generateDailySummary(input);
      expect(result.narrative).toContain('1.500');
      expect(result.priorityActions).toHaveLength(2);
      expect(result.generatedAt).toBeTruthy();
    });

    it('returns fallback on API error', async () => {
      mockCreate.mockRejectedValueOnce(new Error('rate limit'));
      const result = await service.generateDailySummary(input);
      expect(result.narrative).toContain('Rezumatul automat');
      expect(result.priorityActions).toHaveLength(0);
    });
  });

  // -------------------------------------------------------------------------
  // reconcileServicesVsBilled
  // -------------------------------------------------------------------------

  describe('reconcileServicesVsBilled', () => {
    const input = {
      dateFrom: '2026-06-01', dateTo: '2026-06-09',
      totalConsultations: 100, billedConsultations: 90,
      unbilledConsultations: 10, totalRevenue: 15000,
      outstandingAmount: 3000, spvPending: 2, spvRejected: 1,
    };

    it('returns analysis with riskLevel', async () => {
      mockCreate.mockResolvedValueOnce(makeTextResponse({
        analysis: 'Rata de facturare de 90% este acceptabilă dar poate fi îmbunătățită.',
        riskLevel: 'low',
        recommendations: ['Facturați zilnic', 'Setați reminder pentru consultații nefacturate'],
      }));
      const result = await service.reconcileServicesVsBilled(input);
      expect(result.riskLevel).toBe('low');
      expect(result.recommendations.length).toBeGreaterThan(0);
      expect(result.generatedAt).toBeTruthy();
    });

    it('defaults to medium riskLevel if Claude returns unknown value', async () => {
      mockCreate.mockResolvedValueOnce(makeTextResponse({
        analysis: 'analiza', riskLevel: 'unknown', recommendations: [],
      }));
      const result = await service.reconcileServicesVsBilled(input);
      expect(result.riskLevel).toBe('medium');
    });

    it('returns fallback on error', async () => {
      mockCreate.mockRejectedValueOnce(new Error('err'));
      const result = await service.reconcileServicesVsBilled(input);
      expect(result.riskLevel).toBe('medium');
      expect(result.recommendations.length).toBeGreaterThan(0);
    });
  });
});
