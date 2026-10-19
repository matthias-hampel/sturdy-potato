/** Ported from agmeo `src/lib/federalExport/harmonie-export/besyd/fruchtartCodes.ts`. */

export type BesydFruchtartInfo = {
  code: string;
  bezeichnung: string;
  category: string;
};

export const DEFAULT_CROP_TO_BESYD: Record<string, BesydFruchtartInfo> = {
  // Winter cereals
  winterWheat: {
    code: '0102',
    bezeichnung: 'Winterweizen, A/B',
    category: 'Wintergetreide',
  },
  hardWheat: {
    code: '0104',
    bezeichnung: 'Winterhartweizen (Durum)',
    category: 'Wintergetreide',
  },
  winterRyeBaking: {
    code: '0106',
    bezeichnung: 'Winterroggen',
    category: 'Wintergetreide',
  },
  winterBarleyFodder: {
    code: '0108',
    bezeichnung: 'Wintergerste',
    category: 'Wintergetreide',
  },
  triticaleFodder: {
    code: '0110',
    bezeichnung: 'Wintertriticale',
    category: 'Wintergetreide',
  },
  spelt: { code: '0112', bezeichnung: 'Dinkel', category: 'Wintergetreide' },

  // Spring cereals
  springBarleyMalting: {
    code: '0202',
    bezeichnung: 'Sommergerste (Braugerste)',
    category: 'Sommergetreide',
  },
  springWheatFodder: {
    code: '0204',
    bezeichnung: 'Sommerweizen',
    category: 'Sommergetreide',
  },
  springOatsFodder: {
    code: '0206',
    bezeichnung: 'Hafer',
    category: 'Sommergetreide',
  },

  // Maize
  silageMaize: { code: '0411', bezeichnung: 'Silomais', category: 'Mais' },
  grainMaize: { code: '0401', bezeichnung: 'Körnermais', category: 'Mais' },
  sorghumBiogas: {
    code: '0420',
    bezeichnung: 'Sorghum-Hirse',
    category: 'Mais',
  },

  // Oilseeds
  canola: { code: '0501', bezeichnung: 'Winterraps', category: 'Ölsaaten' },
  springCanola: {
    code: '0502',
    bezeichnung: 'Sommerraps',
    category: 'Ölsaaten',
  },
  sunflower: { code: '0510', bezeichnung: 'Sonnenblume', category: 'Ölsaaten' },

  // Root crops
  sugarBeet: {
    code: '0601',
    bezeichnung: 'Zuckerrüben',
    category: 'Hackfrüchte',
  },
  potatoTableLate: {
    code: '0610',
    bezeichnung: 'Kartoffeln',
    category: 'Hackfrüchte',
  },

  // Legumes
  peasDry: {
    code: '0301',
    bezeichnung: 'Körnererbsen',
    category: 'Körnerleguminosen',
  },
  peasDryFodder: {
    code: '0301',
    bezeichnung: 'Körnererbsen',
    category: 'Körnerleguminosen',
  },
  broadBeans: {
    code: '0304',
    bezeichnung: 'Ackerbohne',
    category: 'Körnerleguminosen',
  },
  winterBroadBeans: {
    code: '0304',
    bezeichnung: 'Ackerbohne',
    category: 'Körnerleguminosen',
  },
  soybeanBeans: {
    code: '0308',
    bezeichnung: 'Sojabohne',
    category: 'Körnerleguminosen',
  },
  lupine: {
    code: '0307',
    bezeichnung: 'Lupine',
    category: 'Körnerleguminosen',
  },
  alfalfaFodder: { code: '1023', bezeichnung: 'Luzerne', category: 'Feldgras' },

  // Field grass and grassland
  fieldGrassWiltedSilage: {
    code: '1001',
    bezeichnung: 'Ackergras',
    category: 'Feldgras',
  },
  permanentGrasslandWiltedSilage: {
    code: '1501',
    bezeichnung: 'Grünland',
    category: 'Grünland',
  },
  grassSeed: {
    code: '1040',
    bezeichnung: 'Grassamenvermehrung',
    category: 'Feldgras',
  },

  // Intercrops
  cerealRyeIntercrop: {
    code: '2010',
    bezeichnung: 'Gründüngungszwischenfrucht ohne Leguminosen',
    category: 'Zwischenfrüchte',
  },
  mustardIntercrop: {
    code: '2010',
    bezeichnung: 'Gründüngungszwischenfrucht ohne Leguminosen',
    category: 'Zwischenfrüchte',
  },
  oilRadishIntercrop: {
    code: '2010',
    bezeichnung: 'Gründüngungszwischenfrucht ohne Leguminosen',
    category: 'Zwischenfrüchte',
  },
  phaceliaIntercrop: {
    code: '2010',
    bezeichnung: 'Gründüngungszwischenfrucht ohne Leguminosen',
    category: 'Zwischenfrüchte',
  },
  persianCloverIntercrop: {
    code: '2020',
    bezeichnung: 'Zwischenfrucht mit Leguminosen',
    category: 'Zwischenfrüchte',
  },

  // Other
  floweringStrip: {
    code: '9001',
    bezeichnung: 'Blühstreifen',
    category: 'Sonstige',
  },
  landscapeFeature: {
    code: '9000',
    bezeichnung: 'Sonstige Fläche',
    category: 'Sonstige',
  },
  nonProductiveArea: {
    code: '9000',
    bezeichnung: 'Sonstige Fläche',
    category: 'Sonstige',
  },

  // Whole plant silage
  ryeWholePlantSilage: {
    code: '0106',
    bezeichnung: 'Winterroggen (GPS)',
    category: 'Wintergetreide',
  },
};

export const BESYD_FRUCHTART_CATALOGUE: BesydFruchtartInfo[] = [
  // Wintergetreide
  {
    code: '0102',
    bezeichnung: 'Winterweizen, A/B',
    category: 'Wintergetreide',
  },
  { code: '0103', bezeichnung: 'Winterweizen, C', category: 'Wintergetreide' },
  {
    code: '0104',
    bezeichnung: 'Winterhartweizen (Durum)',
    category: 'Wintergetreide',
  },
  { code: '0105', bezeichnung: 'Winterweizen, E', category: 'Wintergetreide' },
  { code: '0106', bezeichnung: 'Winterroggen', category: 'Wintergetreide' },
  {
    code: '0107',
    bezeichnung: 'Winterroggen (Hybridroggen)',
    category: 'Wintergetreide',
  },
  { code: '0108', bezeichnung: 'Wintergerste', category: 'Wintergetreide' },
  { code: '0110', bezeichnung: 'Wintertriticale', category: 'Wintergetreide' },
  { code: '0112', bezeichnung: 'Dinkel', category: 'Wintergetreide' },

  // Sommergetreide
  {
    code: '0201',
    bezeichnung: 'Sommergerste (Futtergerste)',
    category: 'Sommergetreide',
  },
  {
    code: '0202',
    bezeichnung: 'Sommergerste (Braugerste)',
    category: 'Sommergetreide',
  },
  { code: '0204', bezeichnung: 'Sommerweizen', category: 'Sommergetreide' },
  { code: '0205', bezeichnung: 'Sommerweizen, E', category: 'Sommergetreide' },
  { code: '0206', bezeichnung: 'Hafer', category: 'Sommergetreide' },
  { code: '0208', bezeichnung: 'Sommerroggen', category: 'Sommergetreide' },
  { code: '0210', bezeichnung: 'Sommertriticale', category: 'Sommergetreide' },

  // Körnerleguminosen
  { code: '0301', bezeichnung: 'Körnererbsen', category: 'Körnerleguminosen' },
  { code: '0304', bezeichnung: 'Ackerbohne', category: 'Körnerleguminosen' },
  { code: '0305', bezeichnung: 'Wicke', category: 'Körnerleguminosen' },
  { code: '0307', bezeichnung: 'Lupine (blau)', category: 'Körnerleguminosen' },
  { code: '0308', bezeichnung: 'Sojabohne', category: 'Körnerleguminosen' },
  { code: '0311', bezeichnung: 'Linse', category: 'Körnerleguminosen' },
  { code: '0317', bezeichnung: 'Lupine (gelb)', category: 'Körnerleguminosen' },
  { code: '0327', bezeichnung: 'Lupine (weiß)', category: 'Körnerleguminosen' },

  // Mais
  { code: '0401', bezeichnung: 'Körnermais', category: 'Mais' },
  { code: '0402', bezeichnung: 'CCM (Corn-Cob-Mix)', category: 'Mais' },
  { code: '0411', bezeichnung: 'Silomais', category: 'Mais' },
  { code: '0412', bezeichnung: 'Biogasmais', category: 'Mais' },
  { code: '0420', bezeichnung: 'Sorghum-Hirse', category: 'Mais' },

  // Ölsaaten
  { code: '0501', bezeichnung: 'Winterraps', category: 'Ölsaaten' },
  { code: '0502', bezeichnung: 'Sommerraps', category: 'Ölsaaten' },
  { code: '0510', bezeichnung: 'Sonnenblume', category: 'Ölsaaten' },
  { code: '0515', bezeichnung: 'Öllein', category: 'Ölsaaten' },

  // Hackfrüchte
  { code: '0601', bezeichnung: 'Zuckerrüben', category: 'Hackfrüchte' },
  { code: '0602', bezeichnung: 'Futterrüben', category: 'Hackfrüchte' },
  { code: '0610', bezeichnung: 'Kartoffeln', category: 'Hackfrüchte' },
  { code: '0611', bezeichnung: 'Frühkartoffeln', category: 'Hackfrüchte' },
  { code: '0615', bezeichnung: 'Stärkekartoffeln', category: 'Hackfrüchte' },

  // Feldgras
  { code: '1001', bezeichnung: 'Ackergras', category: 'Feldgras' },
  { code: '1008', bezeichnung: 'Kleegras (50:50)', category: 'Feldgras' },
  { code: '1022', bezeichnung: 'Klee allgemein', category: 'Feldgras' },
  { code: '1023', bezeichnung: 'Luzerne', category: 'Feldgras' },
  { code: '1027', bezeichnung: 'Luzernegras', category: 'Feldgras' },
  { code: '1040', bezeichnung: 'Grassamenvermehrung', category: 'Feldgras' },

  // Grünland
  { code: '1501', bezeichnung: 'Grünland', category: 'Grünland' },
  { code: '1510', bezeichnung: 'Weide extensiv', category: 'Grünland' },
  { code: '1520', bezeichnung: 'Weide intensiv', category: 'Grünland' },
  { code: '1530', bezeichnung: 'Mähweide', category: 'Grünland' },

  // Zwischenfrüchte
  {
    code: '2010',
    bezeichnung: 'Gründüngungszwischenfrucht ohne Leguminosen',
    category: 'Zwischenfrüchte',
  },
  {
    code: '2020',
    bezeichnung: 'Zwischenfrucht mit Leguminosen',
    category: 'Zwischenfrüchte',
  },
  {
    code: '2030',
    bezeichnung: 'Futterzwischenfrucht',
    category: 'Zwischenfrüchte',
  },

  // Gemüse
  { code: '6001', bezeichnung: 'Kopfkohl', category: 'Gemüse' },
  { code: '6010', bezeichnung: 'Blumenkohl', category: 'Gemüse' },
  { code: '6021', bezeichnung: 'Buschbohnen', category: 'Gemüse' },
  { code: '6050', bezeichnung: 'Möhren', category: 'Gemüse' },
  { code: '6060', bezeichnung: 'Zwiebeln', category: 'Gemüse' },

  // Sonstige
  { code: '9000', bezeichnung: 'Sonstige Fläche', category: 'Sonstige' },
  { code: '9001', bezeichnung: 'Blühstreifen', category: 'Sonstige' },
  { code: '9010', bezeichnung: 'Brache', category: 'Sonstige' },
];

export function getBesydFruchtart(
  cropName: string,
  overrides?: Record<string, string>,
): BesydFruchtartInfo | undefined {
  if (overrides?.[cropName]) {
    const code = overrides[cropName];
    const catalogEntry = BESYD_FRUCHTART_CATALOGUE.find((f) => f.code === code);
    if (catalogEntry) return catalogEntry;
    return { code, bezeichnung: code, category: 'Benutzerdefiniert' };
  }
  return DEFAULT_CROP_TO_BESYD[cropName];
}

export function searchBesydFruchtartCatalogue(
  query: string,
): BesydFruchtartInfo[] {
  const q = query.toLowerCase();
  return BESYD_FRUCHTART_CATALOGUE.filter(
    (f) =>
      f.code.toLowerCase().includes(q) ||
      f.bezeichnung.toLowerCase().includes(q) ||
      f.category.toLowerCase().includes(q),
  );
}

export function getBesydFruchtartByCategory(
  category: string,
): BesydFruchtartInfo[] {
  return BESYD_FRUCHTART_CATALOGUE.filter((f) => f.category === category);
}

export function getBesydFruchtartCategories(): string[] {
  return [...new Set(BESYD_FRUCHTART_CATALOGUE.map((f) => f.category))];
}
