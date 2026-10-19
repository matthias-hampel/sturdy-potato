-- BVL approval conditions (Auflagen) of plant-protection products and their approved uses, with
-- the drift-reduction tiers of the water-body buffer (reference PsmRestriction and
-- PsmRestrictionReduction, from the BVL tables auflagen and auflage_redu). Reference data like the
-- rest of the register: replaced as a whole by the PSM sync.

CREATE TABLE IF NOT EXISTS psm_restrictions (
  auflagenr            text PRIMARY KEY,
  -- Exactly one scope: an approved use (AWG id like "024701-00/01-001") or a whole product.
  awg_id               text,
  kennr                text,
  code                 text NOT NULL,
  text                 text,
  -- Leading letters of the code: NW (water), NT (non-target areas), SB, …
  code_group           text,
  -- Buffer to surface water in m: the unreduced BVL distance, else the widest permitted tier.
  water_buffer_m       numeric(6, 1),
  -- Drift-reduction class the buffer assumes when it comes from a tier.
  drift_reduction_pct  smallint,
  CHECK ((awg_id IS NULL) <> (kennr IS NULL))
);
CREATE INDEX IF NOT EXISTS psm_restrictions_awg_idx ON psm_restrictions (awg_id) WHERE awg_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS psm_restrictions_kennr_idx ON psm_restrictions (kennr) WHERE kennr IS NOT NULL;

CREATE TABLE IF NOT EXISTS psm_restriction_reductions (
  auflagenr      text NOT NULL REFERENCES psm_restrictions (auflagenr) ON DELETE CASCADE,
  reduction_pct  smallint NOT NULL,
  -- null: the class does not permit application ("*").
  distance_m     numeric(6, 1),
  PRIMARY KEY (auflagenr, reduction_pct)
);

GRANT SELECT ON psm_restrictions, psm_restriction_reductions TO agmeo_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON psm_restrictions, psm_restriction_reductions TO agmeo_refdata;
