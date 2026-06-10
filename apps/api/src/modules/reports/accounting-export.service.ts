import { Inject, Injectable, Logger } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import * as ExcelJS from 'exceljs';
import { DRIZZLE_DB, DrizzleDB } from '../../database/database.module';

// ---------------------------------------------------------------------------
// Export contabilitate compatibil Saga C / WinMentor
//
// Formatul CSV generat respectă structura de import a jurnalelor Saga C:
//   Data, Nr. Document, CUI/CNP Client, Denumire Client,
//   Baza impozabilă (fiecare cotă TVA separat),
//   TVA (fiecare cotă), Total, Tip jurnal
//
// SECURITY: fișierul exportat conține date financiare sensibile —
//   acces restricționat la ADMIN + ACCOUNTANT.
// ---------------------------------------------------------------------------

interface AccountingRow {
  docDate:         string;
  docNumber:       string;
  customerVatId:   string;
  customerName:    string;
  base0:           number;    // bază impozabilă TVA 0%
  base9:           number;    // bază impozabilă TVA 9%
  base19:          number;    // bază impozabilă TVA 19%
  vat9:            number;
  vat19:           number;
  total:           number;
  paymentStatus:   string;
  paidAmount:      number;
  journalPrefix:   string;
}

interface PaymentRow {
  docDate:       string;
  invoiceNumber: string;
  customerName:  string;
  amount:        number;
  method:        string;
  reference:     string | null;
}

@Injectable()
export class AccountingExportService {
  private readonly logger = new Logger(AccountingExportService.name);

  constructor(@Inject(DRIZZLE_DB) private readonly db: DrizzleDB) {}

  // -------------------------------------------------------------------------
  // Extrage datele pentru export
  // -------------------------------------------------------------------------

  async getInvoiceRows(dateFrom: string, dateTo: string): Promise<AccountingRow[]> {
    const rows = await this.db.execute<Record<string, string>>(sql`
      SELECT
        i.issued_at::DATE::TEXT                                                    AS doc_date,
        i.invoice_number,
        COALESCE(i.billing_cui, '')                                                AS customer_vat_id,
        COALESCE(i.billing_name, '')                                               AS customer_name,
        COALESCE(SUM(il.line_total) FILTER (WHERE il.vat_rate = 0),  0)::TEXT     AS base0,
        COALESCE(SUM(il.line_total) FILTER (WHERE il.vat_rate = 9),  0)::TEXT     AS base9,
        COALESCE(SUM(il.line_total) FILTER (WHERE il.vat_rate = 19), 0)::TEXT     AS base19,
        COALESCE(SUM(il.vat_amount) FILTER (WHERE il.vat_rate = 9),  0)::TEXT     AS vat9,
        COALESCE(SUM(il.vat_amount) FILTER (WHERE il.vat_rate = 19), 0)::TEXT     AS vat19,
        i.total_amount::TEXT,
        i.status,
        i.paid_amount::TEXT
      FROM invoices i
      LEFT JOIN invoice_lines il ON il.invoice_id = i.id
      WHERE i.deleted_at IS NULL
        AND i.status NOT IN ('draft', 'cancelled', 'storno')
        AND i.issued_at::DATE BETWEEN ${dateFrom} AND ${dateTo}
      GROUP BY i.id, i.issued_at, i.invoice_number,
               i.billing_cui, i.billing_name,
               i.total_amount, i.status, i.paid_amount
      ORDER BY i.issued_at ASC, i.invoice_number ASC
    `);

    return rows.rows.map((r) => ({
      docDate:       r['doc_date']       ?? '',
      docNumber:     r['invoice_number'] ?? '',
      customerVatId: r['customer_vat_id'] ?? '',
      customerName:  r['customer_name']  ?? '',
      base0:         parseFloat(r['base0']  ?? '0'),
      base9:         parseFloat(r['base9']  ?? '0'),
      base19:        parseFloat(r['base19'] ?? '0'),
      vat9:          parseFloat(r['vat9']   ?? '0'),
      vat19:         parseFloat(r['vat19']  ?? '0'),
      total:         parseFloat(r['total_amount'] ?? '0'),
      paymentStatus: r['status'] ?? '',
      paidAmount:    parseFloat(r['paid_amount'] ?? '0'),
      journalPrefix: 'VZ',
    }));
  }

  async getPaymentRows(dateFrom: string, dateTo: string): Promise<PaymentRow[]> {
    const rows = await this.db.execute<Record<string, string>>(sql`
      SELECT
        p.paid_at::DATE::TEXT              AS doc_date,
        i.invoice_number,
        COALESCE(i.billing_name, '')       AS customer_name,
        p.amount::TEXT                     AS amount,
        p.payment_method,
        p.reference
      FROM payments p
      JOIN invoices i ON i.id = p.invoice_id
      WHERE p.paid_at::DATE BETWEEN ${dateFrom} AND ${dateTo}
      ORDER BY p.paid_at ASC
    `);

    return rows.rows.map((r) => ({
      docDate:       r['doc_date']       ?? '',
      invoiceNumber: r['invoice_number'] ?? '',
      customerName:  r['customer_name']  ?? '',
      amount:        parseFloat(r['amount'] ?? '0'),
      method:        r['payment_method'] ?? '',
      reference:     r['reference'] ?? null,
    }));
  }

  // -------------------------------------------------------------------------
  // Export CSV (compatibil Saga C / orice soft de contabilitate)
  // -------------------------------------------------------------------------

  exportToCsv(rows: AccountingRow[]): string {
    const header = [
      'Data', 'Nr. Document', 'CUI/CNP Client', 'Denumire Client',
      'Baza TVA 0%', 'Baza TVA 9%', 'Baza TVA 19%',
      'TVA 9%', 'TVA 19%', 'Total Factură',
      'Status Plată', 'Sumă Încasată', 'Jurnal',
    ].join(';');

    const csvRows = rows.map((r) =>
      [
        r.docDate,
        r.docNumber,
        r.customerVatId,
        `"${r.customerName.replace(/"/g, '""')}"`,
        r.base0.toFixed(2).replace('.', ','),
        r.base9.toFixed(2).replace('.', ','),
        r.base19.toFixed(2).replace('.', ','),
        r.vat9.toFixed(2).replace('.', ','),
        r.vat19.toFixed(2).replace('.', ','),
        r.total.toFixed(2).replace('.', ','),
        r.paymentStatus,
        r.paidAmount.toFixed(2).replace('.', ','),
        r.journalPrefix,
      ].join(';'),
    );

    // BOM UTF-8 pentru Excel românesc care altfel face greșeli la diacritice
    return '﻿' + [header, ...csvRows].join('\r\n');
  }

  exportPaymentsToCsv(rows: PaymentRow[]): string {
    const header = [
      'Data Plată', 'Nr. Factură', 'Client', 'Sumă', 'Metodă', 'Referință',
    ].join(';');
    const csvRows = rows.map((r) =>
      [
        r.docDate,
        r.invoiceNumber,
        `"${r.customerName.replace(/"/g, '""')}"`,
        r.amount.toFixed(2).replace('.', ','),
        r.method,
        r.reference ?? '',
      ].join(';'),
    );
    return '﻿' + [header, ...csvRows].join('\r\n');
  }

  // -------------------------------------------------------------------------
  // Export XLSX (foaie separată pentru facturi și plăți)
  // -------------------------------------------------------------------------

  async exportToXlsx(
    invoiceRows: AccountingRow[],
    paymentRows:  PaymentRow[],
    dateFrom:     string,
    dateTo:       string,
  ): Promise<Buffer> {
    const wb = new ExcelJS.Workbook();
    wb.creator = 'VetHospital PIMS';
    wb.created  = new Date();

    // ---- Foaie facturi ----
    const wsInv = wb.addWorksheet('Jurnal Vânzări');
    wsInv.columns = [
      { header: 'Data',           key: 'docDate',       width: 12 },
      { header: 'Nr. Document',   key: 'docNumber',     width: 18 },
      { header: 'CUI/CNP',        key: 'vatId',         width: 16 },
      { header: 'Client',         key: 'name',          width: 30 },
      { header: 'Baza 0%',        key: 'base0',         width: 12 },
      { header: 'Baza 9%',        key: 'base9',         width: 12 },
      { header: 'Baza 19%',       key: 'base19',        width: 12 },
      { header: 'TVA 9%',         key: 'vat9',          width: 12 },
      { header: 'TVA 19%',        key: 'vat19',         width: 12 },
      { header: 'Total',          key: 'total',         width: 14 },
      { header: 'Status Plată',   key: 'status',        width: 14 },
      { header: 'Sumă Încasată',  key: 'paid',          width: 14 },
    ];

    // Header style
    wsInv.getRow(1).font = { bold: true };
    wsInv.getRow(1).fill = {
      type: 'pattern', pattern: 'solid',
      fgColor: { argb: 'FFD3E8FF' },
    };

    invoiceRows.forEach((r) =>
      wsInv.addRow({
        docDate: r.docDate, docNumber: r.docNumber,
        vatId: r.customerVatId, name: r.customerName,
        base0: r.base0, base9: r.base9, base19: r.base19,
        vat9: r.vat9, vat19: r.vat19, total: r.total,
        status: r.paymentStatus, paid: r.paidAmount,
      }),
    );

    // Totale
    const lastRow = invoiceRows.length + 1;
    wsInv.addRow({
      docDate: 'TOTAL', docNumber: '',
      vatId: '', name: '',
      base0:  invoiceRows.reduce((s, r) => s + r.base0, 0),
      base9:  invoiceRows.reduce((s, r) => s + r.base9, 0),
      base19: invoiceRows.reduce((s, r) => s + r.base19, 0),
      vat9:   invoiceRows.reduce((s, r) => s + r.vat9, 0),
      vat19:  invoiceRows.reduce((s, r) => s + r.vat19, 0),
      total:  invoiceRows.reduce((s, r) => s + r.total, 0),
      status: '',
      paid:   invoiceRows.reduce((s, r) => s + r.paidAmount, 0),
    });
    wsInv.getRow(lastRow + 1).font = { bold: true };

    // Format numeric
    ['base0','base9','base19','vat9','vat19','total','paid'].forEach((col) => {
      wsInv.getColumn(col).numFmt = '#,##0.00';
    });

    // ---- Foaie plăți ----
    const wsPay = wb.addWorksheet('Jurnal Încasări');
    wsPay.columns = [
      { header: 'Data Plată',  key: 'docDate',   width: 12 },
      { header: 'Nr. Factură', key: 'invoice',   width: 18 },
      { header: 'Client',      key: 'name',      width: 30 },
      { header: 'Sumă',        key: 'amount',    width: 14 },
      { header: 'Metodă',      key: 'method',    width: 16 },
      { header: 'Referință',   key: 'ref',       width: 20 },
    ];
    wsPay.getRow(1).font = { bold: true };
    wsPay.getRow(1).fill = {
      type: 'pattern', pattern: 'solid',
      fgColor: { argb: 'FFD8F0D8' },
    };
    paymentRows.forEach((r) =>
      wsPay.addRow({
        docDate: r.docDate, invoice: r.invoiceNumber,
        name: r.customerName, amount: r.amount,
        method: r.method, ref: r.reference ?? '',
      }),
    );
    wsPay.getColumn('amount').numFmt = '#,##0.00';

    // ---- Foaie metadata ----
    const wsMeta = wb.addWorksheet('Info Export');
    wsMeta.addRow(['Export generat de:', 'VetHospital PIMS']);
    wsMeta.addRow(['Perioadă:', `${dateFrom} – ${dateTo}`]);
    wsMeta.addRow(['Data generare:', new Date().toISOString()]);
    wsMeta.addRow(['Notă:', 'Verificați cu contabilul înainte de import în Saga/WinMentor.']);

    return wb.xlsx.writeBuffer() as unknown as Promise<Buffer>;
  }
}
