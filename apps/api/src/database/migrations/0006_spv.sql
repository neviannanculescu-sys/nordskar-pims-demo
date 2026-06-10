-- Migration: 0006_spv
-- SPV/e-Factura: spv_submissions + spv_responses
-- Reguli de business:
--   • O singură submission activă per factură (index unic parțial)
--   • Răspunsurile SPV sunt append-only — nu se șterg niciodată
--   • upload_index obligatoriu după upload reușit
--   • SECURITY: token OAuth ANAF nu se stochează în DB — env/vault only

-- ============================================================
-- Enum
-- ============================================================

CREATE TYPE spv_submission_status AS ENUM (
  'pending',
  'uploading',
  'uploaded',
  'processing',
  'accepted',
  'rejected',
  'error'
);

-- ============================================================
-- spv_submissions
-- ============================================================

CREATE TABLE spv_submissions (
  id               UUID                  PRIMARY KEY DEFAULT gen_random_uuid(),
  invoice_id       UUID                  NOT NULL REFERENCES invoices(id),
  invoice_number   VARCHAR(30),

  status           spv_submission_status NOT NULL DEFAULT 'pending',
  upload_index     VARCHAR(50),
  download_id      VARCHAR(50),

  xml_content      TEXT                  NOT NULL,
  xml_sha256       VARCHAR(64)           NOT NULL,

  submitted_at     TIMESTAMPTZ,
  submitted_by     UUID                  REFERENCES users(id),
  last_polled_at   TIMESTAMPTZ,
  accepted_at      TIMESTAMPTZ,
  rejected_at      TIMESTAMPTZ,

  error_message    TEXT,
  retry_count      INTEGER               NOT NULL DEFAULT 0,

  created_at       TIMESTAMPTZ           NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMPTZ,

  -- upload_index trebuie să existe odată ce ANAF a confirmat primirea
  CONSTRAINT chk_spv_upload_index CHECK (
    status NOT IN ('uploaded', 'processing', 'accepted', 'rejected')
    OR upload_index IS NOT NULL
  )
);

-- O singură submission activă per factură
-- (permite rejected/error fără a bloca re-submiterea)
CREATE UNIQUE INDEX uq_spv_active_submission
  ON spv_submissions (invoice_id)
  WHERE status IN ('pending', 'uploading', 'uploaded', 'processing', 'accepted');

CREATE INDEX idx_spv_submissions_status ON spv_submissions (status)
  WHERE status IN ('uploaded', 'processing');  -- pentru polling eficient

CREATE INDEX idx_spv_submissions_invoice ON spv_submissions (invoice_id);

-- Alertă pentru facturi neconfirmate > 5 zile:
-- SELECT * FROM spv_submissions
-- WHERE status IN ('uploaded', 'processing')
--   AND submitted_at < NOW() - INTERVAL '5 days';
CREATE INDEX idx_spv_submissions_alert
  ON spv_submissions (submitted_at)
  WHERE status IN ('uploaded', 'processing') AND submitted_at IS NOT NULL;

-- ============================================================
-- spv_responses — append-only
-- ============================================================

CREATE TABLE spv_responses (
  id                UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  submission_id     UUID        NOT NULL REFERENCES spv_submissions(id),
  anaf_status       VARCHAR(30) NOT NULL,
  anaf_message      TEXT,
  error_details     JSONB,
  human_explanation TEXT,
  raw_response_xml  TEXT,
  received_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_spv_responses_submission ON spv_responses (submission_id);

-- Blochează DELETE fizic — răspunsurile SPV sunt audit trail fiscal permanent
CREATE OR REPLACE FUNCTION block_spv_delete_fn()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Physical DELETE on % is not allowed. SPV records are permanent audit trail.', TG_TABLE_NAME;
END;
$$;

CREATE TRIGGER no_delete_spv_responses
  BEFORE DELETE ON spv_responses
  FOR EACH ROW EXECUTE FUNCTION block_spv_delete_fn();

-- ============================================================
-- Audit triggers
-- ============================================================

CREATE TRIGGER audit_spv_submissions
  AFTER INSERT OR UPDATE ON spv_submissions
  FOR EACH ROW EXECUTE FUNCTION audit_trigger_fn();
