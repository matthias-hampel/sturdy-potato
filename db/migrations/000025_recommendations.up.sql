-- Field recommendations ("what, when, where, why"): typed decisions of a versioned rule set over
-- the calendar, weather, satellite observations and DüV/PSM rules. A language model may phrase the
-- reason (`explanation`), but never adds or changes a decision. Every refresh is one run.

CREATE TABLE IF NOT EXISTS recommendation_runs (
  id                uuid PRIMARY KEY DEFAULT uuidv7(),
  organization_id   uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  rule_set          text NOT NULL,
  generated_at      timestamptz NOT NULL DEFAULT now(),
  item_count        integer NOT NULL DEFAULT 0,
  -- Short daily summary written by the language model, when one is configured.
  briefing          text,
  explanation_model text,
  explanation_error text,
  created_by        uuid REFERENCES users(id),
  UNIQUE (organization_id, id)
);
CREATE INDEX IF NOT EXISTS recommendation_runs_org_idx ON recommendation_runs (organization_id, generated_at DESC);

CREATE TABLE IF NOT EXISTS recommendations (
  id                uuid PRIMARY KEY DEFAULT uuidv7(),
  organization_id   uuid NOT NULL,
  run_id            uuid NOT NULL,
  -- Stable identity of the decision across runs, e.g. 'timing:<operationId>:postpone'.
  key               text NOT NULL,
  kind              text NOT NULL CHECK (kind IN ('operation_timing', 'scouting', 'fertilization', 'compliance', 'variable_rate')),
  action            text NOT NULL CHECK (action IN ('do_now', 'postpone', 'catch_up', 'inspect', 'plan_operation', 'review', 'create_vra_map')),
  operation_type    text CHECK (operation_type IN ('tillage', 'sowing', 'fertilization', 'crop_protection', 'irrigation', 'harvest', 'inspection', 'other')),
  farm_id           uuid NOT NULL,
  field_id          uuid NOT NULL,
  crop_cycle_id     uuid,
  operation_id      uuid,
  zone_nos          smallint[],
  window_from       date,
  window_to         date,
  priority          text NOT NULL CHECK (priority IN ('low', 'normal', 'high', 'urgent')),
  confidence        numeric(3, 2) NOT NULL CHECK (confidence BETWEEN 0 AND 1),
  evidence          jsonb NOT NULL DEFAULT '[]',
  rule_set          text NOT NULL,
  explanation       text,
  explanation_model text,
  status            text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'accepted', 'dismissed', 'expired')),
  dismiss_reason    text CHECK (dismiss_reason IN ('already_done', 'not_relevant', 'wrong_timing', 'wrong_data', 'other')),
  dismiss_note      text,
  -- tasks has no (organization_id, id) key; the task is created in the same transaction and tenant.
  task_id           uuid REFERENCES tasks(id) ON DELETE SET NULL,
  decided_at        timestamptz,
  decided_by        uuid REFERENCES users(id),
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (organization_id, run_id) REFERENCES recommendation_runs (organization_id, id) ON DELETE CASCADE,
  FOREIGN KEY (organization_id, farm_id) REFERENCES farms (organization_id, id) ON DELETE CASCADE,
  FOREIGN KEY (organization_id, field_id) REFERENCES fields (organization_id, id) ON DELETE CASCADE,
  FOREIGN KEY (organization_id, crop_cycle_id) REFERENCES crop_cycles (organization_id, id) ON DELETE CASCADE,
  FOREIGN KEY (organization_id, operation_id) REFERENCES operations (organization_id, id) ON DELETE CASCADE
);
-- One open recommendation per decision; decided ones stay as feedback for calibrating the rules.
CREATE UNIQUE INDEX IF NOT EXISTS recommendations_open_key_idx ON recommendations (organization_id, key) WHERE status = 'open';
CREATE INDEX IF NOT EXISTS recommendations_key_idx ON recommendations (organization_id, key, decided_at DESC);
CREATE INDEX IF NOT EXISTS recommendations_field_idx ON recommendations (organization_id, field_id, status);

DROP TRIGGER IF EXISTS recommendations_updated_at ON recommendations;
CREATE TRIGGER recommendations_updated_at BEFORE UPDATE ON recommendations
  FOR EACH ROW EXECUTE FUNCTION app.set_updated_at();

ALTER TABLE recommendation_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE recommendations ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS recommendation_runs_tenant ON recommendation_runs;
CREATE POLICY recommendation_runs_tenant ON recommendation_runs FOR ALL
  USING (organization_id = (SELECT app.org_id())) WITH CHECK (organization_id = (SELECT app.org_id()));
DROP POLICY IF EXISTS recommendations_tenant ON recommendations;
CREATE POLICY recommendations_tenant ON recommendations FOR ALL
  USING (organization_id = (SELECT app.org_id())) WITH CHECK (organization_id = (SELECT app.org_id()));

GRANT SELECT, INSERT, UPDATE ON recommendation_runs, recommendations TO agmeo_app;
