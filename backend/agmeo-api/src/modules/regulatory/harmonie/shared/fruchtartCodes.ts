/**
 * Mapping from agmeo crop names to the ENNI (Niedersachsen) Dube2.5 fruchtart
 * codes. Schleswig-Holstein ships its own Berechnungsstammdaten with partly
 * colliding code strings — see endo/fruchtartCodesSh.ts.
 */

import type { AgmeoCropKey } from '../types.js';

export type FruchtartInfo = {
  code: string;
  bezeichnung: string;
};

/**
 * A crop with no entry has no Dube2.5 code. The export preflight then reports it
 * as a missing crop mapping and the user supplies an override, which is safer
 * than filing "Sonstige Fläche" on an official report.
 */
export const DEFAULT_CROP_TO_FRUCHTART: Readonly<
  Record<AgmeoCropKey, FruchtartInfo>
> = {
  winterWheat: {
    code: 'WGetreide001',
    bezeichnung: 'Winterweizen, A/B, 14% RP',
  },
  hardWheat: { code: 'WGetreide001', bezeichnung: 'Winterweizen, A/B, 14% RP' },
  winterRyeBaking: {
    code: 'WGetreide003',
    bezeichnung: 'Winterroggen, 11 % RP',
  },
  winterBarleyFodder: {
    code: 'WGetreide002',
    bezeichnung: 'Wintergerste, 12 % RP',
  },
  triticaleFodder: { code: 'WGetreide008', bezeichnung: 'Triticale, 12 % RP' },
  spelt: { code: 'WGetreide009', bezeichnung: 'Dinkel' },
  springBarleyMalting: {
    code: 'SGetreide001',
    bezeichnung: 'Braugerste 10 % RP',
  },
  springWheatFodder: {
    code: 'SGetreide003',
    bezeichnung: 'Sommerweizen, A/B, 14 % RP',
  },
  springOatsFodder: { code: 'SGetreide006', bezeichnung: 'Hafer, 11 % RP' },
  silageMaize: { code: 'Mais005', bezeichnung: 'Silomais (32 % TS)' },
  grainMaize: { code: 'Mais001', bezeichnung: 'Körnermais/CCM (86 % TS)' },
  canola: { code: 'Oelsaat005', bezeichnung: 'Raps, 23 % RP, Winter-' },
  sunflower: { code: 'Oelsaat007', bezeichnung: 'Sonnenblume, 20 % RP' },
  sugarBeet: { code: 'Hackfrucht001', bezeichnung: 'Zuckerrüben' },
  potatoTableLate: { code: 'Hackfrucht007', bezeichnung: 'Kartoffeln' },
  peasDry: { code: 'Legum007', bezeichnung: 'Körnererbsen' },
  peasDryFodder: { code: 'Legum007', bezeichnung: 'Körnererbsen' },
  broadBeans: { code: 'Legum001', bezeichnung: 'Ackerbohne' },
  soybeanBeans: { code: 'Legum010', bezeichnung: 'Sojabohnen' },
  lupine: { code: 'Legum008', bezeichnung: 'Lupinen' },
  alfalfa: {
    code: 'Feldgras006',
    bezeichnung: 'Luzerne (3-4 Schnitte/Jahr) [TM]',
  },
  fieldGrassWiltedSilage: {
    code: 'Feldgras001',
    bezeichnung: 'Ackergras (3-4 Schnitte) [TM]',
  },
  permanentGrasslandWiltedSilage: {
    code: 'GL009',
    bezeichnung: 'Grünland 4-Schnittnutzung (90 dt/ha TM)',
  },
  grassSeed: {
    code: 'Feldgras001',
    bezeichnung: 'Ackergras (3-4 Schnitte) [TM]',
  },
  cerealRyeIntercrop: {
    code: 'ZFrucht028',
    bezeichnung: 'Gründüngungszwischenfrucht ohne Leguminosen',
  },
  mustardIntercrop: {
    code: 'ZFrucht028',
    bezeichnung: 'Gründüngungszwischenfrucht ohne Leguminosen',
  },
  oilRadishIntercrop: {
    code: 'ZFrucht028',
    bezeichnung: 'Gründüngungszwischenfrucht ohne Leguminosen',
  },
  phaceliaIntercrop: {
    code: 'ZFrucht028',
    bezeichnung: 'Gründüngungszwischenfrucht ohne Leguminosen',
  },
  persianCloverIntercrop: {
    code: 'ZFrucht051',
    bezeichnung: 'Futterzwischenfrucht <= 50% Leguminosen',
  },
  landscapeFeature: { code: 'Sonstige001', bezeichnung: 'Sonstige Fläche' },
  nonProductiveArea: { code: 'Sonstige001', bezeichnung: 'Sonstige Fläche' },
  ryeWholePlantSilage: {
    code: 'WGetreide003',
    bezeichnung: 'Winterroggen, 11 % RP',
  },
  winterOats: { code: 'SGetreide006', bezeichnung: 'Hafer, 11 % RP' },
  springRye: { code: 'SGetreide005', bezeichnung: 'Sommerroggen, 11 % RP' },
  springTriticale: {
    code: 'SGetreide007',
    bezeichnung: 'Sommertriticale, 12 % RP',
  },
  springCanola: { code: 'Oelsaat006', bezeichnung: 'Raps, 23 % RP, Sommer-' },
  springDurum: {
    code: 'SGetreide004',
    bezeichnung: 'Sommerweizen, E, 16 % RP',
  },
  winterBroadBeans: { code: 'Legum001', bezeichnung: 'Ackerbohne' },
  winterPeas: { code: 'Legum007', bezeichnung: 'Körnererbsen' },
  potatoStarch: { code: 'Hackfrucht009', bezeichnung: 'Stärkekartoffeln' },
  seedPotato: {
    code: 'Hackfrucht008',
    bezeichnung: 'Pflanzgut (Vermehrung) für alle Kartoffeln',
  },
  potatoTableEarly: {
    code: 'Hackfrucht005',
    bezeichnung: 'Frühe Speisekartoffeln bis 15. Juni',
  },
  cornCobMix: { code: 'Mais001', bezeichnung: 'Körnermais/CCM (86 % TS)' },
  maizeBiogas: { code: 'Mais003', bezeichnung: 'Biogasmais (35 % TS)' },
  sorghum: { code: 'Mais011', bezeichnung: 'Sorghum-Hirse' },
  linseed: { code: 'Oelsaat008', bezeichnung: 'Öllein' },
  fodderBeet: { code: 'Hackfrucht002', bezeichnung: 'Futterrüben' },
  vetch: { code: 'Legum006', bezeichnung: 'Wicken, zur Körnernutzung' },
  lentils: { code: 'Legum009', bezeichnung: 'Linsen' },
  clover: {
    code: 'Feldgras003',
    bezeichnung: 'Rotklee (3-4 Schnitte/Jahr) [TM]',
  },
  cloverGrass: {
    code: 'Feldgras007',
    bezeichnung: 'Kleegras (Grasanteil überw., 3-4 Schnitte) [TM]',
  },
  ryegrassUndersow: {
    code: 'Feldgras001',
    bezeichnung: 'Ackergras (3-4 Schnitte) [TM]',
  },
  cloverGrassUndersow: {
    code: 'Feldgras007',
    bezeichnung: 'Kleegras (Grasanteil überw., 3-4 Schnitte) [TM]',
  },
  onion: { code: 'Zwiebel001', bezeichnung: 'Speisezwiebel' },

  intercropMixture: {
    code: 'ZFrucht029',
    bezeichnung: 'Gründüngungszwischenfrucht mit <= 50% Leguminosen',
  },
  blackOatIntercrop: {
    code: 'ZFrucht028',
    bezeichnung: 'Gründüngungszwischenfrucht ohne Leguminosen',
  },
  buckwheatIntercrop: {
    code: 'ZFrucht028',
    bezeichnung: 'Gründüngungszwischenfrucht ohne Leguminosen',
  },
  sunflowerIntercrop: {
    code: 'ZFrucht028',
    bezeichnung: 'Gründüngungszwischenfrucht ohne Leguminosen',
  },
  nigerIntercrop: {
    code: 'ZFrucht028',
    bezeichnung: 'Gründüngungszwischenfrucht ohne Leguminosen',
  },
  sorghumIntercrop: {
    code: 'ZFrucht028',
    bezeichnung: 'Gründüngungszwischenfrucht ohne Leguminosen',
  },
  linseedIntercrop: {
    code: 'ZFrucht028',
    bezeichnung: 'Gründüngungszwischenfrucht ohne Leguminosen',
  },
  camelinaIntercrop: {
    code: 'ZFrucht028',
    bezeichnung: 'Gründüngungszwischenfrucht ohne Leguminosen',
  },
  vetchIntercrop: {
    code: 'ZFrucht030',
    bezeichnung: 'Gründüngungszwischenfrucht mit > 50% Leguminosen',
  },
  crimsonCloverIntercrop: {
    code: 'ZFrucht030',
    bezeichnung: 'Gründüngungszwischenfrucht mit > 50% Leguminosen',
  },
  alexandrineCloverIntercrop: {
    code: 'ZFrucht030',
    bezeichnung: 'Gründüngungszwischenfrucht mit > 50% Leguminosen',
  },
  serradellaIntercrop: {
    code: 'ZFrucht030',
    bezeichnung: 'Gründüngungszwischenfrucht mit > 50% Leguminosen',
  },
};

export const FRUCHTART_CATALOGUE: FruchtartInfo[] = [
  { code: 'WGetreide001', bezeichnung: 'Winterweizen, A/B, 14% RP' },
  { code: 'WGetreide002', bezeichnung: 'Wintergerste, 12 % RP' },
  { code: 'WGetreide003', bezeichnung: 'Winterroggen, 11 % RP' },
  { code: 'WGetreide004', bezeichnung: 'Winterroggen Hybridroggen 12 % RP' },
  { code: 'WGetreide005', bezeichnung: 'Wintertriticale, 12 % RP' },
  { code: 'WGetreide006', bezeichnung: 'Winterweizen, C, 12% RP' },
  { code: 'WGetreide007', bezeichnung: 'Winterweizen, E, 16% RP' },
  { code: 'WGetreide008', bezeichnung: 'Triticale, 12 % RP' },
  { code: 'WGetreide009', bezeichnung: 'Dinkel' },
  { code: 'SGetreide001', bezeichnung: 'Braugerste 10 % RP' },
  { code: 'SGetreide002', bezeichnung: 'Futtergerste, 11 % RP' },
  { code: 'SGetreide003', bezeichnung: 'Sommerweizen, A/B, 14 % RP' },
  { code: 'SGetreide004', bezeichnung: 'Sommerweizen, E, 16 % RP' },
  { code: 'SGetreide005', bezeichnung: 'Sommerroggen, 11 % RP' },
  { code: 'SGetreide006', bezeichnung: 'Hafer, 11 % RP' },
  { code: 'SGetreide007', bezeichnung: 'Sommertriticale, 12 % RP' },
  { code: 'SGetreide008', bezeichnung: 'Menggetreide, 12 % RP' },
  { code: 'Mais001', bezeichnung: 'Körnermais/CCM (86 % TS)' },
  { code: 'Mais002', bezeichnung: 'Biogasmais (28 % TS)' },
  { code: 'Mais003', bezeichnung: 'Biogasmais (35 % TS)' },
  { code: 'Mais004', bezeichnung: 'Silomais (28 % TS)' },
  { code: 'Mais005', bezeichnung: 'Silomais (32 % TS)' },
  { code: 'Mais006', bezeichnung: 'Silomais (35 % TS)' },
  { code: 'Mais007', bezeichnung: 'Lieschkolbenschrot (LKS) (55 % TS)' },
  { code: 'Mais011', bezeichnung: 'Sorghum-Hirse' },
  { code: 'Oelsaat001', bezeichnung: 'Winterraps, Erucasäurereich' },
  { code: 'Oelsaat002', bezeichnung: 'Winterraps, Erucasäurearm (00)' },
  { code: 'Oelsaat003', bezeichnung: 'Sommerraps, Erucasäurereich' },
  { code: 'Oelsaat004', bezeichnung: 'Sommerraps, Erucasäurearm (00)' },
  { code: 'Oelsaat005', bezeichnung: 'Raps, 23 % RP, Winter-' },
  { code: 'Oelsaat006', bezeichnung: 'Raps, 23 % RP, Sommer-' },
  { code: 'Oelsaat007', bezeichnung: 'Sonnenblume, 20 % RP' },
  { code: 'Oelsaat008', bezeichnung: 'Öllein' },
  { code: 'Hackfrucht001', bezeichnung: 'Zuckerrüben' },
  { code: 'Hackfrucht002', bezeichnung: 'Futterrüben' },
  { code: 'Hackfrucht003', bezeichnung: 'Gehaltsrüben' },
  { code: 'Hackfrucht004', bezeichnung: 'Masserüben' },
  { code: 'Hackfrucht005', bezeichnung: 'Frühe Speisekartoffeln bis 15. Juni' },
  {
    code: 'Hackfrucht006',
    bezeichnung: 'Frühe Speisekartoffeln ab 15. Juni bis 31. Juli',
  },
  { code: 'Hackfrucht007', bezeichnung: 'Kartoffeln' },
  {
    code: 'Hackfrucht008',
    bezeichnung: 'Pflanzgut (Vermehrung) für alle Kartoffeln',
  },
  { code: 'Hackfrucht009', bezeichnung: 'Stärkekartoffeln' },
  { code: 'Legum001', bezeichnung: 'Ackerbohne' },
  { code: 'Legum002', bezeichnung: 'Futtererbsen' },
  { code: 'Legum003', bezeichnung: 'Blaue Süßlupinen' },
  { code: 'Legum004', bezeichnung: 'Gelbe Süßlupinen' },
  { code: 'Legum005', bezeichnung: 'Weiße Süßlupinen' },
  { code: 'Legum006', bezeichnung: 'Wicken, zur Körnernutzung' },
  { code: 'Legum007', bezeichnung: 'Körnererbsen' },
  { code: 'Legum008', bezeichnung: 'Lupinen' },
  { code: 'Legum009', bezeichnung: 'Linsen' },
  { code: 'Legum010', bezeichnung: 'Sojabohnen' },
  { code: 'Feldgras001', bezeichnung: 'Ackergras (3-4 Schnitte) [TM]' },
  { code: 'Feldgras002', bezeichnung: 'Ackergras (5 Schnitte) [TM]' },
  { code: 'Feldgras003', bezeichnung: 'Rotklee (3-4 Schnitte/Jahr) [TM]' },
  { code: 'Feldgras004', bezeichnung: 'Rotklee (5 Schnitte/Jahr) [TM]' },
  { code: 'Feldgras005', bezeichnung: 'Luzerne (5 Schnitte/Jahr) [TM]' },
  { code: 'Feldgras006', bezeichnung: 'Luzerne (3-4 Schnitte/Jahr) [TM]' },
  {
    code: 'Feldgras007',
    bezeichnung: 'Kleegras (Grasanteil überw., 3-4 Schnitte) [TM]',
  },
  {
    code: 'Feldgras008',
    bezeichnung: 'Kleegras (Grasanteil überw., 5 Schnitte) [TM]',
  },
  {
    code: 'Feldgras009',
    bezeichnung: 'Kleegras (Kleeanteil überw., 3-4 Schnitte) [TM]',
  },
  {
    code: 'Feldgras010',
    bezeichnung: 'Kleegras (Kleeanteil überw., 5 Schnitte) [TM]',
  },
  {
    code: 'Feldgras018',
    bezeichnung: 'Kleegras (Grasanteil >50%, 3-4 Schnitte/Jahr) [TM]',
  },
  { code: 'GL001', bezeichnung: 'Grünland 1-Schnittnutzung (25 dt/ha TM)' },
  { code: 'GL002', bezeichnung: 'Grünland 2-Schnittnutzung (45 dt/ha TM)' },
  { code: 'GL003', bezeichnung: 'Grünland 3-Schnittnutzung (60 dt/ha TM)' },
  { code: 'GL004', bezeichnung: 'Grünland 3-Schnittnutzung (70 dt/ha TM)' },
  { code: 'GL005', bezeichnung: 'Grünland 3-Schnittnutzung (80 dt/ha TM)' },
  { code: 'GL006', bezeichnung: 'Grünland 4-Schnittnutzung (70 dt/ha TM)' },
  { code: 'GL007', bezeichnung: 'Grünland 4-Schnittnutzung (80 dt/ha TM)' },
  { code: 'GL008', bezeichnung: 'Grünland 4-Schnittnutzung (85 dt/ha TM)' },
  { code: 'GL009', bezeichnung: 'Grünland 4-Schnittnutzung (90 dt/ha TM)' },
  { code: 'GL010', bezeichnung: 'Grünland 5-Schnittnutzung (95 dt/ha TM)' },
  { code: 'GL011', bezeichnung: 'Grünland 5-Schnittnutzung (100 dt/ha TM)' },
  { code: 'GL021', bezeichnung: 'Weide extensiv [TM]' },
  { code: 'GL022', bezeichnung: 'Weide intensiv [TM]' },
  { code: 'GL023', bezeichnung: 'Mähweide extensiv [TM]' },
  { code: 'GL024', bezeichnung: 'Mähweide mittelintensiv [TM]' },
  { code: 'GL025', bezeichnung: 'Mähweide intensiv [TM]' },
  {
    code: 'ZFrucht028',
    bezeichnung: 'Gründüngungszwischenfrucht ohne Leguminosen',
  },
  {
    code: 'ZFrucht029',
    bezeichnung: 'Gründüngungszwischenfrucht mit <= 50% Leguminosen',
  },
  {
    code: 'ZFrucht030',
    bezeichnung: 'Gründüngungszwischenfrucht mit > 50% Leguminosen',
  },
  { code: 'ZFrucht041', bezeichnung: 'Futterzwischenfrucht ohne Leguminosen' },
  {
    code: 'ZFrucht051',
    bezeichnung: 'Futterzwischenfrucht <= 50% Leguminosen',
  },
  { code: 'ZFrucht052', bezeichnung: 'Futterzwischenfrucht > 50% Leguminosen' },
  { code: 'Zwiebel001', bezeichnung: 'Speisezwiebel' },
  { code: 'Zwiebel006', bezeichnung: 'Zwiebel, Trocken-' },
  { code: 'Sonstige001', bezeichnung: 'Sonstige Fläche' },
];

export function getFruchtart(
  cropName: string,
  overrides?: Record<string, string>,
): FruchtartInfo | undefined {
  if (overrides?.[cropName]) {
    const code = overrides[cropName];
    const catalogEntry = FRUCHTART_CATALOGUE.find((f) => f.code === code);
    if (catalogEntry) return catalogEntry;
    return { code, bezeichnung: code };
  }

  const defaultMapping = DEFAULT_CROP_TO_FRUCHTART[cropName] as
    FruchtartInfo | undefined;
  if (defaultMapping) return defaultMapping;

  return undefined;
}

const ENNI_CODES = new Set(FRUCHTART_CATALOGUE.map((f) => f.code));

export function isFruchtartInStammdaten(code: string): boolean {
  return ENNI_CODES.has(code);
}

/** Horticulture in the ENNI catalogue: only the `Zwiebel…` family so far. */
export function isGartenbauFruchtart(code: string | undefined): boolean {
  return !!code && /^(Zwiebel|Gemuese|Gemüse)/.test(code);
}

export function searchFruchtartCatalogue(query: string): FruchtartInfo[] {
  const lowerQuery = query.toLowerCase();
  return FRUCHTART_CATALOGUE.filter(
    (f) =>
      f.code.toLowerCase().includes(lowerQuery) ||
      f.bezeichnung.toLowerCase().includes(lowerQuery),
  );
}
