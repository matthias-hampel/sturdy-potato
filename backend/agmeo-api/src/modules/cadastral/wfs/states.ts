/**
 * Cadastre (ALKIS) WFS services of the German federal states, ported from the reference's
 * lib/cadastral/states.ts. 15 of 16 states are openly accessible; Bayern needs a paid LDBV
 * framework contract and is marked `blocked`.
 *
 * Schemas (feature-type names of the services are kept verbatim):
 *   inspire_cp  INSPIRE cp:CadastralParcel (NI NW SH HE HH BB MV ST BW SL)
 *   adv_ave     AdV "ALKIS vereinfacht" ave:Flurstueck (SN TH RP, Bremen's app:flurstuecke)
 *   be_local    Berlin's own alkis_flurstuecke:flurstuecke
 */
import type { UtmCrs } from './utm.js';

export type CadastralSchema = 'inspire_cp' | 'adv_ave' | 'be_local';

export const FEDERAL_STATE_CODES = ['SH', 'HH', 'NI', 'HB', 'NW', 'HE', 'RP', 'BW', 'BY', 'SL', 'BE', 'BB', 'MV', 'SN', 'ST', 'TH'] as const;
export type FederalStateCode = (typeof FEDERAL_STATE_CODES)[number];

export interface FederalStateConfig {
  code: FederalStateCode;
  name: string;
  wfsUrl: string;
  typeName: string;
  /** All states answer in ETRS89/UTM (easting, northing). */
  crs: UtmCrs;
  schema: CadastralSchema;
  reliability: 'high' | 'medium' | 'blocked';
  expectedLatencyMs: number;
  coverageNote: string;
  /** Source credit required by the data licences (dl-de/by-2-0 and similar). */
  attribution: string;
  /** Rough WGS 84 extent [west, south, east, north] for routing a geometry to its state. */
  bbox: [number, number, number, number];
}

export const FEDERAL_STATES: Record<FederalStateCode, FederalStateConfig> = {
  SH: {
    code: 'SH',
    name: 'Schleswig-Holstein',
    wfsUrl: 'https://service.gdi-sh.de/SH_INSPIREDOWNLOAD_AI_CP_ALKIS',
    typeName: 'cp:CadastralParcel',
    crs: 'EPSG:25832',
    schema: 'inspire_cp',
    reliability: 'high',
    expectedLatencyMs: 400,
    coverageNote: '',
    attribution: '© GeoBasis-DE/LVermGeo SH',
    bbox: [7.86, 53.36, 11.32, 55.06],
  },
  HH: {
    code: 'HH',
    name: 'Hamburg',
    wfsUrl: 'https://geodienste.hamburg.de/HH_WFS_INSPIRE_Flurstuecke',
    typeName: 'cp:CadastralParcel',
    crs: 'EPSG:25832',
    schema: 'inspire_cp',
    reliability: 'high',
    expectedLatencyMs: 600,
    coverageNote: '',
    attribution: '© Freie und Hansestadt Hamburg, LGV',
    bbox: [8.42, 53.39, 10.33, 53.74],
  },
  NI: {
    code: 'NI',
    name: 'Niedersachsen',
    wfsUrl: 'https://www.inspire.niedersachsen.de/doorman/noauth/alkis-dls-cp',
    typeName: 'cp:CadastralParcel',
    crs: 'EPSG:25832',
    schema: 'inspire_cp',
    reliability: 'high',
    expectedLatencyMs: 500,
    coverageNote: '',
    attribution: '© LGLN',
    bbox: [6.65, 51.3, 11.61, 53.89],
  },
  HB: {
    code: 'HB',
    name: 'Bremen',
    wfsUrl: 'https://geodienste.bremen.de/wfs_hduk2958loah3976niun',
    typeName: 'app:flurstuecke',
    crs: 'EPSG:25832',
    schema: 'adv_ave',
    reliability: 'high',
    expectedLatencyMs: 600,
    coverageNote: '',
    attribution: '© GeoInformation Bremen',
    bbox: [8.48, 53.01, 8.99, 53.61],
  },
  NW: {
    code: 'NW',
    name: 'Nordrhein-Westfalen',
    wfsUrl: 'https://www.wfs.nrw.de/geobasis/wfs_nw_inspire-flurstuecke_alkis',
    typeName: 'cp:CadastralParcel',
    crs: 'EPSG:25832',
    schema: 'inspire_cp',
    reliability: 'high',
    expectedLatencyMs: 500,
    coverageNote: '',
    attribution: '© Geobasis NRW',
    bbox: [5.87, 50.32, 9.46, 52.53],
  },
  HE: {
    code: 'HE',
    name: 'Hessen',
    wfsUrl: 'https://inspire-hessen.de/ows/services/org.2.d66ec21e-39e7-45c4-bf68-438e8baea882_wfs',
    typeName: 'cp:CadastralParcel',
    crs: 'EPSG:25832',
    schema: 'inspire_cp',
    reliability: 'high',
    expectedLatencyMs: 600,
    coverageNote: '',
    attribution: '© HVBG',
    bbox: [7.77, 49.39, 10.24, 51.66],
  },
  RP: {
    code: 'RP',
    name: 'Rheinland-Pfalz',
    wfsUrl: 'https://geo5.service24.rlp.de/wfs/alkis_rp.fcgi',
    typeName: 'ave:Flurstueck',
    crs: 'EPSG:25832',
    schema: 'adv_ave',
    reliability: 'high',
    expectedLatencyMs: 800,
    coverageNote: '',
    attribution: '© GeoBasis-DE / LVermGeoRP',
    bbox: [6.11, 48.97, 8.51, 50.94],
  },
  BW: {
    code: 'BW',
    name: 'Baden-Württemberg',
    wfsUrl: 'https://owsproxy.lgl-bw.de/owsproxy/wfs/WFS_INSP_BW_Flst_ALKIS',
    typeName: 'cp:CadastralParcel',
    crs: 'EPSG:25832',
    schema: 'inspire_cp',
    reliability: 'high',
    expectedLatencyMs: 1000,
    coverageNote: '',
    attribution: '© LGL, www.lgl-bw.de',
    bbox: [7.51, 47.53, 10.49, 49.79],
  },
  BY: {
    code: 'BY',
    name: 'Bayern',
    wfsUrl: 'https://geoservices.bayern.de/wfs/v1/ogc_alkis_ave.cgi',
    typeName: 'ave:Flurstueck',
    crs: 'EPSG:25832',
    schema: 'adv_ave',
    reliability: 'blocked',
    expectedLatencyMs: 0,
    coverageNote: 'paid LDBV framework contract required',
    attribution: '© LDBV',
    bbox: [8.98, 47.27, 13.83, 50.56],
  },
  SL: {
    code: 'SL',
    name: 'Saarland',
    wfsUrl: 'https://geoportal.saarland.de/gdi-sl/inspirewfs_Flurstuecke_Grundstuecke_ALKIS',
    typeName: 'cp:CadastralParcel',
    crs: 'EPSG:25832',
    schema: 'inspire_cp',
    reliability: 'medium',
    expectedLatencyMs: 1500,
    coverageNote: '',
    attribution: '© GeoBasis DE/LVGL-SL',
    bbox: [6.36, 49.11, 7.4, 49.64],
  },
  BE: {
    code: 'BE',
    name: 'Berlin',
    wfsUrl: 'https://gdi.berlin.de/services/wfs/alkis_flurstuecke',
    typeName: 'alkis_flurstuecke:flurstuecke',
    crs: 'EPSG:25833',
    schema: 'be_local',
    reliability: 'high',
    expectedLatencyMs: 500,
    coverageNote: '',
    attribution: '© Geoportal Berlin',
    bbox: [13.09, 52.34, 13.76, 52.68],
  },
  BB: {
    code: 'BB',
    name: 'Brandenburg',
    wfsUrl: 'https://inspire.brandenburg.de/services/cp_alkis_wfs',
    typeName: 'cp:CadastralParcel',
    crs: 'EPSG:25833',
    schema: 'inspire_cp',
    reliability: 'high',
    expectedLatencyMs: 500,
    coverageNote: '',
    attribution: '© GeoBasis-DE/LGB',
    bbox: [11.27, 51.36, 14.77, 53.56],
  },
  MV: {
    code: 'MV',
    name: 'Mecklenburg-Vorpommern',
    wfsUrl: 'https://www.geodaten-mv.de/dienste/inspire_cp_alkis_download',
    typeName: 'cp:CadastralParcel',
    crs: 'EPSG:25833',
    schema: 'inspire_cp',
    reliability: 'high',
    expectedLatencyMs: 500,
    coverageNote: '',
    attribution: '© GeoBasis-DE/M-V',
    bbox: [10.59, 53.11, 14.41, 54.69],
  },
  SN: {
    code: 'SN',
    name: 'Sachsen',
    wfsUrl: 'https://geodienste.sachsen.de/aaa/public_alkis/vereinf/wfs',
    typeName: 'ave:Flurstueck',
    crs: 'EPSG:25833',
    schema: 'adv_ave',
    reliability: 'high',
    expectedLatencyMs: 500,
    coverageNote: '',
    attribution: '© GeoSN',
    bbox: [11.87, 50.16, 15.04, 51.69],
  },
  ST: {
    code: 'ST',
    name: 'Sachsen-Anhalt',
    wfsUrl: 'https://geodatenportal.sachsen-anhalt.de/ows_INSPIRE_LVermGeo_ALKIS_CP_WFS',
    typeName: 'cp:CadastralParcel',
    crs: 'EPSG:25832',
    schema: 'inspire_cp',
    reliability: 'high',
    expectedLatencyMs: 500,
    coverageNote: '',
    attribution: '© GeoBasis-DE / LVermGeo ST',
    bbox: [10.56, 50.93, 13.19, 53.04],
  },
  TH: {
    code: 'TH',
    name: 'Thüringen',
    wfsUrl: 'https://www.geoproxy.geoportal-th.de/geoproxy/services/adv_alkis_v2_wfs',
    typeName: 'ave:Flurstueck',
    crs: 'EPSG:25832',
    schema: 'adv_ave',
    reliability: 'high',
    expectedLatencyMs: 800,
    coverageNote: '',
    attribution: '© GDI-Th',
    bbox: [9.87, 50.2, 12.65, 51.65],
  },
};
