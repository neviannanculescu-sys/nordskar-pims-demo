# CLAUDE.md — VetHospital Management System
## Reguli obligatorii pentru Claude Code în acest proiect

> Acest fișier este sursa de adevăr pentru orice sesiune Claude Code pe acest repo.
> Citește-l complet înainte de orice task. Regulile de mai jos sunt **necondiționat obligatorii**.

---

## 1. CONTEXTUL PROIECTULUI

Construim un sistem de management pentru un **spital veterinar din România**.

Sistemul are 4 straturi:
1. **PIMS Core** — date medicale (consultații, fișe, internări, tratamente)
2. **ERP Light** — stocuri, achiziții, catalog prețuri, marjă
3. **Financiar + Fiscal** — facturare, plăți, bon fiscal, ANAF SPV / RO e-Factura
4. **AI Layer** — Claude API pentru suport decizional și rapoarte (adăugat ultimul)

**Principiu absolut:** Sistemul trebuie să funcționeze complet și corect **fără AI**. Claude API este un layer opțional de analiză — nu o dependență critică.

**Blueprint de referință:** `docs/blueprint/` — citește dacă ai nevoie de context despre un modul înainte de a scrie cod.

---

## 2. STACK TEHNIC — DECIZII FIXE

> Nu propune alternative la stack-ul de mai jos fără să întrebi explicit. Deciziile sunt luate.

### Backend
- **Runtime:** Node.js 20 LTS + TypeScript strict
- **Framework:** NestJS (arhitectură modulară, DI, decoratori)
- **ORM:** Drizzle ORM (type-safe, migrații cu drizzle-kit)
- **Validare DTO:** class-validator + class-transformer
- **Autentificare:** JWT access token (15 min) + refresh token (7 zile), custom guard NestJS
- **Queue / Jobs:** BullMQ + Redis (pentru SPV, email, rapoarte async)
- **Logging:** Pino (structured JSON logs, nu console.log)

### Baza de date
- **DBMS:** PostgreSQL 15+
- **Schema:** snake_case pentru tabele și coloane
- **PK:** UUID v4 (gen_random_uuid()) — niciodată INTEGER autoincrement pentru entități principale
- **Timestamps:** `created_at TIMESTAMPTZ DEFAULT NOW()`, `updated_at TIMESTAMPTZ`
- **Soft delete:** coloana `deleted_at TIMESTAMPTZ` — niciodată DELETE fizic pe entități principale
- **Audit:** Triggere automate pe toate tabelele din lista AUDIT_TABLES (vezi secțiunea 7)

### Frontend
- **Framework:** Next.js 14 App Router + TypeScript strict
- **UI:** shadcn/ui + Tailwind CSS
- **State:** Zustand pentru state global, React Query (TanStack) pentru server state
- **Forms:** React Hook Form + Zod pentru validare
- **Tabele:** TanStack Table
- **Grafice:** Recharts

### Infrastructură
- **Containerizare:** Docker + docker-compose pentru local dev
- **Env management:** `.env.local` (local), `.env.example` (repo, fără valori reale)
- **Fișiere:** Cloudflare R2 (S3-compatible) — SDK `@aws-sdk/client-s3`
- **Email:** Resend SDK
- **SMS:** Twilio SDK
- **PDF:** Puppeteer (pentru facturi) sau PDFKit

---

## 3. STRUCTURA REPO-ULUI

```
/
├── apps/
│   ├── api/              ← NestJS backend
│   │   ├── src/
│   │   │   ├── modules/  ← un folder per modul (medical, financial, inventory, spv, auth, users)
│   │   │   ├── common/   ← guards, interceptors, pipes, decorators comune
│   │   │   ├── database/ ← schema Drizzle, migrații, seed
│   │   │   └── main.ts
│   │   └── test/
│   └── web/              ← Next.js frontend
│       ├── app/          ← App Router pages
│       ├── components/   ← componente reutilizabile
│       └── lib/          ← utils, hooks, api client
├── packages/
│   ├── types/            ← tipuri TypeScript partajate (între api și web)
│   └── validations/      ← scheme Zod partajate
├── docs/
│   └── blueprint/        ← blueprint-urile din Partea 1-3
├── scripts/              ← scripturi utilitare (seed, import date inițiale)
├── docker-compose.yml
├── CLAUDE.md             ← ACEST FIȘIER
└── .env.example
```

---

## 4. CONVENȚII DE COD

### Generale
- **TypeScript strict mode** — `"strict": true` în tsconfig. Zero `any` fără comentariu explicit.
- **Funcții pure** unde este posibil. Efecte secundare izolate și documentate.
- **Erori explicite** — niciodată `throw new Error('something went wrong')`. Folosește erori cu mesaj clar și context: `throw new Error(\`Invoice ${invoiceId} cannot be issued: consultation ${consultationId} is not signed\`)`.
- **No magic numbers** — constantele au nume: `MIN_MARGIN_PERCENT = 30`, nu `0.30` hardcodat.
- **Comentarii** — comentează DE CE, nu CE face codul. Codul trebuie să fie suficient de clar pentru CE.

### Denumiri
- Fișiere: `kebab-case.ts` (ex: `invoice.service.ts`, `create-invoice.dto.ts`)
- Clase, interfețe, tipuri: `PascalCase`
- Variabile, funcții: `camelCase`
- Constante globale: `UPPER_SNAKE_CASE`
- Tabele DB: `snake_case` (ex: `invoice_lines`, `stock_movements`)
- Coloane DB: `snake_case`
- Enum-uri în DB: litere mici cu underscore (ex: `'partially_paid'`, nu `'PARTIALLY_PAID'`)

### API Design
- REST, nu GraphQL (decizie luată)
- Rute: `kebab-case`, plural pentru colecții: `/api/v1/invoice-lines`, `/api/v1/stock-movements`
- Versioning: `/api/v1/...` — include versiunea de la început
- Răspunsuri de succes: `{ data: T, meta?: PaginationMeta }`
- Răspunsuri de eroare: `{ error: { code: string, message: string, details?: unknown } }`
- Coduri HTTP corecte: 200 (ok), 201 (created), 400 (bad request), 401 (unauthorized), 403 (forbidden), 404 (not found), 409 (conflict), 422 (unprocessable), 500 (internal)

### Baza de date
- Migrațiile sunt **forward-only** — nu modifica o migrație existentă, creează una nouă
- Orice coloană nouă obligatorie pe tabel existent trebuie să aibă DEFAULT sau să fie nullable inițial
- Seed-urile sunt în `apps/api/src/database/seeds/` și rulează cu `npm run db:seed`
- **NICIODATĂ** nu șterge date cu `DELETE` din entitățile principale — folosește `deleted_at`

---

## 5. SEPARAREA DOMENIILOR — REGULI STRICTE

Sistemul are 3 domenii cu separare clară. **Nu amesteca logica între ele.**

### Domeniu MEDICAL
**Module NestJS:** `medical/consultations`, `medical/pets`, `medical/owners`, `medical/hospitalizations`, `medical/treatments`, `medical/procedures`

**Poate:**
- Citi/scrie date medicale
- Genera triggere pentru facturare (emite event `ConsultationSignedEvent`)
- Citi catalog prețuri (read-only)
- Citi stocuri (read-only, pentru verificare disponibilitate)

**Nu poate:**
- Emite facturi direct
- Modifica prețuri
- Accesa modulul SPV
- Scădea stocul direct (emite event `StockConsumptionRequestedEvent`, inventarul procesează)

---

### Domeniu FINANCIAR
**Module NestJS:** `financial/invoices`, `financial/payments`, `financial/fiscal-documents`

**Poate:**
- Crea și emite facturi
- Înregistra plăți
- Genera documente fiscale
- Emite event `InvoiceIssuedEvent` (procesat de SPV service)

**Nu poate:**
- Modifica o consultație
- Modifica stocul
- Trimite direct la ANAF (emite event, SPV service trimite)
- Șterge sau modifica o factură emisă (doar storno)

**Regula de aur pentru factură:**
> O factură cu `status = 'issued'` este **IMUABILĂ**.
> Orice corecție = stornare (factură nouă cu `invoice_type = 'storno'` + refacturare.
> Nicio metodă din `InvoiceService` nu poate modifica câmpurile fiscale după `issued_at IS NOT NULL`.

---

### Domeniu SPV (ANAF e-Factura)
**Module NestJS:** `spv/submissions`, `spv/responses`

**Poate:**
- Genera XML UBL 2.1 CIUS-RO din date factură
- Valida XML față de XSD
- Comunica cu API ANAF (upload, poll, download)
- Gestiona token OAuth + refresh
- Arhiva răspunsuri

**Nu poate:**
- Modifica factura originală
- Șterge submissions sau responses (niciodată)
- Executa logică de business medicală sau financiară

**Dependențe permise:**
- SPV citește din `invoices` (read-only prin repository injectat)
- SPV scrie doar în `spv_submissions` și `spv_responses`

---

## 6. RBAC — ROLURI ȘI PERMISIUNI

Rolurile sunt definite ca enum în DB și în cod. **Nu hardcoda verificări de rol — folosește decorator-ul `@Roles()` și `RolesGuard`.**

```typescript
export enum UserRole {
  ADMIN        = 'admin',         // acces total
  VET_DOCTOR   = 'vet_doctor',    // medical + citire financiar propriu
  ASSISTANT    = 'assistant',     // medical read + treatment_lines write
  RECEPTIONIST = 'receptionist',  // programări + check-in + facturare + plăți
  ACCOUNTANT   = 'accountant',    // financiar read + export contabilitate
  IT_ADMIN     = 'it_admin',      // config + audit logs (fără date medicale)
}
```

### Matrice permisiuni (rezumat):

| Acțiune | ADMIN | VET | ASSISTANT | RECEPT | ACCOUNTANT |
|---|:---:|:---:|:---:|:---:|:---:|
| Creare/editare consultație | ✓ | ✓ | - | - | - |
| Semnare consultație | ✓ | ✓ | - | - | - |
| Emitere factură | ✓ | - | - | ✓ | - |
| Stornare factură | ✓ | - | - | - | - |
| Modificare prețuri catalog | ✓ | - | - | - | - |
| Aplicare reduceri | ✓ | - | - | ✓* | - |
| Recepție marfă | ✓ | - | ✓ | - | - |
| Export contabilitate | ✓ | - | - | - | ✓ |
| Acces SPV dashboard | ✓ | - | - | - | ✓ |
| Acces audit logs | ✓ | - | - | - | - |
| Configurare sistem | ✓ | - | - | - | - |

*RECEPT poate aplica reduceri doar până la limita `max_receptionist_discount_percent` din config.

---

## 7. AUDIT TRAIL — REGULI ABSOLUTE

**AUDIT_TABLES** (triggere obligatorii pe toate):
```
owners, pets, consultations, procedures, treatment_lines,
invoices, invoice_lines, payments, price_catalog,
inventory_items, stock_movements, goods_receipts,
spv_submissions, users, user_roles
```

### Regulile audit:
1. **`audit_logs` nu se poate șterge niciodată** — nicio metodă, nicio rută, nicio migrație nu face `DELETE` din `audit_logs`. Dacă există un astfel de cod, este o eroare.
2. **Triggerul se activează pe INSERT, UPDATE și DELETE** — salvează `old_values` (JSONB) și `new_values` (JSONB).
3. **`changed_by` este obligatoriu** — nicio modificare fără user_id în context. Jobs async setează un system user dedicat (`system_job_user_id`).
4. **IP și session** — middleware-ul HTTP injectează `ip_address` și `session_id` în context pentru fiecare request.
5. **Câmpuri excluse din audit** (pentru a nu umfla logul): `updated_at`, `password_hash`.

### Exemplu trigger PostgreSQL (template pentru toate tabelele):
```sql
CREATE OR REPLACE FUNCTION audit_trigger_fn()
RETURNS trigger AS $$
BEGIN
  INSERT INTO audit_logs (
    table_name, record_id, action,
    changed_by, old_values, new_values,
    ip_address, session_id
  ) VALUES (
    TG_TABLE_NAME,
    COALESCE(NEW.id, OLD.id),
    TG_OP,
    current_setting('app.current_user_id', true)::uuid,
    CASE WHEN TG_OP = 'INSERT' THEN NULL ELSE row_to_json(OLD)::jsonb END,
    CASE WHEN TG_OP = 'DELETE' THEN NULL ELSE row_to_json(NEW)::jsonb END,
    current_setting('app.current_ip', true),
    current_setting('app.current_session', true)
  );
  RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql;
```

---

## 8. INTERDICȚII ABSOLUTE

Acestea sunt linii roșii. Dacă un task te conduce spre una dintre ele, **oprește-te și întreabă**.

### Interdicții de date:
- ❌ `DELETE` fizic din: `owners`, `pets`, `consultations`, `invoices`, `invoice_lines`, `payments`, `audit_logs`, `spv_submissions`, `spv_responses` — folosește `deleted_at`
- ❌ Modificarea câmpurilor fiscale ale unei facturi după `issued_at IS NOT NULL` (serie, număr, dată, sume, TVA, CUI)
- ❌ Modificarea `spv_submissions` sau `spv_responses` după creare (append-only)
- ❌ Stocul negativ — `current_stock < 0` trebuie să fie imposibil la nivel de DB (CHECK constraint)

### Interdicții de securitate:
- ❌ Stocarea tokenului OAuth ANAF sau a credențialelor în baza de date neencriptată — folosește variabile de mediu sau vault
- ❌ Logging de date personale (CNP, CUI, date medicale) în loguri de aplicație (Pino) — loguează doar ID-uri
- ❌ Endpoint-uri fără autentificare, în afara celor explicite: `POST /auth/login`, `GET /health`
- ❌ `console.log` în cod de producție — folosește `this.logger` (Pino prin NestJS Logger)

### Interdicții de arhitectură:
- ❌ Import direct între module de domenii diferite — comunicare doar prin events sau interfețe definite în `packages/types`
- ❌ Logică de business în controllere — controllere sunt thin, logica e în servicii
- ❌ Query-uri SQL raw în servicii — folosește Drizzle ORM. Dacă ai nevoie de SQL raw, izolează în repository și documentează de ce
- ❌ Modificarea unei migrații existente — creează una nouă
- ❌ Variabile de mediu hardcodate în cod — toate sunt în `.env` și accesate prin `ConfigService`

### Interdicții SPV (CRITIC fiscal):
- ❌ Generarea sau trimiterea XML la ANAF din altă parte decât `SpvModule`
- ❌ Retrimiterea unui XML deja acceptat de ANAF (`anaf_status = 'ok'`) — creează submission nou
- ❌ Ștergerea sau arhivarea răspunsurilor ANAF
- ❌ Trimitere la ANAF dacă token-ul nu este valid — verifică și refresh înainte de orice upload

---

## 9. TESTARE — CERINȚE MINIME

### Per modul livrat:
- **Unit tests** pentru toate metodele din servicii cu logică de business (`*.service.spec.ts`)
- **Integration tests** pentru fluxurile critice (`*.integration.spec.ts`) — rulează pe DB de test real (Docker)
- **Coverage minim:** 70% pe fișierele din `src/modules/`

### Fluxuri cu teste de integrare obligatorii (înainte de merge):
1. `POST /consultations/:id/sign` → verifică că `billed = false` și event emis
2. `POST /invoices` → verifică că toate procedurile consultației apar în linii
3. `POST /invoices/:id/issue` → verifică că factura devine imuabilă după emitere
4. `POST /stock-movements` → verifică că `current_stock` nu devine negativ
5. `GET /spv/submissions/:id/status` → mock ANAF, verifică toate stările

### Comenzi test:
```bash
npm run test              # unit tests
npm run test:integration  # integration tests (necesită Docker)
npm run test:coverage     # coverage report
```

---

## 10. WORKFLOW PENTRU UN TASK NOU

Urmează acești pași în ordine pentru **orice** task primit:

```
1. CITEȘTE blueprint-ul modulului relevant din docs/blueprint/ (dacă există)
2. VERIFICĂ dacă există cod deja scris pentru acel modul (nu rescrie ce există)
3. PLANIFICĂ — scrie în 3-5 rânduri ce vei face înainte de a scrie cod
4. SCRIE schema DB first (dacă task-ul implică date noi) + migrație
5. SCRIE serviciu + teste unitare
6. SCRIE controller + DTO-uri
7. SCRIE teste de integrare pentru fluxul principal
8. RULEAZĂ testele: npm run test
9. RAPORTEAZĂ ce ai făcut, ce teste trec, ce e netestat și de ce
```

**Dacă un task este ambiguu** (nu știi exact ce câmpuri, ce reguli de business, ce permisiuni), **oprește-te și listează întrebările** înainte de a scrie cod.

---

## 11. ORDINEA DE IMPLEMENTARE — FAZE

Respectă această ordine. **Nu sări la faze superioare dacă faza curentă nu e validată de utilizatori reali.**

```
FAZA 1 — Baza operațională (activ acum)
  ✓ Autentificare + RBAC
  ✓ Owners + Pets + Species + Breeds
  ✓ Veterinarians + Rooms
  ✓ Appointments (calendar)
  ✓ Consultations (creare + semnare)
  ✓ Audit trail

FAZA 2 — Financiar + Stocuri
  → Catalog prețuri + procedure_templates
  → Inventory items + stock_movements
  → Purchase orders + goods_receipts
  → Invoices + invoice_lines (din consultație)
  → Payments
  → Export contabilitate (CSV)

FAZA 3 — SPV / e-Factura
  → Generare XML UBL 2.1 CIUS-RO
  → OAuth + upload ANAF
  → Polling status + download răspuns
  → Dashboard reconciliere
  ⛔ DOAR după ce facturarea internă e stabilă și validată

FAZA 4 — AI Layer (Claude API)
  → Integrare Anthropic SDK
  → Automatizări G-01 → G-15 (din blueprint)
  ⛔ DOAR după ce Fazele 1-3 funcționează fără AI

FAZA 5 — Analytics + CRM
  → Dashboard KPI complet
  → CRM + retenție clienți
  → Rapoarte manageriale avansate
```

---

## 12. VARIABILE DE MEDIU — REFERINȚĂ

Acestea sunt variabilele necesare. Valorile reale sunt în `.env.local` (niciodată în repo).

```bash
# Database
DATABASE_URL=postgresql://user:pass@localhost:5432/vetdb

# Auth
JWT_SECRET=<min 64 chars random>
JWT_REFRESH_SECRET=<min 64 chars random>
JWT_EXPIRES_IN=900          # 15 minute în secunde
JWT_REFRESH_EXPIRES_IN=604800  # 7 zile în secunde

# Redis
REDIS_URL=redis://localhost:6379

# Storage (Cloudflare R2)
R2_ACCOUNT_ID=
R2_ACCESS_KEY_ID=
R2_SECRET_ACCESS_KEY=
R2_BUCKET_NAME=
R2_PUBLIC_URL=

# Email
RESEND_API_KEY=

# SMS
TWILIO_ACCOUNT_SID=
TWILIO_AUTH_TOKEN=
TWILIO_FROM_NUMBER=

# ANAF SPV (NU STOCA TOKEN-URI AICI — sunt gestionate în memorie cu refresh)
ANAF_CLIENT_ID=
ANAF_CLIENT_SECRET=
ANAF_REDIRECT_URI=
ANAF_ENV=sandbox   # sau 'production'

# Claude API (Faza 4 — lasă gol până atunci)
ANTHROPIC_API_KEY=

# App
NODE_ENV=development
APP_URL=http://localhost:3000
API_URL=http://localhost:3001
PORT=3001

# Limits
MAX_RECEPTIONIST_DISCOUNT_PERCENT=15
MIN_GLOBAL_MARGIN_PERCENT=30
```

---

## 13. REFERINȚE RAPIDE

- **Schema entități:** `docs/blueprint/VetHospital_System_Blueprint_Partea1.md` — Secțiunea C
- **Fluxuri operaționale:** `docs/blueprint/VetHospital_System_Blueprint_Partea1.md` — Secțiunea D
- **Strategia prețuri:** `docs/blueprint/VetHospital_System_Blueprint_Partea2.md` — Secțiunea E
- **Integrare SPV detaliată:** `docs/blueprint/VetHospital_System_Blueprint_Partea2.md` — Secțiunea F
- **Automatizări Claude:** `docs/blueprint/VetHospital_System_Blueprint_Partea2.md` — Secțiunea G
- **KPI-uri + formule:** `docs/blueprint/VetHospital_System_Blueprint_Partea3.md` — Secțiunea J
- **Tabel riscuri:** `docs/blueprint/VetHospital_System_Blueprint_Partea3.md` — Secțiunea K

---

*Versiune CLAUDE.md: 1.0 | Data: 09 iunie 2026*
*Actualizează acest fișier dacă deciziile de stack sau regulile de business se schimbă.*
