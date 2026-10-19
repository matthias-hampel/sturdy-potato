-- Plant-protection record under §11 PflSchG / EU Implementing Regulation 2023/564.
--
-- The record itself is built from the operations; what it needs beyond them are the two
-- certificates an inspection opens with: the Sachkundenachweis (certificate of competence in
-- plant protection) and the periodic sprayer inspection. They are kept once per organization,
-- like the reference app kept them in the organization's metadata. Usage type (Freiland,
-- Gewächshaus, …) of an application lives in the crop-protection operation's `details`.
CREATE TABLE IF NOT EXISTS psm_attestations (
  organization_id            uuid PRIMARY KEY REFERENCES organizations (id) ON DELETE CASCADE,
  certificate_number         text CHECK (length(certificate_number) <= 30),
  certificate_holder         text CHECK (length(certificate_holder) <= 100),
  certificate_valid_until    date,
  sprayer_inspection_number  text CHECK (length(sprayer_inspection_number) <= 30),
  sprayer_inspected_on       date,
  updated_at                 timestamptz NOT NULL DEFAULT now(),
  updated_by                 uuid
);
ALTER TABLE psm_attestations ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS psm_attestations_tenant ON psm_attestations;
CREATE POLICY psm_attestations_tenant ON psm_attestations FOR ALL
  USING (organization_id = (SELECT app.org_id())) WITH CHECK (organization_id = (SELECT app.org_id()));
GRANT SELECT, INSERT, UPDATE, DELETE ON psm_attestations TO agmeo_app;
