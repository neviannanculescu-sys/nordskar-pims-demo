-- G-15: Reconciliation tasks — manual action items created from unbilled cases.
-- INVARIANT: the system NEVER auto-creates or auto-resolves tasks.
-- INVARIANT: resolving a task does NOT mark the source consultation as billed.
--            Source reconciliation status must be verified independently.

CREATE TABLE IF NOT EXISTS reconciliation_tasks (
  id               UUID          PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Source entity that triggered this task.
  -- source_entity_id = composite key used by reconciliation detectors, e.g. "consultation:uuid".
  -- source_type      = unbilled item type, drives which detector produced this item.
  source_entity_id VARCHAR(100)  NOT NULL,
  source_type      VARCHAR(30)   NOT NULL CHECK (source_type IN ('consultation','procedure','treatment_line','stock_movement')),

  -- Optional FK to consultation — NULL for stock_movement type tasks.
  consultation_id  UUID          REFERENCES consultations(id),

  description      TEXT          NOT NULL,
  assigned_to      UUID          REFERENCES users(id),
  note             TEXT,

  status           VARCHAR(20)   NOT NULL DEFAULT 'open'
                   CHECK (status IN ('open','in_progress','done','dismissed')),

  -- Financial context (snapshot at task creation time, NOT live).
  estimated_value  NUMERIC(12,2),

  -- Audit trail
  created_at       TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  created_by       UUID          NOT NULL REFERENCES users(id),
  updated_by       UUID          REFERENCES users(id),  -- last person to change status
  resolved_at      TIMESTAMPTZ,
  resolved_by      UUID          REFERENCES users(id)   -- set when status → done|dismissed
);

CREATE INDEX IF NOT EXISTS idx_rec_tasks_source     ON reconciliation_tasks (source_entity_id);
CREATE INDEX IF NOT EXISTS idx_rec_tasks_status     ON reconciliation_tasks (status);
CREATE INDEX IF NOT EXISTS idx_rec_tasks_created_by ON reconciliation_tasks (created_by);
CREATE INDEX IF NOT EXISTS idx_rec_tasks_assigned   ON reconciliation_tasks (assigned_to) WHERE assigned_to IS NOT NULL;
