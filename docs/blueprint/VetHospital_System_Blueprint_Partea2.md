# SISTEM DIGITAL CENTRALIZAT — SPITAL VETERINAR ROMÂNIA
## Blueprint Complet de Arhitectură, Operațiuni și Implementare
### Partea 2 din 3: Prețuri, SPV, Automatizări AI, Stack Tehnic, Plan Implementare

---

# E. STRATEGIA DE PREȚURI

## E.1 Construirea Catalogului de Servicii

### Structura ierarhică recomandată:

```
Nivel 1 — Categorie principală
  └── Nivel 2 — Subcategorie
        └── Nivel 3 — Serviciu individual sau pachet

Exemplu:
Chirurgie
  └── Chirurgie țesuturi moi
        └── Castrare câine mascul < 10 kg
        └── Castrare câine mascul 10-25 kg
        └── Castrare câine mascul > 25 kg
  └── Chirurgie ortopedică
        └── Osteosinteza fractură femur
```

### Câmpuri obligatorii per serviciu în catalog:

| Câmp | Tip | Descriere |
|------|-----|-----------|
| cod_serviciu | VARCHAR | Cod unic intern (ex: "CHIR-CAST-M-S") |
| denumire | VARCHAR | Denumire completă |
| categorie | FK | Legătură la service_categories |
| timp_estimat_minute | INTEGER | Timp medic pentru calcul cost indirect |
| consumabile_template | FK | Legătură la procedure_template_items |
| cost_direct_calculat | DECIMAL | Auto-calculat din consumabile |
| cost_indirect_estimat | DECIMAL | Calculat separat (overhead / oră) |
| adaos_minim_procent | DECIMAL | Prag minim acceptat (ex: 30%) |
| pret_baza_fara_tva | DECIMAL | Prețul aprobat |
| tva_procent | DECIMAL | 9% sau 19% |
| valabil_de_la | DATE | Data intrare în vigoare |
| aplicabil_specii | ARRAY | NULL = toate, altfel restricționat |

---

## E.2 Calculul Costului Direct

**Definiție:** Costul direct = suma valorii consumabilelor și medicamentelor utilizate efectiv pentru prestarea serviciului.

### Formula cost direct:

```
COST_DIRECT = Σ (cantitate_consumabil × cost_mediu_stoc)
            + Σ (cantitate_medicament × cost_mediu_stoc)
            + costuri_analize_externe_daca_aplicabil

Unde cost_mediu_stoc = average_cost din inventory_items (calculat FEFO)
```

**Exemplu practic — Castrare câine mascul 5 kg:**

| Consumabil | Cantitate | Cost/unitate | Cost total |
|---|---|---|---|
| Seringă 5ml | 3 buc | 0.30 RON | 0.90 RON |
| Ac 21G | 3 buc | 0.25 RON | 0.75 RON |
| Ketamină 10mg/ml - 1ml | 2 ml | 4.50 RON | 9.00 RON |
| Medetomidine 1mg/ml | 0.5 ml | 3.20 RON | 1.60 RON |
| Manuși sterile | 2 perechi | 1.20 RON | 2.40 RON |
| Câmp operator steril | 1 buc | 2.50 RON | 2.50 RON |
| Fire sutura Vicryl 2/0 | 1 pachet | 8.00 RON | 8.00 RON |
| Betadine | 20 ml | 0.08 RON/ml | 1.60 RON |
| **TOTAL COST DIRECT** | | | **26.75 RON** |

---

## E.3 Calculul Costului Indirect

**Definiție:** Costul indirect = ponderea cheltuielilor fixe și semi-fixe ale clinicii alocată per oră de activitate medicală.

### Formula overhead pe oră:

```
OVERHEAD_ORAR = (Cheltuieli fixe lunare totale) / (Ore facturabile lunare)

Cheltuieli fixe lunare = chirie + utilități + salarii non-medical 
                        + amortizare echipamente + asigurări 
                        + licențe + marketing + altele

Ore facturabile lunare = (Medici × Ore/zi × Zile/lună) × Factor_utilizare
                       (Factor_utilizare tipic = 0.65-0.75 pentru clinici)
```

**Exemplu calcul:**

```
Cheltuieli fixe lunare estimate: 25,000 RON
Medici: 3, Ore/zi: 8, Zile/lună: 22
Ore disponibile: 3 × 8 × 22 = 528 ore
Factor utilizare: 0.70 → Ore facturabile: ~370 ore

OVERHEAD_ORAR = 25,000 / 370 = ~67.57 RON/oră

Cost indirect Castrare 5 kg (45 min):
COST_INDIRECT = 67.57 × (45/60) = ~50.68 RON
```

---

## E.4 Formula Completă de Calcul Preț

```
┌─────────────────────────────────────────────────────────────────┐
│                    MODEL DE PREȚURI                             │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  COST_DIRECT     = Σ consumabile × cost_mediu_stoc              │
│                                                                  │
│  COST_INDIRECT   = overhead_orar × (durata_minute / 60)         │
│                                                                  │
│  COST_TOTAL      = COST_DIRECT + COST_INDIRECT                  │
│                                                                  │
│  PRET_MINIM      = COST_TOTAL / (1 - marja_minima_procent/100)  │
│                                                                  │
│  PRET_RECOMANDAT = COST_TOTAL × (1 + adaos_target/100)          │
│                    SAU benchmarking cu piața                     │
│                                                                  │
│  MARJA_BRUTA_%   = (PRET_FARA_TVA - COST_TOTAL) / PRET_FARA_TVA × 100 │
│                                                                  │
│  PRAG_MINIM      = COST_DIRECT × 1.15  (acoperă minim direct)  │
│                    [sub acest pret = pierdere garantată]         │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

**Exemplu complet — Castrare câine 5 kg:**

| Componentă | Valoare |
|---|---|
| Cost direct | 26.75 RON |
| Cost indirect (45 min) | 50.68 RON |
| **Cost total** | **77.43 RON** |
| Marjă minimă 40% → Preț minim | 129.05 RON |
| Preț recomandat (marjă 55%) | 172.07 RON |
| **Preț catalog actual** | **180.00 RON** |
| **Marjă brută reală** | **57.0%** |
| Prag de alertă (sub marjă minimă 40%)| < 129 RON |

---

## E.5 Gestionarea Pachetelor

### Structura unui pachet:

```sql
packages {
  id              UUID PRIMARY KEY
  name            VARCHAR(200) NOT NULL
  description     TEXT
  
  -- Componente
  -- (relație many-to-many cu price_catalog)
  
  base_price      DECIMAL(10,2) NOT NULL    -- prețul pachetului
  discount_from_individual DECIMAL(5,2)    -- % reducere față de individual
  
  -- Condiții
  min_weight_kg   DECIMAL(5,2)
  max_weight_kg   DECIMAL(5,2)
  species_id      UUID REFERENCES species(id)
  valid_from      DATE
  valid_to        DATE
  
  is_active       BOOLEAN DEFAULT TRUE
}

package_services {
  id          UUID PRIMARY KEY
  package_id  UUID REFERENCES packages(id) NOT NULL
  service_id  UUID REFERENCES price_catalog(id) NOT NULL
  quantity    DECIMAL(8,2) DEFAULT 1
  is_optional BOOLEAN DEFAULT FALSE    -- serviciu opțional în pachet
}
```

**Exemplu pachet: "Pachet Wellness Anual Câine"**

| Serviciu inclus | Preț individual | |
|---|---|---|
| Consultație anuală | 80 RON | obligatoriu |
| Vaccinare DHPPi + Rabie | 150 RON | obligatoriu |
| Deparazitare internă | 45 RON | obligatoriu |
| Deparazitare externă | 35 RON | obligatoriu |
| Analiză hemoleucogramă | 90 RON | opțional |
| **Total individual** | **400 RON** | |
| **Preț pachet** | **320 RON** | reducere 20% |

**Control:** Prețul pachetului ≥ cost_total_direct al serviciilor incluse

---

## E.6 Urgențe și Tarife Speciale

### Urgențe:

```
Tarif urgență = tarif_baza × emergency_multiplier

Recomandat:
  - Urgențe în program: multiplier = 1.0 (fără adaos)
  - Urgențe extra-program (18:00-22:00): multiplier = 1.5
  - Urgențe noapte (22:00-08:00): multiplier = 2.0
  - Urgențe weekend: multiplier = 1.5
  - Urgențe sărbători legale: multiplier = 2.0
```

### Reduceri și prețuri speciale:

```sql
price_exceptions {
  id                UUID PRIMARY KEY
  service_id        UUID REFERENCES price_catalog(id)
  owner_id          UUID REFERENCES owners(id)       -- reducere per client
  
  exception_type    ENUM('discount_percent','fixed_price','complementary')
  value             DECIMAL(10,2)
  reason            TEXT NOT NULL
  
  approved_by       UUID REFERENCES users(id) NOT NULL   -- CRITIC: obligatoriu
  valid_from        DATE NOT NULL
  valid_to          DATE
  
  max_uses          INTEGER            -- număr maxim utilizări
  current_uses      INTEGER DEFAULT 0
  
  is_active         BOOLEAN DEFAULT TRUE
  created_at        TIMESTAMP DEFAULT NOW()
}
```

**Regulă CRITIC:** Nicio reducere nu poate aduce prețul sub `PRAG_MINIM` fără aprobare specială de la administrator.

---

## E.7 Urmărirea Profitabilității

### Dimensiuni de analiză:

| Dimensiune | Cum se calculează | Frecvență |
|---|---|---|
| Per serviciu | (preț_realizat - cost_direct) / preț_realizat | Real-time |
| Per medic | Σ marja_bruta_consultații_medic / Σ venituri_medic | Săptămânal |
| Per specie | Σ marja_bruta pe consultații câine/pisică/etc. | Lunar |
| Per tip caz | Chirurgie vs. consultații vs. internări | Lunar |
| Per perioadă | Comparativ lunar, trimestrial, anual | Lunar |

### Alerte automate recomandate:

- Dacă un serviciu are marjă brută < marjă_minimă → alertă catalog
- Dacă media realizată pe un serviciu este cu >15% sub prețul catalog → investigație reduceri neautorizate
- Dacă marja unui medic este semnificativ sub medie → verificare discount aplicat manual

---

# F. INTEGRAREA CU ANAF SPV / RO e-FACTURA

## F.1 Context Legal și Tehnic

> **CRITIC:** Această secțiune descrie implementarea pentru RO e-Factura (RO_CIUS), obligatorie pentru tranzacțiile B2B din România de la 01.01.2024. Informațiile sunt bazate pe documentația ANAF disponibilă la data redactării. **Verificați întotdeauna ultimul Ghid tehnic ANAF** înainte de implementare.

**Documentație oficială necesară:**
- Ghid tehnic integrare e-Factura (ANAF)
- Schema XSD CIUS-RO
- Documentație API SPV (swagger ANAF)
- OUG 120/2021 + modificări

---

## F.2 Fluxul Tehnic Minim Necesar

```
APLICATIE PRINCIPALĂ
        │
        ▼
[1] Validare date factură
  - CUI/CNP valid
  - Toate câmpurile obligatorii
  - TVA corect calculat
        │
        ▼
[2] Generare XML UBL 2.1 (CIUS-RO)
  - Conform schemei XSD ANAF
  - Structura: Invoice → AccountingSupplierParty, 
    AccountingCustomerParty, TaxTotal, LegalMonetaryTotal, InvoiceLine
        │
        ▼
[3] Validare locală XML
  - Validare față de XSD descărcat de la ANAF
  - Verificare câmpuri obligatorii CIUS-RO
        │
        ▼
[4] MIDDLEWARE / QUEUE
  - Autentificare OAuth ANAF (token + certificat digital)
  - Upload XML la endpoint ANAF
  - Recepție upload_index
        │
        ▼
[5] POLLING STATUS (cron job la 15-30 minute)
  - Verificare status cu upload_index
  - Stări: in prelucrare / ok / nok / erori xml
        │
        ▼
[6] DESCĂRCARE RĂSPUNS
  - Download arhivă ZIP de la ANAF
  - Extragere mesaje eroare (dacă nok)
  - Extragere confirmare + semnătură (dacă ok)
        │
        ▼
[7] ARHIVARE + RECONCILIERE
  - Stocare locală (minim 5 ani legal)
  - Actualizare status în baza de date
  - Notificare utilizator
```

---

## F.3 Componente Tehnice Detaliate

### F.3.1 Autentificarea OAuth cu certificat digital

```
COMPONENTE NECESARE:
─────────────────────────────────────────────────────
1. Certificat digital calificat (token USB)
   - Emis de: DigiSign, CertSIGN, Trans Sped
   - Cost estimat: ~100-200 EUR/an
   - CRITIC: Necesar pentru semnarea electronică și autentificare
   
2. Client OAuth implementat în backend
   Endpoint ANAF: https://logincert.anaf.ro/anaf-oauth2/v1/authorize
   
3. Flow autentificare:
   a) Redirect la ANAF login page cu client_id
   b) User autentificat cu certificat digital
   c) ANAF returnează authorization code
   d) Backend face exchange code → access_token + refresh_token
   e) access_token valid 600 secunde → refresh înainte de expirare
   
4. Stocare token:
   - NU în baza de date neencriptată
   - Recomandat: vault (HashiCorp Vault) sau variabile de mediu criptate
```

**CRITIC:** Certificatul digital aparține persoanei juridice (spitalul). La reînnoire sau schimbare administrator, procesul trebuie repetat. Planificați cu 2 luni înainte de expirare.

---

### F.3.2 Structura XML UBL 2.1 CIUS-RO (schelet)

```xml
<?xml version="1.0" encoding="UTF-8"?>
<Invoice xmlns="urn:oasis:names:specification:ubl:schema:xsd:Invoice-2"
         xmlns:cac="urn:oasis:names:specification:ubl:schema:xsd:CommonAggregateComponents-2"
         xmlns:cbc="urn:oasis:names:specification:ubl:schema:xsd:CommonBasicComponents-2">
  
  <!-- Identificare -->
  <cbc:CustomizationID>urn:cen.eu:en16931:2017#compliant#urn:efactura.mfinante.ro:CIUS-RO:1.0.1</cbc:CustomizationID>
  <cbc:ID>VET-2024-001234</cbc:ID>         <!-- Seria + număr factură -->
  <cbc:IssueDate>2024-03-15</cbc:IssueDate>
  <cbc:DueDate>2024-03-15</cbc:DueDate>
  <cbc:InvoiceTypeCode>380</cbc:InvoiceTypeCode>  <!-- 380=factură, 381=storno -->
  <cbc:DocumentCurrencyCode>RON</cbc:DocumentCurrencyCode>
  
  <!-- Vânzător -->
  <cac:AccountingSupplierParty>
    <cac:Party>
      <cac:PartyName><cbc:Name>SPITAL VETERINAR SRL</cbc:Name></cac:PartyName>
      <cac:PostalAddress>
        <cbc:StreetName>Str. Veterinarilor, Nr. 10</cbc:StreetName>
        <cbc:CityName>București</cbc:CityName>
        <cbc:CountrySubentity>RO-B</cbc:CountrySubentity>
        <cac:Country><cbc:IdentificationCode>RO</cbc:IdentificationCode></cac:Country>
      </cac:PostalAddress>
      <cac:PartyTaxScheme>
        <cbc:CompanyID>RO12345678</cbc:CompanyID>  <!-- CUI cu RO -->
        <cac:TaxScheme><cbc:ID>VAT</cbc:ID></cac:TaxScheme>
      </cac:PartyTaxScheme>
    </cac:Party>
  </cac:AccountingSupplierParty>
  
  <!-- Cumpărător (B2B) -->
  <cac:AccountingCustomerParty>
    <!-- similar cu vânzătorul, date client -->
  </cac:AccountingCustomerParty>
  
  <!-- Total TVA -->
  <cac:TaxTotal>
    <cbc:TaxAmount currencyID="RON">171.00</cbc:TaxAmount>
    <cac:TaxSubtotal>
      <cbc:TaxableAmount currencyID="RON">1900.00</cbc:TaxableAmount>
      <cbc:TaxAmount currencyID="RON">171.00</cbc:TaxAmount>
      <cac:TaxCategory>
        <cbc:ID>S</cbc:ID>
        <cbc:Percent>9</cbc:Percent>
        <cac:TaxScheme><cbc:ID>VAT</cbc:ID></cac:TaxScheme>
      </cac:TaxCategory>
    </cac:TaxSubtotal>
  </cac:TaxTotal>
  
  <!-- Totale monetare -->
  <cac:LegalMonetaryTotal>
    <cbc:LineExtensionAmount currencyID="RON">1900.00</cbc:LineExtensionAmount>
    <cbc:TaxExclusiveAmount currencyID="RON">1900.00</cbc:TaxExclusiveAmount>
    <cbc:TaxInclusiveAmount currencyID="RON">2071.00</cbc:TaxInclusiveAmount>
    <cbc:PayableAmount currencyID="RON">2071.00</cbc:PayableAmount>
  </cac:LegalMonetaryTotal>
  
  <!-- Linii factură -->
  <cac:InvoiceLine>
    <cbc:ID>1</cbc:ID>
    <cbc:InvoicedQuantity unitCode="C62">1</cbc:InvoicedQuantity>
    <cbc:LineExtensionAmount currencyID="RON">400.00</cbc:LineExtensionAmount>
    <cac:Item>
      <cbc:Description>Castrare câine mascul</cbc:Description>
      <cbc:Name>CHIR-CAST-M-S</cbc:Name>
      <cac:ClassifiedTaxCategory>
        <cbc:ID>S</cbc:ID>
        <cbc:Percent>9</cbc:Percent>
        <cac:TaxScheme><cbc:ID>VAT</cbc:ID></cac:TaxScheme>
      </cac:ClassifiedTaxCategory>
    </cac:Item>
    <cac:Price>
      <cbc:PriceAmount currencyID="RON">400.00</cbc:PriceAmount>
    </cac:Price>
  </cac:InvoiceLine>
  
</Invoice>
```

**CRITIC:** Verificați întotdeauna față de ultima versiune a XSD-ului CIUS-RO publicat de ANAF. Schema se poate actualiza.

---

### F.3.3 Endpoint-uri API ANAF (conform documentație)

| Operațiune | Endpoint | Metoda |
|---|---|---|
| Upload factură | `POST /FCTEL/rest/upload?standard=UBL&cif={CUI_vanzator}` | POST multipart |
| Verificare status | `GET /FCTEL/rest/stareMesaj?id_incarcare={index}` | GET |
| Descărcare răspuns | `GET /FCTEL/rest/descarcare?id_incarcare={index}` | GET |
| Listare mesaje | `GET /FCTEL/rest/listaMesajeFactura?zile={nr}&cif={CUI}` | GET |

> **Ipoteză:** Endpoint-urile de mai sus sunt conform documentației disponibile la momentul redactării. **Validați față de documentația actualizată ANAF** — acestea s-au schimbat în trecut.

---

### F.3.4 Tratamentul erorilor SPV

| Cod eroare ANAF | Semnificație | Acțiune recomandată |
|---|---|---|
| `F-LG-CODPART-CUI` | CUI cumpărător invalid | Verificare CUI în ANAF Webservice + corectare client |
| `F-LG-VATID` | Număr TVA invalid | Verificare format CUI |
| `XML_ERRORS` | XML nu respectă schema | Re-generare XML + validare locală |
| `in prelucrare` | ANAF procesează | Așteptare + polling după 30 minute |
| `ok` | Acceptat | Arhivare confirmare |
| `nok` | Respins | Citire mesaje eroare detaliate |

---

### F.3.5 Separarea responsabilităților pentru SPV

| Componentă | Responsabilitate |
|---|---|
| **Aplicația principală** | Validare date factură, emitere factură în sistem, generare trigger SPV |
| **Backend / Middleware** | Generare XML, autentificare OAuth, upload, polling, descărcare răspuns |
| **Queue system** | Retry logic, backoff, gestionare erori temporare (n8n/Make sau custom) |
| **Baza de date** | Stocare XML, răspunsuri, status, audit trail complet |
| **Contabilitate / Operator** | Reconciliere manuală finală, tratarea cazurilor excepționale |
| **Claude** | Explicare erori în limbaj uman, sugestii corectare, raport reconciliere |
| **NU Claude** | Generare XML, upload la ANAF, autentificare, semnătură digitală |

---

## F.4 Jurnalizare obligatorie SPV

Orice interacțiune cu ANAF trebuie logată complet:

```
LOG ENTRY pentru fiecare call API:
  - timestamp
  - endpoint
  - metoda HTTP
  - headers trimise (fără token!)
  - body trimis (primele 500 caractere sau XML file path)
  - HTTP status primit
  - body primit (complet)
  - durată request
  - identificator intern (invoice_id, submission_id)
```

**CRITIC:** Aceste loguri pot fi necesare în caz de litigiu fiscal sau audit ANAF. Se păstrează minim 5 ani (termen prescripție fiscală).

---

# G. AUTOMATIZĂRI CLAUDE CU IMPACT MARE

## G.1 Lista Completă de Automatizări (minimum 15)

---

### G-01: Verificare Factură Pre-Emitere

**Scop:** Detectarea automată a erorilor înainte de emiterea facturii fiscale

**Input:**
```json
{
  "invoice_draft": { ...toate câmpurile facturii... },
  "consultation_summary": { ...proceduri, tratamente... },
  "client_data": { ...date fiscale client... }
}
```

**Output:**
```
STATUS: ⚠️ ATENȚIE — 2 probleme detectate
1. CUI client "RO12345678" nu a putut fi validat în ANAF - verificați manual
2. Suma linie 3 (Castrare) este 180 RON, dar prețul catalog actual este 200 RON
   - Aplicat discount? Dacă nu, corectați suma.
3. ✅ TVA calculat corect (9%)
4. ✅ Toate câmpurile fiscale obligatorii sunt completate
```

**Frecvență:** La fiecare factură înainte de emitere (on-demand)
**Grad de risc:** Scăzut — rol consultativ, nu execută acțiuni
**Tip:** Suport decizional

---

### G-02: Rezumat Medical la Deschiderea Fișei

**Scop:** Economisirea timpului medicului — context rapid înaintea consultației

**Input:**
```json
{
  "pet_name": "Max",
  "last_5_consultations": [...],
  "active_medications": [...],
  "allergies": [...],
  "pending_reminders": [...]
}
```

**Output:**
```
Max — Labrador Retriever, mascul, 6 ani
⚠️ ALERGII: Penicilină — reacție anafilactică documentată (ian 2023)
Ultima consultație: acum 2 luni (10 ian 2024) — dermatită alergică cronică
Tratament activ: Apoquel 16mg 1cp/zi (prescris 90 zile, ~30 zile rămase)
De verificat: Vaccinul Rabie expiră pe 15 martie 2024 (24 zile)
Greutate la ultima vizită: 28.5 kg
```

**Frecvență:** La fiecare deschidere fișă pacient
**Grad de risc:** Scăzut — informativ
**Tip:** Suport decizional

---

### G-03: Generare Discharge Notes pentru Proprietar

**Scop:** Transformarea notițelor medicale tehnice în instrucțiuni clare pentru proprietar

**Input:**
```
Diagnostic: Gastroenterită acută
Tratament: Omeprazol 20mg SID 7 zile, Metronidazol 250mg BID 5 zile, 
           Dieta bland 3 zile, Rehidratare IV 500ml NaCl 0.9%
Follow-up: Recontrol 7 zile dacă nu ameliorare
```

**Output:**
```
Dragă doamnă Ionescu,

Max a primit tratament astăzi pentru o inflamație gastrointestinală. 
Iată ce trebuie să faceți acasă:

MEDICAMENTE:
• Omeprazol (1 comprimat roșu) — O DATĂ pe zi, dimineața, CU 30 min înainte de mâncare — 7 zile
• Metronidazol (1 comprimat alb) — DE DOUĂ ORI pe zi, dimineață + seară — 5 zile

MÂNCARE — URMĂTOARELE 3 ZILE:
• Orez fiert cu piept de pui fiert (fără condimente)
• Porții mici, de 3-4 ori pe zi
• Apă proaspătă la discreție

CÂND SĂ SUNAȚI URGENT:
• Dacă vomită mai mult de 3 ori în 24 ore
• Dacă apare sânge în scaun sau vărsături
• Dacă devine letargic sau refuză apa

Recontrol programat: 22 martie 2024
```

**Frecvență:** La finalul fiecărei consultații (one-click)
**Grad de risc:** Mediu — necesită verificare rapidă medic
**Tip:** Suport decizional + draft de aprobare

---

### G-04: Analiză Marjă Servicii și Propuneri de Preț

**Scop:** Identificarea serviciilor cu marjă sub prag și propunerea de ajustări

**Input:**
```json
{
  "services_with_margin": [...toate serviciile cu cost calculat și preț actual...],
  "cost_changes_last_30_days": [...consumabile cu prețuri modificate...],
  "market_context": "Inflatie materiale medicale +8% Q1 2024"
}
```

**Output:**
```
RAPORT MARJĂ SERVICII — Analiză automată
═══════════════════════════════════════════

⛔ SERVICII SUB MARJA MINIMĂ (30%):
1. Deparazitare internă pisică: marjă actuală 22% (preț 35 RON, cost real 27.3 RON)
   → Preț recomandat: 40 RON (+14%)
   
2. Consultație urmărire post-op: marjă actuală 18%
   → Preț recomandat: 70 RON (+22%)

⚠️ SERVICII AFECTATE DE CREȘTERE COSTURI:
3. Omeprazol 20mg (cost achiziție +15% față de luna trecută)
   → Verificați prețul de vânzare la farmacie recepție

📊 COMPARAȚIE: Prețurile dvs. sunt cu ~8% sub media pieței din zona dvs.
   (Estimare bazată pe date disponibile — verificați manual)
```

**Frecvență:** Lunar sau la fiecare schimbare semnificativă de cost
**Grad de risc:** Mediu — propuneri, nu modifică automat prețuri
**Tip:** Suport decizional

---

### G-05: Detectare Anomalii Operaționale

**Scop:** Identificarea pattern-urilor neobișnuite în activitate

**Input:** Date zilnice agregate (venituri, consultații, stoc, plăți)

**Output:**
```
⚠️ ANOMALII DETECTATE — 8 martie 2024

1. FINANCIAR: Dr. Popescu a aplicat reduceri la 7 din 8 consultații azi
   (reducere medie 25%) — valoare totală reduceri: 840 RON
   → Recomandare: verificare manuală

2. STOC: Betadine 500ml — 5 unități ieșite din stoc astăzi
   dar doar 3 consultații chirurgicale înregistrate
   → Posibilă înregistrare incorectă sau consum neraportate

3. FACTURARE: 3 consultații finalizate acum > 4 ore, nefacturate încă
   Valoare estimată nerecuperată: 480 RON

4. PATTERN: Marți după-amiaza are în mod constant 35% no-show rate
   → Recomandare: trimiteți reminder suplimentar la 2h pentru marțea
```

**Frecvență:** Zilnic automat (seara)
**Grad de risc:** Scăzut — raportare, fără acțiuni
**Tip:** Suport decizional

---

### G-06: Rezumat Operațional Zilnic/Săptămânal/Lunar

**Scop:** Brief executiv pentru administrator, trimis automat dimineața

**Input:** Date agregate din toate modulele

**Output (exemplu zilnic):**
```
SPITAL VETERINAR — Raport 8 martie 2024
══════════════════════════════════════

📊 IERI — PERFORMANȚĂ:
• 12 consultații (față de medie 10.3/zi — +16%)
• 2 internări active
• 1 intervenție chirurgicală
• Venituri: 4,240 RON (față de media 3,850 RON — +10.1%)
• Încasări: 3,890 RON | Creanțe noi: 350 RON

🔴 ATENȚIE ASTĂZI:
• 3 facturi B2B neîncă trimise în SPV (deadline azi)
• Stoc critic: Amoxiclav 250mg — mai rămân 4 unități
• 2 creanțe scadente (total 1,200 RON): Societatea XYZ + dl. Ion Popescu

📅 PROGRAMĂRI AZI: 15 programări (3 slots libere 14:00-16:00)

💡 INSIGHT SĂPTĂMÂNA ACEASTA:
Internările au crescut cu 40% față de săptămâna trecută. 
Verificați capacitatea cuștilor pentru weekend.
```

**Frecvență:** Zilnic (07:30), Săptămânal (luni dimineața), Lunar (1 ale lunii)
**Grad de risc:** Scăzut
**Tip:** Raportare automată

---

### G-07: Generare SOP-uri pentru Recepție

**Scop:** Crearea documentelor de proceduri standard pentru personal

**Input:** Descriere proces în limbaj natural

**Output:** SOP structurat cu pași numerotați, responsabili, checklist

**Exemplu SOP generat — "Procedura de urgență după program":**
```
SOP-012: GESTIONARE URGENȚE DUPĂ PROGRAM
Versiune: 1.0 | Data: 08.03.2024 | Aprobat: Dr. Ionescu

SCOP: Asigurarea unui răspuns eficient la urgențele veterinare primite 
      între orele 20:00-08:00

RESPONSABIL: Asistent de gardă + Medic de gardă (telefonic)

PAȘI:
1. La apelul de urgență:
   □ Preluare apel — identificare proprietar + animal
   □ Evaluare urgență: "Este animalul conștient? Respiră?"
   □ Dacă amenințare viață imediată → instruire proprietar să vină IMEDIAT
   □ Contactare medic de gardă la 07XX XXX XXX
   
2. La sosirea proprietarului:
   □ Deschidere cu cheia de urgență
   □ Înregistrare rapid în sistem (appointment tip 'emergency')
   □ Cântărire animal
   □ Anunțare medic de gardă că pacientul a sosit

3. Documentare:
   □ Consultația se înregistrează COMPLET în sistem chiar dacă e 2 noaptea
   □ Bon sau factură emisă înainte de plecare
   □ Dacă nu plătește → înregistrare creanță + contact mâine dimineață

4. NICIODATĂ:
   ✗ Nu amânați înregistrarea în sistem pentru dimineață
   ✗ Nu eliberați medicamente fără a le scăzut din stoc
```

**Frecvență:** La cerere
**Grad de risc:** Scăzut — necesită aprobare înainte de distribuire
**Tip:** Generare conținut + aprobare umană

---

### G-08: Draft Comunicare Post-Consultație (WhatsApp/Email/SMS)

**Scop:** Personalizarea comunicărilor cu proprietarii în funcție de context

**Input:** Date consultație + preferință comunicare client

**Output (exemplu WhatsApp post-consultație):**
```
Bună ziua, doamnă Ionescu! 🐾

Max a ajuns bine acasă sperăm! Vă reamintim câteva lucruri importante:

💊 Medicamente:
- Omeprazol: O pastilă dimineața, 7 zile
- Metronidazol: Câte o pastilă dimineața și seara, 5 zile

🍚 Dietă bland 3 zile (orez + pui fiert)

📅 Recontrol: 22 martie (programarea este în sistem, vă vom contacta cu 2 zile înainte)

⚕️ Dacă apar probleme sau întrebări, sunați la: 021 XXX XXXX

Îngrijire deosebită pentru Max! 🐶
— Echipa Spitalului Veterinar
```

**Frecvență:** Automat la 1 oră după consultație (după aprobare sau trimis direct)
**Grad de risc:** Mediu — necesită validare că mesajul nu conține date medicale sensibile nepermise
**Tip:** Draft + aprobare sau automatizat cu ruleset

---

### G-09: Clasificare și Indexare Documente

**Scop:** Organizarea automată a documentelor primite (facturi furnizori, analize externe, documente ANAF)

**Input:** Document PDF/imagine + metadate de bază (furnizor, dată, suma dacă vizibilă)

**Output:**
```json
{
  "document_type": "supplier_invoice",
  "supplier": "Romvac Company SA",
  "invoice_number": "RVC-2024-004521",
  "date": "2024-03-05",
  "total_amount": 2450.00,
  "vat_amount": 220.50,
  "suggested_purchase_order": "PO-2024-0023",
  "confidence": 0.94,
  "requires_review": false
}
```

**Frecvență:** La upload fiecare document
**Grad de risc:** Mediu — valorile financiare trebuie verificate de om
**Tip:** Suport decizional (pre-completare formulare)

---

### G-10: Explicare Erori SPV în Limbaj Uman

**Scop:** Transformarea codurilor de eroare ANAF în instrucțiuni clare de remediere

**Input:**
```json
{
  "error_code": "F-LG-CODPART-CUI-INACTIV",
  "invoice_number": "VET-2024-001234",
  "client_cui": "RO9876543"
}
```

**Output:**
```
Factura VET-2024-001234 a fost RESPINSĂ de ANAF.

Motivul: CUI-ul clientului dvs. (RO9876543) este marcat ca INACTIV 
în baza de date ANAF.

CE TREBUIE SĂ FACEȚI:
1. Contactați clientul și confirmați că firma lor este activă
2. Verificați CUI-ul pe: https://www.anaf.ro/RegVec/
3. Dacă CUI-ul este greșit → corectați-l în fișa clientului → stornați 
   factura originală → re-emiteți cu date corecte
4. Dacă firma este cu adevărat inactivă → contactați departamentul juridic 
   pentru a discuta despre creanță

Termen limită re-trimitere: 5 zile lucrătoare de la data originală a facturii
```

**Frecvență:** La fiecare eroare SPV
**Grad de risc:** Scăzut — informativ
**Tip:** Suport decizional

---

### G-11: Analiză Feedback Clienți

**Scop:** Sinteză automată a recenziilor și feedback-ului primit

**Input:** Recenzii Google, formulare feedback intern, emailuri

**Output:**
```
ANALIZĂ FEEDBACK — Ultimele 30 zile (47 răspunsuri)

Scor mediu: 4.2/5.0 ⭐

TEME POZITIVE (frecvență):
• Amabilitatea personalului: menționat în 38/47 răspunsuri
• Curățenia clinicii: menționat în 29 răspunsuri
• Comunicarea clară a medicilor: menționat în 25 răspunsuri

TEME NEGATIVE (necesită atenție):
• Timp de așteptare: menționat în 12 răspunsuri (26%)
  Fraze comune: "am așteptat 45 minute deși aveam programare"
• Prețuri: menționat în 8 răspunsuri — percepție "scump dar merită"
• Parcare: menționat în 5 răspunsuri

ALERTĂ: 2 recenzii negative acute despre același incident (3 martie)
→ Recomandare: investigație internă + răspuns public recenzii
```

**Frecvență:** Săptămânal
**Grad de risc:** Scăzut
**Tip:** Raportare + sugestii

---

### G-12: Propunere Protocoale Tratament (intern, medical)

**Scop:** Asistarea medicilor cu informații de referință pentru cazuri specifice

**Input:** Diagnostic + specie + greutate + alergii cunoscute

**Output:**
```
PROTOCOL DE REFERINȚĂ — Cistită bacteriană la pisică, 4kg
(Informații de referință — decizia aparține medicului curant)

OPȚIUNI ANTIBIOTICE RECOMANDATE:
1. Amoxiclav 62.5mg — 1 comprimat BID × 7-14 zile
   (Verificați: pisica NU are alergie la penicilină în fișă)
   
2. Marbocyl 5mg — 1 comprimat SID × 7 zile
   (Alternativă dacă alergie la penicilină)

DIAGNOSTIC CONFIRMARE RECOMANDAT:
• Urinaliza + cultură urinară (înainte de antibiotic)
• Ecografie vezică urinară

MONITORIZARE:
• Recontrol la 7 zile
• Dacă nu ameliorare → cultură + antibiogramă

⚠️ ATENȚIE: Aceasta este informație de referință, nu consultanță medicală.
Decizia terapeutică aparține exclusiv medicului veterinar.
```

**Frecvență:** La cerere de medic
**Grad de risc:** MEDIU-ÎNALT — trebuie marcat clar ca informație de referință, nu decizie medicală
**Tip:** Suport informațional — NU execută acțiuni medicale

---

### G-13: Raport Stoc Mort și Optimizare Inventar

**Scop:** Identificarea produselor imobilizate nejustificat

**Input:** Date stoc cu mișcări ultimele 90 zile

**Output:**
```
RAPORT STOC MORT — 8 martie 2024

💀 FĂRĂ MIȘCARE > 90 ZILE (valoare totalizată: 3,240 RON):
1. Ciprofloxacin 250mg (40 comprimate) — achizitat aug 2023, expiră sept 2024
   Valoare: 180 RON — Recomandare: vânzare la reducere sau returnare furnizor
   
2. Ser fiziologic NaCl 1L (12 flacoane) — fără mișcare 95 zile
   Valoare: 360 RON — Verificați: sunt folosite dar neraportate?

3. Fir sutură PDS 0 (5 pachete) — nicio intervenție cu acest fir în 4 luni
   Valoare: 240 RON — Discuție cu chirurgul: mai este necesar?

⚠️ EXPIRĂ ÎN 30 ZILE:
• Enrofloxacin 50mg/ml injectabil — 3 flacoane — Exp: 1 aprilie
• Vitamina B12 — 2 flacoane — Exp: 20 martie → URGENT

ELIBERAT FĂRĂ PRESCRIERE ASOCIATĂ (ultimele 30 zile):
• 3 mișcări tip 'consultation_use' fără consultation_id asociat
  → Verificați cu gestionarul
```

**Frecvență:** Săptămânal
**Grad de risc:** Scăzut
**Tip:** Raportare + sugestii

---

### G-14: Draft Somaţie de Plată / Comunicare Creanțe

**Scop:** Generarea comunicărilor personalizate pentru clienți cu restanțe

**Input:** Date client + factură restantă + nr. zile depășit

**Output (ton adaptat la nr. zile):**
```
[1-15 zile — ton prietenos]
Bună ziua, doamnă Ionescu!
Dorim să vă reamintim că factura nr. VET-2024-00234 în valoare de 480 RON, 
emisă pe 22 februarie, nu a fost încă achitată.
Puteți efectua plata la recepție, prin transfer sau card.
Vă mulțumim!

[15-30 zile — ton mai ferm]  
Stimate client,
Vă notificăm că soldul facturat în valoare de 480 RON este scadent de 22 de zile.
Vă rugăm să regularizați situația până la [data + 10 zile] pentru a evita 
penalități de întârziere.

[>30 zile — formal/legal]
Notificare formală de plată
Suma restantă: 480 RON — Termen original: 22 feb 2024
...
```

**Frecvență:** La cerere sau automat la praguri de timp
**Grad de risc:** Mediu — necesită aprobare umană înainte de trimitere
**Tip:** Draft + aprobare

---

### G-15: Reconciliere Servicii Prestate vs. Facturate (Audit Financiar)

**Scop:** Raport complet de discrepanțe pentru audit intern

**Input:** Date consultații, proceduri, tratamente, facturi pentru o perioadă

**Output:**
```
AUDIT RECONCILIERE — Săptămâna 4-8 martie 2024
═══════════════════════════════════════════════

SERVICII PRESTATE, NEFACTURATE:
Consultații nefacturate: 2
  - Consultație Max (Ionescu) — 6 mar — estimat 180 RON
  - Consultație Whiskers (Popa) — 7 mar — estimat 120 RON
  
Proceduri nefacturate: 3
  - Ecografie abdominală (Lab), 5 mar — 150 RON
  - Hemoleucogramă, 5 mar — 90 RON
  - Pansament, 7 mar — 35 RON

Medicamente dispensate, nefacturate: 
  - Metronidazol 250mg × 10 comprimate (lot 2403A) — 6 mar — 25 RON

TOTAL ESTIMAT NERECUPERAT SĂPTĂMÂNA ACEASTA: 600 RON

TREND: Săptămânile precedente: 320 RON → 410 RON → 600 RON
→ RECOMANDARE URGENTĂ: Verificați procesul de facturare la finalizarea consultației
```

**Frecvență:** Săptămânal
**Grad de risc:** Scăzut — raportare
**Tip:** Audit + raportare

---

# H. STACK TEHNIC RECOMANDAT

## H.1 Varianta 1 — Low-Cost / MVP Rapid (0-3 luni)

### Caracteristici:
- Echipă mică (1-2 developeri full-stack)
- Buget limitat
- Prioritate: funcționalitate de bază, nu scalabilitate
- Acceptabil: unele limitări tehnice

| Componentă | Tehnologie | Justificare |
|---|---|---|
| **Frontend** | Next.js 14 + Tailwind CSS + shadcn/ui | Rapid de prototipat, SSR bun pentru SEO |
| **Backend** | Next.js API Routes sau Fastify (Node.js) | Un singur ecosistem JS |
| **Baza de date** | PostgreSQL (Supabase) | Gratis tier generos, BaaS funcționalități |
| **ORM** | Prisma | Type-safe, migrații simple |
| **Autentificare** | Supabase Auth sau NextAuth | Simplu de integrat |
| **Fișiere** | Supabase Storage sau Cloudflare R2 | Ieftin, S3-compatible |
| **Automatizări** | n8n (self-hosted) sau Make.com | Fără cod pentru fluxuri simple |
| **Integrare Claude** | Anthropic SDK (direct din backend) | Simplu de integrat |
| **Integrare SPV** | Librărie open-source (ex: efactura-ro) + custom | Nevoie de testare riguroasă |
| **Email/SMS** | Resend (email) + Twilio sau smslink.ro | Ieftin, API simplu |
| **WhatsApp** | WhatsApp Business API (via Meta) | Necesită aprobare Business |
| **Hosting** | Vercel (frontend/API) + Supabase | Gratuit/ieftin la start |
| **Bon fiscal** | Integrare cu soft casă de marcat existent | Depinde de echipament fizic |

**Avantaje:**
- Pornit în 2-4 săptămâni
- Cost lunar < 100 EUR la start
- Tehnologii populare, ușor de găsit developeri

**Limitări:**
- Supabase limitat pentru query-uri complexe analitice
- Vercel are cold starts pentru API routes
- n8n necesită server separat pentru self-hosted
- Scalabilitate limitată > 10.000 înregistrări/zi
- SPV integration necesită testare extensivă cu sandbox ANAF

---

## H.2 Varianta 2 — Mid-Level Robust (3-9 luni, producție reală)

### Caracteristici:
- Echipă 2-3 developeri
- Buget mediu
- Producție reală, performanță bună
- Scalabilitate moderată (zeci de mii de înregistrări)

| Componentă | Tehnologie | Justificare |
|---|---|---|
| **Frontend** | Next.js 14 + TypeScript | Type safety, productivitate |
| **Backend** | NestJS (Node.js/TypeScript) | Arhitectură modulară, DI, testabil |
| **Baza de date** | PostgreSQL (managed — AWS RDS sau Neon) | Control total, scalabil |
| **ORM** | TypeORM sau Drizzle ORM | TypeScript-native |
| **Cache** | Redis (Upstash) | Cache query, sesiuni, job queues |
| **Queue** | BullMQ (Redis) | Job queue pentru SPV, email, rapoarte |
| **Autentificare** | JWT + Refresh Token custom | Control total, RBAC granular |
| **Fișiere** | AWS S3 sau Cloudflare R2 | Standard industrie |
| **Automatizări** | n8n self-hosted pe VPS dedicat | Control total, fără limite |
| **Integrare Claude** | Anthropic SDK + streaming | UX mai bun pentru output lung |
| **Integrare SPV** | Service dedicat TypeScript + librărie XML | Testat, izolat |
| **Email** | Resend sau SendGrid | Deliverability bun |
| **SMS/WhatsApp** | Twilio | Fiabil, documentație bună |
| **PDF** | Puppeteer sau PDFKit | Generare facturi, rapoarte |
| **Hosting** | AWS (EC2/ECS) sau Railway.app | Control, scalabilitate |
| **Monitoring** | Sentry (errors) + Grafana/Prometheus sau Better Uptime | Observabilitate |

**Avantaje:**
- Robust, testabil, mentenabil
- RBAC granular posibil
- Queue system fiabil pentru SPV retry logic
- Separare clară servicii

**Limitări:**
- Timp de setup mai mare
- Cost ~200-500 EUR/lună la utilizare normală
- Complexitate mai mare pentru echipa mică

---

## H.3 Varianta 3 — Scalabil Enterprise-Ready (9+ luni)

### Caracteristici:
- Multi-clinici (SaaS potențial)
- Mii de utilizatori simultani
- Cerințe de compliance înalte

| Componentă | Tehnologie | Justificare |
|---|---|---|
| **Frontend** | Next.js + monorepo (Turborepo) | Partajare cod între apps |
| **Backend** | Microservicii: NestJS per domeniu | Medical, Financiar, SPV, AI — separate |
| **API Gateway** | Kong sau AWS API Gateway | Rate limiting, auth centralizat |
| **Baza de date** | PostgreSQL (RDS Multi-AZ) + Read replicas | HA, performanță read |
| **Data warehouse** | Clickhouse sau BigQuery | Analytics, rapoarte complexe |
| **Cache** | Redis Cluster | HA cache |
| **Queue** | RabbitMQ sau AWS SQS | Reliable messaging |
| **Autentificare** | Keycloak sau Auth0 | SSO, MFA, RBAC enterprise |
| **Fișiere** | AWS S3 + CloudFront CDN | Global, rapid |
| **Automatizări** | Temporal.io sau Airflow | Workflow orchestration complex |
| **Integrare Claude** | Bedrock (AWS) sau API direct + LangChain | Control, fallback |
| **Integrare SPV** | Serviciu dedicat containerizat | Izolat, scalabil independent |
| **Monitoring** | Datadog sau New Relic | Full observability stack |
| **CI/CD** | GitHub Actions + ArgoCD | GitOps |
| **Hosting** | AWS sau GCP (Kubernetes) | Auto-scaling, global |

**Avantaje:**
- Scalabilitate aproape nelimitată
- Rezistentă la defecte (HA)
- Auditabilă complet
- Extensibilă ca SaaS

**Limitări:**
- Cost ridicat: 1,000-5,000+ EUR/lună
- Complexitate operațională ridicată
- Timp implementare 12-18 luni pentru full rollout
- Necesită echipă DevOps dedicată

---

### Recomandare pentru cazul dvs.:

> **Porniți cu Varianta 1 (MVP în 30 zile) pentru validare, targetați Varianta 2 la 3-6 luni când aveți volumul operațional confirmat. Varianta 3 devine relevantă dacă extindeți la multiple clinici sau vândeți ca SaaS.**

---

*Continuare în Partea 3: Plan de Implementare (I), KPI-uri (J), Riscuri (K), Blueprint Integrare (L), Output Final (M), Prompturi Secundare*
