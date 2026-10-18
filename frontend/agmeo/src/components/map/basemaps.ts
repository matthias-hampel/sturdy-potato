import type { ExpressionSpecification, LayerSpecification, StyleSpecification } from 'maplibre-gl'
import { t } from '#/i18n'

export type Basemap = 'satellite' | 'map'

const GLYPHS = 'https://tiles.openfreemap.org/fonts/{fontstack}/{range}.pbf'

// Aerial imagery for tracing and viewing fields. Esri World Imagery is fine for development;
// production use needs a licensed imagery provider (set VITE_SATELLITE_TILES).
const SATELLITE_TILES =
  import.meta.env.VITE_SATELLITE_TILES ?? 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}'
const SATELLITE_ATTRIBUTION: string | undefined = import.meta.env.VITE_SATELLITE_ATTRIBUTION

export const satelliteStyle = (): StyleSpecification => ({
  version: 8,
  glyphs: GLYPHS,
  sources: {
    satellite: { type: 'raster', tiles: [SATELLITE_TILES], tileSize: 256, maxzoom: 19, attribution: SATELLITE_ATTRIBUTION ?? t('map.attribution.esri') },
    reference: { type: 'vector', url: VECTOR_TILES },
  },
  layers: [{ id: 'satellite', type: 'raster', source: 'satellite' }, ...referenceLayers],
})

// OpenFreeMap: free vector tiles based on OpenStreetMap, no API key.
const VECTOR_TILES = 'https://tiles.openfreemap.org/planet'
export const mapStyleUrl = 'https://tiles.openfreemap.org/styles/liberty'

// Reference overlay for the imagery: administrative borders and the names of places, roads and
// water (OpenMapTiles schema). Light text on a dark halo so it stays readable on any imagery.
const NAME: ExpressionSpecification = ['coalesce', ['get', 'name'], ['get', 'name_en']]
const HALO = { 'text-color': '#ffffff', 'text-halo-color': 'rgba(15,20,12,0.9)', 'text-halo-width': 1.4 }
const notMaritime: ExpressionSpecification = ['!=', ['get', 'maritime'], 1]

const referenceLayers: LayerSpecification[] = [
  {
    id: 'ref-boundary-municipality',
    type: 'line',
    source: 'reference',
    'source-layer': 'boundary',
    minzoom: 10,
    filter: ['all', ['>=', ['get', 'admin_level'], 7], ['<=', ['get', 'admin_level'], 8], notMaritime],
    paint: { 'line-color': 'rgba(255,255,255,0.55)', 'line-width': ['interpolate', ['linear'], ['zoom'], 10, 0.6, 16, 1.4], 'line-dasharray': [3, 2] },
  },
  {
    id: 'ref-boundary-district',
    type: 'line',
    source: 'reference',
    'source-layer': 'boundary',
    minzoom: 7,
    filter: ['all', ['>=', ['get', 'admin_level'], 5], ['<=', ['get', 'admin_level'], 6], notMaritime],
    paint: { 'line-color': 'rgba(255,255,255,0.7)', 'line-width': ['interpolate', ['linear'], ['zoom'], 7, 0.7, 16, 1.8], 'line-dasharray': [4, 2] },
  },
  {
    id: 'ref-boundary-state',
    type: 'line',
    source: 'reference',
    'source-layer': 'boundary',
    minzoom: 3,
    filter: ['all', ['>=', ['get', 'admin_level'], 3], ['<=', ['get', 'admin_level'], 4], notMaritime],
    paint: { 'line-color': 'rgba(255,255,255,0.85)', 'line-width': ['interpolate', ['linear'], ['zoom'], 3, 0.8, 16, 2.4], 'line-dasharray': [5, 2, 1, 2] },
  },
  {
    id: 'ref-boundary-country',
    type: 'line',
    source: 'reference',
    'source-layer': 'boundary',
    filter: ['all', ['==', ['get', 'admin_level'], 2], notMaritime],
    paint: { 'line-color': '#ffffff', 'line-width': ['interpolate', ['linear'], ['zoom'], 0, 1, 16, 3] },
  },
  {
    id: 'ref-water-name',
    type: 'symbol',
    source: 'reference',
    'source-layer': 'water_name',
    minzoom: 9,
    layout: { 'text-field': NAME, 'text-font': ['Noto Sans Italic'], 'text-size': 12, 'text-max-width': 8 },
    paint: { ...HALO, 'text-color': '#bfe3ff' },
  },
  {
    id: 'ref-waterway-name',
    type: 'symbol',
    source: 'reference',
    'source-layer': 'waterway',
    minzoom: 13,
    layout: { 'text-field': NAME, 'text-font': ['Noto Sans Italic'], 'text-size': 11, 'symbol-placement': 'line', 'symbol-spacing': 400 },
    paint: { ...HALO, 'text-color': '#bfe3ff' },
  },
  {
    id: 'ref-road-name',
    type: 'symbol',
    source: 'reference',
    'source-layer': 'transportation_name',
    minzoom: 13,
    filter: ['match', ['get', 'class'], ['motorway', 'trunk', 'primary', 'secondary', 'tertiary', 'minor'], true, false],
    layout: {
      'text-field': ['coalesce', ['get', 'name'], ['get', 'ref']],
      'text-font': ['Noto Sans Regular'],
      'text-size': ['interpolate', ['linear'], ['zoom'], 13, 10, 17, 13],
      'symbol-placement': 'line',
      'symbol-spacing': 350,
    },
    paint: { ...HALO, 'text-color': '#f3f0e6' },
  },
  {
    id: 'ref-place-minor',
    type: 'symbol',
    source: 'reference',
    'source-layer': 'place',
    minzoom: 13,
    filter: ['match', ['get', 'class'], ['hamlet', 'suburb', 'quarter', 'neighbourhood', 'isolated_dwelling', 'locality'], true, false],
    layout: { 'text-field': NAME, 'text-font': ['Noto Sans Regular'], 'text-size': 11, 'text-max-width': 8 },
    paint: { ...HALO, 'text-color': '#e8e8e8' },
  },
  {
    id: 'ref-place-village',
    type: 'symbol',
    source: 'reference',
    'source-layer': 'place',
    minzoom: 10,
    filter: ['==', ['get', 'class'], 'village'],
    layout: { 'text-field': NAME, 'text-font': ['Noto Sans Regular'], 'text-size': ['interpolate', ['linear'], ['zoom'], 10, 11, 15, 14], 'text-max-width': 8 },
    paint: HALO,
  },
  {
    id: 'ref-place-town',
    type: 'symbol',
    source: 'reference',
    'source-layer': 'place',
    minzoom: 7,
    filter: ['==', ['get', 'class'], 'town'],
    layout: { 'text-field': NAME, 'text-font': ['Noto Sans Regular'], 'text-size': ['interpolate', ['linear'], ['zoom'], 7, 11, 14, 16], 'text-max-width': 8 },
    paint: HALO,
  },
  {
    id: 'ref-place-city',
    type: 'symbol',
    source: 'reference',
    'source-layer': 'place',
    minzoom: 4,
    filter: ['==', ['get', 'class'], 'city'],
    layout: {
      'text-field': NAME,
      'text-font': ['Noto Sans Bold'],
      'text-size': ['interpolate', ['linear'], ['zoom'], 4, 11, 12, 18],
      'text-max-width': 8,
      'symbol-sort-key': ['get', 'rank'],
    },
    paint: HALO,
  },
  {
    id: 'ref-place-state',
    type: 'symbol',
    source: 'reference',
    'source-layer': 'place',
    minzoom: 5,
    maxzoom: 8,
    filter: ['==', ['get', 'class'], 'state'],
    layout: { 'text-field': NAME, 'text-font': ['Noto Sans Italic'], 'text-size': 12, 'text-transform': 'uppercase', 'text-letter-spacing': 0.1, 'text-max-width': 9 },
    paint: { ...HALO, 'text-color': 'rgba(255,255,255,0.85)' },
  },
  {
    id: 'ref-place-country',
    type: 'symbol',
    source: 'reference',
    'source-layer': 'place',
    maxzoom: 7,
    filter: ['==', ['get', 'class'], 'country'],
    layout: { 'text-field': NAME, 'text-font': ['Noto Sans Bold'], 'text-size': ['interpolate', ['linear'], ['zoom'], 2, 11, 6, 15], 'text-max-width': 8 },
    paint: HALO,
  },
]

export const styleFor = (b: Basemap) => (b === 'satellite' ? satelliteStyle() : mapStyleUrl)

/** Prefix of sources and layers owned by agmeo; kept when the basemap changes. */
export const OWN = 'agmeo-'
