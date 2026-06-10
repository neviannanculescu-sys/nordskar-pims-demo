# SISTEM DIGITAL CENTRALIZAT — SPITAL VETERINAR ROMÂNIA
## Blueprint Complet de Arhitectură, Operațiuni și Implementare
### Partea 3 din 3: Plan Implementare, KPI-uri, Riscuri, Blueprint Integrare, Output Final, Prompturi

---

# I. PLAN DE IMPLEMENTARE PE FAZE

## I.1 Faza 1 — Baza Operațională (Săptămânile 1-4)

### Ce se livrează:
- [ ] Setup baza de date cu entitățile core: owners, pets, species, breeds, veterinarians, appointments, consultations, users
- [ ] Autentificare și permisiuni de bază (roluri: admin, medic, asistent, receptioner)
- [ ] Modul Recepție: creare/editare clienți, animale, programări
- [ ] Calendar vizual per medic
- [ ] Modul Consultație: înregistrare completă, semnătură medic
- [ ] Fișă pacient cu istoric
- [ ] Reminder automat programări (SMS sau email simplu)
- [ ] Catalog servicii de bază (fără calcul costuri)
- [ ] Audit log minimal

### Dependențe:
- Definirea nomeclaturii interne de servicii (input de la medicul șef)
- Datele de migrare (clienți + animale existenți) — calitate date critică
- Alegerea stack-ului tehnic + provider hosting
- Acces server email/SMS pentru notificări

### Riscuri:
- Migrarea datelor existente este cel mai mare risc de timp — poate lua 2-3x mai mult
- Personalul rezistă la schimbare — training insuficient
- Catalog servicii nedefinit întârzie orice altceva

### Quick wins (vizibile rapid):
- Calendar digital vizual → elimină agenda pe hârtie
- Fișa digitală a pacientului → acces instant la istoric
- Remindere automate → reducere no-show

### Ce trebuie testat:
- [ ] Crearea unui pacient nou de la zero (client + animal)
- [ ] Flux complet programare → check-in → consultație → semnare
- [ ] Reminder SMS primit de un test client
- [ ] Audit log înregistrează corect modificările
- [ ] Permisiunile — receptioanera nu poate modifica prețurile

---

## I.2 Faza 2 — Financiar + Stocuri (Săptămânile 5-10)

### Ce se livrează:
- [ ] Catalog complet prețuri cu legătură la consumabile
- [ ] Modul stocuri: inventory_items, stock_movements (intrări + ieșiri)
- [ ] Legare consumabile de consultații/proceduri
- [ ] Modul facturare: generare factură din consultație, invoice_lines auto-populate
- [ ] Plăți: cash, card, transfer
- [ ] Bon fiscal (integrare sau workaround temporar)
- [ ] Modul achiziții: PO + bon recepție + actualizare stoc
- [ ] Alertă stoc minim
- [ ] Export de bază pentru contabilitate (CSV)
- [ ] Raport zilnic basic (fără Claude)
- [ ] Detectare servicii nefacturate (query automat)

### Dependențe:
- Faza 1 completă și stabilă
- Inventarul fizic de pornire (stoc inițial) — necesită inventariere fizică
- Definirea costurilor pentru fiecare serviciu în catalog
- Decizie despre casa de marcat fizică (se integrează sau se operează separat?)

### **CRITIC — Casa de marcat:**
> Integrarea tehnică cu o casă de marcat fiscală (pentru bon fiscal la plata cash) este complexă și depinde de modelul de echipament. Opțiuni:
> 1. Integrare directă prin driver/SDK (dacă casa suportă)
> 2. Export date pentru casă + operare manuală (workaround temporar)
> 3. Casă de marcat Android cu API (ex: Datecs, Tremol) — mai ușor de integrat
> **Nu lăsați această decizie pentru ultima zi — clarificați în săptămâna 1**

### Riscuri:
- Stocul inițial greșit → toate calculele de marjă sunt incorecte de la început
- Prețuri de cost nesincronizate → servicii vândute sub cost fără a ști
- Bon fiscal neintegrat → operare duală (sistem + casă separată) → erori

### Quick wins:
- Prima factură emisă din sistem (nu mai pe hârtie/Word)
- Prima alertă stoc minim funcțională
- Primul raport zilnic venituri

### Ce trebuie testat:
- [ ] Flux complet consultație → factură cu toate liniile populate corect
- [ ] Consum stoc la finalizarea consultației
- [ ] Stoc minim generează alertă
- [ ] Raport zilnic cifre corecte față de tranzacțiile introduse
- [ ] Export CSV deschis corect în Excel pentru contabil

---

## I.3 Faza 3 — SPV + Reconciliere (Săptămânile 11-18)

### Ce se livrează:
- [ ] Generare XML UBL 2.1 CIUS-RO pentru facturi B2B
- [ ] Validare locală XML față de XSD ANAF
- [ ] Modul SPV: autentificare OAuth, upload, polling status
- [ ] Descărcare și arhivare răspunsuri ANAF
- [ ] Dashboard SPV: status per factură, erori, reconciliere
- [ ] Tratare erori cu coduri cunoscute + explicații
- [ ] Raport reconciliere lunar (facturi emise vs. confirmate ANAF)
- [ ] Export complet contabilitate (facturi emise + primite + plăți + TVA)

### Dependențe:
- **CRITIC:** Certificat digital calificat achiziționat și funcțional
- **CRITIC:** Acces la sandbox ANAF pentru testare (`https://api.anaf.ro/...`)
- Contabilul extern să confirme formatul de export acceptat
- Faza 2 completă (facturare funcțională)
- Minimum 3-4 săptămâni dedicate testelor SPV — nu grăbiți această fază

### **Ipoteză importantă:** Endpoint-urile și schema XSD se pot modifica. Construiți mecanismul de update al schemei XSD fără redeploy.

### Riscuri:
- **CRITIC:** Token OAuth poate expira în producție dacă nu implementați refresh corect → facturi netrimise fără avertizare
- Schema XSD actualizată de ANAF → XML-ul generat devine invalid
- Erori la facturile cu linii complexe (TVA diferite pe aceeași factură)
- Timp de răspuns ANAF variabil → UI trebuie să gestioneze stări intermediare

### Ce trebuie testat:
- [ ] Upload factură simplă în sandbox ANAF → confirmare 'ok'
- [ ] Upload factură cu erori deliberate → primit 'nok' cu coduri corecte
- [ ] Token refresh automat funcționează
- [ ] Arhivare răspuns ZIP funcționează
- [ ] Dashboard SPV reflectă corect statusul real
- [ ] Alertă pentru facturi > 5 zile neconfirmate funcționează

---

## I.4 Faza 4 — AI Layer (Săptămânile 19-26)

### Ce se livrează:
- [ ] Integrare Anthropic Claude API (SDK + streaming)
- [ ] G-01: Verificare factură pre-emitere
- [ ] G-02: Rezumat medical la deschiderea fișei
- [ ] G-03: Generare discharge notes
- [ ] G-06: Rezumat operațional zilnic (email automat)
- [ ] G-05: Detectare anomalii
- [ ] G-10: Explicare erori SPV
- [ ] G-13: Raport stoc mort
- [ ] G-15: Reconciliere servicii prestate vs. facturate
- [ ] **RECOMANDAT:** G-08: Draft comunicare clienți (necesită aprobare umană)

### Dependențe:
- Faze 1-3 complete și stabile (AI are nevoie de date curate)
- API key Anthropic activ
- Definirea prompturilor și validarea lor cu personalul
- Infrastructură pentru job-uri asincrone (queue pentru rapoarte)

### Riscuri:
- **CRITIC:** AI-ul poate genera informații incorecte — niciun output AI nu trebuie aplicat automat fără validare umană, mai ales în context medical sau fiscal
- Cost API Claude poate fi surprinzător dacă nu implementați rate limiting și caching
- Personalul poate supra-delega AI-ului → dependență periculoasă
- Prompturi prost calibrate → output irelevant sau periculos

### Quick wins:
- Rezumatul medical la deschidere fișă → economie 2-3 minute per consultație
- Raport zilnic automat → administrator informat fără efort

### Ce trebuie testat:
- [ ] Rezumat medical reflectă corect datele din fișă (nu halucinează)
- [ ] Verificare factură detectează greșeli introduse deliberat
- [ ] Cost API per zi este în buget (monitorizare token usage)
- [ ] Dacă API Claude este down, sistemul funcționează normal (graceful degradation)

---

## I.5 Faza 5 — Analytics și Optimizare (Săptămânile 27-36)

### Ce se livrează:
- [ ] Dashboard management complet cu toți KPI-urile din secțiunea J
- [ ] Rapoarte manageriale avansate (comparații perioadă, trenduri)
- [ ] Motor de pricing automat (alertă + propuneri actualizare prețuri)
- [ ] CRM complet: segmentare clienți, campanii, retenție
- [ ] Rapoarte profitabilitate pe medic / serviciu / specie
- [ ] Modul internări complet (dacă nu implementat anterior)
- [ ] Integrare WhatsApp Business pentru comunicare clienți
- [ ] **RECOMANDAT:** Modul laborator + imagistică (DICOM viewer basic)

### Dependențe:
- Toate fazele anterioare complete
- Minimum 3-6 luni de date în sistem pentru analize relevante

### Riscuri:
- Fără date curate din faze anterioare, analytics sunt inutile
- WhatsApp Business API — procese de aprobare Meta pot dura săptămâni

---

# J. KPI-URI DE MANAGEMENT

## J.1 Tabel Complet KPI-uri

### FINANCIARI

---

**KPI-01: Venit pe Zi**
- **Definiție:** Total venituri facturate în ziua respectivă (sumă invoice.total pentru facturi emise în acea zi)
- **Formula:** `SUM(invoices.total) WHERE issue_date = today AND status != 'cancelled'`
- **Sursă date:** Modulul facturare
- **Frecvență raportare:** Zilnic (raport dimineață pentru ziua precedentă)
- **Praguri alertă:** < 70% față de media ultimelor 30 zile → flag galben; < 50% → flag roșu

---

**KPI-02: Venit pe Medic**
- **Definiție:** Venituri generate din consultațiile unui medic specific
- **Formula:** `SUM(invoice_lines.total) WHERE procedure.veterinarian_id = {vet_id} AND invoice.issue_date IN period`
- **Sursă date:** Facturare + consultații
- **Frecvență:** Săptămânal, lunar
- **Praguri alertă:** Dacă un medic este cu >30% sub media echipei → investigație (concediu? caz complex?)

---

**KPI-03: Bon Mediu per Consultație**
- **Definiție:** Valoarea medie a unei facturi asociate unei consultații
- **Formula:** `SUM(invoice.total) / COUNT(DISTINCT consultation_id) pentru facturile cu consultation_id`
- **Sursă date:** Facturare + consultații
- **Frecvență:** Zilnic, săptămânal
- **Praguri alertă:** Scădere >15% față de media precedentă → verificare reduceri aplicate

---

**KPI-04: Marjă Brută pe Serviciu**
- **Definiție:** (Preț vânzare - Cost direct) / Preț vânzare × 100
- **Formula:** `(invoice_line.unit_price - invoice_line.unit_cost) / invoice_line.unit_price * 100`
- **Sursă date:** Invoice lines cu unit_cost completat
- **Frecvență:** Lunar (recalcul la fiecare schimbare cost)
- **Praguri alertă:** Marjă < min_margin_percent din catalog → alertă imediată

---

**KPI-05: Zile până la Facturare (TTB — Time to Bill)**
- **Definiție:** Timpul mediu de la finalizarea consultației până la emiterea facturii
- **Formula:** `AVG(invoice.issued_at - consultation.ended_at) WHERE consultation.status = 'completed'`
- **Sursă date:** Consultații + facturare
- **Frecvență:** Zilnic
- **Praguri alertă:** TTB > 2 ore pentru consultații rutiniere → alertă; >24 ore → alertă critică

---

**KPI-06: DSO (Days Sales Outstanding) — Zile până la Încasare**
- **Definiție:** Numărul mediu de zile de la emiterea facturii până la plată integrală
- **Formula:** `AVG(payment.payment_date - invoice.issue_date) WHERE payment.payment_type = 'payment'`
- **Sursă date:** Facturare + plăți
- **Frecvență:** Lunar
- **Praguri alertă:** DSO > 7 zile (pentru clinică cu plată predominant la fața locului) → risc creanțe

---

**KPI-07: Total Creanțe Restante**
- **Definiție:** Suma facturilor neachitate total sau parțial, grupate pe intervale de vârstă
- **Formula:** 
  ```
  SUM(invoice.balance_due) WHERE balance_due > 0
  Grupat: 0-30 zile / 31-60 zile / 61-90 zile / >90 zile
  ```
- **Sursă date:** Facturare
- **Frecvență:** Zilnic
- **Praguri alertă:** Creanțe >90 zile > 5% din venituri lunare → acțiune colectare

---

**KPI-08: Rată Erori SPV**
- **Definiție:** % facturi B2B respinse de ANAF din totalul transmis
- **Formula:** `COUNT(spv_submissions WHERE anaf_status = 'nok') / COUNT(spv_submissions WHERE anaf_status != 'not_uploaded') * 100`
- **Sursă date:** Modul SPV
- **Frecvență:** Zilnic
- **Praguri alertă:** > 5% → investigație proces; > 15% → alertă critică, posibil problemă sistematică CUI sau XML

---

### OPERAȚIONALI

---

**KPI-09: Rată Ocupare Programări**
- **Definiție:** % din sloturile disponibile care au fost efectiv utilizate
- **Formula:** `COUNT(appointments WHERE status IN ('completed','in_progress')) / COUNT(available_slots) * 100`
- **Sursă date:** Programări + calendar disponibilitate
- **Frecvență:** Zilnic, săptămânal
- **Praguri alertă:** < 60% → considerați reducere de capacitate sau campanie de atragere clienți; > 95% → considerați extindere

---

**KPI-10: Rată No-Show**
- **Definiție:** % programări confirmate care nu s-au prezentat
- **Formula:** `COUNT(appointments WHERE status = 'no_show') / COUNT(appointments WHERE status IN ('no_show','completed','in_progress')) * 100`
- **Sursă date:** Programări
- **Frecvență:** Zilnic, săptămânal
- **Praguri alertă:** > 15% → revizuire sistem remindere

---

**KPI-11: Servicii Nefacturate Suspecte (Valoare)**
- **Definiție:** Valoarea estimată a serviciilor prestate dar neapărute în facturi
- **Formula:** `SUM(procedure.total_price + treatment_line.unit_price * quantity) WHERE NOT EXISTS invoice_line`
- **Sursă date:** Proceduri + tratamente + facturare
- **Frecvență:** Zilnic (alertă) + Săptămânal (raport)
- **Praguri alertă:** Orice valoare > 0 → task; > 500 RON/zi → alertă imediată manager

---

### STOCURI

---

**KPI-12: Rotație Stoc per Categorie**
- **Definiție:** De câte ori se „rotește" (se consumă și se reaprovizionează) stocul într-o perioadă
- **Formula:** `Cost_bunuri_consumate_perioada / Valoare_medie_stoc_perioada`
- **Sursă date:** Stocuri + mișcări
- **Frecvență:** Lunar
- **Praguri alertă:** Rotație < 2× pe lună pentru medicamente esențiale → posibil stoc supradimensionat

---

**KPI-13: % Stoc Mort**
- **Definiție:** % din valoarea stocului fără nicio mișcare în ultimele 90 zile
- **Formula:** `SUM(current_stock * average_cost WHERE last_movement_date < NOW()-90d) / SUM(current_stock * average_cost) * 100`
- **Sursă date:** Stocuri + mișcări
- **Frecvență:** Lunar
- **Praguri alertă:** > 10% din valoarea stocului → acțiune: returnare furnizor, reducere preț, casare

---

**KPI-14: Produse sub Stoc Minim**
- **Definiție:** Numărul de produse active cu stoc curent sub nivelul minim setat
- **Formula:** `COUNT(inventory_items WHERE current_stock <= min_stock_level AND is_active = TRUE)`
- **Sursă date:** Stocuri
- **Frecvență:** Real-time (alertă) + Zilnic (raport)
- **Praguri alertă:** Orice produs esențial (medicamente) sub minim → alertă imediată

---

### CLINICI

---

**KPI-15: Consultații pe Medic pe Zi**
- **Definiție:** Numărul mediu de consultații realizate per medic per zi lucrătoare
- **Formula:** `COUNT(consultations WHERE veterinarian_id = X AND date = Y) / working_days`
- **Frecvență:** Zilnic, săptămânal
- **Praguri alertă:** > 20 consultații/zi/medic consistent → risc burnout și calitate scăzută

---

**KPI-16: Top 10 Servicii Profitabile**
- **Definiție:** Serviciile cu cea mai mare contribuție la marja brută totală
- **Formula:** `SUM((unit_price - unit_cost) * quantity) per service_id, ordonat descrescător`
- **Frecvență:** Lunar
- **Utilizare:** Prioritizare marketing, training personal, investiții echipamente

---

**KPI-17: Top 10 Servicii Neprofitabile (sub marjă minimă)**
- **Definiție:** Serviciile vândute în mod regulat sub marja minimă acceptată
- **Formula:** `AVG(realized_margin) per service WHERE realized_margin < min_margin_percent, COUNT > 5`
- **Frecvență:** Lunar
- **Acțiune:** Revizuire preț sau eliminare din catalog

---

# K. RISCURI ȘI CONTROALE

## K.1 Tabel Complet Riscuri

| # | Risc | Cauza probabilă | Impact | Control Preventiv | Control Detectiv | Responsabil |
|---|------|----------------|--------|-------------------|-----------------|-------------|
| R-01 | **Date lipsă în consultație** | Medici grăbiți, UI neprietenos | Factură incompletă, urmărire medicală deficitară | Câmpuri obligatorii marcate; blocare semnătură consultație fără date cheie | Raport % completitudine consultații; alertă la TTB > 2h fără semnătură | Medic șef |
| R-02 | **Factură emisă incorect** | Date client greșite, preț greșit, TVA greșit | Penalitate fiscală, factură invalidă | Verificare Claude pre-emitere; câmpuri CUI validate la salvare client | Raport facturi fără SPV submission; reconciliere TVA | Administrator |
| R-03 | **Servicii prestate nefacturate** | Consultație nesemnată, proceduri uitate în factură | Pierdere directă de venituri | Pre-populate automată factură din consultație; blocare închidere zi fără facturi | Raport zilnic servicii nefacturate (KPI-11); alertă TTB | Administrator + Recepție |
| R-04 | **Stocuri incorecte** | Medicamente folosite neraportate, recepție greșită | Discrepanțe inventar, calcul marjă eronat | Scădere automată stoc la fiecare treatment_line dispensed | Inventar fizic periodic; raport discrepanțe; alertă stoc negativ imposibil | Gestionar |
| R-05 | **Drepturi prea largi în sistem** | Configurare neglijentă, cont admin partajat | Modificări neautorizate prețuri/facturi, furt date | RBAC granular; principiul minimului privilegiu; parole individuale | Raport audit_logs per user; alertă acțiuni sensibile (stornare, reducere >20%) | Administrator IT |
| R-06 | **Dubluri de clienți/animale** | Înregistrare la telefon vs. walk-in; greșeli de scriere | Istoric dispersat, facturare duplicată | Verificare duplicate la creare (phone, email, chip_number) | Raport lunar conturi potențial duplicate | Recepție |
| R-07 | **Erori SPV — token expirat** | Refresh token neimplementat sau certificat expirat | Facturi B2B netrimise la ANAF; risc amendă | Refresh automat token; alertă cu 30 zile înainte de expirare certificat | Dashboard SPV; alertă facturi pending > 2 zile | Responsabil IT + Administrator |
| R-08 | **Dependență excesivă de AI** | Personalul delegă decizii medicale sau fiscale AI | Erori medicale, erori fiscale, responsabilitate legală neclară | Training personal: AI = asistent, nu decizie; NU acțiuni automate pe date critice | Audit output Claude; feedback loop calitate răspunsuri | Medic șef + Administrator |
| R-09 | **Lipsa audit trail** | Baza de date fără triggere de logging; ștergere permisă | Imposibil de investigat incidente; risc audit fiscal | Triggere DB pe toate tabelele critice; audit_logs NICIODATĂ șterse | Verificare periodică integritate audit log; test random intrări | Administrator IT |
| R-10 | **Inconsistență medical/financiar** | Consultație modificată după facturare | Factură nu reflectă prestația reală; risc dacă inspectat | Blocare modificare consultație după emiterea facturii (status lock) | Raport comparativ proceduri vs. linii factură | Administrator |
| R-11 | **Medicamente expirate folosite** | Stoc neverificat; FEFO nerespectare | Risc medical și legal | Blocare ieșire din stoc pentru lot cu expiry_date < azi | Alertă zilnică produse expirate în stoc; raport inspecție stoc | Gestionar + Medic șef |
| R-12 | **Date personale fără GDPR** | Stocare date contact fără consimțământ | Amendă GDPR (până la 4% cifra de afaceri) | gdpr_consent = TRUE obligatoriu la creare client; UI cu checkbox explicit | Raport clienți fără consent GDPR | Administrator + Contabilitate/Juridic |
| R-13 | **Factură B2B emisă fără SPV** | Bug în logică trimitere; token invalid neobservat | Amendă ANAF; neconformitate fiscală | Trigger automat la emitere factură B2B → creare spv_submission | Dashboard facturi B2B fără submission în 24h; alertă zilnică | Administrator |
| R-14 | **Pierdere date (backup)** | Server crash, ransomware, greșeală admin | Pierdere istorică de date medicale și financiare | Backup automat zilnic (3-2-1: 3 copii, 2 medii, 1 offsite) | Test restaurare backup lunar | Administrator IT |
| R-15 | **Stupefiante/psihotrope nedeclarate** | Evidență separată nerespectată | Răspundere penală | Câmp `is_controlled = TRUE` cu restricții acces; jurnale separate | Raport lunar utilizare substanțe controlate (predat DSVSA) | Medic șef + Gestionar |

---

# L. BLUEPRINT DE AUTOMATIZARE — SCHEMA DE INTEGRARE

## L.1 Descriere Textuală a Schemei

```
═══════════════════════════════════════════════════════════════════
                    SCHEMA GENERALĂ DE INTEGRARE
═══════════════════════════════════════════════════════════════════

APLICAȚIA PRINCIPALĂ (Next.js / NestJS)
├── Frontend (React/Next.js)
│   ├── UI Recepție (programări, check-in)
│   ├── UI Medical (consultații, fișe, internări)
│   ├── UI Financiar (facturare, plăți)
│   ├── UI Stocuri (inventar, achiziții)
│   └── Dashboard Management (KPI-uri, rapoarte)
│
├── Backend API (REST + WebSocket pentru real-time)
│   ├── Auth Service (JWT, RBAC)
│   ├── Core Medical Service (consultații, tratamente)
│   ├── Financial Service (facturare, plăți)
│   ├── Inventory Service (stocuri, achiziții)
│   └── Notification Service (email, SMS, WhatsApp)
│
└── Job Queue (BullMQ / Redis)
    ├── Job: send-reminders (cron 2× pe zi)
    ├── Job: daily-report (cron 07:30)
    ├── Job: spv-poll-status (cron la 30 min)
    ├── Job: stock-alert-check (cron zilnic 08:00)
    └── Job: unbilled-services-check (cron zilnic 20:00)

─────────────────────────────────────────────────────────────────

BAZA DE DATE (PostgreSQL)
├── Schema core (owners, pets, consultations, etc.)
├── Schema financial (invoices, payments, fiscal_documents)
├── Schema inventory (inventory_items, stock_movements)
├── Schema spv (spv_submissions, spv_responses)
└── Schema audit (audit_logs — IMUTABIL)

→ Backend API citește/scrie direct în PostgreSQL
→ Audit triggers pe toate tabelele critice (INSERT/UPDATE/DELETE)
→ Read-only replica pentru rapoarte (opțional, Varianta 2+)

─────────────────────────────────────────────────────────────────

N8N / MAKE (Automation Middleware)
├── Flow: "Factură emisă → Verificare Claude → Trigger SPV"
│   Trigger: Webhook din backend la invoices.status = 'issued'
│   Acțiuni: 
│     1. Call Claude API pentru verificare
│     2. Dacă ok → creare spv_submission în DB
│     3. Dacă erori → notificare recepție cu detalii
│
├── Flow: "Reminder programări"
│   Trigger: Cron 09:00
│   Acțiuni:
│     1. Query DB → programări de mâine și in 2 ore
│     2. Claude (opțional): personalizare mesaj
│     3. Send SMS via Twilio / smslink.ro
│     4. Send WhatsApp via Meta Business API
│     5. Log în DB (reminder_sent = true)
│
├── Flow: "Alertă stoc minim"
│   Trigger: Webhook din backend la stock_movements
│   Acțiuni:
│     1. Verificare stoc current vs. min_stock_level
│     2. Dacă sub minim → email gestionar + push notification
│     3. Creare task în sistem
│
├── Flow: "Raport zilnic management"
│   Trigger: Cron 07:30
│   Acțiuni:
│     1. Query DB → date agregate ziua precedentă (JSON)
│     2. Call Claude API → generare rezumat narativ
│     3. Send email → administrator
│     4. Send WhatsApp short summary → manager
│
└── Flow: "Feedback post-consultație"
    Trigger: Webhook la 24h după consultation.ended_at
    Acțiuni:
      1. Claude: generare mesaj personalizat feedback
      2. Send WhatsApp / email cu link formular
      3. Log în DB

─────────────────────────────────────────────────────────────────

SPV MIDDLEWARE (Service dedicat — Node.js sau Python)
├── Funcție: generate-xml(invoice_id)
│   - Citire date factură din DB
│   - Generare XML UBL 2.1 CIUS-RO
│   - Validare față de XSD
│   - Salvare XML în storage
│   - Update spv_submissions.xml_file_path
│
├── Funcție: upload-to-anaf(submission_id)
│   - Citire token OAuth din vault
│   - Dacă token expirat → refresh automat
│   - POST multipart la ANAF upload endpoint
│   - Salvare upload_index în DB
│   - Retry logic: max 3 retry cu exponential backoff
│
├── Funcție: poll-status(submission_id)
│   - GET status de la ANAF
│   - Update anaf_status în DB
│   - Dacă 'ok' → trigger download
│   - Dacă 'nok' → parse erori + creare task
│
├── Funcție: download-response(submission_id)
│   - GET arhivă ZIP de la ANAF
│   - Salvare în storage + path în DB
│   - Update reconciled flag
│
└── Monitorizare: Health check la fiecare 5 minute
    - Token valid?
    - Upload queue goală sau cu erori blocate?
    - Notificare imediată dacă service down

─────────────────────────────────────────────────────────────────

CLAUDE API (Anthropic)
├── Apelat din: Backend API (sync, pentru verificări)
│             n8n flows (async, pentru rapoarte, drafturi)
│             SPV middleware (pentru explicare erori)
│
├── Context injectat per call:
│   - Date relevante din DB (structurate ca JSON)
│   - Instrucțiuni sistem (rol, limitări, format output)
│   - Nu date personale inutile (minim necesar)
│
├── Output gestionat:
│   - Afișat în UI (suggestii, rezumate)
│   - Trimis prin email/WhatsApp (drafturi aprobate)
│   - Loggat în audit_logs (ce a generat Claude, când, pentru ce)
│
└── Fallback:
    - Dacă API Claude down → funcționalitățile AI sunt disabled
    - Sistemul CONTINUĂ să funcționeze normal
    - Alertă administrator că AI layer este indisponibil

─────────────────────────────────────────────────────────────────

EMAIL / SMS / WHATSAPP
├── Email: Resend.com sau SendGrid
│   - Facturi emise (PDF atașat)
│   - Rapoarte management
│   - Notificări sistem (erori SPV, alerte stoc)
│   - Comunicări clienți
│
├── SMS: smslink.ro (furnizor RO) sau Twilio
│   - Remindere programări
│   - Confirmări programări
│   - Alerte urgente
│
└── WhatsApp: Meta Business API
    - Mesaje personalizate clienți (post-consultație)
    - Remindere vaccinuri
    - Comunicare status internare
    [ATENȚIE: necesită aprobare cont Business Meta, 1-4 săptămâni]

─────────────────────────────────────────────────────────────────

CONTABILITATE EXTERNĂ
├── Export lunar CSV/JSON:
│   - Registru vânzări (facturi emise + TVA colectată)
│   - Registru cumpărări (facturi furnizori + TVA deductibilă)
│   - Jurnal casă (încasări cash)
│   - Jurnal bancă (extrase import)
│   - Balanță stocuri (valoare la cost)
│
├── Format: Compatibil cu Saga / WinMentor / CIEL
│   (de confirmat cu contabilul înainte de implementare)
│
└── Transmitere: Email securizat sau access read-only la modul export

─────────────────────────────────────────────────────────────────

DASHBOARD MANAGEMENT (BI)
├── Real-time: WebSocket din backend → KPI live
├── Grafice: Recharts sau Chart.js în frontend
├── Rapoarte: Pre-generate + cache în Redis
└── Export: PDF și Excel pentru rapoarte manageriale
```

---

# M. OUTPUT FINAL DE IMPLEMENTARE

## M.1 Blueprint Operațional — Rezumat Executiv

Sistemul are **4 straturi principale**:
1. **PIMS Core** — date medicale, programări, fișe, consultații, internări
2. **ERP Light** — stocuri, achiziții, furnizori, catalog prețuri, marjă
3. **Financiar + Fiscal** — facturare, plăți, bon fiscal, SPV/e-Factura, contabilitate
4. **AI + Analytics** — Claude pentru suport decizional, rapoarte, comunicări, detectare anomalii

**Principiu necondiționat:** Sistemul funcționează complet fără AI. Claude adaugă eficiență și vizibilitate, nu devine dependență critică.

---

## M.2 Liste Module Prioritare

### PRIORITATE 1 (MVP Obligatoriu — Faza 1-2):
1. Recepție + Programări
2. Fișa Pacientului + Istoric Medical
3. Consultații + Semnătură Medic
4. Catalog Servicii (de bază)
5. Stocuri (inventar + mișcări)
6. Facturare + Plăți
7. Audit Log
8. Permisiuni RBAC

### PRIORITATE 2 (Faza 2-3 — Necesare pentru operare reală):
9. Achiziții + Bon Recepție
10. Integrare SPV / e-Factura
11. Export Contabilitate
12. Alertă Stoc Minim + Nefacturat
13. Raport Zilnic Basic

### PRIORITATE 3 (Faza 4-5 — Valoare adăugată):
14. Automatizări Claude (G-01 → G-15)
15. CRM + Retenție
16. Internări (complet)
17. Laborator + Imagistică
18. Dashboard KPI Avansat

---

## M.3 Schema Baze de Date v1 — Lista Entități

```
ENTITĂȚI CORE (Faza 1):
─────────────────────
users               → autentificare și roluri
owners              → proprietari animale
pets                → animale / pacienți
species             → specii (câine, pisică, etc.)
breeds              → rase
veterinarians       → medici cu profiluri extinse
rooms               → cabinete / săli
appointments        → programări
consultations       → consultații medicale
audit_logs          → jurnal complet acțiuni

ENTITĂȚI MEDICALE (Faza 1-2):
─────────────────────────────
procedure_templates         → șabloane proceduri standard
procedure_template_items    → consumabile per șablon
procedures                  → proceduri efectuate
treatment_lines             → medicamente prescrise/administrate
hospitalizations            → internări
hospitalization_observations → observații zilnice internare
cages                       → cuști / boxe

ENTITĂȚI COMERCIALE (Faza 2):
─────────────────────────────
price_catalog        → catalog servicii și tarife
service_categories   → ierarhie categorii servicii
packages             → pachete servicii
package_services     → componente pachete
price_exceptions     → prețuri speciale / reduceri aprobate

ENTITĂȚI STOCURI (Faza 2):
──────────────────────────
inventory_items      → produse în stoc
stock_movements      → mișcări stoc (intrări/ieșiri)
suppliers            → furnizori
purchase_orders      → comenzi aprovizionare
purchase_order_lines → linii comenzi
goods_receipts       → bonuri de recepție
goods_receipt_lines  → linii bon recepție

ENTITĂȚI FINANCIARE (Faza 2-3):
─────────────────────────────────
invoices             → facturi emise
invoice_lines        → linii facturi
payments             → plăți / încasări
fiscal_documents     → bonuri fiscale + alte documente

ENTITĂȚI SPV (Faza 3):
───────────────────────
spv_submissions      → transmisii la ANAF
spv_responses        → răspunsuri ANAF (log complet)

ENTITĂȚI CRM/COMUNICARE (Faza 4-5):
────────────────────────────────────
tasks                → sarcini interne
reminders            → reamintiri pentru clienți
feedback             → feedback clienți
```

---

## M.4 Lista Automatizări Claude Prioritare

| Prioritate | Cod | Automatizare | Faza |
|---|---|---|---|
| P1 | G-01 | Verificare factură pre-emitere | 4 |
| P1 | G-02 | Rezumat medical la deschiderea fișei | 4 |
| P1 | G-06 | Rezumat operațional zilnic automat | 4 |
| P1 | G-10 | Explicare erori SPV | 4 |
| P2 | G-03 | Generare discharge notes | 4 |
| P2 | G-05 | Detectare anomalii operaționale | 4 |
| P2 | G-15 | Reconciliere servicii prestate vs. facturate | 4 |
| P2 | G-13 | Raport stoc mort | 4 |
| P3 | G-04 | Propuneri actualizare prețuri | 5 |
| P3 | G-07 | Generare SOP-uri | 5 |
| P3 | G-08 | Draft comunicare clienți | 5 |
| P3 | G-09 | Clasificare documente | 5 |
| P3 | G-11 | Analiză feedback clienți | 5 |
| P3 | G-12 | Protocoale tratament (referință) | 5 |
| P3 | G-14 | Draft somaţie plată | 5 |

---

## M.5 Plan MVP 30 Zile

### Săptămâna 1 (Zile 1-7): Fundație
| Zi | Task |
|---|---|
| 1-2 | Setup repo, baza de date PostgreSQL, mediu de dezvoltare, schema inițială v1 |
| 3-4 | Migrare date existente (owners + pets) — format CSV → import script |
| 5-6 | Autentificare (login, logout, roluri: admin, medic, receptioner) |
| 7 | Test + validare schema + access control |

### Săptămâna 2 (Zile 8-14): Recepție + Consultații
| Zi | Task |
|---|---|
| 8-9 | CRUD Owners + Pets + formulare UI |
| 10-11 | Calendar programări (vizualizare + creare) |
| 12-13 | Modul consultație (creare, editare, semnare medic) |
| 14 | Test flux: client nou → animal → programare → consultație |

### Săptămâna 3 (Zile 15-21): Catalog + Stocuri basic
| Zi | Task |
|---|---|
| 15-16 | Catalog servicii (CRUD + categorii) |
| 17-18 | Stocuri: inventory_items + stock_movements de bază |
| 19-20 | Reminder programări (email simplu sau SMS) |
| 21 | Test: catalog → legare la consultație; stoc minim alertă |

### Săptămâna 4 (Zile 22-30): Facturare + Polish
| Zi | Task |
|---|---|
| 22-24 | Facturare: generare factură din consultație, linii auto-populate |
| 25-26 | Plăți (cash/card) + status factură |
| 27-28 | Raport zilnic basic (fără Claude) |
| 29 | Detectare servicii nefacturate (query + alertă) |
| 30 | Test end-to-end complet + training 2-3 ore personal + go-live soft |

**Rezultat la 30 zile:** Sistemul înlocuiește agenda pe hârtie și Word-ul pentru facturare. Stocul se urmărește digital. Raportul zilnic funcționează.

---

## M.6 Plan Versiune Robustă 90 Zile

### Zilele 31-50: Financial Layer Complet
- Bon fiscal (integrare cu casa de marcat sau workaround confirmat)
- Achiziții + bon recepție complet cu 3-way match
- Export contabilitate format agreat cu contabilul
- Prețuri cu calcul cost direct + marjă + alertă subevaluare
- Avansuri + reconciliere plăți

### Zilele 51-70: SPV Integration
- Generare XML UBL 2.1 CIUS-RO validat
- Autentificare OAuth + upload ANAF (sandbox complet)
- Polling status + descărcare răspuns
- Dashboard SPV + tratare erori
- **GO-LIVE SPV după minimum 2 săptămâni test sandbox fără erori**

### Zilele 71-90: AI Layer + Analytics
- Integrare Claude API pentru G-01, G-02, G-06 (prioritate 1)
- Dashboard KPI complet cu toate indicatorii din secțiunea J
- Detectare anomalii (G-05) + reconciliere servicii (G-15)
- Raport lunar management automat
- Training extins personal + documentație SOP sistem
- Audit securitate + penetration test basic

**Rezultat la 90 zile:** Sistem complet funcțional, integrat cu ANAF, cu AI layer activ pentru suport decizional, gestionând toate operațiunile spitalului digital.

---

# PROMPTURI SECUNDARE RECOMANDATE

Aceste prompturi sunt derivate din blueprint-ul de mai sus și pot fi folosite direct cu Claude pentru a aprofunda implementarea fiecărei componente.

---

### PROMPT 1 — Design UI/UX Recepție

```
Ești un expert UI/UX pentru aplicații medicale veterinare.
Context: Am un sistem de management spital veterinar cu modulele descrise [atașează blueprint-ul].
Sarcina: Proiectează fluxul complet UI/UX pentru modulul de Recepție.
Include:
- Wire-frame textual (structura paginilor, nu imagini)
- Lista ecranelor necesare și relațiile dintre ele
- Câmpuri și validări per formular
- Stările UI (loading, eroare, succes, empty state)
- Shortcut-uri de tastatură pentru recepție (utilizare rapidă)
- Comportament mobil vs. desktop (recepționerele pot fi pe tabletă)
- Fluxuri pentru cazuri edge: walk-in urgent, client fără programare, animal fără fișă
- Mesaje de eroare și succes prietenoase (limbă română)
Gândește ca un UX designer care a petrecut o săptămână la recepția unui spital veterinar.
```

---

### PROMPT 2 — Schemă Baze de Date Completă SQL

```
Ești un database architect specializat în sisteme medicale și financiare pentru România.
Context: Blueprint complet sistem veterinar [atașează schema din secțiunea C].
Sarcina: Generează schema SQL completă pentru PostgreSQL v15+, incluzând:
- CREATE TABLE pentru toate entitățile din schema v1
- Toate FOREIGN KEY constraints
- Indexuri recomandate pentru query-urile frecvente
- Triggere pentru:
  a) audit_logs automat la INSERT/UPDATE/DELETE pe tabelele critice
  b) actualizare inventory_items.current_stock la fiecare stock_movement
  c) invalidare invoice dacă consultation este modificată
- CHECK constraints pentru validări business (stoc negativ imposibil, etc.)
- Views utile (consultations_unbilled, stock_below_minimum)
- Comentarii pe coloanele critice
Respectă best practices PostgreSQL: UUID pentru PK, timestamptz, snake_case naming.
```

---

### PROMPT 3 — Backend NestJS — Structura Modulelor

```
Ești un senior backend architect specializat în NestJS TypeScript.
Context: Sistem veterinar cu modulele: medical, financiar, inventar, SPV, AI layer.
Sarcina: Proiectează structura completă a backend-ului NestJS pentru acest sistem.
Include:
- Arhitectura modulelor (ce module NestJS, responsabilități)
- Service layer vs. Controller layer — ce intră unde
- Injecție de dependențe (dependency injection)
- Middleware și Guards pentru autentificare + autorizare RBAC
- DTOs pentru toate entitățile principale (cu validări class-validator)
- Event-driven communication între module (EventEmitter sau Queue)
- Error handling centralizat
- Structura de foldere recomandată
- Testabilitate (unit tests + integration tests)
- Rate limiting pentru endpoint-urile publice
Gândește pentru producție, nu demo.
```

---

### PROMPT 4 — Integrare ANAF SPV — Implementare Completă Node.js

```
Ești un expert în integrări fiscale România, specializat în ANAF SPV / RO e-Factura.
Context: Sistem veterinar care trebuie să trimită facturi B2B prin RO e-Factura.
Sarcina: Implementează un service Node.js/TypeScript complet pentru:
1. Autentificare OAuth cu certificat digital calificat (flow complet)
2. Generare XML UBL 2.1 CIUS-RO dintr-un obiect factură JSON
3. Validare XML față de XSD (cu XSD downloadat de la ANAF)
4. Upload la ANAF (endpoint-uri producție + sandbox)
5. Polling status cu exponential backoff și jitter
6. Descărcare arhivă ZIP răspuns
7. Parsare erori din răspuns NZPO
8. Retry logic complet (max 5 retry, 5-10-20-40-80 secunde)
9. Stocare token cu refresh automat (600 secunde expirare)
10. Logging complet al tuturor interacțiunilor
Include cod TypeScript funcțional, nu pseudocod.
Notează clar unde trebuie înlocuite credențialele reale.
```

---

### PROMPT 5 — Pricing Engine — Motor de Calcul Prețuri

```
Ești un senior developer specializat în sisteme de prețuri pentru industria medicală.
Context: Spital veterinar cu catalog servicii, consumabile, timp medic.
Sarcina: Implementează un pricing engine complet în TypeScript/SQL care:
1. Calculează cost_direct din procedure_template_items (cu FEFO pe costuri)
2. Calculează cost_indirect bazat pe overhead_orar × durata_serviciu
3. Calculează prețul recomandat cu marja target
4. Verifică că prețul curent > prag_minim
5. Detectează servicii subevaluate la modificarea costului unui consumabil
6. Simulează impactul modificării unui preț (câte consultații sunt afectate?)
7. Calculează marja realizată reală (din invoice_lines cu unit_cost)
8. Generează raport diferență preț_catalog vs. preț_realizat (reduceri)
Includ:
- Query-urile SQL necesare
- Logica în TypeScript
- Event trigger: "la modificarea average_cost → recalcul afectați"
```

---

### PROMPT 6 — Rapoarte Manageriale — Dashboard Complet

```
Ești un specialist business intelligence pentru clinici medicale private România.
Context: Sistem veterinar cu datele din schema [atașează schema v1].
Sarcina: Proiectează și implementează query-urile SQL + logica pentru:
1. Dashboard zilnic: venituri, consultații, încasări, creanțe, stoc critic, SPV status
2. Comparativ săptămânal: week-over-week pentru fiecare KPI principal
3. Raport lunar P&L simplificat: venituri - cost direct - overhead estimat = marjă brută
4. Top 10 servicii profitabile vs. neprofitabile
5. Analiza medicilor: venituri generate, bon mediu, timp per consultație
6. Stoc management: rotație, stoc mort, expirare apropiată
7. SPV compliance: facturi emise B2B vs. confirmate ANAF, erori pe categorie
8. CRM: clienți noi vs. revenire, rata retenție, clienți inactivi
Pentru fiecare raport: query SQL + JSON output structure + frecvență raportare.
```

---

### PROMPT 7 — SOP-uri Recepție — Set Complet

```
Ești un consultant de procese pentru spitale veterinare private din România.
Context: Spital veterinar cu 3 medici, 2 recepționere, 4 asistenți, program 08:00-20:00 + urgențe.
Sarcina: Creează un set complet de SOP-uri (Standard Operating Procedures) pentru recepție.
Include SOP-uri pentru:
1. Deschiderea clinicii dimineața (checklist + sistem)
2. Înregistrarea unui client nou (date + GDPR)
3. Gestionarea walk-in neprogramat
4. Gestionarea urgențelor (în program + extra-program)
5. Procesul de check-in pentru programare existentă
6. Emiterea facturii și procesarea plății (cash + card)
7. Gestionarea reclamațiilor clienților
8. Închiderea clinicii seara (checklist + raport)
9. Procedura no-show (ce se face în sistem + comunicare client)
10. Gestionarea creanțelor (când și cum se contactează clientul)
Format fiecare SOP cu: scop, actor responsabil, pași numerotați, decizii (if/else), checklist, ce NU se face.
```

---

### PROMPT 8 — Automatizări n8n — Fluxuri Complete

```
Ești un expert n8n specializat în automatizări pentru industria medicală.
Context: Sistem veterinar cu PostgreSQL, Anthropic Claude API, Twilio SMS, Meta WhatsApp Business API, Resend email.
Sarcina: Descrie, cu pași concreți și noduri n8n, toate fluxurile de automatizare necesare:
1. Reminder programări (24h + 2h înainte)
2. Raport zilnic management (query DB → Claude → email)
3. Alertă stoc minim (webhook trigger → email + task)
4. Servicii nefacturate (cron zilnic → dashboard task)
5. Feedback post-consultație (wait 24h → WhatsApp)
6. Reconciliere SPV (cron la 30min → poll ANAF → update DB)
7. Campanie reactivare clienți inactivi (lunar → segment → WhatsApp)
8. Notificare proprietar internare (la fiecare observație → WhatsApp rezumat)
Pentru fiecare flux:
- Trigger (cron, webhook, manual)
- Noduri n8n necesare (în ordine)
- Date transmise între noduri
- Tratare erori
- Ce se loghează în DB
```

---

### PROMPT 9 — Verificare Facturi — Prompt Claude Complet

```
Ești un specialist în crearea prompturilor pentru Claude destinat verificării documentelor fiscale.
Context: Sistem veterinar România, facturi cu TVA 9% (servicii medicale veterinare) sau 19% (produse).
Sarcina: Creează promptul de sistem complet pentru automatizarea G-01 (verificare factură pre-emitere).
Include în prompt:
- Rolul exact al asistentului AI
- Lista completă de verificări (câmpuri obligatorii, calcule TVA, CUI valid, serii unice, etc.)
- Structura exactă a datelor de input (JSON schema)
- Structura exactă a output-ului (JSON cu status, warnings, errors, suggestions)
- Exemple de invoice_data cu erori + răspunsul corect așteptat
- Instrucțiuni pentru cazuri edge (storno, proforma, factură cu discount)
- Limitări explicite: ce NU face AI-ul (nu modifică factura, nu trimite la ANAF)
- Ton și limbă: română, profesional, concis
Testează promptul cu 3 scenarii concrete: factură corectă, factură cu TVA greșit, factură cu CUI invalid.
```

---

### PROMPT 10 — Audit Operațional — Proceduri de Control Intern

```
Ești un auditor intern specializat în clinici medicale private din România.
Context: Spital veterinar cu sistemul descris în blueprint [atașează].
Sarcina: Proiectează procedura completă de audit operațional intern pentru:
1. Audit lunar financiar:
   - Ce se verifică, ce query-uri se rulează
   - Reconciliere facturi emise vs. SPV vs. contabilitate
   - Verificare completitudine facturare (servicii nefacturate)
   - Analiza reducerilor aplicate (autorizate vs. neautorizate)

2. Audit trimestrial stocuri:
   - Inventariere fizică vs. stoc sistem
   - Trasabilitate lot/expirare
   - Verificare stupefiante/psihotrope

3. Audit semestrial securitate:
   - Review drepturi utilizatori
   - Analiza audit_logs pentru acțiuni suspecte
   - Verificare backup și recuperare date

4. Audit anual conformitate:
   - GDPR (consimțăminte, ștergeri la cerere)
   - SPV compliance (toate facturile B2B trimise?)
   - Documente fiscale arhivate (5 ani)

Pentru fiecare audit:
- Checklist detaliat
- Query SQL pentru verificare
- Criterii de acceptare/respingere
- Acțiuni corective recomandate
- Cine execută și cine primește raportul
```

---

> **Notă finală:** Aceste 3 documente (Partea 1, 2 și 3) reprezintă un blueprint operațional complet. Ele nu sunt un produs finalizat — sunt fundația de la care pornești conversații detaliate cu developerii, contabilul, medicul șef și consultantul fiscal. Nicio decizie fiscală sau medicală nu trebuie luată exclusiv pe baza acestor specificații fără validare cu specialiști calificați în România.

---

*Document generat: 09 iunie 2026 | Versiune: 1.0*
*Blueprint sistem management spital veterinar România — Proprietate internă*
