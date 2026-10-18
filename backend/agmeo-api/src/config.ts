// `nest start --watch` does not read .env (the start:* scripts pass --env-file-if-exists).
// Variables already set in the environment win over the file.
try {
  process.loadEnvFile();
} catch {
  // No .env: defaults and the process environment apply.
}

function env(name: string, fallback?: string): string {
  const value = process.env[name] ?? fallback;
  if (value === undefined) throw new Error(`Missing required environment variable ${name}`);
  return value;
}

export const config = {
  port: Number(env('PORT', '3001')),
  databaseUrl: env('DATABASE_URL', 'postgres://agmeo_api:agmeo_api@localhost:5434/agmeo'),
  relayDatabaseUrl: env('RELAY_DATABASE_URL', 'postgres://agmeo_worker:agmeo_worker@localhost:5434/agmeo'),
  refdataDatabaseUrl: env('REFDATA_DATABASE_URL', 'postgres://agmeo_refdata_sync:agmeo_refdata_sync@localhost:5434/agmeo'),
  natsUrl:env('NATS_URL', 'nats://localhost:4222'),
  corsOrigin: env('CORS_ORIGIN', 'http://localhost:3000'),
  auth: {
    // 'dev' issues and accepts locally signed tokens. Replace with 'oidc' (Keycloak) later.
    mode: env('AUTH_MODE', 'dev') as 'dev',
    devSecret: env('DEV_AUTH_SECRET', 'agmeo-dev-secret-change-me-agmeo-dev-secret'),
    tokenTtlHours: Number(env('DEV_AUTH_TTL_HOURS', '168')),
  },
  // Internal tile server of the satellite pipeline (backend/agmeo-geo).
  geoTilesUrl: env('GEO_TILES_URL', 'http://127.0.0.1:3002'),
  weather: {
    baseUrl: env('OPEN_METEO_URL', 'https://api.open-meteo.com/v1/forecast'),
    cacheMinutes: Number(env('WEATHER_CACHE_MINUTES', '30')),
  },
  // Language model that phrases the reasons of field recommendations. Without a key the
  // recommendations still work; the UI then shows the reasons from the evidence codes.
  openai: {
    apiKey: env('OPENAI_API_KEY', ''),
    model: env('OPENAI_MODEL', 'gpt-5.4-mini'),
    // Empty for models without reasoning (e.g. gpt-4.1).
    reasoningEffort: env('OPENAI_REASONING_EFFORT', 'low'),
    timeoutMs: Number(env('OPENAI_TIMEOUT_MS', '30000')),
  },

};
