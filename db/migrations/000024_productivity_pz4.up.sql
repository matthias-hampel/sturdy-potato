-- Productivity algorithm pz-4 (backend/agmeo-geo/agmeo_geo/productivity.py).
--
-- Analyses also store the tercile stability (share of pixels in the bottom tercile of every
-- used acquisition plus the share in the top tercile of every one) and the minimum pairwise
-- correlation of the used acquisitions. Scenes carry a "reason" when their season was left
-- out: "crop" (vegetables, grassland, ...) or "inconsistent" (pattern disagrees with the
-- other seasons).
--
-- The geo worker reads the main crop of each season to skip seasons with such crops. It can
-- read crop categories and which crop a field had in which harvest year, nothing else.
-- Idempotent: the shared dev database gets migrations applied by hand.

ALTER TABLE productivity_analyses
  ADD COLUMN IF NOT EXISTS tercile_stability numeric(4, 3) CHECK (tercile_stability BETWEEN 0 AND 1),
  ADD COLUMN IF NOT EXISTS min_correlation numeric(4, 3) CHECK (min_correlation BETWEEN -1 AND 1);
COMMENT ON COLUMN productivity_analyses.scenes IS
  'Candidate acquisitions: [{"sceneId", "date", "season", "ndviMean", "used", "reason": null | "crop" | "inconsistent"}]';

GRANT SELECT (id, organization_id, field_id, season_id, crop_id, role) ON crop_cycles TO agmeo_geo;
GRANT SELECT (id, organization_id, harvest_year) ON growing_seasons TO agmeo_geo;
GRANT SELECT (id, organization_id, category) ON crops TO agmeo_geo;

DROP POLICY IF EXISTS crop_cycles_geo_read ON crop_cycles;
DROP POLICY IF EXISTS growing_seasons_geo_read ON growing_seasons;
DROP POLICY IF EXISTS crops_geo_read ON crops;
CREATE POLICY crop_cycles_geo_read ON crop_cycles FOR SELECT TO agmeo_geo USING (true);
CREATE POLICY growing_seasons_geo_read ON growing_seasons FOR SELECT TO agmeo_geo USING (true);
CREATE POLICY crops_geo_read ON crops FOR SELECT TO agmeo_geo USING (true);
