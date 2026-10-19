import type { MultiPolygon } from 'geojson';
import type { SoilParameter } from './soil.js';

// ---------------------------------------------------------------------------
// Thematic layers of the organization map (agmeo _components/mapLayers: economic choropleth,
// field choropleth, harvest yield, soil, trafficability)
// ---------------------------------------------------------------------------

export const MAP_THEMES = ['margin', 'yield', 'co2e', 'nitrogen', 'soil', 'trafficability'] as const;
export type MapTheme = (typeof MAP_THEMES)[number];

/** Per-field key figures of a season, area-weighted over the field's crops. */
export interface MapFieldKpi {
  fieldId: string;
  cropNames: string[];
  areaHa: number;
  /** DB I per hectare in the organization's currency; null without finance permission or data. */
  db1PerHa: number | null;
  yieldTHa: number | null;
  /** Main crop of the field, for the relative yield scale per crop. */
  cropName: string | null;
  co2eKgPerHa: number | null;
  nKgPerHa: number | null;
}

export interface MapKpis {
  seasonId: string | null;
  harvestYear: number | null;
  currency: string;
  /** Margin values are only included with the finance permission. */
  finance: boolean;
  fields: MapFieldKpi[];
}

/** One zone of a field's active soil zonation with the value of the chosen parameter. */
export interface MapSoilZone {
  id: string;
  fieldId: string;
  fieldName: string;
  label: string;
  areaHa: number;
  value: number | null;
  /** VDLUFA content class (A–E) for pH, P2O5, K2O and MgO. */
  contentClass: string | null;
  sampledOn: string | null;
  geometry: MultiPolygon;
}

export interface MapSoil {
  parameter: SoilParameter;
  zones: MapSoilZone[];
  /** Parameters with at least one value, for the picker. */
  available: SoilParameter[];
}

export const TRAFFICABILITY_BANDS = ['good', 'caution', 'risk', 'unsafe'] as const;

export interface MapTrafficabilityField {
  fieldId: string;
  band: string | null;
  sci: number | null;
  pf: number | null;
}

export interface MapTrafficability {
  equipmentId: string;
  date: string | null;
  fields: MapTrafficabilityField[];
  /** Fields left out: no soil class, or not enough stored weather. */
  skipped: { fieldId: string; reason: 'no_soil_texture' | 'no_water_balance' | 'error' }[];
}
