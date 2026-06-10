-- =============================================================================
-- 0007_anomalies: Engine detectare anomalii operaționale (G-05)
-- =============================================================================
-- Tabel append-friendly: INSERT upsert pe fingerprint.
-- Ack / Resolve se fac PATCH-like (UPDATE status / acked_by / resolved_by).
-- Nu se șterg niciodată rândurile (soft: status=resolved).
-- =============================================================================

CREATE TABLE IF NOT EXISTS anomalies (
  id                  UUID          PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Identificare unică în ziua curentă (evită duplicate la re-run)
  -- Format: <type>:<range_key>:<date>:<related_entity_id|'global'>
  fingerprint         VARCHAR(200)  NOT NULL,

  -- Clasificare
  type                VARCHAR(60)   NOT NULL,
  title               VARCHAR(200)  NOT NULL,
  description         TEXT          NOT NULL,
  source_module       VARCHAR(50)   NOT NULL
                        CHECK (source_module IN ('financial','operational','inventory','spv','audit')),
  severity            VARCHAR(20)   NOT NULL
                        CHECK (severity IN ('info','warning','critical')),

  -- Metrici
  metric_value        NUMERIC(14,4),
  baseline_value      NUMERIC(14,4),
  threshold           NUMERIC(14,4),

  -- Entitate sursă
  related_entity_type VARCHAR(50),
  related_entity_id   UUID,

  -- Acțiune sugerată
  suggested_action    TEXT,

  -- Stare workflow
  status              VARCHAR(20)   NOT NULL DEFAULT 'open'
                        CHECK (status IN ('open','ack','resolved')),
  acked_at            TIMESTAMPTZ,
  acked_by            UUID          REFERENCES users(id),
  resolved_at         TIMESTAMPTZ,
  resolved_by         UUID          REFERENCES users(id),

  -- Perioada analizată (today | 7d | 30d)
  range_key           VARCHAR(10)   NOT NULL DEFAULT 'today',

  detected_at         TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  created_at          TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX idx_anomalies_fingerprint ON anomalies (fingerprint);
CREATE INDEX idx_anomalies_status             ON anomalies (status);
CREATE INDEX idx_anomalies_severity           ON anomalies (severity);
CREATE INDEX idx_anomalies_source_module      ON anomalies (source_module);
CREATE INDEX idx_anomalies_detected_at        ON anomalies (detected_at DESC);
CREATE INDEX idx_anomalies_type               ON anomalies (type);

COMMENT ON TABLE anomalies IS
  'Engine detectare anomalii operaționale G-05. '
  'Upsert pe fingerprint la fiecare run. Status: open → ack → resolved. '
  'Niciodată nu se șterg rânduri.';
