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
  status:      'ok' | 'warning' | 'error';
  errors:      string[];
  warnings:    string[];
  suggestions: string[];
  summary:     string;
  // backward compat
  approved:    boolean;
  issues:      string[];
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
  invoiceId:                string;
  lineCount:                number;
  subtotal:                 number;
  vatAmount:                number;
  totalAmount:              number;
  vatBreakdown:             Array<{ rate: number; base: number; vat: number }>;
  ownerType:                'individual' | 'company';
  hasStornoRef:             boolean;
  series:                   string;
  billingCui?:              string;
  consultationServiceCount?: number;
  invoiceServiceCount?:      number;
  invoiceNumber?:            string;
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

// Input agregat intern pentru G-06 (date din getDailyReport + dashboardSummary)
export interface DailyReportAggregateInput {
  reportDate:            string;  // data raportului (ieri)
  revenue:               number;
  invoiceCount:          number;
  paymentsByMethod:      Array<{ method: string; amount: number; count: number }>;
  appointmentsToday:     number;
  noShowYesterday:       number;
  overdueReceivables:    number;  // număr facturi scadente
  overdueAmount:         number;  // sumă totală scadentă
  criticalStockItems:    number;
  expiringIn7Days:       number;
  spvPending:            number;
  spvRejected:           number;
  unbilledConsultations: number;
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

    // ------------------------------------------------------------------
    // Verificări locale sincrone (fără Claude) — răspuns instant
    // ------------------------------------------------------------------
    const localErrors:   string[] = [];
    const localWarnings: string[] = [];

    if (input.lineCount < 1) {
      localErrors.push('Factura nu conține nicio linie de serviciu sau produs.');
    }
    const computedTotal = +(input.subtotal + input.vatAmount).toFixed(2);
    if (Math.abs(computedTotal - input.totalAmount) > 0.02) {
      localErrors.push(
        `Totalul nu corespunde: subtotal ${input.subtotal.toFixed(2)} + TVA ${input.vatAmount.toFixed(2)} = ${computedTotal.toFixed(2)}, dar totalul declarat este ${input.totalAmount.toFixed(2)} RON.`,
      );
    }
    if (input.ownerType === 'company' && !input.billingCui) {
      localWarnings.push('Client persoană juridică fără CUI completat — facturile B2B necesită CUI valid pentru e-Factura.');
    }
    if (!input.series || input.series.trim() === '') {
      localErrors.push('Serie factură lipsă. Configurați seria înainte de emitere.');
    }
    if (
      input.consultationServiceCount !== undefined &&
      input.invoiceServiceCount !== undefined &&
      input.consultationServiceCount > input.invoiceServiceCount
    ) {
      localWarnings.push(
        `Consultația conține ${input.consultationServiceCount} servicii/tratamente, dar factura include doar ${input.invoiceServiceCount}. Verificați dacă toate serviciile prestate sunt facturate.`,
      );
    }
    if (!input.hasStornoRef && input.totalAmount < 0) {
      localErrors.push('Total negativ pe o factură non-storno. Dacă este o notă de credit, bifați referința storno.');
    }

    // Dacă sunt erori critice locale → returnăm imediat fără a apela Claude
    if (localErrors.length > 0) {
      return {
        status:      'error',
        errors:      localErrors,
        warnings:    localWarnings,
        suggestions: ['Corectați erorile de mai sus înainte de a emite factura.'],
        summary:     `${localErrors.length} erori critice detectate. Factura nu poate fi emisă în starea curentă.`,
        approved:    false,
        issues:      localErrors,
      };
    }

    // ------------------------------------------------------------------
    // Verificări contextuale Claude (doar dacă nu sunt erori locale)
    // ------------------------------------------------------------------
    const vatRatesNote = input.vatBreakdown.map(
      (v) => `  • Cotă ${v.rate}%: bază ${v.base.toFixed(2)} RON, TVA ${v.vat.toFixed(2)} RON`,
    ).join('\n') || '  • (nicio structură TVA)';

    const prompt = `Ești un asistent de verificare financiară pentru o clinică veterinară din România.
Analizează datele facturii și identifică probleme înainte de emitere.

Date factură (toate valorile în RON):
- Serie/Număr: ${input.series}${input.invoiceNumber ? '/' + input.invoiceNumber : ' (număr nealocat încă)'}
- Număr linii: ${input.lineCount}
- Subtotal (fără TVA): ${input.subtotal.toFixed(2)} RON
- Total TVA: ${input.vatAmount.toFixed(2)} RON
- Total cu TVA: ${input.totalAmount.toFixed(2)} RON
- Structură TVA:
${vatRatesNote}
- Tip client: ${input.ownerType === 'company' ? 'persoană juridică (B2B)' : 'persoană fizică (B2C)'}
- CUI client B2B: ${input.billingCui || 'ABSENT'}
- Este notă de credit (storno): ${input.hasStornoRef ? 'DA' : 'NU'}
${input.consultationServiceCount !== undefined ? `- Servicii în consultație: ${input.consultationServiceCount}, Servicii pe factură: ${input.invoiceServiceCount ?? input.lineCount}` : ''}

Verifică:
1. Cotele TVA aplicabile pentru servicii veterinare în România (cota redusă 9% este standard)
2. Coerența valorilor (rotunjiri, distribuție pe cote TVA)
3. Orice anomalie contabilă sau risc de respingere e-Factura
4. Dacă seria pare validă (litere mari, 2-4 caractere)

Verificările matematice de bază au fost deja efectuate. Concentrează-te pe anomalii contabile și fiscale.

Răspunde EXCLUSIV în format JSON, fără text în afara JSON-ului:
{
  "errors":      ["eroare gravă 1"],
  "warnings":    ["avertisment 1"],
  "suggestions": ["sugestie 1"],
  "summary":     "rezumat scurt în 1-2 propoziții"
}`;

    try {
      const response = await this.client.messages.create({
        model:      this.model,
        max_tokens: 512,
        messages:   [{ role: 'user', content: prompt }],
      });

      const text = (response.content[0] as { type: 'text'; text: string }).text.trim();
      const aiResult = JSON.parse(text) as {
        errors: string[]; warnings: string[]; suggestions: string[]; summary: string;
      };

      const allErrors   = [...localErrors,   ...(aiResult.errors   ?? [])];
      const allWarnings = [...localWarnings, ...(aiResult.warnings ?? [])];
      const status: InvoiceVerificationResult['status'] =
        allErrors.length > 0   ? 'error'   :
        allWarnings.length > 0 ? 'warning' : 'ok';

      return {
        status,
        errors:      allErrors,
        warnings:    allWarnings,
        suggestions: aiResult.suggestions ?? [],
        summary:     aiResult.summary,
        approved:    status !== 'error',
        issues:      allErrors,
      };
    } catch (err) {
      this.logger.error({ event: 'ai_invoice_verify_error', invoiceId: input.invoiceId });
      const allWarnings = [...localWarnings];
      const status: InvoiceVerificationResult['status'] = localErrors.length > 0 ? 'error' : (allWarnings.length > 0 ? 'warning' : 'ok');
      return {
        status,
        errors:      localErrors,
        warnings:    allWarnings,
        suggestions: ['Verificarea AI nu a putut fi efectuată. Verificați manual totalurile și structura TVA.'],
        summary:     'Verificare parțială (AI indisponibil). Verificările matematice locale au fost efectuate.',
        approved:    status !== 'error',
        issues:      localErrors,
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
  // 3b. G-06 — Rezumat zilnic din date agregate intern (fără input frontend)
  // -------------------------------------------------------------------------

  async generateDailySummaryFromReport(input: DailyReportAggregateInput): Promise<DailySummaryResult> {
    this.logger.log({ event: 'ai_daily_summary_auto', date: input.reportDate });

    const methodLines = input.paymentsByMethod.length > 0
      ? input.paymentsByMethod.map(p => `  • ${p.method}: ${p.amount.toFixed(2)} RON (${p.count} tranzacții)`).join('\n')
      : '  • nicio plată înregistrată';

    const prompt = `Ești asistentul managerului unei clinici veterinare din România.
Generează un rezumat operațional zilnic concis și profesional în română.

Data raportată: ${input.reportDate}

FINANCIAR:
- Venituri facturate: ${input.revenue.toFixed(2)} RON (${input.invoiceCount} facturi)
- Încasări pe metode de plată:
${methodLines}

OPERAȚIONAL:
- Programări pentru azi: ${input.appointmentsToday}
- No-show-uri ieri: ${input.noShowYesterday}
- Consultații nefacturate în așteptare: ${input.unbilledConsultations}

CREANȚE:
- Facturi scadente neîncasate: ${input.overdueReceivables} facturi, total ${input.overdueAmount.toFixed(2)} RON

STOC:
- Produse sub nivelul minim: ${input.criticalStockItems}
- Loturi care expiră în 7 zile: ${input.expiringIn7Days}

e-FACTURA / SPV:
- Facturi în așteptare ANAF: ${input.spvPending}
- Facturi respinse ANAF: ${input.spvRejected}

Generează:
1. Un paragraf narativ de 3-5 propoziții cu situația zilei — ton calm, profesional, orientat spre acțiune
2. Maxim 5 atenționări prioritare (doar dacă există probleme reale — nu inventa probleme dacă nu există)
3. O scurtă concluzie de 1 propoziție

Răspunde EXCLUSIV în format JSON:
{
  "narrative": "paragraful narativ...",
  "priorityActions": ["atenționare 1", "atenționare 2"],
  "conclusion": "concluzie scurtă..."
}`;

    try {
      const response = await this.client.messages.create({
        model:      this.model,
        max_tokens: 700,
        messages:   [{ role: 'user', content: prompt }],
      });

      const text = (response.content[0] as { type: 'text'; text: string }).text.trim();
      const parsed = JSON.parse(text) as {
        narrative: string; priorityActions: string[]; conclusion?: string;
      };
      return {
        narrative:       parsed.narrative + (parsed.conclusion ? '\n\n' + parsed.conclusion : ''),
        priorityActions: parsed.priorityActions ?? [],
        generatedAt:     new Date().toISOString(),
      };
    } catch (err) {
      this.logger.error({ event: 'ai_daily_summary_auto_error', date: input.reportDate });
      return {
        narrative:       'Rezumatul AI nu a putut fi generat. Verificați datele manual în secțiunile de mai sus.',
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
