-- Migration 0003: procedures + treatment_lines
-- Forward-only. Never run drizzle-kit push in staging/prod.

-- ---------------------------------------------------------------------------
-- Enum: treatment_route
-- ---------------------------------------------------------------------------
CREATE TYPE treatment_route AS ENUM (
  'oral', 'iv', 'im', 'sc', 'topical', 'ophthalmic', 'other'
);

-- ---------------------------------------------------------------------------
-- Table: procedures
-- ---------------------------------------------------------------------------
CREATE TABLE procedures (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  consultation_id       UUID NOT NULL REFERENCES consultations(id),
  procedure_template_id UUID,                         -- FK to procedure_templates (Phase 2)
  veterinarian_id       UUID NOT NULL REFERENCES veterinarians(id),
  performed_at          TIMESTAMPTZ NOT NULL,
  name                  VARCHAR(200) NOT NULL,
  description           TEXT,
  quantity              NUMERIC(8,2)  NOT NULL DEFAULT 1,
  unit                  VARCHAR(50),
  unit_price            NUMERIC(10,2) NOT NULL,
  total_price           NUMERIC(10,2) GENERATED ALWAYS AS (quantity * unit_price) STORED,
  cost_direct           NUMERIC(10,2),
  is_billable           BOOLEAN NOT NULL DEFAULT TRUE,
  notes                 TEXT,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at            TIMESTAMPTZ,
  deleted_at            TIMESTAMPTZ,

  CONSTRAINT procedures_quantity_positive   CHECK (quantity   > 0),
  CONSTRAINT procedures_unit_price_positive CHECK (unit_price >= 0)
);

CREATE INDEX idx_procedures_consultation ON procedures(consultation_id) WHERE deleted_at IS NULL;
CREATE INDEX idx_procedures_vet          ON procedures(veterinarian_id) WHERE deleted_at IS NULL;
CREATE INDEX idx_procedures_performed_at ON procedures(performed_at)    WHERE deleted_at IS NULL;

-- Audit trigger (reuses existing audit_trigger_fn from 0001)
CREATE TRIGGER audit_procedures
  AFTER INSERT OR UPDATE OR DELETE ON procedures
  FOR EACH ROW EXECUTE FUNCTION audit_trigger_fn();

-- ---------------------------------------------------------------------------
-- Table: treatment_lines
-- ---------------------------------------------------------------------------
CREATE TABLE treatment_lines (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  consultation_id     UUID NOT NULL REFERENCES consultations(id),
  inventory_item_id   UUID,                           -- FK to inventory_items (Phase 2)
  prescribed_by       UUID NOT NULL REFERENCES veterinarians(id),
  administered_by     UUID REFERENCES users(id),

  -- Prescription
  product_name        VARCHAR(200) NOT NULL,
  dose                VARCHAR(100) NOT NULL,
  frequency           VARCHAR(100),
  route               treatment_route,
  duration_days       INTEGER,
  start_date          DATE,
  end_date            DATE,

  -- Dispensing
  quantity_dispensed  NUMERIC(8,3),
  quantity_unit       VARCHAR(30),

  -- Traceability
  lot_number          VARCHAR(50),
  expiry_date         DATE,

  -- Pricing snapshot
  unit_cost           NUMERIC(10,2),
  unit_price          NUMERIC(10,2),

  is_billable         BOOLEAN NOT NULL DEFAULT TRUE,
  is_dispensed        BOOLEAN NOT NULL DEFAULT FALSE,

  administered_at     TIMESTAMPTZ,
  notes               TEXT,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ,
  deleted_at          TIMESTAMPTZ,

  CONSTRAINT treatment_lines_qty_positive        CHECK (quantity_dispensed IS NULL OR quantity_dispensed > 0),
  CONSTRAINT treatment_lines_unit_price_positive CHECK (unit_price IS NULL OR unit_price >= 0),
  CONSTRAINT treatment_lines_date_order          CHECK (end_date IS NULL OR start_date IS NULL OR end_date >= start_date)
);

CREATE INDEX idx_tl_consultation ON treatment_lines(consultation_id) WHERE deleted_at IS NULL;
CREATE INDEX idx_tl_prescribed   ON treatment_lines(prescribed_by)   WHERE deleted_at IS NULL;
-- Partial index to quickly find undispensed lines for stock processing (Phase 2)
CREATE INDEX idx_tl_undispensed  ON treatment_lines(consultation_id) WHERE is_dispensed = FALSE AND deleted_at IS NULL;

-- Audit trigger
CREATE TRIGGER audit_treatment_lines
  AFTER INSERT OR UPDATE OR DELETE ON treatment_lines
  FOR EACH ROW EXECUTE FUNCTION audit_trigger_fn();
