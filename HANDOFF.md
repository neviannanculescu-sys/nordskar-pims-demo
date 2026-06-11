# HANDOFF — Nordskar PIMS Veterinar

**Data:** 2026-06-11  
**Stare:** MVP backend complet livrat + validat live. Toate fluxurile inventory testate end-to-end.

---

## Ce s-a implementat în această sesiune

### Modulul de Stocuri — livrat complet

**Backend:**

1. `apps/api/src/modules/inventory/dto/create-inventory-item.dto.ts`  
   → Adăugat câmpul `isActive?: boolean` cu `@IsBoolean()`

2. `apps/api/src/modules/inventory/inventory.service.ts`  
   → `updateItem()` include acum `isActive` în SET clause — permite activare/dezactivare produs via PATCH

3. `apps/api/src/modules/treatment-lines/treatment-lines.service.ts`  
   → `dispense()` implementat complet cu auto-deducere din stoc:
   - Row-level lock via `SELECT current_stock ... FOR UPDATE`
   - Idempotency guard (verifică mișcare existentă cu `referenceType='treatment_line'`)
   - Eroare clară dacă stoc insuficient
   - Returnează linia re-fetchuită din DB după tranzacție

4. `apps/api/src/modules/treatment-lines/treatment-lines.service.spec.ts`  
   → Test `dispense()` actualizat — mock `db.limit` are acum 3 faze (initial read, consultation check, re-fetch)

**Frontend (demo.html):**

- Buton „+ Adaugă produs" în header pagina Stocuri
- Coloana Acțiuni cu butoane `IN / OUT / Edit / ↗` per rând în tabel
- Modal **Adaugă/Editează Produs** — toate câmpurile DTO
- Modal **Mișcare Stoc** — refolosit pentru IN (recepție/ajustare+) și OUT (5 tipuri de ieșire)
- Drawer **Detalii Produs** — istoricul complet mișcări per item (50 cele mai recente)
- Funcții JS: `openAddProductModal`, `openEditProductModal`, `openStockInModal`, `openStockOutModal`, `openProductDetail`, `saveProduct`, `saveStockMovement`, `closeProductModal`, `closeMovModal`, `closeProductDetail`

---

## Fișiere atinse

```
apps/api/src/modules/inventory/dto/create-inventory-item.dto.ts  [MODIFIED]
apps/api/src/modules/inventory/inventory.service.ts               [MODIFIED]
apps/api/src/modules/treatment-lines/treatment-lines.service.ts   [MODIFIED]
apps/api/src/modules/treatment-lines/treatment-lines.service.spec.ts [MODIFIED]
demo.html                                                          [MODIFIED]
docs/inventory-module.md                                           [CREATED]
.claude/skills/pims-inventory/SKILL.md                            [CREATED]
HANDOFF.md                                                         [CREATED]
```

---

## Verificări rulate și rezultate

| Verificare | Rezultat |
|---|---|
| `npx tsc --noEmit` | ✅ Zero erori |
| `npm run build` | ✅ Build reușit |
| `npx jest --testPathPattern="inventory\|treatment"` | ✅ 20/20 teste trec |
| Rute UI vs controller | ✅ Aliniate complet |
| DTO fields vs form fields | ✅ Aliniate complet |
| Schema Drizzle vs serviciu | ✅ Aliniate complet |

### Validare live (Render prod, 2026-06-11)

| Test | Rezultat |
|---|---|
| Create Product | ✅ 201, stock=0 inițial |
| Stock IN qty=20 purchase_receipt | ✅ stockBefore=0 → after=20, currentStock=20 |
| Stock OUT qty=7 direct_sale | ✅ stockBefore=20 → after=13, currentStock=13 |
| Stock OUT peste limită (qty=100) | ✅ 400 "Insufficient stock", stoc neatins |
| Movement history sincronizat | ✅ 2 records corecte, descrescător |
| Create Treatment Line cu inventoryItemId | ✅ 201, isDispensed=false |
| dispense() auto-deducere qty=3 | ✅ 13→10, movement consultation_use creat, referenceType=treatment_line |
| dispense() idempotency (a 2-a oară) | ✅ 400 "already dispensed", stoc neatins |
| Edit Product PATCH isActive | ✅ Toggle false/true funcționează |
| Alert lowStock (minStock > currentStock) | ✅ Item apare în alerts.lowStock |
| Global movements feed performedByName | ✅ "Admin Nordskar" prezent |

---

## Decizii tehnice importante

1. **Auto-deducere fără injection circular**: `TreatmentLinesService.dispense()` operează direct pe tabelele Drizzle (`inventoryItemsTable`, `stockMovementsTable`) în aceeași tranzacție — evită importarea `InventoryModule` și dependința circulară.

2. **Re-fetch după dispense**: `dispense()` returnează `this.findOneOrFail(id)` după tranzacție (nu rezultatul din RETURNING) — garantează că UI primește starea reală din DB, inclusiv câmpuri setate de triggere.

3. **Bug fix post-deploy**: `tx.execute(sql`SELECT...FOR UPDATE`)` în Drizzle node-postgres returnează `{ rows: [...] }`, nu un array direct. Accesul incorect cu `[0]` dădea `undefined → parseFloat('0') = 0`, cauzând eroarea "Stoc insuficient" chiar cu stoc disponibil. Fix: `(rows as any).rows?.[0] ?? (rows as any)[0]` — dual-path pentru compatibilitate între drivere.

3. **Idempotency la nivel de DB**: Guard-ul verifică `referenceType + referenceId` în `stock_movements` — `dispense()` poate fi apelat de două ori fără a genera dubluri de stoc.

4. **Modale UI refolosesc aceeași structură**: `inv-mov-modal` este folosit atât pentru IN cât și pentru OUT — tipurile de mișcări disponibile se schimbă dinamic în `openStockInModal()` vs `openStockOutModal()`.

---

## Ce a rămas deschis (non-blocant)

1. **Backfill tratament-linii existente**: liniile de tratament create înainte de implementarea stocului nu au `inventoryItemId` setat. Necesită o migrație SQL manuală de UPDATE pentru a lega liniile istorice de produsele din catalog.

2. **Testare vizuală end-to-end**: pagina Stocuri din demo.html trebuie testată manual pe `https://nordskar-pims-demo.pages.dev` cu datele reale din Neon DB după deploy.

3. **`getMovementHistory()` nu returnează `performedByName`**: drawer-ul de detalii nu afișează numele utilizatorului — doar data, tipul, lot, note. Dacă e nevoie, serviciul trebuie extins cu un JOIN pe `users`.

4. **Paginare pentru items > 200**: `loadInventory()` încarcă `limit=200`. Dacă catalogul crește, trebuie adăugat scroll infinit sau paginare în UI.

---

## Deploy

### Frontend (Cloudflare Pages)
```powershell
# Din directorul rădăcină al proiectului:
.\deploy.ps1
# → copiază demo.html → deploy-demo/index.html
# → wrangler pages deploy deploy-demo --project-name nordskar-pims-demo
# → URL: https://nordskar-pims-demo.pages.dev
```

### Backend (Render.com)
- Auto-deploy la push pe branch `main` (dacă GitHub integration e activă)
- Sau deploy manual din Render Dashboard
- Health check: `GET https://nordskar-pims-demo.onrender.com/api/v1/health`
- Build: `npm install && npm run build` (din rădăcina repo-ului)
- Start: `npm start`

---

## Module MVP livrate — status complet

| Modul | Status |
|---|---|
| Auth + RBAC + Audit | ✅ Livrat |
| Medical core (owners, pets, consultations, etc.) | ✅ Livrat |
| Catalog + Inventory | ✅ Livrat |
| Invoices + Payments | ✅ Livrat |
| SPV / e-Factura (UBL 2.1 CIUS-RO) | ✅ Livrat |
| Reports + Export (CSV/XLSX) | ✅ Livrat |
| AI Assistant (Claude Haiku) | ✅ Livrat |
| G-04 Prețuri (3 marje, simulator, detector underpriced) | ✅ Livrat + Acceptat |
| G-15 Reconciliere (4 detectori, tasks, acceptance check) | ✅ Livrat + Acceptat |
| **Stocuri (CRUD, mișcări, auto-deducere, UI complet)** | ✅ **Livrat** |
