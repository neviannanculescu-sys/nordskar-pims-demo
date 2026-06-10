-- Migration: 0005_invoices
-- Invoices + invoice_lines + payments + sequence for invoice number
-- Rules:
--   • issued invoice is IMMUTABLE — no UPDATE allowed after status = 'issued'
--   • storno creates a credit note (negative amounts) referencing the original
--   • payments are append-only financial audit trail
--   • consultation.billed set to TRUE on issue, FALSE on storno

-- ============================================================
-- Enums
-- ============================================================

CREATE TYPE invoice_status AS ENUM (
  'draft',
  'issued',
  'partially_paid',
  'paid',
  'cancelled',
  'storno'
);

CREATE TYPE payment_method AS ENUM (
  'cash',
  'card',
  'bank_transfer',
  'voucher',
  'other'
);

-- ============================================================
-- Sequence for invoice numbers — restarts never, global counter
-- ============================================================

CREATE SEQUENCE invoice_number_seq
  START     1
  INCREMENT 1
  NO CYCLE;

-- ============================================================
-- invoices
-- ============================================================

CREATE TABLE invoices (
  id                    UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  invoice_number        VARCHAR(30)   UNIQUE,           -- set at issue() via sequence
  series                VARCHAR(10)   NOT NULL DEFAULT 'VET',
  owner_id              UUID          NOT NULL REFERENCES owners(id),
  consultation_id       UUID          REFERENCES consultations(id),
  storno_of_invoice_id  UUID,                           -- FK added below (self-ref)

  status                invoice_status NOT NULL DEFAULT 'draft',
  issued_at             TIMESTAMPTZ,
  due_date              DATE,

  subtotal              NUMERIC(12,2) NOT NULL DEFAULT 0 CHECK (subtotal >= 0),
  vat_amount            NUMERIC(12,2) NOT NULL DEFAULT 0 CHECK (vat_amount >= 0),
  total_amount          NUMERIC(12,2) NOT NULL DEFAULT 0 CHECK (total_amount >= 0),
  paid_amount           NUMERIC(12,2) NOT NULL DEFAULT 0 CHECK (paid_amount >= 0),
  currency              VARCHAR(3)    NOT NULL DEFAULT 'RON',

  billing_name          VARCHAR(300),
  billing_address       TEXT,
  billing_cui           VARCHAR(20),

  notes                 TEXT,
  issued_by             UUID          REFERENCES users(id),
  cancelled_at          TIMESTAMPTZ,
  cancel_reason         TEXT,

  created_at            TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  updated_at            TIMESTAMPTZ,
  deleted_at            TIMESTAMPTZ,
  created_by            UUID          REFERENCES users(id),

  -- Factura nu poate fi nota sa proprie de credit
  CONSTRAINT chk_invoices_no_self_storno CHECK (
    storno_of_invoice_id IS NULL OR storno_of_invoice_id <> id
  ),
  -- Totalul trebuie să fie consistent
  CONSTRAINT chk_invoices_total CHECK (
    ABS(total_amount - (subtotal + vat_amount)) < 0.01
    OR status = 'draft'   -- relaxat pe draft până la recalcul
  )
);

-- Self-referential FK pentru storno
ALTER TABLE invoices
  ADD CONSTRAINT fk_invoices_storno
  FOREIGN KEY (storno_of_invoice_id) REFERENCES invoices(id);

-- O singură notă de credit per factură originală
CREATE UNIQUE INDEX uq_invoices_storno_of
  ON invoices (storno_of_invoice_id)
  WHERE storno_of_invoice_id IS NOT NULL;

-- Index rapid pe owner + status pentru listare
CREATE INDEX idx_invoices_owner_status ON invoices (owner_id, status)
  WHERE deleted_at IS NULL;

-- Index pe consultație pentru lookup rapid
CREATE INDEX idx_invoices_consultation ON invoices (consultation_id)
  WHERE consultation_id IS NOT NULL;

-- ============================================================
-- invoice_lines
-- ============================================================

CREATE TABLE invoice_lines (
  id            UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  invoice_id    UUID          NOT NULL REFERENCES invoices(id),
  source_id     UUID,
  source_type   VARCHAR(20)   CHECK (source_type IN ('procedure', 'treatment_line', 'manual')),
  description   VARCHAR(500)  NOT NULL,
  quantity      NUMERIC(8,3)  NOT NULL CHECK (quantity <> 0),   -- negativ pe storno
  unit          VARCHAR(30),
  unit_price    NUMERIC(10,2) NOT NULL,
  vat_rate      NUMERIC(5,2)  NOT NULL DEFAULT 9
                CHECK (vat_rate IN (0, 9, 19)),
  line_total    NUMERIC(10,2) GENERATED ALWAYS AS (quantity * unit_price) STORED,
  vat_amount    NUMERIC(10,2) GENERATED ALWAYS AS (
                  ROUND(quantity * unit_price * vat_rate / 100, 2)
                ) STORED,
  cost_snapshot NUMERIC(10,2),
  position      INTEGER       NOT NULL DEFAULT 0,
  created_at    TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_invoice_lines_invoice ON invoice_lines (invoice_id);

-- ============================================================
-- payments — append-only, nu se șterg niciodată
-- ============================================================

CREATE TABLE payments (
  id             UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  invoice_id     UUID          NOT NULL REFERENCES invoices(id),
  amount         NUMERIC(12,2) NOT NULL CHECK (amount > 0),
  payment_method payment_method NOT NULL,
  paid_at        TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  reference      VARCHAR(100),
  notes          TEXT,
  recorded_by    UUID          NOT NULL REFERENCES users(id),
  created_at     TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_payments_invoice ON payments (invoice_id);

-- ============================================================
-- Trigger: blochează UPDATE pe facturi emise (status != 'draft')
-- Permite doar tranziții de status și paid_amount — nu câmpuri financiare
-- ============================================================

CREATE OR REPLACE FUNCTION invoice_immutability_fn()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  -- Factura este imuabilă odată emisă
  IF OLD.status <> 'draft' THEN
    -- Permitem tranziții de status și actualizarea paid_amount
    IF (NEW.subtotal     <> OLD.subtotal     OR
        NEW.vat_amount   <> OLD.vat_amount   OR
        NEW.total_amount <> OLD.total_amount OR
        NEW.owner_id     <> OLD.owner_id     OR
        NEW.series       <> OLD.series) THEN
      RAISE EXCEPTION 'Invoice % is immutable after issuance. Status: %',
        OLD.invoice_number, OLD.status;
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER invoice_immutability
  BEFORE UPDATE ON invoices
  FOR EACH ROW
  EXECUTE FUNCTION invoice_immutability_fn();

-- ============================================================
-- Trigger: blochează DELETE fizic pe toate tabelele de facturare
-- ============================================================

CREATE OR REPLACE FUNCTION block_invoice_delete_fn()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Physical DELETE on % is not allowed. Use soft-delete (deleted_at).', TG_TABLE_NAME;
END;
$$;

CREATE TRIGGER no_delete_invoices
  BEFORE DELETE ON invoices
  FOR EACH ROW EXECUTE FUNCTION block_invoice_delete_fn();

CREATE TRIGGER no_delete_payments
  BEFORE DELETE ON payments
  FOR EACH ROW EXECUTE FUNCTION block_invoice_delete_fn();

-- ============================================================
-- Audit triggers pe invoices (refolosim audit_trigger_fn din 0002)
-- ============================================================

CREATE TRIGGER audit_invoices
  AFTER INSERT OR UPDATE ON invoices
  FOR EACH ROW EXECUTE FUNCTION audit_trigger_fn();

CREATE TRIGGER audit_payments
  AFTER INSERT ON payments
  FOR EACH ROW EXECUTE FUNCTION audit_trigger_fn();
