# G-15 Reconciliation — Task Lifecycle & RBAC

## Ce este un reconciliation task?

Un task este o **acțiune manuală** creată de un utilizator autentificat ca urmare a detectării unui caz de nefacturare (consultație, procedură, linie de tratament sau mișcare de stoc). Sistemul NU creează și NU rezolvă task-uri automat.

---

## Statusuri și tranziții permise

```
open ──► in_progress ──► done
  │                         ▲
  └──────────────────────── dismissed
```

Orice tranziție este permisă (nu există un FSM strict), dar `done` și `dismissed` sunt statusuri finale — odată ajuns acolo, task-ul nu mai trebuie redeschis; se creează unul nou dacă situația persistă.

---

## Câmpuri de audit — regulă invariantă

| Câmp | Când se setează | Cine |
|---|---|---|
| `created_by` | La creare, o singură dată | Utilizatorul care a apăsat "Crează task" |
| `created_at` | La creare, o singură dată | DB default `NOW()` |
| `updated_by` | La **orice** tranziție de status | Utilizatorul care a făcut tranziția |
| `updated_at` | La **orice** tranziție de status | DB `NOW()` via UPDATE |
| `resolved_by` | Doar când status devine `done` sau `dismissed` | Utilizatorul care a închis task-ul |
| `resolved_at` | Idem | DB `NOW()` via UPDATE |

`updated_by` și `resolved_by` sunt **coloane independente**. Pe o tranziție finală, ambele sunt scrise simultan cu `userId`-ul apelantului — `updated_by` indică ultimul editor, `resolved_by` indică cine a închis.

---

## RBAC — cine poate face ce

| Acțiune | Roluri permise |
|---|---|
| Vizualizare lista task-uri | Toate rolurile medicale + ACCOUNTANT |
| Creare task | Toate rolurile medicale + ACCOUNTANT |
| Schimbare status | **Doar creatorul task-ului** sau **ADMIN** |
| Acceptance check (`GET reconciliation/acceptance-check`) | **Doar ADMIN** |

Verificarea se face în controller înainte de a delega serviciului:
```typescript
if (task.createdBy !== req.user.id && req.user.role !== UserRole.ADMIN) {
  throw new ForbiddenException(...);
}
```

---

## Invariante de sistem

1. **Sistemul NU creează task-uri automat** — nici din cron, nici din anomaly engine.
2. **Sistemul NU rezolvă task-uri automat** — cronul de 20:00 face exclusiv refresh de semnal și loghează summary.
3. **Închiderea unui task ≠ marcarea sursei ca facturată.** Task-ul rezolvat înseamnă că un utilizator a luat notă și a acționat. Statutul `billed` al consultației/procedurii este modificat exclusiv de modulul de facturare.
4. **`audit_logs` nu se poate șterge** și `changed_by` este obligatoriu pe orice scriere cu `withAuditContext()`.

---

## Praguri configurabile — două concepte distincte

Ambele sunt definite în `RECONCILIATION_CONFIG` din `reconciliation.service.ts`. O singură modificare acolo propagă în toate fluxurile.

### 1. Prag KPI de raportare — `kpiHighValueThreshold` (implicit 100 RON)

Răspunde la: *"ce valoare financiară minimă face un caz critic relevant pentru raportare?"*

Folosit în:
- `getSummary()` → calculul câmpului `criticalHighValue` din `ReconciliationSummary`
- `AnomalyService._detectUnbilledServices()` → câmpul `threshold` din payload anomalie
- Dashboard widget (`dash-unbilled-critical`) → eticheta afișată utilizatorului
- `severity()` helper → graduarea item individual la `critical`

### 2. Prag de alertă imediată — `alertMinCriticalCount` (implicit 1)

Răspunde la: *"de câte cazuri KPI e nevoie ca sistemul să declanșeze o alertă activă?"*

Folosit în:
- Cron 20:00 `runDailyReconciliation()` → `logger.warn` dacă `criticalHighValue >= alertMinCriticalCount`
- `AnomalyService._detectUnbilledServices()` → severity = `'critical'` în înregistrarea anomaliei

---

**Exemplu:** cu valorile implicite, un singur caz cu valoare > 100 RON declanșează atât KPI-ul cât și alerta imediată. Dacă vrei alertă imediată abia de la 3 cazuri, schimbi doar `alertMinCriticalCount: 3`.

```typescript
export const RECONCILIATION_CONFIG = {
  kpiHighValueThreshold:  100,  // RON — prag KPI raportare
  alertMinCriticalCount:    1,  // prag alertă imediată (nr. cazuri KPI)
  criticalDaysSince:        7,
  warningDaysSince:         3,
  warningValueThreshold:   20,  // RON
} as const;
```

---

## Acceptance check — endpoint de verificare

`GET /api/v1/reports/reconciliation/acceptance-check` (rol: ADMIN)

Rulează end-to-end pe toate cele 4 tipuri de surse:
- găsește primul item nefacturat din ultimele 30 de zile
- creează un task de test (`[ACCEPTANCE TEST] ...`)
- tranzitionează `open → in_progress → dismissed`
- verifică shape-ul complet (inclusiv `updated_by`, `resolved_by`, `resolved_at`)
- returnează raport cu `passed / noData / failed` per tip

Task-urile rămân în status `dismissed` și sunt identificabile prin prefixul `[ACCEPTANCE TEST]` în descriere.
