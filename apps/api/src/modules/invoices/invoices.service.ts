import {
  Inject, Injectable, NotFoundException,
  BadRequestException, UnprocessableEntityException,
  ConflictException, Logger,
} from '@nestjs/common';
import { eq, and, isNull, count, SQL, sql } from 'drizzle-orm';
import { DRIZZLE_DB, DrizzleDB }        from '../../database/database.module';
import {
  invoicesTable, invoiceLinesTable, paymentsTable,
  consultationsTable, ownersTable,
} from '../../database/schema';
import { withAuditContext, AuditContext } from '../../common/helpers/audit.helper';
import { paginate }                        from '../../common/types/api-response.types';
import { CreateInvoiceDraftDto, InvoiceLineInputDto } from './dto/create-invoice.dto';
import { CreatePaymentDto }  from './dto/create-payment.dto';

// ---------------------------------------------------------------------------
// Status machine — reguli explicite de business
//
// REGULA 1: cancel() este permis EXCLUSIV din 'draft'.
//   O factură emisă (issued/partially_paid/paid) nu poate fi anulată direct —
//   se folosește obligatoriu storno() care creează notă de credit.
//
// REGULA 2: storno() creează ÎNTOTDEAUNA un document nou (notă de credit negativă).
//   Factura originală trece în 'storno' și rămâne IMUABILĂ (garantat și de DB trigger).
//   Există o singură notă de credit per factură (UNIQUE index parțial în 0005_invoices.sql).
//
// REGULA 3: addPayment() actualizează determinist payment_status:
//   paid_amount + payment.amount >= total_amount → 'paid'
//   paid_amount + payment.amount <  total_amount → 'partially_paid'
//   Supraplata (paid_amount > total_amount + 0.01) este blocată cu BadRequestException.
//
// REGULA 4: după storno(), consultation.billed este resetat la FALSE.
//   Consultația reintră în billing_candidates view și poate fi re-facturată.
// ---------------------------------------------------------------------------

type InvoiceStatus = 'draft' | 'issued' | 'partially_paid' | 'paid' | 'cancelled' | 'storno';

// Regula 1: 'cancelled' accesibil doar din 'draft'
const ALLOWED_TRANSITIONS: Record<InvoiceStatus, InvoiceStatus[]> = {
  draft:          ['issued', 'cancelled'],
  issued:         ['partially_paid', 'paid'],
  partially_paid: ['paid'],
  paid:           [],
  cancelled:      [],  // terminal — nu există cale de ieșire
  storno:         [],  // terminal — document reversat, imuabil
};

// Regula 2: doar facturile emise (nu draft, nu cancelled) pot fi stornate
const STORNABLE: InvoiceStatus[] = ['issued', 'partially_paid', 'paid'];

@Injectable()
export class InvoicesService {
  private readonly logger = new Logger(InvoicesService.name);

  constructor(@Inject(DRIZZLE_DB) private readonly db: DrizzleDB) {}

  // ---------------------------------------------------------------------------
  // Queries
  // ---------------------------------------------------------------------------

  async findAll(params: {
    ownerId?: string;
    status?: string;
    consultationId?: string;
    page?: number;
    limit?: number;
  }) {
    const page  = params.page  ?? 1;
    const limit = params.limit ?? 50;

    const conditions: SQL[] = [isNull(invoicesTable.deletedAt)];
    if (params.ownerId)        conditions.push(eq(invoicesTable.ownerId,        params.ownerId));
    if (params.consultationId) conditions.push(eq(invoicesTable.consultationId, params.consultationId));
    if (params.status)         conditions.push(eq(invoicesTable.status,         params.status as never));

    const where = and(...conditions);

    const [{ value: total }] = await this.db
      .select({ value: count() }).from(invoicesTable).where(where);

    const invoices = await this.db
      .select().from(invoicesTable).where(where)
      .orderBy(sql`${invoicesTable.createdAt} DESC`)
      .limit(limit).offset((page - 1) * limit);

    return paginate(invoices, Number(total), page, limit);
  }

  async findOneOrFail(id: string) {
    const [invoice] = await this.db
      .select().from(invoicesTable)
      .where(and(eq(invoicesTable.id, id), isNull(invoicesTable.deletedAt)))
      .limit(1);
    if (!invoice) throw new NotFoundException(`Invoice ${id} not found`);

    const lines = await this.db
      .select().from(invoiceLinesTable)
      .where(eq(invoiceLinesTable.invoiceId, id))
      .orderBy(invoiceLinesTable.position);

    const payments = await this.db
      .select().from(paymentsTable)
      .where(eq(paymentsTable.invoiceId, id))
      .orderBy(sql`${paymentsTable.paidAt} ASC`);

    return { ...invoice, lines, payments };
  }

  // ---------------------------------------------------------------------------
  // Draft creation — pre-populate from billing_candidates or explicit lines
  // ---------------------------------------------------------------------------

  async createDraft(dto: CreateInvoiceDraftDto, ctx: AuditContext) {
    // Verify owner exists
    const [owner] = await this.db.select().from(ownersTable)
      .where(and(eq(ownersTable.id, dto.ownerId), isNull(ownersTable.deletedAt))).limit(1);
    if (!owner) throw new NotFoundException(`Owner ${dto.ownerId} not found`);

    let lineInputs: InvoiceLineInputDto[] = dto.lines ?? [];

    if (dto.consultationId) {
      // Verify consultation exists and is signed
      const [cons] = await this.db.select()
        .from(consultationsTable)
        .where(and(
          eq(consultationsTable.id, dto.consultationId),
          isNull(consultationsTable.deletedAt),
        )).limit(1);
      if (!cons) throw new NotFoundException(`Consultation ${dto.consultationId} not found`);
      if (!cons.signedBy) {
        throw new UnprocessableEntityException(
          `Consultation ${dto.consultationId} must be signed before invoicing`,
        );
      }
      if (cons.billed) {
        throw new ConflictException(
          `Consultation ${dto.consultationId} is already billed`,
        );
      }

      // Pull billing candidates from the view
      const candidateRows = await this.db.execute(
        sql`SELECT * FROM billing_candidates WHERE consultation_id = ${dto.consultationId} ORDER BY service_date ASC`,
      );

      if (candidateRows.rows.length === 0 && lineInputs.length === 0) {
        throw new UnprocessableEntityException(
          `No billable items found for consultation ${dto.consultationId}`,
        );
      }

      // Map view rows → line inputs (snapshot at this moment)
      const candidateLines: InvoiceLineInputDto[] = (candidateRows.rows as Array<Record<string, unknown>>).map(
        (row, idx) => ({
          sourceId:     row['source_id'] as string,
          sourceType:   row['source_type'] as 'procedure' | 'treatment_line',
          description:  row['description'] as string,
          quantity:     String(row['quantity']),
          unit:         row['unit'] as string | undefined,
          unitPrice:    String(row['unit_price']),
          vatRate:      row['vat_rate'] != null ? String(row['vat_rate']) : '9',
          costSnapshot: row['unit_cost'] != null ? String(row['unit_cost']) : undefined,
          position:     idx,
        }),
      );

      // Candidates from view first, then any additional manual lines
      lineInputs = [...candidateLines, ...lineInputs.map((l, i) => ({ ...l, position: candidateLines.length + i }))];
    }

    if (lineInputs.length === 0) {
      throw new UnprocessableEntityException('Invoice must have at least one line');
    }

    // Compute totals from line inputs
    const { subtotal, vatAmount } = this.computeTotals(lineInputs);
    const totalAmount = +(subtotal + vatAmount).toFixed(2);

    const invoice = await withAuditContext(this.db, ctx, async (tx) => {
      const [inv] = await tx.insert(invoicesTable).values({
        ownerId:        dto.ownerId,
        consultationId: dto.consultationId,
        series:         dto.series ?? 'VET',
        dueDate:        dto.dueDate,
        notes:          dto.notes,
        subtotal:       subtotal.toFixed(2),
        vatAmount:      vatAmount.toFixed(2),
        totalAmount:    totalAmount.toFixed(2),
        status:         'draft',
        createdBy:      ctx.userId,
      }).returning();

      // Insert lines
      for (const line of lineInputs) {
        await tx.insert(invoiceLinesTable).values({
          invoiceId:    inv.id,
          sourceId:     line.sourceId,
          sourceType:   line.sourceType ?? 'manual',
          description:  line.description,
          quantity:     line.quantity,
          unit:         line.unit,
          unitPrice:    line.unitPrice,
          vatRate:      line.vatRate ?? '9',
          costSnapshot: line.costSnapshot,
          position:     line.position ?? 0,
        });
      }

      return inv;
    });

    this.logger.log(`Invoice draft created: ${invoice.id} owner=${dto.ownerId} total=${totalAmount} by ${ctx.userId}`);
    return this.findOneOrFail(invoice.id);
  }

  // ---------------------------------------------------------------------------
  // Issue — generates invoice number, freezes data, marks consultation billed
  // ---------------------------------------------------------------------------

  async issue(id: string, ctx: AuditContext) {
    const invoice = await this.findOneOrFail(id);
    this.assertTransition(invoice.status as InvoiceStatus, 'issued');

    if (invoice.lines.length === 0) {
      throw new UnprocessableEntityException('Cannot issue an invoice with no lines');
    }

    // Recompute totals from current lines (guard against manual edits)
    const { subtotal, vatAmount } = this.computeTotals(
      invoice.lines.map((l) => ({
        quantity:  l.quantity as string,
        unitPrice: l.unitPrice as string,
        vatRate:   l.vatRate  as string,
      })) as InvoiceLineInputDto[],
    );
    const totalAmount = +(subtotal + vatAmount).toFixed(2);

    // Snapshot owner billing data
    const [owner] = await this.db.select().from(ownersTable)
      .where(eq(ownersTable.id, invoice.ownerId)).limit(1);

    const billingName    = owner.type === 'company'
      ? owner.companyName!
      : `${owner.firstName} ${owner.lastName}`;
    const billingAddress = [
      owner.addressStreet,
      owner.addressCity,
      owner.addressCounty,
      owner.addressZip,
      owner.addressCountry,
    ].filter(Boolean).join(', ');

    await withAuditContext(this.db, ctx, async (tx) => {
      // Generate sequential invoice number
      const _seqResult = await tx.execute(sql`SELECT nextval('invoice_number_seq')`);
      const nextval = (_seqResult as unknown as { rows: Array<{ nextval: string }> }).rows[0].nextval;
      const year = new Date().getFullYear();
      const invoiceNumber = `${invoice.series}-${year}-${String(nextval).padStart(6, '0')}`;

      await tx.update(invoicesTable).set({
        status:         'issued',
        invoiceNumber,
        issuedAt:       new Date(),
        issuedBy:       ctx.userId,
        subtotal:       subtotal.toFixed(2),
        vatAmount:      vatAmount.toFixed(2),
        totalAmount:    totalAmount.toFixed(2),
        billingName,
        billingAddress,
        billingCui:     owner.type === 'company' ? (owner.cui ?? undefined) : undefined,
        updatedAt:      new Date(),
      }).where(eq(invoicesTable.id, id));

      // Mark consultation as billed — iese din billing_candidates view
      if (invoice.consultationId) {
        await tx.update(consultationsTable).set({
          billed:    true,
          updatedAt: new Date(),
        }).where(eq(consultationsTable.id, invoice.consultationId));
      }
    });

    this.logger.log(`Invoice issued: ${id} by ${ctx.userId}`);
    return this.findOneOrFail(id);
  }

  // ---------------------------------------------------------------------------
  // Cancel — doar din draft
  // ---------------------------------------------------------------------------

  async cancel(id: string, reason: string, ctx: AuditContext) {
    const invoice = await this.findOneOrFail(id);
    this.assertTransition(invoice.status as InvoiceStatus, 'cancelled');

    await withAuditContext(this.db, ctx, (tx) =>
      tx.update(invoicesTable).set({
        status:      'cancelled',
        cancelledAt: new Date(),
        cancelReason: reason,
        updatedAt:   new Date(),
      }).where(eq(invoicesTable.id, id)),
    );

    this.logger.log(`Invoice ${id} cancelled by ${ctx.userId}: ${reason}`);
    return this.findOneOrFail(id);
  }

  // ---------------------------------------------------------------------------
  // Storno — notă de credit negativă, imuabilitatea originalului garantată de DB trigger
  // ---------------------------------------------------------------------------

  async storno(id: string, ctx: AuditContext) {
    const original = await this.findOneOrFail(id);

    if (!STORNABLE.includes(original.status as InvoiceStatus)) {
      throw new BadRequestException(
        `Invoice ${id} cannot be reversed. Current status: '${original.status}'. ` +
        `Only issued, partially_paid, or paid invoices can be reversed.`,
      );
    }

    // Verifică dacă există deja o notă de credit
    const [existingStorno] = await this.db
      .select({ id: invoicesTable.id })
      .from(invoicesTable)
      .where(eq(invoicesTable.stornoOfInvoiceId, id))
      .limit(1);
    if (existingStorno) {
      throw new ConflictException(`Invoice ${id} already has a credit note: ${existingStorno.id}`);
    }

    const creditNote = await withAuditContext(this.db, ctx, async (tx) => {
      // Marchează originalul ca stornat
      await tx.update(invoicesTable).set({
        status:    'storno',
        updatedAt: new Date(),
      }).where(eq(invoicesTable.id, id));

      // Dacă factura originală are o consultație, eliberează-o pentru re-facturare
      if (original.consultationId) {
        await tx.update(consultationsTable).set({
          billed:    false,
          updatedAt: new Date(),
        }).where(eq(consultationsTable.id, original.consultationId));
      }

      // Crează nota de credit cu sume negative
      const subtotalNeg    = -parseFloat(original.subtotal   as string);
      const vatAmountNeg   = -parseFloat(original.vatAmount  as string);
      const totalAmountNeg = -parseFloat(original.totalAmount as string);

      const [creditInv] = await tx.insert(invoicesTable).values({
        series:              original.series,
        ownerId:             original.ownerId,
        consultationId:      original.consultationId,
        stornoOfInvoiceId:   original.id,
        status:              'issued',
        issuedAt:            new Date(),
        issuedBy:            ctx.userId,
        subtotal:            subtotalNeg.toFixed(2),
        vatAmount:           vatAmountNeg.toFixed(2),
        totalAmount:         totalAmountNeg.toFixed(2),
        paidAmount:          '0',
        currency:            original.currency,
        billingName:         original.billingName ?? undefined,
        billingAddress:      original.billingAddress ?? undefined,
        billingCui:          original.billingCui ?? undefined,
        notes:               `Notă de credit pentru factura ${original.invoiceNumber}`,
        createdBy:           ctx.userId,
      }).returning();

      // Generează număr factură pentru nota de credit
      const _seqResult = await tx.execute(sql`SELECT nextval('invoice_number_seq')`);
      const nextval = (_seqResult as unknown as { rows: Array<{ nextval: string }> }).rows[0].nextval;
      const year = new Date().getFullYear();
      const invoiceNumber = `${creditInv.series}-${year}-${String(nextval).padStart(6, '0')}`;
      await tx.update(invoicesTable).set({ invoiceNumber }).where(eq(invoicesTable.id, creditInv.id));

      // Crează linii negative
      for (const line of original.lines) {
        const qtyNeg = -parseFloat(line.quantity as string);
        await tx.insert(invoiceLinesTable).values({
          invoiceId:    creditInv.id,
          sourceId:     line.sourceId ?? undefined,
          sourceType:   line.sourceType ?? undefined,
          description:  `[STORNO] ${line.description}`,
          quantity:     qtyNeg.toFixed(3),
          unit:         line.unit ?? undefined,
          unitPrice:    line.unitPrice as string,
          vatRate:      line.vatRate   as string,
          costSnapshot: line.costSnapshot ?? undefined,
          position:     line.position,
        });
      }

      return creditInv;
    });

    this.logger.log(`Invoice ${id} reversed → credit note ${creditNote.id} by ${ctx.userId}`);
    return this.findOneOrFail(creditNote.id);
  }

  // ---------------------------------------------------------------------------
  // Add payment — actualizează paid_amount și tranziționează statusul
  // ---------------------------------------------------------------------------

  async addPayment(id: string, dto: CreatePaymentDto, ctx: AuditContext) {
    const invoice = await this.findOneOrFail(id);

    if (!['issued', 'partially_paid'].includes(invoice.status as string)) {
      throw new BadRequestException(
        `Cannot record payment on invoice with status '${invoice.status}'`,
      );
    }

    const paymentAmount  = parseFloat(dto.amount);
    const currentPaid    = parseFloat(invoice.paidAmount as string);
    const totalAmount    = parseFloat(invoice.totalAmount as string);
    const newPaidAmount  = +(currentPaid + paymentAmount).toFixed(2);

    if (newPaidAmount > totalAmount + 0.01) {
      throw new BadRequestException(
        `Payment of ${paymentAmount} would exceed invoice total. ` +
        `Remaining: ${(totalAmount - currentPaid).toFixed(2)}`,
      );
    }

    const newStatus: InvoiceStatus = newPaidAmount >= totalAmount - 0.01 ? 'paid' : 'partially_paid';

    await withAuditContext(this.db, ctx, async (tx) => {
      await tx.insert(paymentsTable).values({
        invoiceId:     id,
        amount:        paymentAmount.toFixed(2),
        paymentMethod: dto.paymentMethod as never,
        paidAt:        dto.paidAt ? new Date(dto.paidAt) : new Date(),
        reference:     dto.reference,
        notes:         dto.notes,
        recordedBy:    ctx.userId,
      });

      await tx.update(invoicesTable).set({
        paidAmount: newPaidAmount.toFixed(2),
        status:     newStatus,
        updatedAt:  new Date(),
      }).where(eq(invoicesTable.id, id));
    });

    this.logger.log(
      `Payment recorded: invoice=${id} amount=${paymentAmount} method=${dto.paymentMethod} ` +
      `→ status=${newStatus} paid=${newPaidAmount} by ${ctx.userId}`,
    );
    return this.findOneOrFail(id);
  }

  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------

  private assertTransition(current: InvoiceStatus, target: InvoiceStatus): void {
    const allowed = ALLOWED_TRANSITIONS[current];
    if (!allowed.includes(target)) {
      throw new BadRequestException(
        `Invoice transition '${current}' → '${target}' is not allowed. ` +
        `Allowed from '${current}': [${allowed.join(', ') || 'none'}]`,
      );
    }
  }

  private computeTotals(lines: Array<{ quantity: string; unitPrice: string; vatRate?: string }>): {
    subtotal: number;
    vatAmount: number;
  } {
    let subtotal  = 0;
    let vatAmount = 0;
    for (const l of lines) {
      const qty      = parseFloat(l.quantity);
      const price    = parseFloat(l.unitPrice);
      const vatRate  = parseFloat(l.vatRate ?? '9');
      const lineNet  = +(qty * price).toFixed(2);
      subtotal  += lineNet;
      vatAmount += +((lineNet * vatRate) / 100).toFixed(2);
    }
    return {
      subtotal:  +subtotal.toFixed(2),
      vatAmount: +vatAmount.toFixed(2),
    };
  }
}
