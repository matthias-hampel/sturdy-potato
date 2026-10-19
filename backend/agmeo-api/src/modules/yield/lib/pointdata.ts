import { plausibleMoisturePercent } from "./channels.js";
import { GridError } from "./grid.js";
import type { YieldPoint } from "./types.js";
import { buildZip } from "./zip.js";

/**
 * The point-data artefact: a zip member holding the yield points that were
 * fetched from a telemetry API (CLAAS Point Data) as a GeoJSON
 * FeatureCollection of Points. Stored under `yield-maps/` like every other
 * assigned map, so the analytics route re-parses it with the same
 * `parseYieldPointsFromZip` pipeline as shapefile and ISOXML exports — the
 * artefact must survive a round-trip, not just a one-off import.
 */
export const POINTDATA_GEOJSON_MEMBER = "points.geojson";

/** Feature properties of the artefact — kebab-free so shapefile-style attribute matching never collides. */
type YieldFeatureProperties = {
  yieldTHa: number;
  moisturePct?: number;
  /** Measurement time (epoch ms) — carried so track cleaning can reconstruct the harvest sequence. */
  t?: number;
  widthM?: number;
  speedKmh?: number;
  headingDeg?: number;
};

export function isPointDataZip(fileNames: string[]): boolean {
  return fileNames.some((name) => /(^|\/)points\.geojson$/i.test(name));
}

export type GeojsonYieldExtract = {
  points: YieldPoint[];
  totalFeatures: number;
  attribute: string;
  moistureAttribute?: string;
};

/** Sidecar of the artefact zip — which source produced it, and on which mass basis. */
export type PointDataSourceMeta = {
  attribute?: string;
  basis?: "wet" | "dry";
};

/** Parse the artefact member back into yield points (inverse of buildYieldPointsGeojsonZip). */
export function extractGeojsonYieldPoints(raw: string, attribute: string): GeojsonYieldExtract {
  let parsed: { type?: string; features?: unknown[] };
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    throw new GridError(`Invalid ${POINTDATA_GEOJSON_MEMBER}: ${error instanceof Error ? error.message : error}`, 400);
  }
  if (parsed.type !== "FeatureCollection" || !Array.isArray(parsed.features)) {
    throw new GridError(`${POINTDATA_GEOJSON_MEMBER} is not a GeoJSON FeatureCollection`, 400);
  }

  const points: YieldPoint[] = [];
  let hasMoisture = false;
  for (const feature of parsed.features as {
    geometry?: { type?: string; coordinates?: [number, number] };
    properties?: Partial<YieldFeatureProperties>;
  }[]) {
    if (feature.geometry?.type !== "Point" || !Array.isArray(feature.geometry.coordinates)) continue;
    const [lon, lat] = feature.geometry.coordinates;
    const value = feature.properties?.yieldTHa;
    if (typeof lon !== "number" || typeof lat !== "number" || typeof value !== "number" || !(value > 0)) continue;

    const moisture = plausibleMoisturePercent(feature.properties?.moisturePct);
    if (moisture !== undefined) hasMoisture = true;
    const { t, widthM, speedKmh, headingDeg } = feature.properties ?? {};
    points.push({
      lon,
      lat,
      value,
      moisture,
      ...(typeof t === "number" ? { t } : {}),
      ...(typeof widthM === "number" ? { width: widthM } : {}),
      ...(typeof speedKmh === "number" ? { speed: speedKmh } : {}),
      ...(typeof headingDeg === "number" ? { heading: headingDeg } : {}),
    });
  }

  if (points.length === 0) {
    throw new GridError(`${POINTDATA_GEOJSON_MEMBER} contains no positive yield points`, 400);
  }

  return {
    points,
    totalFeatures: parsed.features.length,
    attribute,
    moistureAttribute: hasMoisture ? `${attribute} moisture` : undefined,
  };
}

/**
 * Serialize fetched telemetry yield points as the storable artefact. `source`
 * is recorded next to the points so a stored map stays auditable (which API,
 * which machine, which window produced it).
 */
export function buildYieldPointsGeojsonZip(
  points: YieldPoint[],
  source: { attribute: string; basis: "wet" | "dry"; provenance: Record<string, string | number | null> },
): Buffer {
  const features = points.map((point) => ({
    type: "Feature" as const,
    geometry: { type: "Point" as const, coordinates: [point.lon, point.lat] },
    properties: {
      yieldTHa: point.value,
      ...(point.moisture !== undefined ? { moisturePct: point.moisture } : {}),
      ...(point.t !== undefined ? { t: point.t } : {}),
      ...(point.width !== undefined ? { widthM: point.width } : {}),
      ...(point.speed !== undefined ? { speedKmh: point.speed } : {}),
      ...(point.heading !== undefined ? { headingDeg: point.heading } : {}),
    } satisfies YieldFeatureProperties,
  }));

  return buildZip({
    [POINTDATA_GEOJSON_MEMBER]: JSON.stringify({ type: "FeatureCollection", features }),
    "source.json": JSON.stringify({ attribute: source.attribute, basis: source.basis, ...source.provenance }, null, 2),
  });
}
