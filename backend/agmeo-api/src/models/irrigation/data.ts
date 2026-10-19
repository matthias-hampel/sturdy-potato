/**
 * Ported from AGVOLUTION/agmeo src/lib/irrigation/data.ts — the pure parts of
 * `getFieldsIrrigationDataForOrg`: the irrigation constants, the folding of
 * IRRIGATION transactions (ACTION + water PRODUCT per operation) into events,
 * the soil precedence (survey zone before field topsoil) and the per-field
 * root-zone + topsoil balance. The queries that load cultivations, sowing
 * dates, weather, soil overview and zone soil stay with the caller.
 *
 * Also carries the `CultivationZoneSoil` shape and overlap threshold from
 * src/lib/irrigation/zoneSoil.ts (whose matching is a PostGIS query).
 */

import type { SupportedCrops } from '../crops.js';
import {
  buildFieldWaterBalance,
  type FieldTextureSnapshot,
  type FieldWaterBalance,
  type WaterBalanceWeatherRecord,
} from './fieldWaterBalance.js';
import { TOPSOIL_DEPTH_M } from './waterBalance.js';

export const WATER_FQN = 'MISCELLANEOUS__WATER__DRINKING_WATER';
export const MM_TO_M3_HA = 10;

export const IRRIGATION_DEFAULTS_PER_HA: Record<
  string,
  { hours: number; diesel: number }
> = {
  IRRIGATION_METHOD__SPRINKLER: { hours: 0.09, diesel: 0.6 },
  IRRIGATION_METHOD__DRIP: { hours: 0.02, diesel: 0 },
  IRRIGATION_METHOD__PIVOT: { hours: 0.01, diesel: 0 },
};

/**
 * A cultivation must lie at least this much inside a zone before the zone's
 * soil survey overrides the field-level topsoil values — guards against
 * sliver intersections along shared borders.
 */
export const ZONE_OVERLAP_MIN_SHARE = 0.3;

/** Soil zone (active zonation, max area overlap) matched to a cultivation. */
export type CultivationZoneSoil = {
  zoneId: string;
  zoneLabel: string;
  /** Fraction (0..1) of the cultivation's area covered by the matched zone. */
  overlapShare: number;
  /** Survey-provided plant-available water capacity (mm), the authoritative AWC. */
  nfkMm: number | null;
  /** Survey thresholds (mm at 30/50/70 % nFK), when provided. */
  nfk30Pct: number | null;
  nfk50Pct: number | null;
  nfk70Pct: number | null;
  soilTypeText: string | null;
  clay: number | null;
  silt: number | null;
  sand: number | null;
  soc: number | null;
};

export type IrrigationTransaction = {
  id: string;
  operationId: string;
  date: string;
  quantityMm: number;
  actionFqn: string | null;
  status: string;
};

/** One booked IRRIGATION row as the caller loads it. */
export type IrrigationTransactionRow = {
  id: string;
  cultivationId: string;
  operationId: string;
  /** yyyy-mm-dd (local day of the booking) */
  date: string | null;
  quantity: number | null;
  articleId: string | null;
  kind: 'action' | 'product';
  status: string;
};

/**
 * Fold IRRIGATION rows into one event per operation, grouped by cultivation.
 * The water PRODUCT row carries the amount (m³/ha → mm via MM_TO_M3_HA), the
 * ACTION row the method, status and date. Operations without an ACTION row are
 * dropped, as in the reference.
 */
export function groupIrrigationTransactions(
  rows: IrrigationTransactionRow[],
): Map<string, IrrigationTransaction[]> {
  type OpAccumulator = {
    cultivationId: string;
    date: string;
    status: string;
    actionFqn: string | null;
    actionTxId: string | null;
    waterTxId: string | null;
    quantityMm: number;
  };
  const opsByOperationId = new Map<string, OpAccumulator>();
  for (const tx of rows) {
    const date = tx.date ?? '';
    const op = opsByOperationId.get(tx.operationId) ?? {
      cultivationId: tx.cultivationId,
      date,
      status: tx.status,
      actionFqn: null,
      actionTxId: null,
      waterTxId: null,
      quantityMm: 0,
    };
    if (tx.kind === 'product' && tx.articleId === WATER_FQN) {
      op.waterTxId = tx.id;
      op.quantityMm = (tx.quantity ?? 0) / MM_TO_M3_HA;
    } else if (tx.kind === 'action') {
      op.actionFqn = tx.articleId ?? null;
      op.actionTxId = tx.id;
      op.status = tx.status;
      op.date = date;
    }
    opsByOperationId.set(tx.operationId, op);
  }

  const txByCultivation = new Map<string, IrrigationTransaction[]>();
  for (const [operationId, op] of opsByOperationId) {
    if (!op.actionTxId) continue;
    const list = txByCultivation.get(op.cultivationId) ?? [];
    list.push({
      id: op.actionTxId,
      operationId,
      date: op.date,
      quantityMm: op.quantityMm,
      actionFqn: op.actionFqn,
      status: op.status,
    });
    txByCultivation.set(op.cultivationId, list);
  }
  return txByCultivation;
}

/** Applied irrigation per date (mm), summed over a cultivation's events. */
export function irrigationMmByDate(
  transactions: IrrigationTransaction[],
): Map<string, number> {
  const irrigByDate = new Map<string, number>();
  for (const tx of transactions) {
    if (tx.date) {
      irrigByDate.set(tx.date, (irrigByDate.get(tx.date) ?? 0) + tx.quantityMm);
    }
  }
  return irrigByDate;
}

/**
 * Soil precedence per cultivation: the matched zone's surveyed texture first,
 * field-level topsoil as fallback. (Zone texture carries no bulk density.)
 */
export function resolveFieldTexture(
  zoneSoil: CultivationZoneSoil | null,
  fieldTexture: FieldTextureSnapshot | null,
): FieldTextureSnapshot | null {
  const zoneTexture =
    zoneSoil &&
    zoneSoil.clay != null &&
    zoneSoil.silt != null &&
    zoneSoil.sand != null
      ? {
          clay: zoneSoil.clay,
          silt: zoneSoil.silt,
          sand: zoneSoil.sand,
          soc: zoneSoil.soc,
          bd: null,
        }
      : null;
  return zoneTexture ?? fieldTexture;
}

export type FieldIrrigationInput = {
  crop: SupportedCrops | null;
  latitude: number;
  year: number;
  /** Earliest PLANTING booking (yyyy-mm-dd), or null → crop-calendar default. */
  sowingDate: string | null;
  weather: WaterBalanceWeatherRecord;
  /** Field-level topsoil texture (%), from the soil overview. */
  fieldTexture: FieldTextureSnapshot | null;
  /** Matched survey zone, if any. Its nFK overrides the root-zone AWC. */
  zoneSoil?: CultivationZoneSoil | null;
  transactions?: IrrigationTransaction[];
  /** Per-cultivation rooting-depth override (m); null → crop default. */
  rootDepthOverrideM?: number | null;
  /** Also run the plough-layer balance the trafficability layer reads. */
  withTopsoilBalance?: boolean;
  /** yyyy-mm-dd; defaults to the wall clock. */
  today?: string;
};

export type FieldIrrigation = {
  rootZone: FieldWaterBalance;
  /** Plough-layer balance (TOPSOIL_DEPTH_M), only when requested. */
  topsoil: FieldWaterBalance | null;
};

/** The per-field part of getFieldsIrrigationDataForOrg, without the queries. */
export function computeFieldIrrigation(
  input: FieldIrrigationInput,
): FieldIrrigation {
  const zoneSoil = input.zoneSoil ?? null;
  const texture = resolveFieldTexture(zoneSoil, input.fieldTexture);
  const irrigByDate = irrigationMmByDate(input.transactions ?? []);

  const rootZone = buildFieldWaterBalance({
    crop: input.crop,
    texture,
    latitude: input.latitude,
    sowingDate: input.sowingDate,
    weather: input.weather,
    irrigationByDate: irrigByDate,
    year: input.year,
    // Stored override REPLACES the crop default.
    rootDepthM: input.rootDepthOverrideM ?? undefined,
    awcMmOverride: zoneSoil?.nfkMm ?? null,
    today: input.today,
  });

  // Same weather, same crop, plough-layer bucket. Only computed on request:
  // it is a second full pass over the season and only trafficability reads it.
  const topsoil = input.withTopsoilBalance
    ? buildFieldWaterBalance({
        crop: input.crop,
        texture,
        latitude: input.latitude,
        sowingDate: input.sowingDate,
        weather: input.weather,
        irrigationByDate: irrigByDate,
        year: input.year,
        rootDepthM: TOPSOIL_DEPTH_M,
        // No zone nFK here: a surveyed nFK describes the whole rooting zone,
        // so applying it to a 0.3 m bucket would overstate topsoil storage.
        awcMmOverride: null,
        today: input.today,
      })
    : null;

  return { rootZone, topsoil };
}
