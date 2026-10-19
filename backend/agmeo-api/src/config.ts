function env(name: string, fallback?: string): string {
  const value = process.env[name] ?? fallback;
  if (value === undefined) throw new Error(`Missing required environment variable ${name}`);
  return value;
}

function authMode(value: string): 'dev' | 'oidc' {
  if (value !== 'dev' && value !== 'oidc') throw new Error(`AUTH_MODE must be 'dev' or 'oidc', not '${value}'`);
  return value;
}

export const config = {
  port: Number(env('PORT', '3001')),
  databaseUrl: env('DATABASE_URL', 'postgres://agmeo_api:agmeo_api@localhost:5434/agmeo'),
  relayDatabaseUrl: env('RELAY_DATABASE_URL', 'postgres://agmeo_worker:agmeo_worker@localhost:5434/agmeo'),
  refdataDatabaseUrl: env('REFDATA_DATABASE_URL', 'postgres://agmeo_refdata_sync:agmeo_refdata_sync@localhost:5434/agmeo'),
  jobsDatabaseUrl: env('JOBS_DATABASE_URL', 'postgres://agmeo_jobs_worker:agmeo_jobs_worker@localhost:5434/agmeo'),
  natsUrl: env('NATS_URL', 'nats://localhost:4222'),
  /** Public URL of the web app, for links in e-mails. */
  appUrl: env('APP_URL', 'http://localhost:3000'),
  corsOrigin: env('CORS_ORIGIN', 'http://localhost:3000'),
  auth: {
    // 'oidc' verifies Keycloak access tokens; 'dev' issues and accepts locally signed tokens
    // (tests, offline development; refused in production).
    mode: authMode(env('AUTH_MODE', 'dev')),
    issuer: env('OIDC_ISSUER', 'http://localhost:8180/realms/agmeo'),
    audience: env('OIDC_AUDIENCE', 'agmeo-api'),
    /** Public client the web app signs in with (Authorization Code + PKCE). */
    webClientId: env('OIDC_WEB_CLIENT_ID', 'agmeo-web'),
    devSecret: env('DEV_AUTH_SECRET', 'agmeo-dev-secret-change-me-agmeo-dev-secret'),
    tokenTtlHours: Number(env('DEV_AUTH_TTL_HOURS', '168')),
  },
  mail: {
    // Local development delivers to Mailpit (docker compose), web UI on http://localhost:8025.
    smtpUrl: env('SMTP_URL', 'smtp://localhost:1025'),
    from: env('MAIL_FROM', 'agmeo <no-reply@agmeo.local>'),
  },
  storage: {
    // 'local' keeps objects in a directory (development, tests); 's3' uses an S3-compatible bucket.
    driver: env('STORAGE_DRIVER', 'local') as 'local' | 's3',
    localDir: env('STORAGE_LOCAL_DIR', '.storage'),
    /** Allowance for organizations without their own limit. */
    defaultLimitBytes: Number(env('STORAGE_DEFAULT_LIMIT_GB', '5')) * 1e9,
    /** Largest single upload. */
    maxUploadBytes: Number(env('STORAGE_MAX_UPLOAD_MB', '1024')) * 1024 * 1024,
    s3: {
      bucket: env('S3_BUCKET', 'agmeo'),
      region: env('S3_REGION', 'eu-central'),
      endpoint: env('S3_ENDPOINT', ''),
      forcePathStyle: env('S3_FORCE_PATH_STYLE', 'true') === 'true',
      accessKeyId: env('S3_ACCESS_KEY_ID', ''),
      secretAccessKey: env('S3_SECRET_ACCESS_KEY', ''),
    },
  },
  // Internal tile server of the satellite pipeline (backend/agmeo-geo).
  geoTilesUrl: env('GEO_TILES_URL', 'http://127.0.0.1:3002'),
  weather: {
    baseUrl: env('OPEN_METEO_URL', 'https://api.open-meteo.com/v1/forecast'),
    cacheMinutes: Number(env('WEATHER_CACHE_MINUTES', '30')),
    /** Open-Meteo subscription key: customer endpoints and the ERA5 archive for season backfills. Without it the free API is used (development only). */
    apiKey: env('OPEN_METEO_API_KEY', ''),
  },
  /** Thünen AgriGHG tool (RothC humus model) for the soil-carbon simulation; without a key the simulation is unavailable. */
  thuenen: {
    baseUrl: env('THUENEN_BASE_URL', 'https://agrighg-tool.thuenen.de/api/v1'),
    apiKey: env('THUENEN_API_KEY', ''),
  },
  // AGVOLUTION's maize dry-matter service (maize-dmc-api). Without a URL the DMC routes answer
  // "not configured" and the harvest detection job skips itself.
  maizeDmc: {
    apiUrl: env('MAIZE_DMC_API_URL', '').trim().replace(/\/+$/, ''),
    /** Bearer token; empty sends no Authorization header (the service enforces auth only when its own DMC_API_TOKEN is set). */
    apiToken: env('MAIZE_DMC_API_TOKEN', ''),
    /** Per attempt; a predict takes 5–30 s depending on resolution. */
    timeoutMs: Number(env('MAIZE_DMC_API_TIMEOUT_MS', '120000')),
    /** Send our stored daily weather so the service fetches only the gaps. */
    supplyWeather: env('DMC_SUPPLY_CACHED_WEATHER', 'on') !== 'off',
  },
  /**
   * AGVOLUTION's model services. Each is off while its URL (and, where needed, its credentials)
   * is empty: reads answer `configured: false`, requests that would call it answer 503
   * `service_not_configured`, and its jobs skip themselves.
   */
  models: {
    esm: {
      /** Ecosystem model server (lvl0-models esm/endpoints), e.g. https://esm.agvolution.com. */
      url: env('ESM_SERVER_URL', '').replace(/\/+$/, ''),
      /** Bearer token the ESM accepts (it verifies tokens with the reference app's Clerk instance). */
      token: env('ESM_API_TOKEN', ''),
      /** Host the ESM worker posts its writeback to; "localhost" makes the ESM host skip it (results come in the sync response). */
      writebackDomain: env('ESM_WRITEBACK_DOMAIN', 'localhost'),
      /** A model run in sync mode; the ESM itself gives up after 300 s. */
      runTimeoutMs: Number(env('ESM_RUN_TIMEOUT_MS', '330000')),
      /** Result downloads (timeseries.json). */
      timeoutMs: Number(env('ESM_TIMEOUT_MS', '30000')),
    },
    grassland: {
      /** grassland-api, e.g. https://grassland.agmeo.com. */
      url: env('GRASSLAND_API_URL', '').replace(/\/+$/, ''),
      /** Optional; without it no Authorization header is sent. */
      token: env('GRASSLAND_API_TOKEN', ''),
      timeoutMs: Number(env('GRASSLAND_API_TIMEOUT_MS', '120000')),
    },
    isip: {
      /** ISIP chart API and its Keycloak token endpoint (password grant), as agmeo-crawlers uses them. */
      apiUrl: env('ISIP_API_URL', 'https://www.isip.de/charts/api').replace(/\/+$/, ''),
      tokenUrl: env('ISIP_TOKEN_URL', 'https://login.isip.de/auth/realms/ams/protocol/openid-connect/token'),
      username: env('ISIP_USERNAME', ''),
      password: env('ISIP_PASSWORD', ''),
      clientId: env('ISIP_CLIENT_ID', 'sso-api-client-extern'),
      clientSecret: env('ISIP_CLIENT_SECRET', ''),
      timeoutMs: Number(env('ISIP_TIMEOUT_MS', '60000')),
    },
  },
};
