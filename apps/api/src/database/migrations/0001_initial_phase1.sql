-- =============================================================================
-- Migrare: 0001_initial_phase1.sql
-- Descriere: Schema inițială Faza 1 — Baza Operațională
-- Entități: users, species, rooms, owners, breeds, veterinarians,
--           pets, appointments, consultations, audit_logs
-- Regulă: Migrare forward-only. Nu modifica acest fișier — creează 0002_*.sql
-- =============================================================================

-- ---------------------------------------------------------------------------
-- TIPURI ENUM
-- ---------------------------------------------------------------------------

CREATE TYPE user_role AS ENUM (
  'admin',
  'vet_doctor',
  'assistant',
  'receptionist',
  'accountant',
  'it_admin'
);

CREATE TYPE owner_type AS ENUM ('individual', 'company');

CREATE TYPE preferred_channel AS ENUM ('phone', 'email', 'whatsapp', 'sms');

CREATE TYPE pet_gender AS ENUM ('male', 'female', 'unknown');

CREATE TYPE room_type AS ENUM (
  'consultation',
  'surgery',
  'hospitalization',
  'lab',
  'imaging',
  'other'
);

CREATE TYPE appointment_type AS ENUM (
  'routine',
  'emergency',
  'followup',
  'surgery',
  'hospitalization',
  'vaccination',
  'other'
);

CREATE TYPE appointment_status AS ENUM (
  'scheduled',
  'confirmed',
  'checked_in',
  'in_progress',
  'completed',
  'no_show',
  'cancelled'
);

CREATE TYPE appointment_source AS ENUM (
  'phone',
  'online',
  'walkin',
  'whatsapp',
  'internal'
);

CREATE TYPE consultation_type AS ENUM (
  'routine',
  'emergency',
  'followup',
  'second_opinion',
  'teleconsultation'
);

CREATE TYPE consultation_status AS ENUM ('open', 'completed', 'cancelled');

CREATE TYPE consultation_prognosis AS ENUM ('good', 'guarded', 'poor', 'unknown');

-- Valori uppercase: PostgreSQL TG_OP returnează 'INSERT'/'UPDATE'/'DELETE'
CREATE TYPE audit_action AS ENUM ('INSERT', 'UPDATE', 'DELETE');

-- ---------------------------------------------------------------------------
-- TABELE (ordine: dependențe înainte de referinți)
-- ---------------------------------------------------------------------------

-- ---- 1. users ---------------------------------------------------------------
CREATE TABLE users (
  id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  email         VARCHAR(150) NOT NULL UNIQUE,
  password_hash TEXT        NOT NULL,
  role          user_role   NOT NULL,
  first_name    VARCHAR(100) NOT NULL,
  last_name     VARCHAR(100) NOT NULL,
  phone         VARCHAR(20),
  is_active     BOOLEAN     NOT NULL DEFAULT TRUE,
  last_login_at TIMESTAMPTZ,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ,
  deleted_at    TIMESTAMPTZ
);

-- ---- 2. species -------------------------------------------------------------
CREATE TABLE species (
  id        UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  name_ro   VARCHAR(100) NOT NULL,
  name_en   VARCHAR(100),
  is_active BOOLEAN     NOT NULL DEFAULT TRUE
);

-- ---- 3. rooms ---------------------------------------------------------------
CREATE TABLE rooms (
  id         UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  name       VARCHAR(100) NOT NULL UNIQUE,
  room_type  room_type   NOT NULL DEFAULT 'consultation',
  floor      VARCHAR(20),
  notes      TEXT,
  is_active  BOOLEAN     NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ---- 4. owners --------------------------------------------------------------
CREATE TABLE owners (
  id                UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  type              owner_type   NOT NULL,

  -- Persoană fizică
  first_name        VARCHAR(100),
  last_name         VARCHAR(100),
  cnp               VARCHAR(13),

  -- Persoană juridică
  company_name      VARCHAR(200),
  cui               VARCHAR(20),
  vat_payer         BOOLEAN      NOT NULL DEFAULT FALSE,

  -- Adresă
  address_street    VARCHAR(200),
  address_city      VARCHAR(100),
  address_county    VARCHAR(100),
  address_zip       VARCHAR(10),
  address_country   VARCHAR(50)  NOT NULL DEFAULT 'RO',

  -- Contact
  phone_primary     VARCHAR(20)  NOT NULL,
  phone_secondary   VARCHAR(20),
  email             VARCHAR(150),
  whatsapp          VARCHAR(20),
  preferred_channel preferred_channel,

  -- GDPR: stocare date personale necesită consimțământ explicit
  gdpr_consent      BOOLEAN      NOT NULL DEFAULT FALSE,
  gdpr_consent_date TIMESTAMPTZ,

  notes             TEXT,
  is_active         BOOLEAN      NOT NULL DEFAULT TRUE,
  created_at        TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ,
  deleted_at        TIMESTAMPTZ,
  created_by        UUID         REFERENCES users(id)
);

-- Validări business pe owners
-- Persoana fizică: first_name și last_name obligatorii
ALTER TABLE owners ADD CONSTRAINT chk_owners_individual_fields
  CHECK (type <> 'individual' OR (first_name IS NOT NULL AND last_name IS NOT NULL));

-- Persoana juridică: company_name și cui obligatorii
ALTER TABLE owners ADD CONSTRAINT chk_owners_company_fields
  CHECK (type <> 'company' OR (company_name IS NOT NULL AND cui IS NOT NULL));

-- CNP: dacă prezent, trebuie să aibă exact 13 caractere
-- Validarea algoritmică completă rămâne la nivel aplicație
ALTER TABLE owners ADD CONSTRAINT chk_owners_cnp_length
  CHECK (cnp IS NULL OR LENGTH(cnp) = 13);

-- ---- 5. breeds --------------------------------------------------------------
CREATE TABLE breeds (
  id         UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  species_id UUID        NOT NULL REFERENCES species(id),
  name       VARCHAR(150) NOT NULL,
  is_active  BOOLEAN     NOT NULL DEFAULT TRUE,
  CONSTRAINT uq_breeds_species_name UNIQUE (species_id, name)
);

-- ---- 6. veterinarians -------------------------------------------------------
CREATE TABLE veterinarians (
  id                  UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id             UUID        NOT NULL UNIQUE REFERENCES users(id),
  first_name          VARCHAR(100) NOT NULL,
  last_name           VARCHAR(100) NOT NULL,
  -- Număr parafă CMVRO — unic la nivel național
  license_number      VARCHAR(50)  NOT NULL UNIQUE,
  specializations     TEXT[],
  is_surgeon          BOOLEAN     NOT NULL DEFAULT FALSE,
  is_available        BOOLEAN     NOT NULL DEFAULT TRUE,
  consultation_rate   NUMERIC(8,2),
  -- Culoare hex #RRGGBB pentru calendar vizual
  color_in_calendar   VARCHAR(7),
  signature_image_url TEXT,
  notes               TEXT,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at          TIMESTAMPTZ
);

-- Format culoare hex #RRGGBB (case-insensitive)
ALTER TABLE veterinarians ADD CONSTRAINT chk_vet_color_format
  CHECK (color_in_calendar IS NULL OR color_in_calendar ~ '^#[0-9A-Fa-f]{6}$');

-- ---- 7. pets ----------------------------------------------------------------
CREATE TABLE pets (
  id                UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id          UUID        NOT NULL REFERENCES owners(id),
  name              VARCHAR(100) NOT NULL,
  species_id        UUID        NOT NULL REFERENCES species(id),
  breed_id          UUID        REFERENCES breeds(id),
  gender            pet_gender  NOT NULL,
  is_neutered       BOOLEAN,
  date_of_birth     DATE,
  -- Câmp alternativ când data exactă nu este cunoscută
  approximate_age   VARCHAR(50),
  color             VARCHAR(100),
  markings          TEXT,
  -- Număr microcip — unic global
  chip_number       VARCHAR(50) UNIQUE,
  tattoo            VARCHAR(50),
  passport_number   VARCHAR(50),
  -- Ultima greutate înregistrată
  weight_kg         NUMERIC(5,2),
  photo_url         TEXT,
  is_deceased       BOOLEAN     NOT NULL DEFAULT FALSE,
  deceased_date     DATE,
  notes             TEXT,
  -- CRITIC: alergii — câmp vizibil prominent în UI, verificat la orice prescriere
  allergies         TEXT,
  chronic_conditions TEXT,
  is_active         BOOLEAN     NOT NULL DEFAULT TRUE,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ,
  deleted_at        TIMESTAMPTZ
);

-- Dacă animalul este decedat, data decesului trebuie completată
ALTER TABLE pets ADD CONSTRAINT chk_pets_deceased_consistency
  CHECK (NOT is_deceased OR deceased_date IS NOT NULL);

-- Greutatea, dacă prezentă, trebuie să fie pozitivă
ALTER TABLE pets ADD CONSTRAINT chk_pets_weight_positive
  CHECK (weight_kg IS NULL OR weight_kg > 0);

-- ---- 8. appointments --------------------------------------------------------
CREATE TABLE appointments (
  id               UUID               PRIMARY KEY DEFAULT gen_random_uuid(),
  pet_id           UUID               NOT NULL REFERENCES pets(id),
  owner_id         UUID               NOT NULL REFERENCES owners(id),
  -- Nullable: medicul poate fi alocat la check-in, nu neapărat la creare
  veterinarian_id  UUID               REFERENCES veterinarians(id),
  room_id          UUID               REFERENCES rooms(id),
  scheduled_at     TIMESTAMPTZ        NOT NULL,
  duration_min     INTEGER            NOT NULL DEFAULT 30,
  type             appointment_type   NOT NULL,
  status           appointment_status NOT NULL DEFAULT 'scheduled',
  reason           TEXT               NOT NULL,
  notes            TEXT,
  source           appointment_source,
  reminder_sent_24h BOOLEAN           NOT NULL DEFAULT FALSE,
  reminder_sent_2h  BOOLEAN           NOT NULL DEFAULT FALSE,
  created_at       TIMESTAMPTZ        NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMPTZ,
  deleted_at       TIMESTAMPTZ,
  created_by       UUID               REFERENCES users(id)
);

ALTER TABLE appointments ADD CONSTRAINT chk_appointments_duration_positive
  CHECK (duration_min > 0);

-- ---- 9. consultations -------------------------------------------------------
CREATE TABLE consultations (
  id                  UUID                   PRIMARY KEY DEFAULT gen_random_uuid(),
  -- Nullable: consultație walk-in fără programare prealabilă
  appointment_id      UUID                   REFERENCES appointments(id),
  pet_id              UUID                   NOT NULL REFERENCES pets(id),
  owner_id            UUID                   NOT NULL REFERENCES owners(id),
  veterinarian_id     UUID                   NOT NULL REFERENCES veterinarians(id),
  consultation_date   TIMESTAMPTZ            NOT NULL,
  type                consultation_type      NOT NULL,

  -- Anamnesis
  chief_complaint     TEXT                   NOT NULL,
  history             TEXT,

  -- Examen clinic
  weight_kg           NUMERIC(5,2),
  temperature_c       NUMERIC(4,1),
  heart_rate          INTEGER,
  respiratory_rate    INTEGER,
  clinical_findings   TEXT,

  -- Diagnostic
  diagnosis_primary   TEXT                   NOT NULL,
  diagnosis_secondary TEXT,
  prognosis           consultation_prognosis,

  -- Plan și discharge
  treatment_plan      TEXT,
  discharge_notes     TEXT,
  follow_up_date      DATE,
  follow_up_notes     TEXT,

  -- Status și facturare
  status              consultation_status    NOT NULL DEFAULT 'open',
  -- CRITIC: factură emisă DOAR când billed = FALSE și signed_by IS NOT NULL
  billed              BOOLEAN                NOT NULL DEFAULT FALSE,
  -- invoice_id va fi adăugat în migrarea 0002 (Faza 2, după crearea tabelului invoices)

  -- Durată
  started_at          TIMESTAMPTZ,
  ended_at            TIMESTAMPTZ,
  -- Coloană calculată automat de PostgreSQL — nu poate fi scrisă direct
  duration_minutes    INTEGER GENERATED ALWAYS AS (
    FLOOR(EXTRACT(EPOCH FROM (ended_at - started_at)) / 60)
  ) STORED,

  created_at          TIMESTAMPTZ            NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ,
  deleted_at          TIMESTAMPTZ,

  -- Semnătura digitală a medicului — OBLIGATORIE înainte de emiterea facturii
  signed_by           UUID                   REFERENCES veterinarians(id),
  signed_at           TIMESTAMPTZ
);

-- Nu poate exista dată de semnare fără medicul care a semnat
ALTER TABLE consultations ADD CONSTRAINT chk_consultations_signed_consistency
  CHECK (signed_at IS NULL OR signed_by IS NOT NULL);

-- Timpul de final nu poate precede timpul de start
ALTER TABLE consultations ADD CONSTRAINT chk_consultations_time_order
  CHECK (
    ended_at IS NULL
    OR started_at IS NULL
    OR ended_at >= started_at
  );

-- Semne vitale: valori pozitive dacă prezente
ALTER TABLE consultations ADD CONSTRAINT chk_consultations_heart_rate_positive
  CHECK (heart_rate IS NULL OR heart_rate > 0);

ALTER TABLE consultations ADD CONSTRAINT chk_consultations_resp_rate_positive
  CHECK (respiratory_rate IS NULL OR respiratory_rate > 0);

ALTER TABLE consultations ADD CONSTRAINT chk_consultations_weight_positive
  CHECK (weight_kg IS NULL OR weight_kg > 0);

-- ---- 10. audit_logs ---------------------------------------------------------
-- CRITIC: Tabel IMUTABIL. DELETE și UPDATE sunt interzise prin politică de aplicație.
-- Nu adăuga deleted_at sau soft-delete pe acest tabel.
CREATE TABLE audit_logs (
  id          UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  table_name  VARCHAR(100) NOT NULL,
  record_id   UUID         NOT NULL,
  action      audit_action NOT NULL,
  -- Nullable la nivel DB: triggerul folosește current_setting care poate fi NULL
  -- Aplicația TREBUIE să seteze SET LOCAL app.current_user_id = '...' înainte de orice query
  changed_by  UUID         REFERENCES users(id),
  changed_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  -- updated_at și password_hash sunt excluse din audit pentru a nu umfla logul
  old_values  JSONB,
  new_values  JSONB,
  ip_address  VARCHAR(45),
  user_agent  TEXT,
  session_id  VARCHAR(100)
);

-- ---------------------------------------------------------------------------
-- INDEXURI
-- ---------------------------------------------------------------------------

-- users
CREATE INDEX idx_users_role       ON users(role);
CREATE INDEX idx_users_is_active  ON users(is_active) WHERE is_active = TRUE;
CREATE INDEX idx_users_deleted_at ON users(deleted_at) WHERE deleted_at IS NULL;

-- owners
CREATE INDEX idx_owners_phone_primary ON owners(phone_primary);
CREATE INDEX idx_owners_email        ON owners(email) WHERE email IS NOT NULL;
CREATE INDEX idx_owners_cnp          ON owners(cnp) WHERE cnp IS NOT NULL;
CREATE INDEX idx_owners_cui          ON owners(cui) WHERE cui IS NOT NULL;
CREATE INDEX idx_owners_type         ON owners(type);
CREATE INDEX idx_owners_deleted_at   ON owners(deleted_at) WHERE deleted_at IS NULL;
CREATE INDEX idx_owners_created_by   ON owners(created_by) WHERE created_by IS NOT NULL;

-- species (tabel mic de referință — index suplimentar nu e necesar)

-- breeds
CREATE INDEX idx_breeds_species_id ON breeds(species_id);

-- veterinarians
CREATE INDEX idx_vets_user_id        ON veterinarians(user_id);
CREATE INDEX idx_vets_is_available   ON veterinarians(is_available) WHERE is_available = TRUE;
CREATE INDEX idx_vets_deleted_at     ON veterinarians(deleted_at) WHERE deleted_at IS NULL;

-- pets
CREATE INDEX idx_pets_owner_id    ON pets(owner_id);
CREATE INDEX idx_pets_species_id  ON pets(species_id);
CREATE INDEX idx_pets_breed_id    ON pets(breed_id) WHERE breed_id IS NOT NULL;
CREATE INDEX idx_pets_is_active   ON pets(is_active) WHERE is_active = TRUE;
CREATE INDEX idx_pets_deleted_at  ON pets(deleted_at) WHERE deleted_at IS NULL;

-- rooms (tabel mic de configurare — index suplimentar nu e necesar)

-- appointments
CREATE INDEX idx_appt_pet_id        ON appointments(pet_id);
CREATE INDEX idx_appt_owner_id      ON appointments(owner_id);
CREATE INDEX idx_appt_vet_id        ON appointments(veterinarian_id) WHERE veterinarian_id IS NOT NULL;
CREATE INDEX idx_appt_scheduled_at  ON appointments(scheduled_at);
-- Index compus pentru calendar: programările unui medic în ordine cronologică
CREATE INDEX idx_appt_vet_schedule  ON appointments(veterinarian_id, scheduled_at)
  WHERE deleted_at IS NULL;
CREATE INDEX idx_appt_status        ON appointments(status) WHERE deleted_at IS NULL;
CREATE INDEX idx_appt_deleted_at    ON appointments(deleted_at) WHERE deleted_at IS NULL;

-- consultations
CREATE INDEX idx_cons_pet_id         ON consultations(pet_id);
CREATE INDEX idx_cons_owner_id       ON consultations(owner_id);
CREATE INDEX idx_cons_vet_id         ON consultations(veterinarian_id);
CREATE INDEX idx_cons_date           ON consultations(consultation_date);
CREATE INDEX idx_cons_status         ON consultations(status);
-- Index critic pentru detectarea consultațiilor nefacturate (KPI-11 din blueprint)
CREATE INDEX idx_cons_unbilled       ON consultations(billed, status)
  WHERE billed = FALSE AND deleted_at IS NULL;
CREATE INDEX idx_cons_signed_by      ON consultations(signed_by) WHERE signed_by IS NOT NULL;
CREATE INDEX idx_cons_deleted_at     ON consultations(deleted_at) WHERE deleted_at IS NULL;

-- audit_logs
CREATE INDEX idx_audit_table_record ON audit_logs(table_name, record_id);
CREATE INDEX idx_audit_changed_by   ON audit_logs(changed_by) WHERE changed_by IS NOT NULL;
CREATE INDEX idx_audit_changed_at   ON audit_logs(changed_at);
CREATE INDEX idx_audit_action       ON audit_logs(action);

-- ---------------------------------------------------------------------------
-- FUNCȚIE TRIGGER AUDIT (template din CLAUDE.md)
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION audit_trigger_fn()
RETURNS trigger AS $$
BEGIN
  INSERT INTO audit_logs (
    table_name,
    record_id,
    action,
    changed_by,
    old_values,
    new_values,
    ip_address,
    user_agent,
    session_id
  ) VALUES (
    TG_TABLE_NAME,
    COALESCE(NEW.id, OLD.id),
    TG_OP::audit_action,
    -- NULLIF: dacă setarea nu există sau este goală, changed_by devine NULL
    -- Aplicația TREBUIE să seteze app.current_user_id; absența sa va lăsa changed_by NULL
    NULLIF(current_setting('app.current_user_id', TRUE), '')::uuid,
    CASE WHEN TG_OP = 'INSERT' THEN NULL ELSE row_to_json(OLD)::jsonb END,
    CASE WHEN TG_OP = 'DELETE' THEN NULL ELSE row_to_json(NEW)::jsonb END,
    current_setting('app.current_ip',           TRUE),
    current_setting('app.current_user_agent',   TRUE),
    current_setting('app.current_session',      TRUE)
  );
  RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql;

-- ---------------------------------------------------------------------------
-- TRIGGERE AUDIT — AUDIT_TABLES din CLAUDE.md (subset Faza 1)
-- ---------------------------------------------------------------------------

CREATE TRIGGER audit_users
  AFTER INSERT OR UPDATE OR DELETE ON users
  FOR EACH ROW EXECUTE FUNCTION audit_trigger_fn();

CREATE TRIGGER audit_owners
  AFTER INSERT OR UPDATE OR DELETE ON owners
  FOR EACH ROW EXECUTE FUNCTION audit_trigger_fn();

CREATE TRIGGER audit_pets
  AFTER INSERT OR UPDATE OR DELETE ON pets
  FOR EACH ROW EXECUTE FUNCTION audit_trigger_fn();

CREATE TRIGGER audit_consultations
  AFTER INSERT OR UPDATE OR DELETE ON consultations
  FOR EACH ROW EXECUTE FUNCTION audit_trigger_fn();

-- Acces la credențiale medic este sensibil (parafă, disponibilitate, semnătură)
CREATE TRIGGER audit_veterinarians
  AFTER INSERT OR UPDATE OR DELETE ON veterinarians
  FOR EACH ROW EXECUTE FUNCTION audit_trigger_fn();
