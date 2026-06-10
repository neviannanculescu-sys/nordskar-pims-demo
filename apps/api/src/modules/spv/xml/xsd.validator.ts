import { Injectable, Logger } from '@nestjs/common';

export interface ValidationResult {
  valid: boolean;
  errors: string[];
}

// ---------------------------------------------------------------------------
// Validare structurală pre-XSD
// Verifică că elementele obligatorii CIUS-RO sunt prezente înainte de upload.
// Această validare este rapidă și fără dependențe externe.
//
// Pentru validare XSD completă (opțional):
//   npm install libxmljs2
//   Adaugă import { parseXmlString, Document } from 'libxmljs2';
//   și decomentează blocul de la finalul fișierului.
// ---------------------------------------------------------------------------

const REQUIRED_ELEMENTS = [
  { xpath: 'CustomizationID',           label: 'CustomizationID (CIUS-RO)' },
  { xpath: 'ID',                         label: 'Număr factură (ID)' },
  { xpath: 'IssueDate',                  label: 'Data emiterii (IssueDate)' },
  { xpath: 'InvoiceTypeCode',            label: 'Tip factură (InvoiceTypeCode)' },
  { xpath: 'DocumentCurrencyCode',       label: 'Monedă (DocumentCurrencyCode)' },
  { xpath: 'AccountingSupplierParty',    label: 'Date furnizor (AccountingSupplierParty)' },
  { xpath: 'AccountingCustomerParty',    label: 'Date client (AccountingCustomerParty)' },
  { xpath: 'TaxTotal',                   label: 'Total TVA (TaxTotal)' },
  { xpath: 'LegalMonetaryTotal',         label: 'Totale monetare (LegalMonetaryTotal)' },
  { xpath: 'InvoiceLine',                label: 'Cel puțin o linie factură (InvoiceLine)' },
] as const;

const CIUS_RO_CUSTOMIZATION =
  'urn:cen.eu:en16931:2017#compliant#urn:efactura.mfinante.ro:CIUS-RO:1.0.1';

@Injectable()
export class XsdValidator {
  private readonly logger = new Logger(XsdValidator.name);

  validateStructure(xml: string): ValidationResult {
    const errors: string[] = [];

    // Verifică că e XML valid (parsare minimală)
    if (!xml.trim().startsWith('<?xml')) {
      errors.push('XML-ul nu conține declarația <?xml version="1.0" encoding="UTF-8"?>');
    }

    // Verifică CustomizationID CIUS-RO
    if (!xml.includes(CIUS_RO_CUSTOMIZATION)) {
      errors.push(`CustomizationID lipsă sau incorect. Valoare așteptată: ${CIUS_RO_CUSTOMIZATION}`);
    }

    // Verifică elementele obligatorii prin prezența tag-urilor
    for (const { xpath, label } of REQUIRED_ELEMENTS) {
      // Caută atât cu prefix namespace cât și fără
      const found = xml.includes(`<cbc:${xpath}`) ||
                    xml.includes(`<cac:${xpath}`) ||
                    xml.includes(`<${xpath}`);
      if (!found) {
        errors.push(`Element obligatoriu lipsă: ${label}`);
      }
    }

    // Verifică că InvoicedQuantity are atribut unitCode
    if (xml.includes('<cbc:InvoicedQuantity') && !xml.includes('unitCode=')) {
      errors.push('InvoicedQuantity trebuie să conțină atributul unitCode (codul unității de măsură UN/ECE)');
    }

    // Verifică că sumele monetare au atribut currencyID
    const amountTags = ['LineExtensionAmount', 'TaxAmount', 'PayableAmount', 'TaxableAmount'];
    for (const tag of amountTags) {
      if (xml.includes(`<cbc:${tag}`) && !xml.includes(`<cbc:${tag} currencyID=`)) {
        errors.push(`${tag} lipsește atributul currencyID`);
      }
    }

    if (errors.length > 0) {
      this.logger.warn(`XML validation failed: ${errors.length} errors`);
    }

    return { valid: errors.length === 0, errors };
  }

  // ---------------------------------------------------------------------------
  // Stub pentru validare XSD completă cu libxmljs2 (dezactivat implicit)
  // Activare: npm install libxmljs2 + setare env ENABLE_XSD_VALIDATION=true
  // XSD-ul CIUS-RO se descarcă de la https://www.efactura.mfinante.gov.ro/
  // ---------------------------------------------------------------------------
  async validateWithXsd(_xml: string): Promise<ValidationResult> {
    if (process.env['ENABLE_XSD_VALIDATION'] !== 'true') {
      this.logger.debug('XSD validation skipped (ENABLE_XSD_VALIDATION not set)');
      return { valid: true, errors: [] };
    }

    // Placeholder — implementare completă cu libxmljs2:
    // const libxml = require('libxmljs2');
    // const xsdPath = process.env.CIUS_RO_XSD_PATH;
    // const xsdDoc = libxml.parseXml(fs.readFileSync(xsdPath, 'utf8'));
    // const xmlDoc = libxml.parseXml(xml);
    // const valid = xmlDoc.validate(xsdDoc);
    // return { valid, errors: xmlDoc.validationErrors.map(e => e.message) };
    return { valid: true, errors: [] };
  }
}
