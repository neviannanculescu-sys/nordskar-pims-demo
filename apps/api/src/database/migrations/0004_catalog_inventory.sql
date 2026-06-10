-- Migration 0004: price_catalog, procedure_templates, inventory_items,
--                 stock_movements, billing_candidates view, FK backfill
-- Forward-only. NEVER run drizzle-kit push in staging/prod.

-- ---------------------------------------------------------------------------
-- Enums
-- ---------------------------------------------------------------------------

CREATE TYPE service_type AS ENUM (
  'consultation','emergency','surgery','anesthesia',
  'hospitalization','lab_test','imaging','vaccination',
  'treatment','procedure','product','package','other'
);

CREATE TYPE inventory_category AS ENUM (
  'medication','consumable','food','product_for_sale','equipment','other'
);

CREATE TYPE stock_movement_type AS ENUM (
  'purchase_receipt','consultation_use','hospitalization_use','direct_sale',
  'adjustment_positive','adjustment_negative','return_to_supplier',
  'expired_disposal','theft_loss'
);

-- ---------------------------------------------------------------------------
-- service_categories
-- ---------------------------------------------------------------------------

CREATE TABLE service_categories (
  id        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name      VARCHAR(100) NOT NULL,
  parent_id UUID REFERENCES service_categories(id),
  color     VARCHAR(7),
  is_active BOOLEAN NOT NULL DEFAULT TRUE,

  CONSTRAINT service_categories_color_format
    CHECK (color IS NULL OR color ~ '^#[0-9A-Fa-f]{6}$')
);

-- ---------------------------------------------------------------------------
-- price_catalog
-- ---------------------------------------------------------------------------

CREATE TABLE price_catalog (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code         VARCHAR(30)  NOT NULL UNIQUE,
  name         VARCHAR(200) NOT NULL,
  description  TEXT,

  category_id  UUID NOT NULL REFERENCES service_categories(id),
  service_type service_type NOT NULL,

  base_price        NUMERIC(10,2) NOT NULL,
  vat_rate          NUMERIC(5,2)  NOT NULL DEFAULT 9,
  price_with_vat    NUMERIC(10,2) GENERATED ALWAYS AS
                      (base_price * (1 + vat_rate / 100.0)) STORED,

  direct_cost_estimate   NUMERIC(10,2),
  min_margin_percent     NUMERIC(5,2)  DEFAULT 30,
  estimated_duration_min INTEGER,

  is_emergency_surcharge BOOLEAN      NOT NULL DEFAULT FALSE,
  emergency_multiplier   NUMERIC(4,2)          DEFAULT 1.5,

  requires_approval_above NUMERIC(10,2),

  is_active  BOOLEAN NOT NULL DEFAULT TRUE,
  valid_from DATE    NOT NULL DEFAULT CURRENT_DATE,
  valid_to   DATE,

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ,
  updated_by UUID REFERENCES users(id),

  CONSTRAINT price_catalog_base_price_positive CHECK (base_price >= 0),
  CONSTRAINT price_catalog_vat_rate_valid      CHECK (vat_rate IN (0, 9, 19)),
  CONSTRAINT price_catalog_valid_dates         CHECK (valid_to IS NULL OR valid_to >= valid_from),
  CONSTRAINT price_catalog_emergency_mult_min  CHECK (emergency_multiplier >= 1)
);

CREATE INDEX idx_price_catalog_category    ON price_catalog(category_id) WHERE is_active = TRUE;
CREATE INDEX idx_price_catalog_service_type ON price_catalog(service_type) WHERE is_active = TRUE;
CREATE INDEX idx_price_catalog_valid        ON price_catalog(valid_from, valid_to) WHERE is_active = TRUE;

-- ---------------------------------------------------------------------------
-- procedure_templates
-- ---------------------------------------------------------------------------

CREATE TABLE procedure_templates (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  service_id  UUID NOT NULL REFERENCES price_catalog(id),
  name        VARCHAR(200) NOT NULL,
  description TEXT,

  estimated_time_min   INTEGER,
  requires_anesthesia  BOOLEAN NOT NULL DEFAULT FALSE,
  requires_lab         BOOLEAN NOT NULL DEFAULT FALSE,

  pre_procedure_notes  TEXT,
  post_procedure_notes TEXT,

  is_active  BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ
);

-- procedure_template_items (consumables per template) added in Phase 2
-- when inventory_items is fully seeded and FK is stable.

-- ---------------------------------------------------------------------------
-- inventory_items
-- ---------------------------------------------------------------------------

CREATE TABLE inventory_items (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  sku          VARCHAR(50)  NOT NULL UNIQUE,
  name         VARCHAR(200) NOT NULL,
  generic_name VARCHAR(200),

  category     inventory_category NOT NULL,
  subcategory  VARCHAR(100),

  is_controlled           BOOLEAN NOT NULL DEFAULT FALSE,
  requires_prescription   BOOLEAN NOT NULL DEFAULT FALSE,
  is_for_sale             BOOLEAN NOT NULL DEFAULT TRUE,

  manufacturer VARCHAR(200),
  barcode      VARCHAR(50),

  unit_of_measure    VARCHAR(30) NOT NULL,
  base_unit          VARCHAR(30),
  conversion_factor  NUMERIC(10,4),

  current_stock    NUMERIC(10,3) NOT NULL DEFAULT 0,
  min_stock_level  NUMERIC(10,3),
  max_stock_level  NUMERIC(10,3),
  reorder_quantity NUMERIC(10,3),

  last_purchase_price NUMERIC(10,4),
  average_cost        NUMERIC(10,4),
  sale_price          NUMERIC(10,2),
  vat_rate            NUMERIC(5,2) NOT NULL DEFAULT 9,

  storage_location   VARCHAR(100),
  storage_conditions TEXT,

  is_active  BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ,
  deleted_at TIMESTAMPTZ,

  CONSTRAINT inventory_items_stock_non_negative CHECK (current_stock >= 0),
  CONSTRAINT inventory_items_vat_valid          CHECK (vat_rate IN (0, 9, 19)),
  CONSTRAINT inventory_items_sale_price_pos     CHECK (sale_price IS NULL OR sale_price >= 0)
);

CREATE INDEX idx_inventory_sku      ON inventory_items(sku)      WHERE deleted_at IS NULL;
CREATE INDEX idx_inventory_category ON inventory_items(category) WHERE is_active = TRUE AND deleted_at IS NULL;
-- Low-stock alert query
CREATE INDEX idx_inventory_low_stock ON inventory_items(current_stock, min_stock_level)
  WHERE min_stock_level IS NOT NULL AND deleted_at IS NULL;

-- ---------------------------------------------------------------------------
-- stock_movements (append-only — no UPDATE/DELETE ever)
-- ---------------------------------------------------------------------------

CREATE TABLE stock_movements (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  inventory_item_id UUID NOT NULL REFERENCES inventory_items(id),
  movement_type    stock_movement_type NOT NULL,

  reference_type   VARCHAR(50),
  reference_id     UUID,

  quantity    NUMERIC(10,3) NOT NULL,
  unit_cost   NUMERIC(10,4),
  lot_number  VARCHAR(50),
  expiry_date DATE,

  notes        TEXT,
  performed_by UUID NOT NULL REFERENCES users(id),
  performed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  stock_before NUMERIC(10,3),
  stock_after  NUMERIC(10,3),

  CONSTRAINT stock_movements_qty_nonzero CHECK (quantity <> 0)
);

CREATE INDEX idx_stock_movements_item     ON stock_movements(inventory_item_id, performed_at DESC);
CREATE INDEX idx_stock_movements_ref      ON stock_movements(reference_type, reference_id)
  WHERE reference_id IS NOT NULL;

-- ---------------------------------------------------------------------------
-- Resolve Phase 1 nullable debt:
-- Wire FK constraints that were deferred in 0003
-- ---------------------------------------------------------------------------

-- procedures.procedure_template_id → procedure_templates
ALTER TABLE procedures
  ADD CONSTRAINT fk_procedures_template
    FOREIGN KEY (procedure_template_id) REFERENCES procedure_templates(id);

-- treatment_lines.inventory_item_id → inventory_items
-- Remains nullable (walk-in prescriptions without catalog item are valid).
-- Backfill: when inventory items are seeded, run:
--   UPDATE treatment_lines tl
--   SET inventory_item_id = ii.id
--   FROM inventory_items ii
--   WHERE tl.inventory_item_id IS NULL
--     AND tl.deleted_at IS NULL
--     AND ii.sku = <matched_sku>;  -- match on product_name or barcode
ALTER TABLE treatment_lines
  ADD CONSTRAINT fk_treatment_lines_inventory
    FOREIGN KEY (inventory_item_id) REFERENCES inventory_items(id);

-- ---------------------------------------------------------------------------
-- VIEW: billing_candidates
-- Read-only. Aggregates all billable, unbilled, signed lines ready for invoicing.
--
-- Rules:
--   1. consultation must be completed (signed_by IS NOT NULL)
--   2. consultation.billed = FALSE
--   3. line is_billable = TRUE and not soft-deleted
--
-- Used by invoicing module to pre-populate invoice_lines.
-- ---------------------------------------------------------------------------

CREATE VIEW billing_candidates AS

  -- Procedures
  SELECT
    p.id                                        AS source_id,
    'procedure'::TEXT                           AS source_type,
    p.consultation_id,
    c.owner_id,
    c.pet_id,
    c.veterinarian_id,
    p.veterinarian_id                           AS performed_by_vet,
    p.performed_at                              AS service_date,
    p.name                                      AS description,
    p.quantity::NUMERIC(8,3)                    AS quantity,
    p.unit,
    p.unit_price::NUMERIC(10,2)                 AS unit_price,
    p.total_price::NUMERIC(10,2)                AS line_total,
    p.cost_direct::NUMERIC(10,2)                AS unit_cost,
    NULL::NUMERIC(5,2)                          AS vat_rate,  -- resolved from price_catalog in invoice
    p.procedure_template_id                     AS template_or_item_id,
    NULL::UUID                                  AS inventory_item_id,
    NULL::VARCHAR                               AS lot_number
  FROM procedures p
  JOIN consultations c ON c.id = p.consultation_id
  WHERE p.deleted_at      IS NULL
    AND c.deleted_at      IS NULL
    AND c.signed_by       IS NOT NULL
    AND c.billed          = FALSE
    AND p.is_billable     = TRUE

UNION ALL

  -- Treatment lines (dispensed only — undispensed have not left stock yet)
  SELECT
    tl.id,
    'treatment_line'::TEXT,
    tl.consultation_id,
    c.owner_id,
    c.pet_id,
    c.veterinarian_id,
    tl.prescribed_by,
    COALESCE(tl.administered_at, tl.created_at),
    tl.product_name,
    tl.quantity_dispensed::NUMERIC(8,3),
    tl.quantity_unit,
    tl.unit_price::NUMERIC(10,2),
    (tl.quantity_dispensed * tl.unit_price)::NUMERIC(10,2),
    tl.unit_cost::NUMERIC(10,2),
    NULL::NUMERIC(5,2),
    NULL::UUID,
    tl.inventory_item_id,
    tl.lot_number
  FROM treatment_lines tl
  JOIN consultations c ON c.id = tl.consultation_id
  WHERE tl.deleted_at   IS NULL
    AND c.deleted_at    IS NULL
    AND c.signed_by     IS NOT NULL
    AND c.billed        = FALSE
    AND tl.is_billable  = TRUE
    AND tl.is_dispensed = TRUE;

COMMENT ON VIEW billing_candidates IS
  'Read-only: all billable, signed, unbilled procedure and treatment line records.'
  ' Consumed by the invoicing module to pre-populate invoice_lines.'
  ' Filtered: consultation.signed_by NOT NULL, consultation.billed=FALSE, is_billable=TRUE.';
