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
};
