-- Seasons created without a name used to be called "Harvest <year>"; the default is now "Ernte <year>".
-- Renames only seasons whose name is still that generated default, so names users chose stay as they are.
UPDATE growing_seasons SET name = 'Ernte ' || harvest_year WHERE name = 'Harvest ' || harvest_year;
