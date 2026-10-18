/**
 * ENDO-SH Fruchtart codes — the Schleswig-Holstein Berechnungsstammdaten
 * (generated table in fruchtartCatalogueSh.ts).
 *
 * The SH dialect is NOT the ENNI catalogue: several code strings exist in both
 * with a different meaning (WGetreide001 = Winterweizen in ENNI, Dinkel in SH;
 * Hackfrucht001 = Zuckerrüben vs. Futterrüben). agmeo crops are therefore
 * mapped separately here, matched by Bezeichnung. Crops without an unambiguous
 * SH counterpart stay unmapped so the preflight asks for an override instead
 * of filing a wrong crop.
 */

import type { FruchtartInfo } from '../shared/fruchtartCodes.js';
import type { AgmeoCropKey } from '../types.js';
import { FRUCHTART_CATALOGUE_SH_ROWS } from './fruchtartCatalogueSh.js';

export type FruchtartInfoSh = FruchtartInfo & {
  /** Dube2.5 `dvo_fruchtgruppe` (Wintergetreide, Gartenbaukulturen, Grünland, …) */
  gruppe: string;
  /** Dube2.5 `dvo_fruchtklasse` (Hauptfrucht, Nebenfrucht, Zwischenfrucht, Grünland, Brache) */
  klasse: string;
};

export const FRUCHTART_CATALOGUE_SH: FruchtartInfoSh[] =
  FRUCHTART_CATALOGUE_SH_ROWS.map(([code, bezeichnung, gruppe, klasse]) => ({
    code,
    bezeichnung,
    gruppe,
    klasse,
  }));

const BY_CODE = new Map(FRUCHTART_CATALOGUE_SH.map((f) => [f.code, f]));

const GRUENDUENGUNG_OHNE_LEGUMINOSEN = 'ZFrucht028';
const GRUENDUENGUNG_UEBER_50_LEGUMINOSEN = 'ZFrucht034';

/** agmeo crop → SH frucht_id. */
export const DEFAULT_CROP_TO_FRUCHTART_SH: Readonly<
  Record<AgmeoCropKey, string>
> = {
  winterWheat: 'WGetreide008',
  hardWheat: 'WGetreide017',
  onion: 'Zwiebel006',
  winterRyeBaking: 'WGetreide004',
  winterBarleyFodder: 'WGetreide002',
  triticaleFodder: 'WGetreide006',
  spelt: 'WGetreide001',
  winterOats: 'WGetreide015',
  einkorn: 'WGetreide013',
  emmer: 'SGetreide014',
  springBarleyMalting: 'SGetreide001',
  springWheatFodder: 'SGetreide010',
  springOatsFodder: 'SGetreide004',
  springRye: 'SGetreide008',
  springTriticale: 'SGetreide009',
  springDurum: 'SGetreide011',
  buckwheat: 'SGetreide003',
  millet: 'SGetreide015',
  quinoa: 'SGetreide017',
  silageMaize: 'Mais005',
  maizeBiogas: 'Mais005',
  grainMaize: 'Mais002',
  cornCobMix: 'Mais002',
  canola: 'Oelsaat005',
  springCanola: 'Oelsaat007',
  sunflower: 'Oelsaat008',
  linseed: 'Oelsaat004',
  hemp: 'Oelsaat017',
  poppy: 'Oelsaat013',
  sugarBeet: 'Hackfrucht011',
  fodderBeet: 'Hackfrucht001',
  potatoTableLate: 'Hackfrucht004',
  potatoStarch: 'Hackfrucht004',
  seedPotato: 'Hackfrucht004',
  potatoTableEarly: 'Hackfrucht003',
  peasDry: 'Legu019',
  peasDryFodder: 'Legu019',
  winterPeas: 'Legu020',
  broadBeans: 'Legu017',
  winterBroadBeans: 'Legu018',
  soybeanBeans: 'Legu005',
  lupine: 'Legu004',
  lentils: 'Legu014',
  chickpeas: 'Legu015',
  vetch: 'Legu032',
  alfalfa: 'Feldgras021',
  alfalfaGrass: 'Feldgras019',
  clover: 'Feldgras020',
  cloverGrass: 'Feldgras018',
  fieldGrassWiltedSilage: 'Feldgras017',
  grassSeed: 'Feldgras006',
  ryegrassUndersow: 'Feldgras017',
  cloverGrassUndersow: 'Feldgras018',
  permanentGrasslandWiltedSilage: 'GL009',
  ryeWholePlantSilage: 'Energie026',
  nonProductiveArea: 'Brache018',
  cerealRyeIntercrop: GRUENDUENGUNG_OHNE_LEGUMINOSEN,
  mustardIntercrop: GRUENDUENGUNG_OHNE_LEGUMINOSEN,
  oilRadishIntercrop: GRUENDUENGUNG_OHNE_LEGUMINOSEN,
  phaceliaIntercrop: GRUENDUENGUNG_OHNE_LEGUMINOSEN,
  blackOatIntercrop: GRUENDUENGUNG_OHNE_LEGUMINOSEN,
  buckwheatIntercrop: GRUENDUENGUNG_OHNE_LEGUMINOSEN,
  sunflowerIntercrop: GRUENDUENGUNG_OHNE_LEGUMINOSEN,
  nigerIntercrop: GRUENDUENGUNG_OHNE_LEGUMINOSEN,
  sorghumIntercrop: GRUENDUENGUNG_OHNE_LEGUMINOSEN,
  linseedIntercrop: GRUENDUENGUNG_OHNE_LEGUMINOSEN,
  camelinaIntercrop: GRUENDUENGUNG_OHNE_LEGUMINOSEN,
  intercropMixture: 'ZFrucht032',
  persianCloverIntercrop: 'ZFrucht042',
  vetchIntercrop: GRUENDUENGUNG_UEBER_50_LEGUMINOSEN,
  crimsonCloverIntercrop: GRUENDUENGUNG_UEBER_50_LEGUMINOSEN,
  alexandrineCloverIntercrop: GRUENDUENGUNG_UEBER_50_LEGUMINOSEN,
  serradellaIntercrop: GRUENDUENGUNG_UEBER_50_LEGUMINOSEN,
};

export function getFruchtartSh(
  cropName: string,
  overrides?: Record<string, string>,
): FruchtartInfoSh | undefined {
  const code: string | undefined =
    overrides?.[cropName] ?? DEFAULT_CROP_TO_FRUCHTART_SH[cropName];
  if (!code) return undefined;
  return (
    BY_CODE.get(code) ?? { code, bezeichnung: code, gruppe: '', klasse: '' }
  );
}

export function isFruchtartInStammdatenSh(code: string): boolean {
  return BY_CODE.has(code);
}

export function isGartenbauFruchtartSh(code: string | undefined): boolean {
  return !!code && BY_CODE.get(code)?.gruppe === 'Gartenbaukulturen';
}

export function searchFruchtartCatalogueSh(query: string): FruchtartInfoSh[] {
  const q = query.toLowerCase();
  return FRUCHTART_CATALOGUE_SH.filter(
    (f) =>
      f.code.toLowerCase().includes(q) ||
      f.bezeichnung.toLowerCase().includes(q),
  );
}
