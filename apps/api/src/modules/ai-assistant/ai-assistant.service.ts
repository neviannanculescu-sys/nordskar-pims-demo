import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Anthropic from '@anthropic-ai/sdk';

// ---------------------------------------------------------------------------
// AI Assistant — layer de asistență pentru operatorul uman
//
// PRINCIPII FUNDAMENTALE:
//   - Claude EXPLICĂ și SUGEREAZĂ. Operatorul DECIDE și ACȚIONEAZĂ.
//   - Claude nu face upload SPV, nu emite facturi, nu modifică date financiare.
//   - Prompturile NU conțin date personale (CNP, CUI client, denumire client).
//   - Răspunsurile sunt în română, orientate spre acțiune practică.
// ---------------------------------------------------------------------------

export interface InvoiceVerificationResult {
  approved:    boolean;
  issues:      string[];
  suggestions: string[];
  summary:     string;
}

export interface SpvErrorExplanationResult {
  errorCode:   string;
  title:       string;
  explanation: string;
  steps:       string[];
  disclaimer:  string;
}

export interface DailySummaryResult {
  narrative:       string;
  priorityActions: string[];
  generatedAt:     string;
}

export interface ReconciliationResult {
  analysis:        string;
  riskLevel:       'low' | 'medium' | 'high';
  recommendations: string[];
  generatedAt:     string;
}

// Date anonimizate trimise la Claude — fără PII
interface InvoiceVerificationInput {
  invoiceId:    string;
  lineCount:    number;
  subtotal:     number;
  vatAmount:    number;
  totalAmount:  number;
  vatBreakdown: Array<{ rate: number; base: number; vat: number }>;
  ownerType:    'individual' | 'company';
  hasStornoRef: boolean;
  series:       string;
}

interface DashboardInput {
  date:                  string;
  todayConsultations:    number;
  todayRevenue:          number;
  monthRevenue:          number;
  monthOutstanding:      number;
  spvPending:            number;
  spvRejected:           number;
  lowStockItems:         number;
  unbilledConsultations: number;
  unbilledEstimatedTotal: number;
}

interface ReconciliationInput {
  dateFrom:              string;
  dateTo:                string;
  totalConsultations:    number;
  billedConsultations:   number;
  unbilledConsultations: number;
  totalRevenue:          number;
  outstandingAmount:     number;
  spvPending:            number;
  spvRejected:           number;
}

@Injectable()
export class AiAssistantService {
  private readonly logger = new Logger(AiAssistantService.name);
  private readonly client: Anthropic;
  private readonly model = 'claude-haiku-4-5-20251001'; // haiku pentru latență mică

  constructor(private readonly config: ConfigService) {
    const apiKey = this.config.get<string>('ANTHROPIC_API_KEY', '');
    if (!apiKey) {
      this.logger.warn('ANTHROPIC_API_KEY not set — AI assistant will return fallback responses');
    }
    this.client = new Anthropic({ apiKey: apiKey || 'sk-placeholder' });
  }

  // -------------------------------------------------------------------------
  // 1. Verificare factură înainte de emitere
  //    Input: date financiare anonimizate (fără CNP/CUI/denumire client)
  //    Output: lista de probleme + sugestii în română
  // -------------------------------------------------------------------------

  async verifyInvoiceBeforeIssuance(
    input: InvoiceVerificationInput,
  ): Promise<InvoiceVerificationResult> {
    this.logger.log({ event: 'ai_invoice_verify', invoiceId: input.invoiceId });

    const prompt = `Ești un asistent de verificare financiară pentru o clinică veterinară din România.
Analizează datele facturii de mai jos și identifică eventuale probleme înainte de emitere.

Date factură (toate valorile în RON):
- Număr linii: ${input.lineCount}
- Subtotal (fără TVA): ${input.subtotal.toFixed(2)} RON
- Total TVA: ${input.vatAmount.toFixed(2)} RON
- Total cu TVA: ${input.totalAmount.toFixed(2)} RON
- Structură TVA:
${input.vatBreakdown.map((v) => `  • Cotă ${v.rate}%: bază ${v.base.toFixed(2)} RON, TVA ${v.vat.toFixed(2)} RON`).join('\n')}
- Tip client: ${input.ownerType === 'company' ? 'persoană juridică' : 'persoană fizică'}
- Este notă de credit (storno): ${input.hasStornoRef ? 'DA' : 'NU'}
- Serie factură: ${input.series}

Verifică:
1. Dacă suma subtotal + TVA = total (toleranță ±0.02 RON pentru rotunjiri)
2. Dacă TVA calculat corespunde cotelor aplicabile serviciilor veterinare în România (0%, 9%, 19%)
3. Dacă totalul este pozitiv pentru facturi normale și negativ pentru note de credit
4. Dacă există linii (lineCount > 0)
5. Orice altă anomalie evidentă

Răspunde EXCLUSIV în format JSON, fără text în afara JSON-ului:
{
  "approved": true/false,
  "issues": ["problemă 1", "problemă 2"],
  "suggestions": ["sugestie 1", "sugestie 2"],
  "summary": "rezumat scurt în 1-2 propoziții"
}`;

    try {
      const response = await this.client.messages.create({
        model:      this.model,
        max_tokens: 512,
        messages:   [{ role: 'user', content: prompt }],
      });

      const text = (response.content[0] as { type: 'text'; text: string }).text.trim();
      const parsed = JSON.parse(text) as InvoiceVerificationResult;
      return parsed;
    } catch (err) {
      this.logger.error({ event: 'ai_invoice_verify_error', invoiceId: input.invoiceId });
      return {
        approved:    false,
        issues:      ['Verificarea automată nu a putut fi efectuată.'],
        suggestions: ['Verificați manual totalurile și structura TVA înainte de emitere.'],
        summary:     'Eroare la verificarea automată. Verificați manual.',
      };
    }
  }

  // -------------------------------------------------------------------------
  // 2. Explicare erori SPV în limbaj uman
  //    Input: cod eroare ANAF + mesaj brut XML (fără date client)
  //    Output: explicație pas cu pas + disclaimer
  // -------------------------------------------------------------------------

  async explainSpvError(
    errorCode: string,
    rawAnafMessage: string,
  ): Promise<SpvErrorExplanationResult> {
    this.logger.log({ event: 'ai_spv_explain', errorCode });

    const prompt = `Ești un asistent tehnic pentru sistemul e-Factura / SPV al ANAF România.
Explică în limbaj clar, accesibil unui operator de clinică veterinară, eroarea de mai jos.

Cod eroare: ${errorCode}
Mesaj ANAF (extras relevant, fără date personale):
"${rawAnafMessage.slice(0, 500)}"

Furnizează:
1. O explicație clară a cauzei erorii
2. Pași concreți pentru corectare (numerotați)
3. Menționează că operatorul sau contabilul autorizat trebuie să efectueze corecțiile

Răspunde EXCLUSIV în format JSON:
{
  "errorCode": "${errorCode}",
  "title": "titlu scurt al erorii",
  "explanation": "explicație clară în 2-3 propoziții",
  "steps": ["pasul 1", "pasul 2", "pasul 3"],
  "disclaimer": "Sistemul nu face corecții automate. Un operator autorizat trebuie să verifice și să retrimită factura după corectare."
}`;

    try {
      const response = await this.client.messages.create({
        model:      this.model,
        max_tokens: 700,
        messages:   [{ role: 'user', content: prompt }],
      });

      const text = (response.content[0] as { type: 'text'; text: string }).text.trim();
      return JSON.parse(text) as SpvErrorExplanationResult;
    } catch (err) {
      this.logger.error({ event: 'ai_spv_explain_error', errorCode });
      return {
        errorCode,
        title:       'Eroare necunoscută SPV',
        explanation: 'Mesajul de eroare ANAF nu a putut fi interpretat automat.',
        steps:       [
          'Accesați portalul e-Factura ANAF pentru a vedea detaliile complete ale erorii.',
          'Consultați contabilul autorizat pentru corecție și retrimitere.',
        ],
        disclaimer: 'Sistemul nu face corecții automate. Un operator autorizat trebuie să verifice și să retrimită factura după corectare.',
      };
    }
  }

  // -------------------------------------------------------------------------
  // 3. Rezumat operațional zilnic
  //    Input: date agregate din dashboard (fără PII)
  //    Output: narativ în română pentru managerul clinicii
  // -------------------------------------------------------------------------

  async generateDailySummary(input: DashboardInput): Promise<DailySummaryResult> {
    this.logger.log({ event: 'ai_daily_summary', date: input.date });

    const prompt = `Ești asistentul managerului unei clinici veterinare din România.
Generează un rezumat operațional zilnic concis, profesional, în română, pe baza datelor de mai jos.

Data: ${input.date}
Date operaționale:
- Consultații azi: ${input.todayConsultations}
- Venituri azi: ${input.todayRevenue.toFixed(2)} RON
- Venituri luna curentă: ${input.monthRevenue.toFixed(2)} RON
- Restanțe neîncasate: ${input.monthOutstanding.toFixed(2)} RON
- Facturi SPV în așteptare ANAF: ${input.spvPending}
- Facturi SPV respinse ANAF: ${input.spvRejected}
- Produse sub stoc minim: ${input.lowStockItems}
- Consultații nefacturate: ${input.unbilledConsultations}
- Valoare estimată servicii nefacturate: ${input.unbilledEstimatedTotal.toFixed(2)} RON

Generează:
1. Un paragraf narativ de 3-5 propoziții cu situația zilei
2. O listă cu maximum 3 acțiuni prioritare pentru manager (dacă există probleme)

Răspunde EXCLUSIV în format JSON:
{
  "narrative": "paragraful narativ...",
  "priorityActions": ["acțiune 1", "acțiune 2"]
}`;

    try {
      const response = await this.client.messages.create({
        model:      this.model,
        max_tokens: 600,
        messages:   [{ role: 'user', content: prompt }],
      });

      const text = (response.content[0] as { type: 'text'; text: string }).text.trim();
      const parsed = JSON.parse(text) as { narrative: string; priorityActions: string[] };
      return { ...parsed, generatedAt: new Date().toISOString() };
    } catch (err) {
      this.logger.error({ event: 'ai_daily_summary_error', date: input.date });
      return {
        narrative:       'Rezumatul automat nu a putut fi generat. Verificați datele manual în dashboard.',
        priorityActions: [],
        generatedAt:     new Date().toISOString(),
      };
    }
  }

  // -------------------------------------------------------------------------
  // 4. Reconciliere servicii prestate vs facturate
  //    Input: statistici agregate pe perioadă (fără PII)
  //    Output: analiză risc + recomandări
  // -------------------------------------------------------------------------

  async reconcileServicesVsBilled(input: ReconciliationInput): Promise<ReconciliationResult> {
    this.logger.log({ event: 'ai_reconciliation', dateFrom: input.dateFrom, dateTo: input.dateTo });

    const billingRate = input.totalConsultations > 0
      ? ((input.billedConsultations / input.totalConsultations) * 100).toFixed(1)
      : '0.0';

    const prompt = `Ești un consultant de management financiar pentru o clinică veterinară din România.
Analizează gradul de facturare pentru perioada ${input.dateFrom} – ${input.dateTo}.

Date statistice:
- Total consultații finalizate (semnate): ${input.totalConsultations}
- Consultații facturate: ${input.billedConsultations}
- Consultații nefacturate: ${input.unbilledConsultations}
- Rata de facturare: ${billingRate}%
- Total venituri facturate: ${input.totalRevenue.toFixed(2)} RON
- Restanțe neîncasate: ${input.outstandingAmount.toFixed(2)} RON
- Facturi SPV în așteptare: ${input.spvPending}
- Facturi SPV respinse: ${input.spvRejected}

Evaluează:
1. Nivelul de risc al discrepanței servicii prestate vs facturate (low/medium/high)
2. Analiza situației în 3-5 propoziții
3. Maximum 4 recomandări practice pentru îmbunătățire

Răspunde EXCLUSIV în format JSON:
{
  "analysis": "analiza situației...",
  "riskLevel": "low|medium|high",
  "recommendations": ["recomandare 1", "recomandare 2", "recomandare 3"]
}`;

    try {
      const response = await this.client.messages.create({
        model:      this.model,
        max_tokens: 700,
        messages:   [{ role: 'user', content: prompt }],
      });

      const text = (response.content[0] as { type: 'text'; text: string }).text.trim();
      const parsed = JSON.parse(text) as { analysis: string; riskLevel: string; recommendations: string[] };
      const validLevels = ['low', 'medium', 'high'];
      return {
        analysis:        parsed.analysis,
        riskLevel:       (validLevels.includes(parsed.riskLevel) ? parsed.riskLevel : 'medium') as 'low' | 'medium' | 'high',
        recommendations: parsed.recommendations,
        generatedAt:     new Date().toISOString(),
      };
    } catch (err) {
      this.logger.error({ event: 'ai_reconciliation_error' });
      return {
        analysis:        'Analiza automată nu a putut fi generată. Verificați datele manual.',
        riskLevel:       'medium',
        recommendations: ['Verificați manual consultațiile nefacturate din raportul de servicii nefacturate.'],
        generatedAt:     new Date().toISOString(),
      };
    }
  }
}
