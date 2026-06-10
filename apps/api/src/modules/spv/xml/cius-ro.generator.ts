import { create } from 'xmlbuilder2';

// ---------------------------------------------------------------------------
// Tipuri de date pentru generarea XML
// ---------------------------------------------------------------------------

export interface CiusRoLine {
  id: string;
  description: string;
  quantity: string;
  unit: string;
  unitPrice: string;         // preț fără TVA
  lineTotal: string;         // quantity * unitPrice
  vatRate: string;           // 0 | 9 | 19
  vatAmount: string;         // lineTotal * vatRate / 100
}

export interface CiusRoParty {
  name: string;
  vatNumber: string;         // CUI cu prefix RO pentru plătitori TVA, fără pentru neplătitori
  registrationName?: string;
  streetName?: string;
  city?: string;
  postalZone?: string;
  countryCode: string;       // 'RO'
  iban?: string;
  bankName?: string;
}

export interface CiusRoInvoiceData {
  invoiceNumber: string;
  issueDate: string;         // YYYY-MM-DD
  dueDate?: string;          // YYYY-MM-DD
  // 380 = factură comercială, 381 = notă de credit (storno)
  typeCode: '380' | '381';
  currency: string;          // 'RON'
  supplier: CiusRoParty;
  customer: CiusRoParty;
  lines: CiusRoLine[];
  subtotal: string;          // sumă fără TVA
  vatAmount: string;         // total TVA
  totalAmount: string;       // subtotal + vatAmount
  // VAT breakdown pe cote
  vatBreakdown: Array<{ rate: string; base: string; amount: string }>;
  notes?: string;
  // Referință factură originală (obligatoriu pentru nota de credit 381)
  billingReference?: string;
}

// ---------------------------------------------------------------------------
// Namespace-uri CIUS-RO 1.0.1
// ---------------------------------------------------------------------------

const NS = {
  Invoice:   'urn:oasis:names:specification:ubl:schema:xsd:Invoice-2',
  cac:       'urn:oasis:names:specification:ubl:schema:xsd:CommonAggregateComponents-2',
  cbc:       'urn:oasis:names:specification:ubl:schema:xsd:CommonBasicComponents-2',
  ext:       'urn:oasis:names:specification:ubl:schema:xsd:CommonExtensionComponents-2',
  xsi:       'http://www.w3.org/2001/XMLSchema-instance',
} as const;

const CUSTOMIZATION_ID =
  'urn:cen.eu:en16931:2017#compliant#urn:efactura.mfinante.ro:CIUS-RO:1.0.1';
const PROFILE_ID = 'urn:www.cenbii.eu:profile:bii04:ver2.0';

// ---------------------------------------------------------------------------
// Generator XML UBL 2.1 CIUS-RO
// ---------------------------------------------------------------------------

export function generateCiusRoXml(data: CiusRoInvoiceData): string {
  const root = create({ version: '1.0', encoding: 'UTF-8' })
    .ele(NS.Invoice, 'Invoice', {
      'xmlns':     NS.Invoice,
      'xmlns:cac': NS.cac,
      'xmlns:cbc': NS.cbc,
      'xmlns:ext': NS.ext,
    });

  // Antet
  root.ele(NS.cbc, 'cbc:UBLVersionID').txt('2.1').up();
  root.ele(NS.cbc, 'cbc:CustomizationID').txt(CUSTOMIZATION_ID).up();
  root.ele(NS.cbc, 'cbc:ProfileID').txt(PROFILE_ID).up();
  root.ele(NS.cbc, 'cbc:ID').txt(data.invoiceNumber).up();
  root.ele(NS.cbc, 'cbc:IssueDate').txt(data.issueDate).up();
  if (data.dueDate) root.ele(NS.cbc, 'cbc:DueDate').txt(data.dueDate).up();
  root.ele(NS.cbc, 'cbc:InvoiceTypeCode').txt(data.typeCode).up();
  if (data.notes) root.ele(NS.cbc, 'cbc:Note').txt(data.notes).up();
  root.ele(NS.cbc, 'cbc:DocumentCurrencyCode').txt(data.currency).up();
  root.ele(NS.cbc, 'cbc:TaxCurrencyCode').txt(data.currency).up();

  // Referință factură originală (notă de credit)
  if (data.billingReference) {
    root.ele(NS.cac, 'cac:BillingReference')
      .ele(NS.cac, 'cac:InvoiceDocumentReference')
        .ele(NS.cbc, 'cbc:ID').txt(data.billingReference).up()
      .up()
    .up();
  }

  // Furnizor (clinica veterinară)
  addParty(root, 'cac:AccountingSupplierParty', data.supplier);

  // Client (proprietarul animalului)
  addParty(root, 'cac:AccountingCustomerParty', data.customer);

  // Cont bancar furnizor (opțional)
  if (data.supplier.iban) {
    root.ele(NS.cac, 'cac:PaymentMeans')
      .ele(NS.cbc, 'cbc:PaymentMeansCode').txt('30').up()  // 30 = credit transfer
      .ele(NS.cac, 'cac:PayeeFinancialAccount')
        .ele(NS.cbc, 'cbc:ID').txt(data.supplier.iban).up()
        .ele(NS.cac, 'cac:FinancialInstitutionBranch')
          .ele(NS.cbc, 'cbc:ID').txt(data.supplier.bankName ?? '').up()
        .up()
      .up()
    .up();
  }

  // Termene de plată
  if (data.dueDate) {
    root.ele(NS.cac, 'cac:PaymentTerms')
      .ele(NS.cbc, 'cbc:Note').txt(`Termen de plată: ${data.dueDate}`).up()
    .up();
  }

  // Totale TVA per cotă
  data.vatBreakdown.forEach(({ rate, base, amount }) => {
    root.ele(NS.cac, 'cac:TaxTotal')
      .ele(NS.cbc, 'cbc:TaxAmount', { currencyID: data.currency }).txt(amount).up()
      .ele(NS.cac, 'cac:TaxSubtotal')
        .ele(NS.cbc, 'cbc:TaxableAmount', { currencyID: data.currency }).txt(base).up()
        .ele(NS.cbc, 'cbc:TaxAmount',     { currencyID: data.currency }).txt(amount).up()
        .ele(NS.cac, 'cac:TaxCategory')
          .ele(NS.cbc, 'cbc:ID').txt(rate === '0' ? 'Z' : 'S').up()
          .ele(NS.cbc, 'cbc:Percent').txt(rate).up()
          .ele(NS.cac, 'cac:TaxScheme')
            .ele(NS.cbc, 'cbc:ID').txt('VAT').up()
          .up()
        .up()
      .up()
    .up();
  });

  // Totale monetare legale
  root.ele(NS.cac, 'cac:LegalMonetaryTotal')
    .ele(NS.cbc, 'cbc:LineExtensionAmount',  { currencyID: data.currency }).txt(data.subtotal).up()
    .ele(NS.cbc, 'cbc:TaxExclusiveAmount',   { currencyID: data.currency }).txt(data.subtotal).up()
    .ele(NS.cbc, 'cbc:TaxInclusiveAmount',   { currencyID: data.currency }).txt(data.totalAmount).up()
    .ele(NS.cbc, 'cbc:PayableAmount',        { currencyID: data.currency }).txt(data.totalAmount).up()
  .up();

  // Linii factură
  data.lines.forEach((line, idx) => {
    root.ele(NS.cac, 'cac:InvoiceLine')
      .ele(NS.cbc, 'cbc:ID').txt(String(idx + 1)).up()
      .ele(NS.cbc, 'cbc:InvoicedQuantity', { unitCode: normalizeUnit(line.unit) }).txt(line.quantity).up()
      .ele(NS.cbc, 'cbc:LineExtensionAmount', { currencyID: data.currency }).txt(line.lineTotal).up()
      .ele(NS.cac, 'cac:Item')
        .ele(NS.cbc, 'cbc:Description').txt(line.description).up()
        .ele(NS.cbc, 'cbc:Name').txt(line.description).up()
        .ele(NS.cac, 'cac:ClassifiedTaxCategory')
          .ele(NS.cbc, 'cbc:ID').txt(line.vatRate === '0' ? 'Z' : 'S').up()
          .ele(NS.cbc, 'cbc:Percent').txt(line.vatRate).up()
          .ele(NS.cac, 'cac:TaxScheme')
            .ele(NS.cbc, 'cbc:ID').txt('VAT').up()
          .up()
        .up()
      .up()
      .ele(NS.cac, 'cac:Price')
        .ele(NS.cbc, 'cbc:PriceAmount', { currencyID: data.currency }).txt(line.unitPrice).up()
      .up()
    .up();
  });

  return root.end({ prettyPrint: true });
}

// ---------------------------------------------------------------------------
// Helpers private
// ---------------------------------------------------------------------------

function addParty(root: ReturnType<typeof create>, tagName: string, party: CiusRoParty): void {
  root.ele(NS.cac, `cac:${tagName.split(':')[1]}`)
    .ele(NS.cac, 'cac:Party')
      .ele(NS.cac, 'cac:PartyName')
        .ele(NS.cbc, 'cbc:Name').txt(party.name).up()
      .up()
      .ele(NS.cac, 'cac:PostalAddress')
        .ele(NS.cbc, 'cbc:StreetName').txt(party.streetName ?? '').up()
        .ele(NS.cbc, 'cbc:CityName').txt(party.city ?? '').up()
        .ele(NS.cbc, 'cbc:PostalZone').txt(party.postalZone ?? '').up()
        .ele(NS.cac, 'cac:Country')
          .ele(NS.cbc, 'cbc:IdentificationCode').txt(party.countryCode).up()
        .up()
      .up()
      .ele(NS.cac, 'cac:PartyTaxScheme')
        .ele(NS.cbc, 'cbc:CompanyID').txt(party.vatNumber).up()
        .ele(NS.cac, 'cac:TaxScheme')
          .ele(NS.cbc, 'cbc:ID').txt('VAT').up()
        .up()
      .up()
      .ele(NS.cac, 'cac:PartyLegalEntity')
        .ele(NS.cbc, 'cbc:RegistrationName').txt(party.registrationName ?? party.name).up()
        .ele(NS.cbc, 'cbc:CompanyID').txt(party.vatNumber).up()
      .up()
    .up()
  .up();
}

// Mapare unitate de măsură → cod UN/ECE
function normalizeUnit(unit?: string): string {
  const map: Record<string, string> = {
    'buc': 'C62', 'bucata': 'C62', 'pcs': 'C62',
    'kg':  'KGM', 'g': 'GRM',
    'l':   'LTR', 'ml': 'MLT',
    'h':   'HUR', 'min': 'MIN',
    'tab': 'C62', 'tablet': 'C62',
    'fiola': 'C62', 'flacon': 'C62',
  };
  const key = (unit ?? '').toLowerCase();
  return map[key] ?? 'C62';  // C62 = piesă/bucată (fallback)
}
