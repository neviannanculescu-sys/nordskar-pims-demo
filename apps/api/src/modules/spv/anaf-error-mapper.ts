// ---------------------------------------------------------------------------
// Mapper erori ANAF → explicații în limba română
//
// Bazat pe documentația oficială ANAF e-Factura și codurile de eroare publice.
// SECURITY: nu logăm CUI/CNP — doar codurile de eroare și textele standard.
// ---------------------------------------------------------------------------

interface AnafErrorEntry {
  errorCode: string;
  errorMessage: string;
}

interface HumanExplanation {
  title: string;
  detail: string;
  suggestion: string;
}

// Mapare coduri eroare standard ANAF → explicație + sugestie
const ERROR_MAP: Record<string, HumanExplanation> = {
  'E0001': {
    title:      'CIF furnizor invalid',
    detail:     'Codul de identificare fiscală (CIF) al furnizorului nu este înregistrat în baza ANAF.',
    suggestion: 'Verificați că CIF-ul din profilul clinicii este corect și că firma este activă fiscal.',
  },
  'E0002': {
    title:      'CIF cumpărător invalid',
    detail:     'Codul de identificare fiscală al clientului nu este recunoscut de ANAF.',
    suggestion: 'Verificați CIF-ul clientului în profilul proprietarului. Pentru persoane fizice, câmpul poate fi lăsat fără prefix RO.',
  },
  'E0003': {
    title:      'Număr factură duplicat',
    detail:     'O factură cu același număr a fost deja transmisă în SPV.',
    suggestion: 'Verificați că factura nu a fost transmisă anterior. Dacă da, folosiți Storno + o factură nouă cu număr diferit.',
  },
  'E0004': {
    title:      'Data emiterii în afara perioadei permise',
    detail:     'Data facturii este anterioară termenului legal de raportare sau în viitor.',
    suggestion: 'Verificați data emiterii facturii. Facturile trebuie transmise în cel mult 5 zile lucrătoare de la data emiterii.',
  },
  'E0005': {
    title:      'Total factură incorect',
    detail:     'Suma totală a facturii nu corespunde cu suma liniilor de factură.',
    suggestion: 'Regenerați XML-ul din sistemul intern. Dacă eroarea persistă, contactați echipa tehnică.',
  },
  'E0006': {
    title:      'TVA calculată incorect',
    detail:     'Valoarea TVA declarată nu corespunde cu suma din liniile de factură.',
    suggestion: 'Verificați cotele TVA aplicate pe fiecare linie. Cotele valide sunt 0%, 9% și 19%.',
  },
  'E0007': {
    title:      'Cotă TVA invalidă',
    detail:     'A fost utilizată o cotă TVA care nu este recunoscută de legislația română.',
    suggestion: 'Actualizați liniile de factură să folosească exclusiv cotele 0%, 9% sau 19%.',
  },
  'E0008': {
    title:      'IBAN furnizor lipsă sau invalid',
    detail:     'Contul bancar al furnizorului lipsește sau nu respectă formatul IBAN românesc.',
    suggestion: 'Completați IBAN-ul clinicii în setările de facturare (format: RO49AAAA1B31007593840000).',
  },
  'E0010': {
    title:      'Referință factură storno lipsă',
    detail:     'Nota de credit (tip 381) nu conține referința la factura originală.',
    suggestion: 'Regenerați nota de credit — câmpul BillingReference trebuie completat cu numărul facturii originale.',
  },
  'E0011': {
    title:      'Adresă furnizor incompletă',
    detail:     'Datele de adresă ale furnizorului (stradă, oraș, cod poștal) sunt incomplete.',
    suggestion: 'Completați adresa completă a clinicii în setările de profil.',
  },
  'SCHEMA': {
    title:      'XML nu respectă schema UBL 2.1 / CIUS-RO',
    detail:     'Structura XML-ului nu corespunde cu specificațiile tehnice CIUS-RO 1.0.1.',
    suggestion: 'Contactați echipa tehnică pentru actualizarea generatorului XML. Eroarea completă este în câmpul "detalii tehnice".',
  },
};

const FALLBACK: HumanExplanation = {
  title:      'Eroare necunoscută ANAF',
  detail:     'ANAF a returnat o eroare care nu are o explicație predefinită în sistem.',
  suggestion: 'Verificați câmpul "detalii tehnice" pentru eroarea exactă returnată de ANAF și contactați echipa tehnică dacă problema persistă.',
};

// ---------------------------------------------------------------------------
// Funcție principală
// ---------------------------------------------------------------------------

export function explainAnafErrors(errors: AnafErrorEntry[]): string {
  if (!errors || errors.length === 0) {
    return 'Nicio eroare raportată de ANAF.';
  }

  const lines: string[] = ['ANAF a respins factura cu următoarele erori:\n'];

  errors.forEach((err, idx) => {
    const mapped = ERROR_MAP[err.errorCode] ?? FALLBACK;
    lines.push(
      `${idx + 1}. ${mapped.title} (cod: ${err.errorCode})`,
      `   Detaliu: ${mapped.detail}`,
      `   Sugestie: ${mapped.suggestion}`,
      '',
    );
  });

  lines.push(
    'IMPORTANT: Sistemul nu face corecții automate. Un operator autorizat trebuie să',
    'verifice datele, să storneze factura dacă a fost emisă și să emită una corectă.',
  );

  return lines.join('\n');
}

// Parsare XML de răspuns ANAF (format simplificat — răspunsul real e în ZIP)
export function parseAnafResponseErrors(rawXml: string): AnafErrorEntry[] {
  const errors: AnafErrorEntry[] = [];
  // Pattern: <Error errorCode="E0001" errorMessage="CIF furnizor invalid"/>
  const pattern = /errorCode="([^"]+)"[^>]*errorMessage="([^"]+)"/g;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(rawXml)) !== null) {
    errors.push({ errorCode: match[1], errorMessage: match[2] });
  }
  return errors;
}
