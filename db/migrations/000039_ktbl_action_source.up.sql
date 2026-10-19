-- The KTBL action (e.g. PLOWING__RP7_1000) an organization's action took its diesel and hours per hectare from.
ALTER TABLE operation_actions ADD COLUMN IF NOT EXISTS ktbl_fqn text CHECK (length(ktbl_fqn) BETWEEN 1 AND 100);
