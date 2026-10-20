-- The reference app's eleven UI languages (German and English plus Czech, Spanish, Estonian, French,
-- Lithuanian, Latvian, Polish, Romanian and Ukrainian).
ALTER TABLE users DROP CONSTRAINT IF EXISTS users_locale_check;
ALTER TABLE users ADD CONSTRAINT users_locale_check
  CHECK (locale IN ('de', 'en', 'cs', 'es', 'et', 'fr', 'lt', 'lv', 'pl', 'ro', 'uk'));
