import {
  Inject, Injectable, NotFoundException, BadRequestException,
  UnprocessableEntityException, Logger,
} from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { ConfigService } from '@nestjs/config';
import { eq, and, isNull, sql } from 'drizzle-orm';
import * as crypto from 'crypto';
import { DRIZZLE_DB, DrizzleDB } from '../../database/database.module';
import {
  invoicesTable, invoiceLinesTable, ownersTable,
  spvSubmissionsTable, spvResponsesTable,
} from '../../database/schema';
import { withAuditContext, AuditContext } from '../../common/helpers/audit.helper';
import { AnafApiClient } from './anaf-api.client';
import { XsdValidator } from './xml/xsd.validator';
import {
  generateCiusRoXml, CiusRoInvoiceData,
  CiusRoLine, CiusRoParty,
} from './xml/cius-ro.generator';
import { explainAnafErrors, parseAnafResponseErrors } from './anaf-error-mapper';
import { AiAssistantService } from '../ai-assistant/ai-assistant.service';

export interface SpvListFilters {
  status?:    string;
  from?:      string;
  to?:        string;
  invoiceId?: string;
  limit?:     number;
}

// Număr maxim de zile fără confirmare ANAF înainte de alertă
const UNCONFIRMED_ALERT_DAYS = 5;

@Injectable()
export class SpvService {
  private readonly logger = new Logger(SpvService.name);

  constructor(
    @Inject(DRIZZLE_DB) private readonly db: DrizzleDB,
    private readonly anafClient: AnafApiClient,
    private readonly xsdValidator: XsdValidator,
    private readonly config: ConfigService,
    private readonly aiAssistant: AiAssistantService,
  ) {}

  // ---------------------------------------------------------------------------
  // 1. Generare XML CIUS-RO din factura internă
  // ---------------------------------------------------------------------------

  async generateXml(invoiceId: string): Promise<{ xml: string; sha256: string }> {
    const invoice = await this.loadInvoiceForXml(invoiceId);

    if (!invoice.invoiceNumber) {
      throw new UnprocessableEntityException(
        `Factura ${invoiceId} nu a fost emisă (lipsă număr factură). Emiteți factura înainte de a genera XML.`,
      );
    }

    const [owner] = await this.db.select().from(ownersTable)
      .where(eq(ownersTable.id, invoice.ownerId)).limit(1);
    if (!owner) throw new NotFoundException(`Proprietar ${invoice.ownerId} negăsit`);

    const supplierParty = this.buildSupplierParty();
    const customerParty = this.buildCustomerParty(owner);

    // Compute VAT breakdown per rate
    const vatBreakdownMap = new Map<string, { base: number; amount: number }>();
    for (const line of invoice.lines) {
      const rate   = String(line.vatRate ?? '9');
      const net    = parseFloat(line.lineTotal as string);
      const vat    = +((net * parseFloat(rate)) / 100).toFixed(2);
      const entry  = vatBreakdownMap.get(rate) ?? { base: 0, amount: 0 };
      vatBreakdownMap.set(rate, {
        base:   +(entry.base + net).toFixed(2),
        amount: +(entry.amount + vat).toFixed(2),
      });
    }

    const vatBreakdown = Array.from(vatBreakdownMap.entries()).map(([rate, v]) => ({
      rate,
      base:   v.base.toFixed(2),
      amount: v.amount.toFixed(2),
    }));

    const xmlLines: CiusRoLine[] = invoice.lines.map((l) => {
      const qty   = parseFloat(l.quantity  as string);
      const price = parseFloat(l.unitPrice as string);
      const rate  = parseFloat(String(l.vatRate ?? '9'));
      const net   = +(qty * price).toFixed(2);
      const vat   = +((net * rate) / 100).toFixed(2);
      return {
        id:          l.id,
        description: l.description,
        quantity:    String(qty),
        unit:        l.unit ?? 'buc',
        unitPrice:   price.toFixed(2),
        lineTotal:   net.toFixed(2),
        vatRate:     String(rate),
        vatAmount:   vat.toFixed(2),
      };
    });

    const invoiceData: CiusRoInvoiceData = {
      invoiceNumber: invoice.invoiceNumber,
      issueDate:     invoice.issuedAt
        ? new Date(invoice.issuedAt).toISOString().slice(0, 10)
        : new Date().toISOString().slice(0, 10),
      dueDate:       invoice.dueDate ?? undefined,
      // tip 381 = notă de credit (storno)
      typeCode:      invoice.stornoOfInvoiceId ? '381' : '380',
      currency:      invoice.currency ?? 'RON',
      supplier:      supplierParty,
      customer:      customerParty,
      lines:         xmlLines,
      subtotal:      String(invoice.subtotal),
      vatAmount:     String(invoice.vatAmount),
      totalAmount:   String(invoice.totalAmount),
      vatBreakdown,
      notes:         invoice.notes ?? undefined,
      billingReference: invoice.stornoOfInvoiceId
        ? await this.getInvoiceNumber(invoice.stornoOfInvoiceId)
        : undefined,
    };

    const xml = generateCiusRoXml(invoiceData);
    const sha256 = crypto.createHash('sha256').update(xml, 'utf8').digest('hex');

    return { xml, sha256 };
  }

  // ---------------------------------------------------------------------------
  // 2. Validare XSD locală
  // ---------------------------------------------------------------------------

  async validateXml(xml: string): Promise<{ valid: boolean; errors: string[] }> {
    const structural = this.xsdValidator.validateStructure(xml);
    if (!structural.valid) return structural;
    const xsd = await this.xsdValidator.validateWithXsd(xml);
    return {
      valid:  structural.valid && xsd.valid,
      errors: [...structural.errors, ...xsd.errors],
    };
  }

  // ---------------------------------------------------------------------------
  // 3. Submit la ANAF
  // Workflow: generare XML → validare → upload → înregistrare submission
  // Utilizatorul trebuie să confirme explicit — nu se face automat.
  // ---------------------------------------------------------------------------

  async submit(invoiceId: string, ctx: AuditContext): Promise<typeof spvSubmissionsTable.$inferSelect> {
    // Verifică că nu există submission activă
    const [existing] = await this.db.select({ id: spvSubmissionsTable.id, status: spvSubmissionsTable.status })
      .from(spvSubmissionsTable)
      .where(sql`invoice_id = ${invoiceId} AND status IN ('pending','uploading','uploaded','processing','accepted')`)
      .limit(1);
    if (existing) {
      throw new BadRequestException(
        `Factura ${invoiceId} are deja o submission activă (${existing.id}, status: ${existing.status}). ` +
        `Așteptați confirmarea sau anulați submission-ul curent.`,
      );
    }

    // Verifică că factura este emisă
    const [invoice] = await this.db.select({ status: invoicesTable.status, invoiceNumber: invoicesTable.invoiceNumber })
      .from(invoicesTable)
      .where(and(eq(invoicesTable.id, invoiceId), isNull(invoicesTable.deletedAt)))
      .limit(1);
    if (!invoice) throw new NotFoundException(`Factura ${invoiceId} negăsită`);
    if (!['issued', 'partially_paid', 'paid'].includes(invoice.status)) {
      throw new BadRequestException(
        `Factura ${invoiceId} are statusul '${invoice.status}'. ` +
        `Doar facturile emise (issued/partially_paid/paid) pot fi transmise la ANAF.`,
      );
    }

    // Generare + validare XML
    const { xml, sha256 } = await this.generateXml(invoiceId);
    const validation = await this.validateXml(xml);
    if (!validation.valid) {
      throw new UnprocessableEntityException({
        message: 'XML-ul generat nu trece validarea locală. Corectați erorile înainte de a trimite la ANAF.',
        errors:  validation.errors,
      });
    }

    // Creare submission în baza de date (status: 'uploading')
    const [submission] = await withAuditContext(this.db, ctx, (tx) =>
      tx.insert(spvSubmissionsTable).values({
        invoiceId,
        invoiceNumber: invoice.invoiceNumber ?? undefined,
        status:        'uploading',
        xmlContent:    xml,
        xmlSha256:     sha256,
        submittedBy:   ctx.userId,
        retryCount:    0,
      }).returning(),
    );

    // Upload la ANAF
    try {
      const supplierCif = this.config.get<string>('CLINIC_CIF', '');
      const result = await this.anafClient.uploadInvoice(xml, supplierCif);

      if (result.executionStatus !== 0 || !result.uploadIndex) {
        await this.markSubmissionError(submission.id, ctx,
          result.errorMessage ?? 'ANAF a returnat status de eroare fără detalii suplimentare.');
        throw new BadRequestException(
          `Upload ANAF eșuat: ${result.errorMessage ?? 'eroare necunoscută'}`,
        );
      }

      // Marcare uploaded cu uploadIndex
      await withAuditContext(this.db, ctx, (tx) =>
        tx.update(spvSubmissionsTable).set({
          status:      'uploaded',
          uploadIndex: result.uploadIndex,
          submittedAt: new Date(),
          updatedAt:   new Date(),
        }).where(eq(spvSubmissionsTable.id, submission.id)),
      );

      this.logger.log(`SPV submitted: invoice=${invoiceId} uploadIndex=${result.uploadIndex}`);
    } catch (err) {
      if (err instanceof BadRequestException) throw err;
      // Eroare tehnică (network, timeout etc.)
      const msg = err instanceof Error ? err.message : 'Eroare tehnică la comunicarea cu ANAF.';
      await this.markSubmissionError(submission.id, ctx, msg);
      throw new BadRequestException(`Eroare la trimiterea la ANAF: ${msg}`);
    }

    return this.findSubmissionOrFail(submission.id);
  }

  // ---------------------------------------------------------------------------
  // 4. Polling status ANAF
  // ---------------------------------------------------------------------------

  async pollStatus(submissionId: string, ctx: AuditContext): Promise<typeof spvSubmissionsTable.$inferSelect> {
    const sub = await this.findSubmissionOrFail(submissionId);

    if (!['uploaded', 'processing'].includes(sub.status)) {
      throw new BadRequestException(
        `Submission ${submissionId} are statusul '${sub.status}'. Polling-ul este posibil doar pentru 'uploaded' sau 'processing'.`,
      );
    }
    if (!sub.uploadIndex) {
      throw new BadRequestException(`Submission ${submissionId} nu are upload_index.`);
    }

    const result = await this.anafClient.getStatus(sub.uploadIndex);

    await withAuditContext(this.db, ctx, (tx) =>
      tx.update(spvSubmissionsTable).set({
        lastPolledAt: new Date(),
        updatedAt:    new Date(),
      }).where(eq(spvSubmissionsTable.id, submissionId)),
    );

    if (result.stare === 'in prelucrare') {
      // Rămâne în 'processing' sau trece din 'uploaded' → 'processing'
      if (sub.status === 'uploaded') {
        await withAuditContext(this.db, ctx, (tx) =>
          tx.update(spvSubmissionsTable).set({ status: 'processing', updatedAt: new Date() })
            .where(eq(spvSubmissionsTable.id, submissionId)),
        );
      }
      return this.findSubmissionOrFail(submissionId);
    }

    if (result.stare === 'ok' || result.stare === 'nok') {
      // Descarcă și procesează răspunsul
      await this.downloadAndProcessResponse(submissionId, result.downloadId!, result.stare, ctx);
    }

    if (result.stare === 'eroare xml' || result.stare === 'eroare') {
      await this.markSubmissionError(submissionId, ctx,
        `ANAF a returnat eroare de procesare: ${result.message ?? result.stare}`);
    }

    return this.findSubmissionOrFail(submissionId);
  }

  // ---------------------------------------------------------------------------
  // 5. Download și reconciliere răspuns ZIP
  // ---------------------------------------------------------------------------

  private async downloadAndProcessResponse(
    submissionId: string,
    downloadId: string,
    anafStare: string,
    ctx: AuditContext,
  ): Promise<void> {
    let responseXml = '';
    let rawZipBase64 = '';

    try {
      const downloaded = await this.anafClient.downloadResponse(downloadId);
      responseXml  = downloaded.responseXml;
      rawZipBase64 = downloaded.rawZipBase64;
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Eroare la descărcarea răspunsului ANAF.';
      await this.markSubmissionError(submissionId, ctx, msg);
      return;
    }

    const errors        = parseAnafResponseErrors(responseXml);
    const humanExplain  = explainAnafErrors(errors);
    const isAccepted    = anafStare === 'ok';

    // Salvare răspuns SPV — append-only
    await withAuditContext(this.db, ctx, (tx) =>
      tx.insert(spvResponsesTable).values({
        submissionId,
        anafStatus:        anafStare,
        errorDetails:      errors.length > 0 ? JSON.stringify(errors) : null,
        humanExplanation:  humanExplain,
        rawResponseXml:    responseXml,
      }),
    );

    // Actualizare status submission
    await withAuditContext(this.db, ctx, (tx) =>
      tx.update(spvSubmissionsTable).set({
        status:      isAccepted ? 'accepted' : 'rejected',
        downloadId,
        acceptedAt:  isAccepted ? new Date() : null,
        rejectedAt:  isAccepted ? null : new Date(),
        errorMessage: isAccepted ? null : humanExplain,
        updatedAt:   new Date(),
      }).where(eq(spvSubmissionsTable.id, submissionId)),
    );

    // SECURITY: nu logăm conținut XML sau erori detaliate
    this.logger.log(`SPV response processed: submission=${submissionId} stare=${anafStare} errors=${errors.length}`);
  }

  // ---------------------------------------------------------------------------
  // 6. Alertă facturi neconfirmate > 5 zile
  // Rulează zilnic la 08:00 — identifică submission-uri fără răspuns
  // ---------------------------------------------------------------------------

  @Cron(CronExpression.EVERY_DAY_AT_8AM)
  async alertUnconfirmedSubmissions(): Promise<Array<{ submissionId: string; invoiceNumber: string | null; daysPending: number }>> {
    const cutoff = new Date(Date.now() - UNCONFIRMED_ALERT_DAYS * 24 * 60 * 60 * 1000);

    const stale = await this.db.execute<{
      id: string; invoice_number: string | null; submitted_at: Date;
    }>(
      sql`SELECT id, invoice_number, submitted_at
          FROM spv_submissions
          WHERE status IN ('uploaded', 'processing')
            AND submitted_at < ${cutoff}`,
    );

    const alerts = stale.rows.map((row) => ({
      submissionId:  row.id,
      invoiceNumber: row.invoice_number,
      daysPending:   Math.floor((Date.now() - new Date(row.submitted_at).getTime()) / 86_400_000),
    }));

    if (alerts.length > 0) {
      // SECURITY: logăm doar ID-uri, nu date financiare
      this.logger.warn(
        `[SPV ALERT] ${alerts.length} facturi fără confirmare ANAF > ${UNCONFIRMED_ALERT_DAYS} zile. ` +
        `IDs: ${alerts.map((a) => a.submissionId).join(', ')}`,
      );
    }

    return alerts;
  }

  // ---------------------------------------------------------------------------
  // 7. GET /spv/summary — agregate statusuri + alerte
  // ---------------------------------------------------------------------------

  async getSummary() {
    const rows = await this.db.execute<{
      total:         string;
      pending:       string;
      processing:    string;
      accepted:      string;
      rejected_err:  string;
      stale:         string;
    }>(sql`
      SELECT
        COUNT(*)                                                     ::TEXT AS total,
        COUNT(*) FILTER (WHERE status = 'pending')                   ::TEXT AS pending,
        COUNT(*) FILTER (WHERE status IN ('uploaded','processing'))   ::TEXT AS processing,
        COUNT(*) FILTER (WHERE status = 'accepted')                  ::TEXT AS accepted,
        COUNT(*) FILTER (WHERE status IN ('rejected','error'))        ::TEXT AS rejected_err,
        COUNT(*) FILTER (
          WHERE status IN ('uploaded','processing')
            AND submitted_at IS NOT NULL
            AND (
              SELECT COUNT(*)
              FROM generate_series(
                submitted_at::date,
                CURRENT_DATE - 1,
                '1 day'::interval
              ) AS gs(d)
              WHERE EXTRACT(DOW FROM gs.d) BETWEEN 1 AND 5
            ) >= 5
        )                                                             ::TEXT AS stale
      FROM spv_submissions
    `);

    const r = rows.rows[0] as Record<string, string>;
    return {
      total:              parseInt(r['total']        ?? '0', 10),
      pending:            parseInt(r['pending']      ?? '0', 10),
      processing:         parseInt(r['processing']   ?? '0', 10),
      accepted:           parseInt(r['accepted']     ?? '0', 10),
      rejectedOrError:    parseInt(r['rejected_err'] ?? '0', 10),
      staleOver5Days:     parseInt(r['stale']        ?? '0', 10),
    };
  }

  // ---------------------------------------------------------------------------
  // 8. GET /spv/submissions — listă cu filtre + JOIN invoices + ultimul răspuns
  // ---------------------------------------------------------------------------

  async listSubmissions(filters: SpvListFilters) {
    const limit = Math.min(filters.limit ?? 100, 200);

    const rows = await this.db.execute<{
      id: string; invoice_number: string; status: string; upload_index: string | null;
      submitted_at: string | null; accepted_at: string | null; rejected_at: string | null;
      error_message: string | null; retry_count: string;
      billing_name: string | null; billing_cui: string | null; issued_at: string | null;
      total_amount: string;
      last_anaf_message: string | null; last_human_explanation: string | null;
      last_error_details: unknown; business_days: string;
    }>(sql`
      SELECT
        s.id,
        s.invoice_number,
        s.status,
        s.upload_index,
        s.submitted_at::TEXT,
        s.accepted_at::TEXT,
        s.rejected_at::TEXT,
        s.error_message,
        s.retry_count::TEXT,
        i.billing_name,
        i.billing_cui,
        i.issued_at::TEXT,
        i.total_amount::TEXT,
        (SELECT r.anaf_message
         FROM spv_responses r
         WHERE r.submission_id = s.id
         ORDER BY r.received_at DESC LIMIT 1)  AS last_anaf_message,
        (SELECT r.human_explanation
         FROM spv_responses r
         WHERE r.submission_id = s.id
         ORDER BY r.received_at DESC LIMIT 1)  AS last_human_explanation,
        (SELECT r.error_details
         FROM spv_responses r
         WHERE r.submission_id = s.id
         ORDER BY r.received_at DESC LIMIT 1)  AS last_error_details,
        COALESCE(
          (SELECT COUNT(*)
           FROM generate_series(
             s.submitted_at::date,
             CURRENT_DATE - 1,
             '1 day'::interval
           ) AS gs(d)
           WHERE EXTRACT(DOW FROM gs.d) BETWEEN 1 AND 5),
          0
        )::TEXT                                 AS business_days
      FROM spv_submissions s
      JOIN invoices i ON i.id = s.invoice_id
      WHERE i.deleted_at IS NULL
        ${filters.status    ? sql`AND s.status = ${filters.status}`             : sql``}
        ${filters.from      ? sql`AND s.submitted_at::date >= ${filters.from}`  : sql``}
        ${filters.to        ? sql`AND s.submitted_at::date <= ${filters.to}`    : sql``}
        ${filters.invoiceId ? sql`AND s.invoice_id = ${filters.invoiceId}::uuid`: sql``}
      ORDER BY
        CASE WHEN s.status IN ('rejected','error') THEN 0
             WHEN s.status IN ('uploaded','processing') THEN 1
             WHEN s.status = 'pending' THEN 2
             ELSE 3 END,
        s.created_at DESC
      LIMIT ${limit}
    `);

    return rows.rows.map((row) => ({
      id:                   row.id,
      invoiceNumber:        row.invoice_number,
      status:               row.status,
      uploadIndex:          row.upload_index,
      submittedAt:          row.submitted_at,
      acceptedAt:           row.accepted_at,
      rejectedAt:           row.rejected_at,
      errorMessage:         row.error_message,
      retryCount:           parseInt(row.retry_count ?? '0', 10),
      billingName:          row.billing_name,
      billingCui:           row.billing_cui,
      issuedAt:             row.issued_at,
      totalAmount:          parseFloat(row.total_amount ?? '0'),
      lastAnafMessage:      row.last_anaf_message,
      lastHumanExplanation: row.last_human_explanation,
      lastErrorDetails:     row.last_error_details,
      businessDaysPending:  parseInt(row.business_days ?? '0', 10),
    }));
  }

  // ---------------------------------------------------------------------------
  // 9. GET /spv/submissions/:id/explanation — AI + fallback determinist
  // ---------------------------------------------------------------------------

  async getExplanation(submissionId: string) {
    const sub = await this.findSubmissionOrFail(submissionId);

    // Cel mai recent răspuns ANAF
    const responses = await this.db.select().from(spvResponsesTable)
      .where(eq(spvResponsesTable.submissionId, submissionId))
      .orderBy(sql`${spvResponsesTable.receivedAt} DESC`)
      .limit(1);

    const latestResponse = responses[0] ?? null;

    // Erori structurate din ultimul răspuns
    const parsedErrors: Array<{ errorCode: string; errorMessage: string }> =
      latestResponse?.errorDetails
        ? (Array.isArray(latestResponse.errorDetails)
            ? latestResponse.errorDetails as Array<{ errorCode: string; errorMessage: string }>
            : [])
        : [];

    // Erori din mesajul de eroare pe submission (pentru status 'error')
    const rawMessage = sub.errorMessage ?? latestResponse?.anafMessage ?? '';

    // Fallback determinist — întotdeauna disponibil
    const deterministicText = parsedErrors.length > 0
      ? explainAnafErrors(parsedErrors)
      : (latestResponse?.humanExplanation ?? rawMessage ?? 'Niciun detaliu de eroare disponibil.');

    // Disclaimer obligatoriu
    const disclaimer =
      'Sistemul nu face corecții automate, nu retrimite factura și nu modifică XML-ul. ' +
      'Un operator autorizat trebuie să verifice datele, să storneze factura dacă este cazul și să emită una corectă.';

    // Încearcă AI dacă există erori de explicat
    if (parsedErrors.length > 0 || rawMessage) {
      const errorCode = parsedErrors[0]?.errorCode ?? 'UNKNOWN';
      const rawAnafMsg = parsedErrors.map(e => `[${e.errorCode}] ${e.errorMessage}`).join('; ') || rawMessage;

      try {
        const aiResult = await this.aiAssistant.explainSpvError(errorCode, rawAnafMsg);
        this.logger.log({ event: 'ai_spv_explain_ok', submissionId });
        return {
          submissionId,
          invoiceNumber:   sub.invoiceNumber,
          status:          sub.status,
          source:          'ai' as const,
          title:           aiResult.title,
          explanation:     aiResult.explanation,
          steps:           aiResult.steps,
          disclaimer:      aiResult.disclaimer ?? disclaimer,
          rawErrors:       parsedErrors,
        };
      } catch {
        this.logger.warn({ event: 'ai_spv_explain_fallback', submissionId });
      }
    }

    // Fallback determinist
    return {
      submissionId,
      invoiceNumber:   sub.invoiceNumber,
      status:          sub.status,
      source:          'deterministic' as const,
      title:           parsedErrors[0] ? `Eroare ANAF: ${parsedErrors[0].errorCode}` : 'Status SPV',
      explanation:     deterministicText,
      steps:           [] as string[],
      disclaimer,
      rawErrors:       parsedErrors,
    };
  }

  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------

  async findSubmissionOrFail(id: string): Promise<typeof spvSubmissionsTable.$inferSelect> {
    const [sub] = await this.db.select().from(spvSubmissionsTable)
      .where(eq(spvSubmissionsTable.id, id)).limit(1);
    if (!sub) throw new NotFoundException(`SPV submission ${id} negăsit`);
    return sub;
  }

  async getSubmissionWithResponses(id: string) {
    const sub = await this.findSubmissionOrFail(id);
    const responses = await this.db.select().from(spvResponsesTable)
      .where(eq(spvResponsesTable.submissionId, id))
      .orderBy(sql`${spvResponsesTable.receivedAt} ASC`);
    return { ...sub, responses };
  }

  private async markSubmissionError(id: string, ctx: AuditContext, msg: string): Promise<void> {
    await withAuditContext(this.db, ctx, (tx) =>
      tx.update(spvSubmissionsTable).set({
        status:       'error',
        errorMessage: msg,
        updatedAt:    new Date(),
      }).where(eq(spvSubmissionsTable.id, id)),
    );
  }

  private async loadInvoiceForXml(invoiceId: string) {
    const [invoice] = await this.db.select().from(invoicesTable)
      .where(and(eq(invoicesTable.id, invoiceId), isNull(invoicesTable.deletedAt)))
      .limit(1);
    if (!invoice) throw new NotFoundException(`Factura ${invoiceId} negăsită`);

    const lines = await this.db.select().from(invoiceLinesTable)
      .where(eq(invoiceLinesTable.invoiceId, invoiceId))
      .orderBy(invoiceLinesTable.position);

    return { ...invoice, lines };
  }

  private async getInvoiceNumber(invoiceId: string): Promise<string | undefined> {
    const [inv] = await this.db.select({ invoiceNumber: invoicesTable.invoiceNumber })
      .from(invoicesTable).where(eq(invoicesTable.id, invoiceId)).limit(1);
    return inv?.invoiceNumber ?? undefined;
  }

  // Date furnizor din variabile de mediu — NICIODATĂ hard-coded
  private buildSupplierParty(): CiusRoParty {
    return {
      name:             this.config.get<string>('CLINIC_NAME', 'Clinică Veterinară'),
      vatNumber:        this.config.get<string>('CLINIC_VAT_NUMBER', ''),
      registrationName: this.config.get<string>('CLINIC_LEGAL_NAME'),
      streetName:       this.config.get<string>('CLINIC_STREET'),
      city:             this.config.get<string>('CLINIC_CITY'),
      postalZone:       this.config.get<string>('CLINIC_ZIP'),
      countryCode:      'RO',
      iban:             this.config.get<string>('CLINIC_IBAN'),
      bankName:         this.config.get<string>('CLINIC_BANK'),
    };
  }

  private buildCustomerParty(owner: { type: string; firstName: string | null; lastName: string | null; companyName: string | null; cui: string | null; addressStreet: string | null; addressCity: string | null; addressZip: string | null; addressCountry: string }): CiusRoParty {
    const name = owner.type === 'company'
      ? (owner.companyName ?? '')
      : `${owner.firstName ?? ''} ${owner.lastName ?? ''}`.trim();

    // SECURITY: nu logăm CUI sau date personale — doar ID-ul proprietarului
    const vatNumber = owner.type === 'company' && owner.cui
      ? `RO${owner.cui.replace(/\D/g, '')}`
      : 'RO0000000000';  // persoane fizice primesc un placeholder standard

    return {
      name,
      vatNumber,
      streetName:  owner.addressStreet ?? undefined,
      city:        owner.addressCity   ?? undefined,
      postalZone:  owner.addressZip    ?? undefined,
      countryCode: owner.addressCountry ?? 'RO',
    };
  }
}
