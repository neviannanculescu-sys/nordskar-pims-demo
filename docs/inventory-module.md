# Modul Inventar & Stocuri — Documentație Tehnică

**Versiune:** 1.0 (livrat 2026-06-11)

---

## Arhitectură generală

Modulul gestionează catalogul de produse farmaceutice și consumabile, mișcările de stoc, alertele de stoc minim și integrarea automată cu liniile de tratament.

### Principii de design

1. **Append-only**: `stock_movements` nu se modifică niciodată — audit trail complet.
2. **Atomicitate**: mișcare + actualizare stoc curent în aceeași tranzacție.
3. **Auto-deducere**: la `dispense()` pe o linie de tratament cu `inventoryItemId` setat.
4. **Idempotency**: guard în `dispense()` — nu se creează mișcări duble pentru aceeași linie.

---

## Structura DB

### `inventory_items`

| Coloană | Tip | Observații |
|---|---|---|
| `id` | uuid PK | auto-generated |
| `sku` | varchar(50) UNIQUE | imutabil după creare |
| `name` | varchar(200) | |
| `category` | enum | medication/consumable/food/product_for_sale/equipment/other |
| `unit_of_measure` | varchar(30) | buc, ml, kg, etc. |
| `current_stock` | numeric(10,3) | DEFAULT 0, CHECK >= 0 |
| `min_stock_level` | numeric(10,3) | nullable — alerte sub minim |
| `sale_price` | numeric(10,2) | nullable, CHECK >= 0 |
| `is_active` | boolean | soft-delete logic |
| `deleted_at` | timestamp | soft-delete — NULL = activ |

CHECK constraints (în migrație): `current_stock >= 0`, `vat_rate IN (0, 9, 19)`.

### `stock_movements`

| Coloană | Tip | Observații |
|---|---|---|
| `id` | uuid PK | |
| `inventory_item_id` | uuid FK | referință la `inventory_items` |
| `movement_type` | enum | purchase_receipt/consultation_use/... |
| `reference_type` | varchar(50) | nullable — ex. 'treatment_line' |
| `reference_id` | uuid | nullable — ID entitate sursă |
| `quantity` | numeric(10,3) | pozitiv = intrare, negativ = ieșire; CHECK <> 0 |
| `stock_before` | numeric(10,3) | snapshot la momentul mișcării |
| `stock_after` | numeric(10,3) | snapshot la momentul mișcării |
| `performed_by` | uuid FK | required — utilizatorul care a efectuat mișcarea |
| `performed_at` | timestamp | DEFAULT NOW() |

**Nu există UPDATE sau DELETE pe acest tabel.**

---

## Tipuri de mișcări

| Tip | Semn qty | Declanșat de |
|---|---|---|
| `purchase_receipt` | + | Manual (recepție factură furnizor) |
| `consultation_use` | − | Auto la `dispense()` sau manual |
| `hospitalization_use` | − | Manual |
| `direct_sale` | − | Manual |
| `adjustment_positive` | + | Manual (corecție inventar) |
| `adjustment_negative` | − | Manual (corecție inventar) |
| `return_to_supplier` | − | Manual |
| `expired_disposal` | − | Manual (casare loturi expirate) |
| `theft_loss` | − | Manual (pierdere / furt) |

---

## Auto-deducere la dispense

Când o linie de tratament este dispensată (`POST /treatment-lines/:id/dispense`):

1. Verificare că linia nu este deja dispensată (idempotency).
2. Verificare că consultația este editabilă.
3. Tranzacție atomică:
   a. `UPDATE treatment_lines SET is_dispensed = true, administered_at = NOW()`
   b. Dacă `inventory_item_id IS NOT NULL` AND `quantity_dispensed > 0`:
      - Guard: verifică dacă există deja mișcare cu `reference_type='treatment_line'` + `reference_id=line_id`
      - `SELECT current_stock ... FOR UPDATE` (row-level lock)
      - Validare stoc suficient
      - `INSERT INTO stock_movements` cu `movement_type='consultation_use'`
      - `UPDATE inventory_items SET current_stock = newStock`

**Invariantă**: dacă `inventoryItemId` este NULL (prescripție fără catalog), nu se creează mișcare.

---

## Endpoints REST

Prefix: `/api/v1/inventory`

```
GET    /items                   — listă produse (cu filtre: search, category, isActive, lowStock)
GET    /items/:id               — produs individual
POST   /items                   — creare (ADMIN)
PATCH  /items/:id               — editare (ADMIN)
DELETE /items/:id               — soft-delete (ADMIN)
GET    /items/:id/movements     — istoricul mișcărilor per produs
POST   /movements               — înregistrare mișcare manuală (ADMIN, VET_DOCTOR, ASSISTANT)
GET    /movements               — feed global mișcări recente
GET    /alerts                  — alerte: stoc zero, sub minim, loturi expirare <7/30 zile
GET    /billing-candidates      — candidați facturare (VIEW aggregat)
```

---

## UI — pagina Stocuri

Locație: `#page-stock` în `demo.html`.

### Funcționalități implementate

- **KPI cards**: total produse, stoc zero, sub minim, expiră <7 zile, expiră <30 zile
- **Alerte vizuale**: banner roșu/portocaliu/galben pentru situații critice
- **Tabel produse**: 9 coloane incl. butoane acțiuni per rând
- **Modal Adaugă Produs**: formular complet cu SKU, denumire, categorie, UM, preț, min/max, locație
- **Modal Editează Produs**: pre-populat din cache, SKU imutabil
- **Modal Mișcare IN**: recepție furnizor sau ajustare pozitivă
- **Modal Mișcare OUT**: vânzare directă, ajustare negativă, casare, pierdere, retur
- **Drawer Detalii Produs**: istoricul complet al mișcărilor per produs (50 cele mai recente)
- **Loturi cu expirare**: tabel loturi care expiră în 30 zile
- **Mișcări recente**: feed global cu ultimele 30 mișcări

### Variabile JS globale

```javascript
_inventoryItems  // cache pentru filtrare client-side (array of items)
_currentStockItem // item curent în modal/drawer activ
CAT_LABELS       // map category enum → label română
MOV_TYPE_LABELS  // map movement_type enum → label română
```

---

## Migrații

Tabelele sunt create în migrațiile 0004/0005 (inventory_items, stock_movements).  
Nu au fost necesare migrații noi pentru funcționalitățile din versiunea 1.0.

---

## Fișiere atinse în implementarea v1.0

| Fișier | Modificare |
|---|---|
| `dto/create-inventory-item.dto.ts` | Adăugat câmpul `isActive: boolean` cu `@IsBoolean()` |
| `inventory.service.ts` | `updateItem` include acum `isActive` în SET clause |
| `treatment-lines.service.ts` | `dispense()` implementat complet cu auto-deducere |
| `treatment-lines.service.spec.ts` | Test `dispense()` actualizat pentru re-fetch final |
| `demo.html` | UI complet: butoane, modale, drawer, funcții JS |
