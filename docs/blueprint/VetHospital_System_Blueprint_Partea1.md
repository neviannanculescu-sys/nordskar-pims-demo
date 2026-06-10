# SISTEM DIGITAL CENTRALIZAT — SPITAL VETERINAR ROMÂNIA
## Blueprint Complet de Arhitectură, Operațiuni și Implementare
### Partea 1 din 3: Viziune, Module, Model de Date, Fluxuri Operaționale

---

> **Notă de utilizare:** Acest document este împărțit în 3 părți pentru claritate. Menține același nivel de detaliu tehnic și operațional în toate secțiunile. Destinat unui tech lead care construiește sistemul de la zero.

---

# A. VIZIUNEA SISTEMULUI

## A.1 Arhitectura Ideală — Descriere Generală

Sistemul este un **PIMS (Practice Information Management System)** veterinar adaptat pentru România, cu un strat ERP ușor integrat, conectat la infrastructura fiscală națională (ANAF SPV / RO e-Factura) și augmentat cu un layer de inteligență artificială (Claude API).

**Principiul de bază:** Claude este un layer de analiză și suport decizional, NU un registru oficial. Toate datele critice trăiesc în baza de date principală, indiferent dacă AI-ul funcționează sau nu.

### Stratificarea arhitecturii (layere):

```
┌─────────────────────────────────────────────────────────┐
│  LAYER 5: AI & Analytics (Claude API + Dashboards)      │
│  — analiză, sugestii, rezumate, anomalii, drafturi      │
├─────────────────────────────────────────────────────────┤
│  LAYER 4: Integrare Fiscală (SPV / e-Factura / ANAF)    │
│  — generare XML, upload, polling, reconciliere          │
├─────────────────────────────────────────────────────────┤
│  LAYER 3: Financiar (Facturare, Plăți, Contabilitate)   │
│  — facturi, încasări, export contabil, bon fiscal       │
├─────────────────────────────────────────────────────────┤
│  LAYER 2: Operațional (PIMS Core)                       │
│  — programări, consultații, tratamente, stocuri         │
├─────────────────────────────────────────────────────────┤
│  LAYER 1: Date Fundamentale (Single Source of Truth)    │
│  — clienți, pacienți, medici, catalog, entități         │
└─────────────────────────────────────────────────────────┘
```

### Ce trăiește în fiecare componentă:

| Componentă | Responsabilitate | Exemple concrete |
|---|---|---|
| **PIMS Core** | Date medicale, programări, tratamente | consultații, fișe, internări, protocoale |
| **ERP Light** | Stocuri, achiziții, cost goods | recepție marfă, mișcări stoc, furnizori |
| **Financiar** | Facturare, plăți, bon fiscal | facturi, chitanțe, avansuri, restanțe |
| **SPV Middleware** | Integrare ANAF | XML, upload, polling, erori |
| **Contabilitate** | Export date, jurnale | export CSV/JSON pentru contabil extern |
| **AI Layer** | Analiză, sugestii, drafturi | rezumate, anomalii, prețuri, SOPs |

### **CRITIC — Ce NU trebuie lăsat exclusiv pe AI:**
- Emiterea de facturi fiscale
- Trimiterea în SPV
- Calculul TVA și a obligațiilor fiscale
- Stocul de medicamente (trasabilitate legală)
- Autorizările și semnăturile digitale
- Orice operațiune ireversibilă (ștergere, stornare)

---

## A.2 Principii de Design

1. **Single Source of Truth** — fiecare entitate există o singură dată în sistem
2. **Audit Trail complet** — orice modificare este loggată cu user, timestamp, valoare veche/nouă
3. **Graceful degradation** — sistemul funcționează fără AI; AI adaugă valoare, nu dependență
4. **Separare clară medical / financiar** — un medic nu poate modifica o factură emisă
5. **Trasabilitate consumabile** — fiecare seringa/medicament folosit se leagă de o consultație
6. **Reconciliere continuă** — diferențele între prestat și facturat sunt vizibile în timp real

---

# B. HARTA COMPLETĂ A MODULELOR

## B.01 Recepție și Programări

**Scop:** Punct de intrare al tuturor activităților clinice. Gestionează fluxul de pacienți de la apel/mesaj până la check-in fizic.

**Date de intrare:**
- Cerere programare (telefon / WhatsApp / web form / walk-in)
- Identificare client existent sau nou (telefon, email, nume animal)
- Tip serviciu solicitat
- Disponibilitate medic
- Tip urgență (rutină / programat / urgență)

**Date de ieșire:**
- Programare confirmată cu slot orar, medic, cabinet
- Notificare automată client (SMS/email/WhatsApp)
- Card de check-in al zilei (listă programări per medic)
- Alertă dacă clientul are restanțe la plată

**Automatizări posibile:**
- Confirmare automată programare via SMS/WhatsApp cu 24h și 2h înainte
- Detectare no-show și trimitere link reprogramare
- Sugestie slot optim bazată pe istoricul pacientului
- Claude: draft mesaj personalizat de reamintire

**Riscuri operaționale:**
- Dubluri de programare (același slot / același cabinet)
- Walk-in neprogramat supraîncarcă agenda
- No-show fără anulare pierde venituri
- **CRITIC:** Client cu animal în stare critică trebuie să ocolească fluxul normal

**KPI-uri:**
- Rată ocupare programări (programări realizate / programări disponibile)
- Rată no-show (%)
- Timp mediu check-in
- Programări pe canal (telefon vs. online vs. walk-in)

---

## B.02 Fișa Pacientului (Animal)

**Scop:** Dosar medical permanent al fiecărui animal. Sursa unică de adevăr pentru identitate și istoric medical.

**Date de intrare:**
- Date la înregistrare: specie, rasă, sex, vârstă, culoare, semne distinctive, chip/tatuaj
- Date proprietar (owner)
- Vaccinuri existente (upload certificate vechi)
- Condiții preexistente, alergii, medicamente cronice
- Fotografii animal

**Date de ieșire:**
- Fișă completă cu istoric cronologic
- Sumar de sănătate (alergii, contraindicații)
- Calendar vaccinuri și tratamente preventive
- Documente atașate (analize, imagistică, certificate)

**Automatizări posibile:**
- Alertă automată pentru vaccinuri expirate sau ce expiră în 30 zile
- **RECOMANDAT:** Claude: sinteză medicală la deschiderea fișei ("Ultima consultație: acum 3 luni, diagnostic dermatită alergică, tratament finalizat")
- Detectare interacțiuni medicamentoase la prescriere

**Riscuri operaționale:**
- Animale fără chip — risc de confuzie identitate
- Date medicale incomplete la transfer de la alt cabinet
- **CRITIC:** Alergii nedocumentate pot cauza reacții adverse

**KPI-uri:**
- % fișe complete (toate câmpurile obligatorii completate)
- Număr pacienți activi (consultație în ultimele 12 luni)
- Număr pacienți pierduți (inactivi > 12 luni)

---

## B.03 Istoric Medical și Consultații

**Scop:** Înregistrarea și arhivarea tuturor interacțiunilor medicale. Tracabilitate clinică completă.

**Date de intrare:**
- Motiv consultație (anamnesis)
- Examinare clinică (semne vitale, examen pe sisteme)
- Diagnostic (ICD-VM sau nomenclatură internă)
- Plan de tratament
- Medicamente prescrise / administrate
- Consumabile utilizate
- Proceduri efectuate
- Instrucțiuni pentru proprietar (discharge notes)
- Timp medic consumat

**Date de ieșire:**
- Înregistrare consultație semnată digital de medic
- Listă tratamente / proceduri pentru facturare
- Rețetă medicală (dacă este cazul)
- Adeverință / certificat (vaccinuri, călătorie, etc.)
- Trigger pentru facturare automată a serviciilor

**Automatizări posibile:**
- **RECOMANDAT:** Claude: draft discharge notes în limbaj simplu pentru proprietar
- Auto-populare servicii în factură din consultație
- Alertă dacă s-au folosit consumabile fără a fi adăugate pe consultație
- Claude: verificare că planul de tratament este consistent cu diagnosticul

**Riscuri operaționale:**
- Consultații înregistrate incomplet (medicii grăbiți omit detalii)
- Consumabile folosite neraportate → pierdere financiară
- Factură emisă înainte de a fi finalizată consultația
- **CRITIC:** Lipsa alergiilor în fișă la momentul prescrierii

**KPI-uri:**
- Timp mediu per consultație (pe tip și medic)
- Rate consultații cu toate câmpurile completate
- Valoare medie consultație
- Consultații fără factură asociată (alertă)

---

## B.04 Internări

**Scop:** Gestionarea spitalizării — admisie, monitorizare, proceduri multiple, externare și facturare complexă.

**Date de intrare:**
- Decizie internare (din consultație sau urgență)
- Condiție la admitere (scor clinic)
- Cusca / boxă alocată
- Plan de monitorizare (frecvență observații)
- Autorizare proprietar (consimțământ scris)
- Buget estimat prezentat proprietarului

**Date de ieșire:**
- Foaie de observație zilnică
- Administrări medicamente cu timestamp și operator
- Proceduri efectuate pe durata internării
- Raport stare zilnic pentru proprietar
- Factură finală la externare (consolidare toate serviciile)

**Automatizări posibile:**
- Alertă automată proprietar la schimbare stare animal
- Generare automată raport zilnic de stare (Claude: formulare în limbaj accesibil)
- **RECOMANDAT:** Alertă dacă bugetul estimat este depășit cu >20%
- Tracking automat ore internare pentru tarif

**Riscuri operaționale:**
- Administrări medicamente neraportate → doze incorecte + pierdere financiară
- Factură finală incompletă dacă unele proceduri nu s-au înregistrat
- **CRITIC:** Lipsă consimțământ scris pentru proceduri invazive
- **CRITIC:** Supraaglomerare cușcă (capacitate maximă definită în sistem)

**KPI-uri:**
- Zile internare pe lună
- Venit mediu per internare
- Rată ocupare cușcă (%)
- Timp mediu internare pe diagnostic

---

## B.05 Intervenții Chirurgicale

**Scop:** Planificarea și documentarea intervențiilor chirurgicale. Protocoale pre/intra/postoperatorii.

**Date de intrare:**
- Indicație chirurgicală din consultație
- Tip intervenție
- Chirurg + anestezist alocat
- Sală operatorie + slot timp
- Protocoale preanestezice (analize obligatorii)
- Consimțământ operatorie semnat
- Lista materiale necesare (cerere din stoc)

**Date de ieșire:**
- Raport operator complet
- Fișă anestezie
- Consum materiale intraoperatorii
- Plan postoperator
- Trigger facturare pentru toate componentele (chirurgie + anestezie + materiale + monitorizare)

**Automatizări posibile:**
- Verificare automată că analizele preanestezice sunt finalizate înainte de intervenție
- Alertă stoc dacă materialele necesare nu sunt disponibile
- **RECOMANDAT:** Claude: generare draft raport operator din câmpuri structurate
- Auto-calcul cost intervenție bazat pe timp + consumabile

**Riscuri operaționale:**
- Intervenție fără consimțământ semnat — risc juridic
- Materiale lipsă descoperite în sala de operații
- **CRITIC:** Incompatibilitate medicament/anestezie nedepistată
- Facturare incompletă a materialelor intraoperatorii

**KPI-uri:**
- Număr intervenții pe lună / chirurg
- Durată medie intervenție pe tip
- Rată complicații postoperatorii
- Marja netă pe intervenție

---

## B.06 Laborator și Imagistică

**Scop:** Gestionarea analizelor de laborator (intern / trimis extern) și imagistică (Rx, eco, CT/RMN).

**Date de intrare:**
- Cerere analiză / imagistică din consultație
- Tip analiză + urgență
- Probă prelevată (sânge, urină, biopsie, tampon, etc.)
- Echipament utilizat / laborator extern

**Date de ieșire:**
- Rezultat analiză cu valori de referință
- Imagine DICOM (Rx, eco) sau fișier PDF (laborator extern)
- Interpretare automatizată bazală (valori în/din interval normal)
- Link în fișa pacientului
- Trigger facturare serviciu

**Automatizări posibile:**
- Alertă automată medic când rezultatul este disponibil
- **RECOMANDAT:** Alertă valori critice (outside critical range)
- Claude: rezumat analize pentru proprietar în limbaj accesibil
- Tracking termin analize externe (dacă nu vine în X zile, alertă)

**Riscuri operaționale:**
- Probe fără etichetare corectă → mix-up
- Rezultate externe pierdute sau neatașate în fișă
- **CRITIC:** Valori critice neraportate imediat medicului curant
- Facturare analiză fără a fi ataşat rezultatul

**KPI-uri:**
- Timp mediu turnaround analize interne
- Analize trimise vs. rezultate primite (reconciliere)
- Venit lunar laborator
- % analize facturate din analize efectuate

---

## B.07 Farmacie Veterinară și Stocuri

**Scop:** Gestiunea completă a stocului de medicamente, consumabile și produse de vânzare. Trasabilitate totală.

**Date de intrare:**
- Recepție marfă de la furnizori (cantitate, lot, dată expirare, preț achiziție)
- Consum din consultații/internări/intervenții
- Vânzare directă la recepție
- Returnări / deșeuri

**Date de ieșire:**
- Stoc curent per produs (cantitate + valoare la cost)
- Alertă stoc minim
- Alertă produse cu expirare apropiată (< 30, 60, 90 zile)
- Mișcări stoc pentru reconciliere
- Valoare stoc pentru bilanț

**Automatizări posibile:**
- Alertă automată stoc sub minim → propunere bon de comandă
- **RECOMANDAT:** Blocarea eliberării unui produs expirat din sistem
- Calcul automat FIFO/FEFO pentru ieșiri stoc
- Claude: analiză stoc mort (produs fără mișcare > 90 zile)
- Reconciliere consum înregistrat vs. stoc fizic (pentru inventar)

**Riscuri operaționale:**
- Medicamente administrate fără a fi scăzute din stoc → discrepanțe
- **CRITIC:** Medicamente expirate folosite (risc medical și legal)
- Furt / pierderi nedescoperite fără inventare periodice
- **CRITIC:** Medicamente cu regim special (stupefiante/psihotrope) necesită evidență separată conform legii

**KPI-uri:**
- Rotație stoc (zile) per categorie
- % stoc mort (fără mișcare > 90 zile)
- Valoare stoc total
- Diferențe inventar (teoretic vs. fizic)
- Procent produse cu expirare < 30 zile

---

## B.08 Achiziții și Furnizori

**Scop:** Gestionarea relației cu furnizorii, comenzilor de aprovizionare și recepției de marfă.

**Date de intrare:**
- Nevoi de aprovizionare (generate automat din alertă stoc minim sau manual)
- Oferte furnizori
- Comenzi de aprovizionare aprobate
- Facturi de achiziție (input cost)
- Livrări (cantitate și calitate primită)

**Date de ieșire:**
- Comenzi de aprovizionare (PO)
- Bon recepție (GRN) cu confirmare cantitate/lot/expirare
- Actualizare cost de intrare în stoc
- Reconciliere factură furnizor vs. bon de comandă vs. recepție (3-way match)
- Export pentru plata furnizori

**Automatizări posibile:**
- Generare automată propunere comandă la atingere stoc minim
- **RECOMANDAT:** Claude: analiză performanță furnizori (prețuri, termene, calitate)
- Alertă factură furnizor fără bon recepție asociat
- Tracking termene de plată furnizori și avertizare

**Riscuri operaționale:**
- Plată factură furnizor fără recepție confirmată
- **CRITIC:** Recepție marfă cu lot sau dată expirare greșite introduse în sistem
- Prețuri de achiziție diferite față de comandă → eroare în calculul marjei

**KPI-uri:**
- Valoare achiziții lunare per furnizor
- Timp mediu livrare per furnizor
- Discrepanțe 3-way match (%)
- Facturi furnizori neachitate și scadente

---

## B.09 Catalog Prețuri și Servicii

**Scop:** Sursa unică de adevăr pentru toate tarifele. Legătura dintre serviciu medical și valoarea facturabilă.

**Date de intrare:**
- Definire serviciu (cod, denumire, categorie, descriere)
- Timp estimat de execuție
- Consumabile standard asociate (template procedură)
- Cost direct calculat
- Marjă minimă acceptată
- Prețuri aprobate per categorie/specie

**Date de ieșire:**
- Tarif aplicabil la momentul consultației
- Cost estimat pentru deviz
- Prețuri pachete
- Prețuri speciale / excepții aprobate
- Raport servicii subevaluate

**Automatizări posibile:**
- **RECOMANDAT:** Claude: propuneri actualizare prețuri bazate pe evoluție costuri
- Alertă automată dacă prețul unui serviciu scade sub marja minimă setată
- Calculul automat al costului direct la modificarea prețului unui consumabil

**Riscuri operaționale:**
- Prețuri neactualizate → vânzare sub cost
- Reduceri neautorizate aplicate la casă
- **CRITIC:** Prețuri diferite aplicate aceluiași serviciu fără documentare → discrepanțe TVA

**KPI-uri:**
- Număr servicii cu marjă sub prag minim
- % actualizare catalog în ultimele 6 luni
- Prețuri medii realizate vs. prețuri catalog

---

## B.10 Facturare și Plăți

**Scop:** Emiterea documentelor fiscale corecte, gestionarea încasărilor și urmărirea restanțelor.

**Date de intrare:**
- Servicii prestate (din consultație / internare / intervenție)
- Produse vândute
- Plăți anticipate / avansuri
- Modalitate plată (cash, card, transfer, voucher)
- Date client (pentru factura cu date)

**Date de ieșire:**
- Factură fiscală (sau bon fiscal)
- Chitanță / confirmare plată
- Extras cont creanțe
- Export pentru contabilitate
- Date pregătite pentru SPV

**Automatizări posibile:**
- Pre-populare automată factură din serviciile înregistrate în consultație
- **RECOMANDAT:** Claude: verificare factură înainte de emitere (date lipsă, erori, TVA)
- Alertă creanțe > 30/60/90 zile
- Generare automată somaţie plată
- Reconciliere automată plată card (import extras bancar)

**Riscuri operaționale:**
- **CRITIC:** Factură emisă fără toate serviciile din consultație (pierdere venit)
- Factură cu date fiscale greșite ale clientului → invalidă legal
- Avans nereconciliat → dublă încasare sau pierdere
- **CRITIC:** Bon fiscal fără casa de marcat conectată legal

**KPI-uri:**
- Zile medie până la facturare (de la prestare serviciu)
- Zile medie până la încasare (DSO)
- Total creanțe restante
- % facturi plătite în termen

---

## B.11 Integrare Contabilitate

**Scop:** Export structurat al datelor financiare către contabilul extern sau software-ul de contabilitate intern.

**Date de intrare:**
- Facturi emise (vânzări)
- Facturi primite (achiziții)
- Încasări și plăți
- Mișcări stoc (pentru valoare stoc bilanț)
- Salarii și alte cheltuieli (input manual sau import)

**Date de ieșire:**
- Export lunar / la cerere în format CSV/JSON/XML compatibil cu software-ul contabil (Saga, WinMentor, etc.)
- Jurnale contabile (vânzări, cumpărări, casă, bancă)
- Balanță verificare preliminară
- Situație TVA colectată/deductibilă

**Automatizări posibile:**
- Export automat lunar în prima zi a lunii următoare
- **RECOMANDAT:** Reconciliere automată TVA (calculat în sistem vs. exportat pentru declarație)
- Claude: verificare consistență date înainte de export

**Riscuri operaționale:**
- **CRITIC:** Date exportate incorect → erori în declarațiile fiscale
- Export parțial (nu toate facturile incluse)
- Diferențe TVA dacă există facturi stornate netratate

**KPI-uri:**
- % date exportate la timp (până în data X a lunii)
- Număr discrepanțe identificate la reconciliere

---

## B.12 Integrare SPV / e-Factura (ANAF)

**Scop:** Transmiterea electronică a facturilor B2B obligatorii prin sistemul RO e-Factura, conform legislației în vigoare.

> **Referință legală:** OUG 120/2021 modificat, Ordinul ANAF 12/2022, implementare obligatorie B2B de la 01.01.2024.

**Date de intrare:**
- Facturi validate în modulul de facturare
- Date fiscale client (CUI/CNP, denumire, adresă, cont)
- Date vânzător (CUI, serie/număr factură, TVA)
- Linii factură cu coduri NC/CPV unde necesare

**Date de ieșire:**
- XML UBL 2.1 validat (conform specificație CIUS-RO)
- Răspuns ANAF (accepted, rejected, in processing)
- Index ANAF (număr de identificare tranzacție)
- Mesaje de eroare cu cod și descriere
- Arhivă răspunsuri

**Automatizări posibile:**
- **CRITIC:** Generare XML, upload, polling status — trebuie realizate de aplicație sau middleware specializat, NU de Claude
- Claude: analiză erorilor SPV și sugestii de corectare în limbaj uman
- Alertă reconciliere (factură în sistem vs. status SPV)

**Riscuri operaționale:**
- **CRITIC:** Factură emisă dar netrimisă în SPV — amendă ANAF
- Erori de validare ANAF (date lipsă, format greșit) → factură respinsă
- Token expirat → upload eșuat fără știrea utilizatorului
- **CRITIC:** CUI client invalid → factură respinsă automat de ANAF

**KPI-uri:**
- % facturi trimise în SPV în termen (< 5 zile lucrătoare)
- Rată erori SPV (rejected / total)
- Timp mediu procesare SPV
- Facturi neconfirmate > 5 zile lucrătoare (alertă)

---

## B.13 Rapoarte Manageriale

**Scop:** Vizibilitate completă asupra performanței clinice, financiare și operaționale a spitalului.

**Date de intrare:**
- Toate modulele sistemului (consultații, facturi, stocuri, plăți, etc.)

**Date de ieșire:**
- Dashboard zilnic (venituri, consultații, internări, stoc critic)
- Raport săptămânal (comparativ week-over-week)
- Raport lunar (P&L simplificat, KPI-uri cheie)
- Rapoarte ad-hoc (pe cerere)

**Automatizări posibile:**
- **RECOMANDAT:** Generare automată raport zilnic la ora 8:00 și trimitere pe email / WhatsApp
- Claude: rezumat narativ al performanței ("Luna aceasta a fost cu 12% mai slabă față de luna precedentă, principala cauză...")
- Detectare anomalii în tendințe (Claude: flagging)

**KPI-uri:** (detaliate la secțiunea J)

---

## B.14 CRM și Retenție Clienți

**Scop:** Menținerea relației cu proprietarii de animale, creșterea ratei de revenire și a loialității.

**Date de intrare:**
- Istoricul vizitelor și cheltuielilor
- Feedback post-consultație
- Date contact (telefon, email, WhatsApp, preferință comunicare)
- Calendarul vaccinurilor și tratamentelor preventive

**Date de ieșire:**
- Segmentare clienți (activi, la risc de churn, VIP, inactivi)
- Campanii reamintire (vaccinuri, deparazitare, control periodic)
- Comunicări personalizate
- Analiza LTV (lifetime value) per client

**Automatizări posibile:**
- Trimitere automată reminder vaccin cu 30/14/3 zile înainte
- Claude: draft mesaj WhatsApp personalizat per client/animal
- Detectare automată clienți inactivi > 12 luni
- **RECOMANDAT:** Sondaj feedback automat la 24h după consultație

**Riscuri operaționale:**
- Comunicare excesivă → spam → plângeri GDPR
- **CRITIC:** Stocare date personale fără consimțământ GDPR — risc amendă
- Mesaje greșite trimise (confuzie clienți)

**KPI-uri:**
- Rată retenție clienți (%)
- Frecvența medie vizite per client/an
- NPS (Net Promoter Score) din feedback
- Venit per client (LTV)

---

## B.15 Automatizări AI (Claude Layer)

**Scop:** Layer de inteligență aplicată pe date existente. Suport decizional, detectare anomalii, generare conținut.

> **CRITIC:** Modulul AI nu scrie direct în baza de date. Orice acțiune propusă necesită confirmare umană sau flow automatizat separat cu audit trail.

(Detalii complete la secțiunea G)

---

## B.16 Administrare și Permisiuni

**Scop:** Control acces, configurare sistem, audit trail complet.

**Date de intrare:**
- Utilizatori (medici, asistenți, recepție, management, contabilitate)
- Roluri și permisiuni granulare
- Configurare spital (program, tarife implicit, șabloane)

**Date de ieșire:**
- Log complet al tuturor acțiunilor (audit trail)
- Raport acces suspect
- Backup configurație

**Automatizări posibile:**
- Alertă login după program sau din locație neobișnuită
- Blocare automată cont după X tentative eșuate
- **RECOMANDAT:** Raport audit săptămânal trimis administratorului

**Riscuri operaționale:**
- **CRITIC:** Acces prea larg → modificări neautorizate prețuri sau facturi
- Conturi inactive nedesactivate (foști angajați)
- Lipsa audit trail → imposibil de investigat incidente

---

# C. MODELUL DE DATE

## C.1 Schema Logică — Entitățile Principale

### ENTITATE: `owners` (Proprietari)

**Scop:** Persoana fizică sau juridică care deține animalul și față de care se emit documente fiscale.

```sql
owners {
  id                UUID PRIMARY KEY
  type              ENUM('individual','company') NOT NULL
  first_name        VARCHAR(100)
  last_name         VARCHAR(100)
  company_name      VARCHAR(200)           -- dacă type = company
  cui               VARCHAR(20)            -- CUI pentru persoane juridice
  cnp               VARCHAR(13)            -- CNP pentru persoane fizice
  vat_payer         BOOLEAN DEFAULT FALSE
  address_street    VARCHAR(200)
  address_city      VARCHAR(100)
  address_county    VARCHAR(100)
  address_zip       VARCHAR(10)
  address_country   VARCHAR(50) DEFAULT 'RO'
  phone_primary     VARCHAR(20) NOT NULL
  phone_secondary   VARCHAR(20)
  email             VARCHAR(150)
  whatsapp          VARCHAR(20)
  preferred_channel ENUM('phone','email','whatsapp','sms')
  gdpr_consent      BOOLEAN NOT NULL DEFAULT FALSE
  gdpr_consent_date TIMESTAMP
  notes             TEXT
  is_active         BOOLEAN DEFAULT TRUE
  created_at        TIMESTAMP DEFAULT NOW()
  updated_at        TIMESTAMP
  created_by        UUID REFERENCES users(id)
}
```

**Validări:**
- `cnp` validat cu algoritm oficial CNP România
- `cui` validat format (RO + cifre) și checksum
- Dacă `type = company`, atunci `company_name` și `cui` sunt obligatorii
- `gdpr_consent = TRUE` obligatoriu înainte de stocare date contact
- **CRITIC:** CUI trebuie validat la momentul creării (verificare ANAF VIES opțional)

---

### ENTITATE: `pets` (Animale / Pacienți)

**Scop:** Dosar permanent al pacientului (animalul). Identitate medicală unică.

```sql
pets {
  id              UUID PRIMARY KEY
  owner_id        UUID REFERENCES owners(id) NOT NULL
  name            VARCHAR(100) NOT NULL
  species_id      UUID REFERENCES species(id) NOT NULL
  breed_id        UUID REFERENCES breeds(id)
  gender          ENUM('male','female','unknown') NOT NULL
  is_neutered     BOOLEAN
  date_of_birth   DATE
  approximate_age VARCHAR(50)              -- dacă nu se știe data exactă
  color           VARCHAR(100)
  markings        TEXT
  chip_number     VARCHAR(50) UNIQUE       -- număr microcip
  tattoo          VARCHAR(50)
  passport_number VARCHAR(50)             -- pașaport european animale
  weight_kg       DECIMAL(5,2)            -- ultima greutate înregistrată
  photo_url       TEXT
  is_deceased     BOOLEAN DEFAULT FALSE
  deceased_date   DATE
  notes           TEXT
  allergies       TEXT                    -- CRITIC: câmp vizibil prominent
  chronic_conditions TEXT
  is_active       BOOLEAN DEFAULT TRUE
  created_at      TIMESTAMP DEFAULT NOW()
  updated_at      TIMESTAMP
}
```

**Relații cheie:**
- `owner_id` → un animal aparține unui proprietar
- Un proprietar poate avea multiple animale
- `species_id` și `breed_id` sunt din tabele de referință

---

### ENTITATE: `species` + `breeds`

```sql
species {
  id          UUID PRIMARY KEY
  name_ro     VARCHAR(100) NOT NULL   -- ex: "Câine", "Pisică", "Iepure"
  name_en     VARCHAR(100)
  is_active   BOOLEAN DEFAULT TRUE
}

breeds {
  id          UUID PRIMARY KEY
  species_id  UUID REFERENCES species(id) NOT NULL
  name        VARCHAR(150) NOT NULL   -- ex: "Labrador Retriever"
  is_active   BOOLEAN DEFAULT TRUE
}
```

---

### ENTITATE: `veterinarians` (Medici)

```sql
veterinarians {
  id                  UUID PRIMARY KEY
  user_id             UUID REFERENCES users(id) UNIQUE NOT NULL
  first_name          VARCHAR(100) NOT NULL
  last_name           VARCHAR(100) NOT NULL
  license_number      VARCHAR(50) NOT NULL    -- număr parafă CMVRO
  specializations     TEXT[]                  -- array de specialități
  is_surgeon          BOOLEAN DEFAULT FALSE
  is_available        BOOLEAN DEFAULT TRUE
  consultation_rate   DECIMAL(8,2)            -- tarif orar intern
  color_in_calendar   VARCHAR(7)              -- hex color pentru calendar
  signature_image_url TEXT                    -- pentru documente
  notes               TEXT
  created_at          TIMESTAMP DEFAULT NOW()
}
```

---

### ENTITATE: `appointments` (Programări)

```sql
appointments {
  id              UUID PRIMARY KEY
  pet_id          UUID REFERENCES pets(id) NOT NULL
  owner_id        UUID REFERENCES owners(id) NOT NULL
  veterinarian_id UUID REFERENCES veterinarians(id)
  room_id         UUID REFERENCES rooms(id)
  scheduled_at    TIMESTAMP NOT NULL
  duration_min    INTEGER DEFAULT 30
  type            ENUM('routine','emergency','followup','surgery','hospitalization','vaccination','other')
  status          ENUM('scheduled','confirmed','checked_in','in_progress','completed','no_show','cancelled')
  reason          TEXT NOT NULL              -- motiv consultație
  notes           TEXT
  source          ENUM('phone','online','walkin','whatsapp','internal')
  reminder_sent_24h BOOLEAN DEFAULT FALSE
  reminder_sent_2h  BOOLEAN DEFAULT FALSE
  created_at      TIMESTAMP DEFAULT NOW()
  updated_at      TIMESTAMP
  created_by      UUID REFERENCES users(id)
}
```

---

### ENTITATE: `consultations` (Consultații)

**CRITIC:** Aceasta este entitatea centrală operațională. Leagă clientul, pacientul, medicul, serviciile prestate și declanșează facturarea.

```sql
consultations {
  id                  UUID PRIMARY KEY
  appointment_id      UUID REFERENCES appointments(id)   -- poate fi NULL pentru walk-in
  pet_id              UUID REFERENCES pets(id) NOT NULL
  owner_id            UUID REFERENCES owners(id) NOT NULL
  veterinarian_id     UUID REFERENCES veterinarians(id) NOT NULL
  consultation_date   TIMESTAMP NOT NULL
  type                ENUM('routine','emergency','followup','second_opinion','teleconsultation')
  
  -- Anamnesis
  chief_complaint     TEXT NOT NULL
  history             TEXT
  
  -- Examen clinic
  weight_kg           DECIMAL(5,2)
  temperature_c       DECIMAL(4,1)
  heart_rate          INTEGER
  respiratory_rate    INTEGER
  clinical_findings   TEXT
  
  -- Diagnostic
  diagnosis_primary   TEXT NOT NULL
  diagnosis_secondary TEXT
  prognosis           ENUM('good','guarded','poor','unknown')
  
  -- Plan
  treatment_plan      TEXT
  discharge_notes     TEXT              -- instrucțiuni proprietar
  follow_up_date      DATE
  follow_up_notes     TEXT
  
  -- Status
  status              ENUM('open','completed','cancelled') DEFAULT 'open'
  billed              BOOLEAN DEFAULT FALSE
  invoice_id          UUID REFERENCES invoices(id)
  
  -- Durată
  started_at          TIMESTAMP
  ended_at            TIMESTAMP
  duration_minutes    INTEGER GENERATED ALWAYS AS (EXTRACT(EPOCH FROM (ended_at - started_at))/60) STORED
  
  created_at          TIMESTAMP DEFAULT NOW()
  updated_at          TIMESTAMP
  signed_by           UUID REFERENCES veterinarians(id)
  signed_at           TIMESTAMP
}
```

**Regulă business CRITIC:** O consultație nu poate fi facturată dacă `signed_by` este NULL. Medicul trebuie să semneze digital consultația înainte de emiterea facturii.

---

### ENTITATE: `procedures` (Proceduri efectuate în consultație)

```sql
procedures {
  id                    UUID PRIMARY KEY
  consultation_id       UUID REFERENCES consultations(id) NOT NULL
  hospitalization_id    UUID REFERENCES hospitalizations(id)
  procedure_template_id UUID REFERENCES procedure_templates(id)
  veterinarian_id       UUID REFERENCES veterinarians(id) NOT NULL
  performed_at          TIMESTAMP NOT NULL
  name                  VARCHAR(200) NOT NULL
  description           TEXT
  quantity              DECIMAL(8,2) DEFAULT 1
  unit                  VARCHAR(50)
  unit_price            DECIMAL(10,2) NOT NULL     -- prețul la momentul prestării
  total_price           DECIMAL(10,2) NOT NULL
  cost_direct           DECIMAL(10,2)              -- cost consumabile asociate
  is_billable           BOOLEAN DEFAULT TRUE
  notes                 TEXT
  created_at            TIMESTAMP DEFAULT NOW()
}
```

---

### ENTITATE: `procedure_templates` (Șabloane proceduri)

**Scop:** Definește o procedură standard cu consumabilele asociate și timpul estimat. Baza pentru calculul costului direct.

```sql
procedure_templates {
  id                    UUID PRIMARY KEY
  service_id            UUID REFERENCES price_catalog(id) NOT NULL
  name                  VARCHAR(200) NOT NULL
  description           TEXT
  estimated_time_min    INTEGER
  is_active             BOOLEAN DEFAULT TRUE
  requires_anesthesia   BOOLEAN DEFAULT FALSE
  requires_lab          BOOLEAN DEFAULT FALSE
  pre_procedure_notes   TEXT
  post_procedure_notes  TEXT
  created_at            TIMESTAMP DEFAULT NOW()
  updated_at            TIMESTAMP
}

-- Tabela de legătură: ce consumabile intră standard într-o procedură
procedure_template_items {
  id                    UUID PRIMARY KEY
  template_id           UUID REFERENCES procedure_templates(id) NOT NULL
  inventory_item_id     UUID REFERENCES inventory_items(id) NOT NULL
  quantity_standard     DECIMAL(8,3) NOT NULL    -- cantitate standard
  quantity_unit         VARCHAR(30) NOT NULL
  is_mandatory          BOOLEAN DEFAULT TRUE
  notes                 TEXT
}
```

---

### ENTITATE: `treatment_lines` (Linii de tratament)

```sql
treatment_lines {
  id                  UUID PRIMARY KEY
  consultation_id     UUID REFERENCES consultations(id)
  hospitalization_id  UUID REFERENCES hospitalizations(id)
  inventory_item_id   UUID REFERENCES inventory_items(id) NOT NULL
  prescribed_by       UUID REFERENCES veterinarians(id) NOT NULL
  administered_by     UUID REFERENCES users(id)
  
  -- Prescripție
  dose                VARCHAR(100) NOT NULL    -- ex: "5mg/kg"
  frequency           VARCHAR(100)             -- ex: "de 2 ori pe zi"
  route               ENUM('oral','iv','im','sc','topical','ophthalmic','other')
  duration_days       INTEGER
  start_date          DATE
  end_date            DATE
  
  -- Administrare
  quantity_dispensed  DECIMAL(8,3)
  quantity_unit       VARCHAR(30)
  lot_number          VARCHAR(50)             -- CRITIC: trasabilitate
  expiry_date         DATE
  
  -- Cost și facturare
  unit_cost           DECIMAL(10,2)           -- costul din stoc (FIFO/FEFO)
  unit_price          DECIMAL(10,2)           -- prețul de vânzare
  is_billable         BOOLEAN DEFAULT TRUE
  is_dispensed        BOOLEAN DEFAULT FALSE   -- a ieșit fizic din stoc?
  
  administered_at     TIMESTAMP
  notes               TEXT
  created_at          TIMESTAMP DEFAULT NOW()
}
```

**CRITIC:** Câmpul `lot_number` și `expiry_date` sunt obligatorii pentru medicamente cu trasabilitate legală.

---

### ENTITATE: `inventory_items` (Produse în stoc)

```sql
inventory_items {
  id                  UUID PRIMARY KEY
  sku                 VARCHAR(50) UNIQUE NOT NULL
  name                VARCHAR(200) NOT NULL
  generic_name        VARCHAR(200)
  category            ENUM('medication','consumable','food','product_for_sale','equipment','other')
  subcategory         VARCHAR(100)
  
  -- Clasificare specială
  is_controlled       BOOLEAN DEFAULT FALSE   -- CRITIC: stupefiante/psihotrope
  requires_prescription BOOLEAN DEFAULT FALSE
  is_for_sale         BOOLEAN DEFAULT TRUE    -- poate fi vândut direct la recepție
  
  -- Furnizor și identitate
  supplier_id         UUID REFERENCES suppliers(id)
  manufacturer        VARCHAR(200)
  barcode             VARCHAR(50)
  
  -- Unități de măsură
  unit_of_measure     VARCHAR(30) NOT NULL    -- ex: "flacon", "ml", "comprimat", "kg"
  base_unit           VARCHAR(30)             -- unitatea de bază pentru stoc
  conversion_factor   DECIMAL(10,4)           -- ex: 1 flacon = 100 ml
  
  -- Stoc
  current_stock       DECIMAL(10,3) DEFAULT 0
  min_stock_level     DECIMAL(10,3)           -- prag alertă stoc minim
  max_stock_level     DECIMAL(10,3)
  reorder_quantity    DECIMAL(10,3)           -- cantitate comandă reaprovizionare
  
  -- Cost și prețuri
  last_purchase_price DECIMAL(10,4)           -- ultimul preț de achiziție
  average_cost        DECIMAL(10,4)           -- calculat FIFO/FEFO
  sale_price          DECIMAL(10,2)           -- prețul de vânzare la recepție
  vat_rate            DECIMAL(5,2) DEFAULT 9  -- 9% sau 19%
  
  -- Localizare
  storage_location    VARCHAR(100)            -- raft, congelator, etc.
  storage_conditions  TEXT
  
  is_active           BOOLEAN DEFAULT TRUE
  created_at          TIMESTAMP DEFAULT NOW()
  updated_at          TIMESTAMP
}
```

---

### ENTITATE: `stock_movements` (Mișcări stoc)

```sql
stock_movements {
  id                  UUID PRIMARY KEY
  inventory_item_id   UUID REFERENCES inventory_items(id) NOT NULL
  
  movement_type       ENUM(
    'purchase_receipt',     -- intrare din bon de recepție
    'consultation_use',     -- ieșire folosit în consultație
    'hospitalization_use',  -- ieșire folosit în internare
    'direct_sale',          -- vânzare directă la recepție
    'adjustment_positive',  -- corecție inventar plus
    'adjustment_negative',  -- corecție inventar minus
    'return_to_supplier',   -- retur furnizor
    'expired_disposal',     -- casare expirat
    'theft_loss'            -- pierdere/furt
  ) NOT NULL
  
  reference_type      VARCHAR(50)   -- 'consultation', 'invoice', 'purchase_order', etc.
  reference_id        UUID          -- ID-ul entității de referință
  
  quantity            DECIMAL(10,3) NOT NULL   -- pozitiv = intrare, negativ = ieșire
  unit_cost           DECIMAL(10,4)            -- costul unitar la momentul mișcării
  lot_number          VARCHAR(50)
  expiry_date         DATE
  
  notes               TEXT
  performed_by        UUID REFERENCES users(id) NOT NULL
  performed_at        TIMESTAMP NOT NULL DEFAULT NOW()
  
  -- Stoc înainte și după (pentru audit)
  stock_before        DECIMAL(10,3)
  stock_after         DECIMAL(10,3)
}
```

---

### ENTITATE: `suppliers` (Furnizori)

```sql
suppliers {
  id              UUID PRIMARY KEY
  name            VARCHAR(200) NOT NULL
  cui             VARCHAR(20) UNIQUE NOT NULL
  vat_payer       BOOLEAN DEFAULT TRUE
  
  -- Contact
  contact_person  VARCHAR(100)
  phone           VARCHAR(20)
  email           VARCHAR(150)
  address         TEXT
  
  -- Condiții comerciale
  payment_terms_days INTEGER DEFAULT 30
  discount_percent   DECIMAL(5,2)
  min_order_value    DECIMAL(10,2)
  delivery_days      INTEGER
  
  notes           TEXT
  is_active       BOOLEAN DEFAULT TRUE
  created_at      TIMESTAMP DEFAULT NOW()
}
```

---

### ENTITATE: `purchase_orders` (Comenzi de aprovizionare)

```sql
purchase_orders {
  id              UUID PRIMARY KEY
  po_number       VARCHAR(30) UNIQUE NOT NULL    -- număr intern comandă
  supplier_id     UUID REFERENCES suppliers(id) NOT NULL
  
  status          ENUM('draft','sent','confirmed','partially_received','received','cancelled')
  
  ordered_by      UUID REFERENCES users(id) NOT NULL
  approved_by     UUID REFERENCES users(id)
  ordered_at      TIMESTAMP NOT NULL DEFAULT NOW()
  expected_date   DATE
  received_at     TIMESTAMP
  
  total_value     DECIMAL(12,2)
  notes           TEXT
  
  created_at      TIMESTAMP DEFAULT NOW()
  updated_at      TIMESTAMP
}

purchase_order_lines {
  id                    UUID PRIMARY KEY
  purchase_order_id     UUID REFERENCES purchase_orders(id) NOT NULL
  inventory_item_id     UUID REFERENCES inventory_items(id) NOT NULL
  quantity_ordered      DECIMAL(10,3) NOT NULL
  quantity_received     DECIMAL(10,3) DEFAULT 0
  unit_price            DECIMAL(10,4) NOT NULL
  total_price           DECIMAL(12,2) NOT NULL
  notes                 TEXT
}
```

---

### ENTITATE: `goods_receipts` (Bon de recepție)

```sql
goods_receipts {
  id                UUID PRIMARY KEY
  grn_number        VARCHAR(30) UNIQUE NOT NULL
  purchase_order_id UUID REFERENCES purchase_orders(id)
  supplier_id       UUID REFERENCES suppliers(id) NOT NULL
  supplier_invoice_number VARCHAR(50)          -- numărul facturii furnizorului
  
  received_by       UUID REFERENCES users(id) NOT NULL
  received_at       TIMESTAMP NOT NULL DEFAULT NOW()
  
  status            ENUM('draft','confirmed','discrepancy')
  notes             TEXT
  
  created_at        TIMESTAMP DEFAULT NOW()
}

goods_receipt_lines {
  id                    UUID PRIMARY KEY
  goods_receipt_id      UUID REFERENCES goods_receipts(id) NOT NULL
  inventory_item_id     UUID REFERENCES inventory_items(id) NOT NULL
  quantity_received     DECIMAL(10,3) NOT NULL
  unit_price            DECIMAL(10,4) NOT NULL
  lot_number            VARCHAR(50)       -- CRITIC
  expiry_date           DATE              -- CRITIC
  storage_location      VARCHAR(100)
  notes                 TEXT
}
```

---

### ENTITATE: `price_catalog` (Catalog prețuri și servicii)

```sql
price_catalog {
  id                UUID PRIMARY KEY
  code              VARCHAR(30) UNIQUE NOT NULL    -- cod serviciu intern
  name              VARCHAR(200) NOT NULL
  description       TEXT
  
  category_id       UUID REFERENCES service_categories(id) NOT NULL
  
  -- Tip serviciu
  service_type      ENUM(
    'consultation', 'emergency', 'surgery', 'anesthesia',
    'hospitalization', 'lab_test', 'imaging', 'vaccination',
    'treatment', 'procedure', 'product', 'package', 'other'
  ) NOT NULL
  
  -- Prețuri
  base_price        DECIMAL(10,2) NOT NULL
  vat_rate          DECIMAL(5,2) DEFAULT 9         -- 9% sau 19%
  price_with_vat    DECIMAL(10,2) GENERATED ALWAYS AS (base_price * (1 + vat_rate/100)) STORED
  
  -- Cost direct (calculat din procedure_templates)
  direct_cost_estimate DECIMAL(10,2)
  
  -- Marjă
  min_margin_percent DECIMAL(5,2) DEFAULT 30       -- marja minimă acceptată
  
  -- Timp
  estimated_duration_min INTEGER
  
  -- Aplicabilitate
  applicable_species UUID[]              -- array de species_id (NULL = toate)
  is_emergency_surcharge BOOLEAN DEFAULT FALSE
  emergency_multiplier   DECIMAL(4,2) DEFAULT 1.5  -- ex: 1.5 = 50% adaos urgențe
  
  -- Control
  requires_approval_above DECIMAL(10,2)  -- necesită aprobare dacă > X lei
  is_active           BOOLEAN DEFAULT TRUE
  valid_from          DATE NOT NULL DEFAULT CURRENT_DATE
  valid_to            DATE
  
  created_at          TIMESTAMP DEFAULT NOW()
  updated_at          TIMESTAMP
  updated_by          UUID REFERENCES users(id)
}

service_categories {
  id          UUID PRIMARY KEY
  name        VARCHAR(100) NOT NULL       -- ex: "Chirurgie", "Consultații", "Laborator"
  parent_id   UUID REFERENCES service_categories(id)   -- ierarhie pe categorii
  color       VARCHAR(7)
  is_active   BOOLEAN DEFAULT TRUE
}
```

---

### ENTITATE: `invoices` (Facturi emise)

**CRITIC:** Aceasta este entitatea fiscală. Odată emisă, nu se modifică — se stornează și se reemite.

```sql
invoices {
  id                  UUID PRIMARY KEY
  invoice_number      VARCHAR(30) UNIQUE NOT NULL    -- ex: "VET-2024-001234"
  series              VARCHAR(10) NOT NULL           -- seria facturii
  
  -- Referințe
  owner_id            UUID REFERENCES owners(id) NOT NULL
  consultation_id     UUID REFERENCES consultations(id)
  hospitalization_id  UUID REFERENCES hospitalizations(id)
  
  -- Tip document
  invoice_type        ENUM('invoice','proforma','storno','receipt') NOT NULL
  storno_of           UUID REFERENCES invoices(id)   -- dacă e storno
  
  -- Date fiscale client
  client_name         VARCHAR(200) NOT NULL     -- snapshot la momentul emiterii
  client_cui          VARCHAR(20)
  client_cnp          VARCHAR(13)
  client_vat_payer    BOOLEAN
  client_address      TEXT
  
  -- Date fiscale vânzător (snapshot)
  seller_name         VARCHAR(200) NOT NULL
  seller_cui          VARCHAR(20) NOT NULL
  seller_address      TEXT NOT NULL
  
  -- Valori
  subtotal            DECIMAL(12,2) NOT NULL
  vat_amount          DECIMAL(12,2) NOT NULL
  total               DECIMAL(12,2) NOT NULL
  total_paid          DECIMAL(12,2) DEFAULT 0
  balance_due         DECIMAL(12,2) GENERATED ALWAYS AS (total - total_paid) STORED
  
  -- Status
  status              ENUM('draft','issued','partially_paid','paid','overdue','cancelled','storno')
  issue_date          DATE NOT NULL
  due_date            DATE
  payment_terms_days  INTEGER DEFAULT 0
  
  -- SPV
  spv_submission_id   UUID REFERENCES spv_submissions(id)
  spv_status          ENUM('not_required','pending','submitted','accepted','rejected','error')
  
  -- Bon fiscal
  fiscal_receipt_number VARCHAR(50)
  fiscal_device_id    VARCHAR(50)
  
  notes               TEXT
  internal_notes      TEXT      -- nu apare pe factură
  
  created_at          TIMESTAMP DEFAULT NOW()
  created_by          UUID REFERENCES users(id) NOT NULL
  issued_at           TIMESTAMP
  issued_by           UUID REFERENCES users(id)
}

invoice_lines {
  id                  UUID PRIMARY KEY
  invoice_id          UUID REFERENCES invoices(id) NOT NULL
  line_number         INTEGER NOT NULL
  
  -- Referință serviciu/produs
  price_catalog_id    UUID REFERENCES price_catalog(id)
  procedure_id        UUID REFERENCES procedures(id)
  treatment_line_id   UUID REFERENCES treatment_lines(id)
  
  description         VARCHAR(500) NOT NULL
  quantity            DECIMAL(8,3) NOT NULL
  unit                VARCHAR(30)
  unit_price          DECIMAL(10,2) NOT NULL      -- preț fără TVA
  discount_percent    DECIMAL(5,2) DEFAULT 0
  discount_amount     DECIMAL(10,2) DEFAULT 0
  vat_rate            DECIMAL(5,2) NOT NULL
  vat_amount          DECIMAL(10,2) NOT NULL
  total               DECIMAL(10,2) NOT NULL       -- cu TVA
  
  -- Cost (pentru calcul marjă)
  unit_cost           DECIMAL(10,4)                -- costul real
  
  notes               TEXT
}
```

---

### ENTITATE: `payments` (Plăți / Încasări)

```sql
payments {
  id              UUID PRIMARY KEY
  invoice_id      UUID REFERENCES invoices(id) NOT NULL
  
  payment_type    ENUM('advance','payment','refund') NOT NULL
  payment_method  ENUM('cash','card','bank_transfer','voucher','other') NOT NULL
  
  amount          DECIMAL(12,2) NOT NULL
  currency        CHAR(3) DEFAULT 'RON'
  exchange_rate   DECIMAL(10,6) DEFAULT 1
  
  payment_date    DATE NOT NULL
  reference       VARCHAR(100)          -- număr chitanță / referință tranzacție
  terminal_id     VARCHAR(50)           -- POS terminal (pentru card)
  
  notes           TEXT
  created_at      TIMESTAMP DEFAULT NOW()
  created_by      UUID REFERENCES users(id) NOT NULL
}
```

---

### ENTITATE: `fiscal_documents` (Documente fiscale — bon + facturi)

```sql
fiscal_documents {
  id              UUID PRIMARY KEY
  document_type   ENUM('fiscal_receipt','invoice','storno_invoice','proforma') NOT NULL
  invoice_id      UUID REFERENCES invoices(id)
  payment_id      UUID REFERENCES payments(id)
  
  document_number VARCHAR(50) NOT NULL
  issue_date      TIMESTAMP NOT NULL
  
  -- Bon fiscal
  fiscal_device_id    VARCHAR(50)         -- seria casei de marcat
  fiscal_receipt_no   VARCHAR(30)
  
  -- Stocare
  file_path           TEXT               -- calea fișierului generat (PDF)
  xml_content         TEXT               -- XML UBL pentru e-Factura
  
  created_at          TIMESTAMP DEFAULT NOW()
}
```

---

### ENTITATE: `spv_submissions` (Transmitere ANAF SPV)

**CRITIC:** Jurnalul complet al interacțiunii cu ANAF. Nicio informație nu se șterge.

```sql
spv_submissions {
  id                  UUID PRIMARY KEY
  invoice_id          UUID REFERENCES invoices(id) NOT NULL
  
  -- Identificare
  upload_index        VARCHAR(100) UNIQUE    -- index returnat de ANAF la upload
  
  -- XML
  xml_file_path       TEXT NOT NULL         -- path XML generat
  xml_generated_at    TIMESTAMP NOT NULL
  
  -- Upload
  upload_attempt      INTEGER DEFAULT 0
  uploaded_at         TIMESTAMP
  upload_status       ENUM('pending','in_progress','uploaded','failed') DEFAULT 'pending'
  upload_error        TEXT
  
  -- Status ANAF
  anaf_status         ENUM('not_uploaded','processing','ok','nok','xml_errors','in_validation') DEFAULT 'not_uploaded'
  anaf_status_checked_at TIMESTAMP
  
  -- Răspuns
  response_file_path  TEXT              -- path arhivă ZIP răspuns ANAF
  response_at         TIMESTAMP
  response_message    TEXT
  
  -- Reconciliere
  reconciled          BOOLEAN DEFAULT FALSE
  reconciled_at       TIMESTAMP
  reconciled_by       UUID REFERENCES users(id)
  
  created_at          TIMESTAMP DEFAULT NOW()
  updated_at          TIMESTAMP
}

spv_responses {
  id                  UUID PRIMARY KEY
  submission_id       UUID REFERENCES spv_submissions(id) NOT NULL
  
  response_type       ENUM('status_check','download','error_detail')
  http_status         INTEGER
  response_body       TEXT        -- răspunsul complet JSON/XML de la ANAF
  error_codes         TEXT[]      -- coduri de eroare parsate
  error_messages      TEXT[]
  
  received_at         TIMESTAMP NOT NULL DEFAULT NOW()
}
```

---

### ENTITATE: `audit_logs` (Jurnal de audit)

**CRITIC:** Completă, imutabilă, nu se șterge niciodată.

```sql
audit_logs {
  id              UUID PRIMARY KEY
  table_name      VARCHAR(100) NOT NULL
  record_id       UUID NOT NULL
  action          ENUM('INSERT','UPDATE','DELETE') NOT NULL
  changed_by      UUID REFERENCES users(id) NOT NULL
  changed_at      TIMESTAMP NOT NULL DEFAULT NOW()
  old_values      JSONB        -- valorile înainte de modificare
  new_values      JSONB        -- valorile după modificare
  ip_address      VARCHAR(45)
  user_agent      TEXT
  session_id      VARCHAR(100)
}
```

---

### ENTITATE: `tasks` și `reminders`

```sql
tasks {
  id              UUID PRIMARY KEY
  title           VARCHAR(200) NOT NULL
  description     TEXT
  assigned_to     UUID REFERENCES users(id)
  
  related_type    VARCHAR(50)     -- 'pet', 'consultation', 'invoice', etc.
  related_id      UUID
  
  priority        ENUM('low','medium','high','urgent')
  status          ENUM('pending','in_progress','completed','cancelled')
  due_date        TIMESTAMP
  completed_at    TIMESTAMP
  completed_by    UUID REFERENCES users(id)
  
  created_by      UUID REFERENCES users(id) NOT NULL
  created_at      TIMESTAMP DEFAULT NOW()
}

reminders {
  id              UUID PRIMARY KEY
  pet_id          UUID REFERENCES pets(id)
  owner_id        UUID REFERENCES owners(id) NOT NULL
  
  reminder_type   ENUM('vaccine','deworming','checkup','treatment','birthday','other')
  title           VARCHAR(200) NOT NULL
  message         TEXT
  
  due_date        DATE NOT NULL
  
  send_at         TIMESTAMP
  channel         ENUM('sms','whatsapp','email','push')
  sent            BOOLEAN DEFAULT FALSE
  sent_at         TIMESTAMP
  
  created_at      TIMESTAMP DEFAULT NOW()
}
```

---

### ENTITATE: `hospitalizations` (Internări)

```sql
hospitalizations {
  id                  UUID PRIMARY KEY
  pet_id              UUID REFERENCES pets(id) NOT NULL
  owner_id            UUID REFERENCES owners(id) NOT NULL
  admitting_vet_id    UUID REFERENCES veterinarians(id) NOT NULL
  
  admission_date      TIMESTAMP NOT NULL
  discharge_date      TIMESTAMP
  
  cage_id             UUID REFERENCES cages(id) NOT NULL
  
  reason              TEXT NOT NULL
  admission_condition TEXT
  
  estimated_duration_days INTEGER
  estimated_cost      DECIMAL(12,2)        -- deviz prezentat proprietarului
  consent_signed      BOOLEAN DEFAULT FALSE   -- CRITIC
  consent_signed_at   TIMESTAMP
  
  status              ENUM('admitted','monitoring','pre_op','post_op','discharged','deceased')
  
  discharge_notes     TEXT
  discharge_diagnosis TEXT
  
  invoice_id          UUID REFERENCES invoices(id)   -- factura finală
  
  created_at          TIMESTAMP DEFAULT NOW()
  updated_at          TIMESTAMP
}

-- Observații zilnice în internare
hospitalization_observations {
  id                  UUID PRIMARY KEY
  hospitalization_id  UUID REFERENCES hospitalizations(id) NOT NULL
  recorded_by         UUID REFERENCES users(id) NOT NULL
  recorded_at         TIMESTAMP NOT NULL DEFAULT NOW()
  
  weight_kg           DECIMAL(5,2)
  temperature_c       DECIMAL(4,1)
  heart_rate          INTEGER
  condition_score     INTEGER CHECK (condition_score BETWEEN 1 AND 5)
  notes               TEXT NOT NULL
}
```

---

# D. FLUXURILE OPERAȚIONALE CRITICE

## D.1 Flux: Programare → Consultație → Tratament → Consumabile → Factură → Plată

```
PASUL 1: Programare
─────────────────────────────────────────────────────
Actor: Recepție / Client online
Date generate: appointments record (status='scheduled')
Control CRITIC: Verificare că pacientul nu are alergii înregistrate relevante pentru tipul de consultație

Claude poate: Genera mesaj confirmare personalizat

PASUL 2: Check-in
─────────────────────────────────────────────────────
Actor: Recepție
Date generate: appointments.status = 'checked_in'
Control: Verificare identitate owner + animal
Alertă automată: Dacă owner are restanțe la plată > 0

PASUL 3: Consultație
─────────────────────────────────────────────────────
Actor: Medic veterinar
Date generate: consultations record (status='open')
          + procedures records
          + treatment_lines records
          + stock_movements (consum consumabile)

Control CRITIC: Orice medicament eliberat generează stock_movement automat
Control CRITIC: Alergia la medicament trebuie verificată înainte de prescriere
Claude poate: Sugestii discharge notes, verificare coerență diagnostic-tratament

PASUL 4: Semnare consultație
─────────────────────────────────────────────────────
Actor: Medic veterinar
Date generate: consultations.signed_by + consultations.signed_at
Control CRITIC: Fără semnătură, factura NU poate fi emisă

PASUL 5: Generare factură
─────────────────────────────────────────────────────
Actor: Recepție / Sistem automat
Date generate: invoices record + invoice_lines records
              (pre-populate din procedures + treatment_lines)

Control CRITIC: Verificare că TOATE procedurile și tratamentele din consultație
               sunt incluse în factură (reconciliere automată)
Alertă: Dacă există proceduri/tratamente nebifate în factură

Claude poate: Verificare finală factură — date lipsă, erori, TVA incorect
             Flagging dacă suma facturată este semnificativ sub estimare

PASUL 6: Emitere factură + bon fiscal (dacă cash)
─────────────────────────────────────────────────────
Actor: Recepție
Date generate: invoices.status = 'issued'
             + fiscal_documents record
             + (dacă B2B) spv_submissions.status = 'pending'

Control CRITIC: Bon fiscal doar prin casă de marcat fiscală conectată legal
Control: Dacă client B2B (are CUI), factură trebuie trimisă în SPV

PASUL 7: Încasare
─────────────────────────────────────────────────────
Actor: Recepție
Date generate: payments record
             + invoices.status = 'paid' sau 'partially_paid'
             + invoices.total_paid actualizat

Control: Reconciliere sumă primită vs. sumă totală factură
Alertă: Dacă rămâne sold restant, crează task de urmărire

PASUL 8: Trimitere SPV (dacă B2B)
─────────────────────────────────────────────────────
Actor: Sistem automat (middleware)
(Detalii la secțiunea F)
```

---

## D.2 Flux: Internare → Proceduri Multiple → Externare → Factură Finală

```
PASUL 1: Decizie internare
─────────────────────────────────────────────────────
Actor: Medic veterinar (din consultație sau urgență directă)
Date generate: hospitalizations record (status='admitted')
Control CRITIC: consent_signed = TRUE obligatoriu înainte de internare
Control: Estimare cost prezentată proprietarului și semnată
Alertă: Dacă cusca dorită nu este disponibilă

PASUL 2: Admitere + alocare cușcă
─────────────────────────────────────────────────────
Actor: Recepție / Asistent
Date generate: hospitalization.cage_id setat
             + observație inițială în hospitalization_observations

PASUL 3: Monitorizare zilnică
─────────────────────────────────────────────────────
Actor: Asistent / Medic de gardă
Date generate: hospitalization_observations records (la fiecare verificare)
             + treatment_lines records (fiecare administrare medicament)
             + stock_movements (fiecare medicament extras din stoc)

Control CRITIC: Fiecare administrare medicament = 1 stock_movement
Claude poate: Generare raport stare zilnic pentru proprietar

PASUL 4: Proceduri în internare
─────────────────────────────────────────────────────
Actor: Medic chirurg / specialist
Date generate: procedures records asociate cu hospitalization_id
             + consumabile specifice fiecărei proceduri

PASUL 5: Decizie externare
─────────────────────────────────────────────────────
Actor: Medic curant
Date generate: hospitalizations.discharge_date + discharge_notes

PASUL 6: Generare factură consolidată
─────────────────────────────────────────────────────
Actor: Recepție / Sistem
Date generate: invoices record cu TOATE liniile:
              - Zile internare (hospitalization fee × nr zile)
              - Proceduri efectuate
              - Medicamente administrate
              - Analize/imagistică
              - Materiale chirurgicale (dacă aplicabil)

Control CRITIC: Reconciliere totală — toate treatment_lines + procedures
               cu hospitalization_id trebuie să apară în factură
Claude poate: Verificare completitudine factură vs. registru activitate

Alertă: Dacă totalul facturii depășește estimarea cu >20%, notificare
        pentru verificare manuală înainte de prezentare proprietar

PASUL 7: Externare și plată
─────────────────────────────────────────────────────
(Identic cu D.1, Pașii 6-8)
```

---

## D.3 Flux: Reaprovizionare Stoc → Recepție Marfă → Actualizare Cost → Impact Marjă

```
PASUL 1: Declanșare nevoie aprovizionare
─────────────────────────────────────────────────────
Trigger: Automat când inventory_items.current_stock <= min_stock_level
         SAU manual de la gestionar
Date generate: Task "Aprobare bon de comandă" pentru administrator

PASUL 2: Generare propunere comandă
─────────────────────────────────────────────────────
Actor: Sistem automat + Gestionar
Date generate: purchase_orders record (status='draft')
             + purchase_order_lines cu cantitățile recomandate

Claude poate: Analiză optimă cantitate comandată (bazată pe consum istoric)
             Comparare prețuri dacă există mai mulți furnizori

PASUL 3: Aprobare și trimitere comandă
─────────────────────────────────────────────────────
Actor: Administrator / Manager
Date generate: purchase_orders.status = 'sent'
             + purchase_orders.approved_by setat
Control: Comandă > prag valoric necesită aprobare suplimentară

PASUL 4: Primire livrare și recepție
─────────────────────────────────────────────────────
Actor: Gestionar
Date generate: goods_receipts record
             + goods_receipt_lines (cu lot + expiry_date pentru fiecare linie)
             + stock_movements (tip 'purchase_receipt') pentru fiecare linie

Control CRITIC: Lot și dată expirare OBLIGATORII la recepție
Control: Cantitate primită vs. cantitate comandată (dacă diferite, discrepancy flag)
Control: Prețul de pe factura furnizorului vs. prețul din comandă

PASUL 5: Actualizare cost mediu și impact marjă
─────────────────────────────────────────────────────
Actor: Sistem automat
Date generate:
  - inventory_items.average_cost recalculat (FEFO/FIFO)
  - inventory_items.last_purchase_price actualizat
  - Re-calcul direct_cost_estimate pentru procedure_templates asociate
  
Alertă automată: Dacă costul unui consumabil a crescut cu >10%, 
                 verifică că prețul serviciilor asociate acoperă noile costuri
                 
Claude poate: Raport impact modificare cost — care servicii sunt acum
             sub marja minimă? Propunere ajustare preț.
```

---

## D.4 Flux: Factură Emisă → Pregătire SPV → Trimitere → Status → Reconciliere

```
PASUL 1: Factură emisă și validată
─────────────────────────────────────────────────────
Precondție: invoices.status = 'issued' AND client are CUI (B2B)
Date generate: spv_submissions record (status='pending', upload_status='pending')

CRITIC: Verificare că CUI-ul clientului este valid înainte de generare XML
CRITIC: Numărul și seria facturii sunt unice și conform setărilor fiscale

PASUL 2: Generare XML UBL 2.1 CIUS-RO
─────────────────────────────────────────────────────
Actor: Middleware / Backend specializat (NU Claude)
Date generate: spv_submissions.xml_file_path
             + spv_submissions.xml_generated_at
             
Control: Validare XML față de schema XSD publicată de ANAF
Control: Verificare câmpuri obligatorii (CUI vânzător/cumpărător, TVA, etc.)
Claude poate: Analiză erori de validare și explicare în limbaj uman

PASUL 3: Autentificare și upload la ANAF
─────────────────────────────────────────────────────
Actor: Middleware (cron job / queue processor)
Mecanism: OAuth token cu certificat digital calificat
Date generate: spv_submissions.upload_index (returnat de ANAF)
             + spv_submissions.uploaded_at
             + spv_submissions.upload_status = 'uploaded'

CRITIC: Token-ul OAuth are durată limitată — implementare refresh automat
CRITIC: Dacă upload eșuează, retry cu exponential backoff
CRITIC: Log complet al tuturor cererilor HTTP în spv_responses

PASUL 4: Polling status
─────────────────────────────────────────────────────
Actor: Middleware (cron job la fiecare 15-30 minute)
Endpoint ANAF: GET /FCTEL/rest/stareMesaj?id_incarcare={upload_index}
Date generate: spv_submissions.anaf_status actualizat
             + spv_responses record (fiecare verificare)

Stări posibile ANAF: ok, nok, in prelucrare, erori de validare XML

PASUL 5: Descărcare răspuns (când status = 'ok' sau 'nok')
─────────────────────────────────────────────────────
Actor: Middleware
Endpoint ANAF: GET /FCTEL/rest/descarcare?id_incarcare={upload_index}
Date generate: spv_submissions.response_file_path (arhivă ZIP)
             + spv_responses record cu conținut complet

CRITIC: Arhiva ZIP conține: factura originală + semnătura ANAF
CRITIC: Se arhivează local și NU se șterge (obligație legală 5 ani)

PASUL 6: Tratament erori (dacă status = 'nok')
─────────────────────────────────────────────────────
Actor: Operator + sistem
Date generate: Erori parsate în spv_responses.error_codes[]
             + Task creat automat pentru operator cu descriere eroare
             
Claude poate: Explicare cod eroare ANAF în limbaj uman + sugestie corectare
             "Eroarea F-LG-CODPART-CUI indică că CUI-ul cumpărătorului 
              nu este înregistrat în ANAF. Verificați CUI-ul clientului."

PASUL 7: Reconciliere
─────────────────────────────────────────────────────
Actor: Sistem automat + Contabil
Date generate: spv_submissions.reconciled = TRUE
             + invoices.spv_status = 'accepted'
             
Raport reconciliere: Facturi emise vs. confirmate ANAF
Alertă CRITIC: Facturi cu status 'pending' sau 'error' > 5 zile lucrătoare
```

---

## D.5 Flux: Raport Zilnic Management

```
Trigger: Cron job la 07:30 în fiecare dimineață

COLECTARE DATE (automat):
─────────────────────────────────────────────────────
1. Venituri zi precedentă (total + pe categorii)
2. Număr consultații + internări + intervenții
3. Plăți încasate (cash + card + transfer)
4. Creanțe scadente azi
5. Programări pentru azi (nr. total + disponibilitate)
6. Stoc critic (sub minim)
7. Produse expirate / ce expiră în 7 zile
8. Facturi B2B neîncă trimise în SPV
9. Erori SPV nerezolvate
10. No-show-uri ieri

PROCESARE Claude (opțional, RECOMANDAT):
─────────────────────────────────────────────────────
Input: JSON cu toate datele de mai sus
Output: Rezumat narativ 200-300 cuvinte în română
        + 3-5 puncte de atenție prioritare
        + Comparație față de ziua anterioară / media săptămânii

DISTRIBUȚIE:
─────────────────────────────────────────────────────
- Email la administrator
- WhatsApp/Telegram la manager (rezumat scurt)
- Dashboard actualizat
```

---

## D.6 Flux: Alertă Stoc Minim

```
Trigger: La fiecare stock_movement de tip ieșire
        + Cron zilnic la 08:00

Verificare: inventory_items.current_stock <= min_stock_level

Dacă TRUE:
  1. Creare reminder în sistem
  2. Notificare push/email gestionar
  3. Generare propunere bon de comandă (draft)
  4. Claude poate: calcul cantitate optimă bazat pe consum ultimele 30 zile
     + Lead time furnizor

ESCALADARE:
  - Dacă stoc = 0 și produsul este critic (medicament esențial):
    → Alertă urgentă administrator + medic șef
    → Task prioritar "URGENT: aprovizionare imediată"
```

---

## D.7 Flux: Detectare Servicii Prestate dar Nefacturate

```
CRITIC: Acesta este unul dintre cele mai importante controale financiare.

Trigger: 
  a) La finalizarea fiecărei consultații/internări
  b) Cron job zilnic la 20:00 (scan general)
  c) La cerere din rapoarte

LOGICĂ DETECTARE:
─────────────────────────────────────────────────────
Query 1: Consultații completate (status='completed') fără factură asociată
  → WHERE consultations.billed = FALSE 
    AND consultations.status = 'completed' 
    AND consultations.ended_at < NOW() - INTERVAL '2 hours'

Query 2: Procedures fără linie de factură asociată
  → JOIN procedures cu invoice_lines pe procedure_id
    WHERE invoice_lines.id IS NULL
    AND procedures.is_billable = TRUE

Query 3: Treatment_lines dispensed dar nefacturate
  → WHERE treatment_lines.is_dispensed = TRUE
    AND treatment_lines.is_billable = TRUE
    AND nu există invoice_line cu treatment_line_id

Query 4: Stock_movements de tip 'consultation_use' fără consultație facturată

ACȚIUNI:
─────────────────────────────────────────────────────
- Creare alertă vizibilă în dashboard
- Task asignat recepției / medicului curant
- Claude poate: Estimare valoare pierdută (cantitate × preț catalog)
- Raport săptămânal: "Servicii detectate nefacturate săptămâna trecută: X lei"

Prag alertă: Dacă valoarea detectată > 100 RON, notificare imediată manager
```

---

*Continuare în Partea 2: Strategia de Prețuri (E), Integrarea SPV (F), Automatizări Claude (G), Stack Tehnic (H)*
