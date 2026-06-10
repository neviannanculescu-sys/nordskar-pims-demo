-- Migration: 0002_audit_appointments
-- Adds audit trigger on appointments table.
-- Rationale: status transitions (scheduled→no_show, confirmed→cancelled, etc.)
-- must be traceable for operational reporting and regulatory compliance (RO).
-- audit_trigger_fn() is already defined in 0001_initial_phase1.sql.

CREATE TRIGGER audit_appointments
  AFTER INSERT OR UPDATE OR DELETE ON appointments
  FOR EACH ROW EXECUTE FUNCTION audit_trigger_fn();
