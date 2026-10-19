/**
 * Anlage 1 — Kulturen und Code-Nummern (HF_Nr) of the Sachsen-Anhalt
 * Mitteilungspflicht (Stand 12/2025), plus the Zwischenfrucht list (codes
 * 6–14). agmeo crops are mapped by the DüV crop name (`DUEV_CROP_DATA[crop]
 * .duevName` where one exists); crops without an unambiguous Anlage 1 entry
 * stay unmapped so the preflight asks for an override.
 *
 * Ported from agmeo `src/lib/federalExport/harmonie-export/st/codes/kulturen.ts`.
 */

import type { AgmeoCropKey } from '../../types.js';

export type StKulturEinteilung =
  | 'Ackerland'
  | 'Gemüse'
  | 'Grünland/mehrschnittiger Feldfutterbau'
  | 'Zwischenfrucht';

export type StKultur = {
  code: string;
  bezeichnung: string;
  einteilung: StKulturEinteilung;
};

const AL = 'Ackerland';
const GE = 'Gemüse';
const GL = 'Grünland/mehrschnittiger Feldfutterbau';
const ZF = 'Zwischenfrucht';

const ROWS: readonly (readonly [string, string, StKulturEinteilung])[] = [
  ['793101', 'Arzneifenchel, Samen', AL],
  ['797101', 'Baldrian, Wurzel', AL],
  ['768101', 'Bohnenkraut, blühendes Kraut', AL],
  ['695101', 'Buchweizen', AL],
  ['832101', 'Buchweizen Ganzpflanze', AL],
  ['690101', 'Corn-Cob-Mix (CCM)', AL],
  ['396101', 'Dauerbrache Ackerland', AL],
  ['691101', 'Dinkel', AL],
  ['798101', 'Dost, blühendes Kraut, 1. Standjahr', AL],
  ['799101', 'Dost, blühendes Kraut, nach 1. Standjahr', AL],
  ['789101', 'Durchwachsene Silphie, Anlagejahr', AL],
  ['790101', 'Durchwachsene Silphie, Erntejahr', AL],
  ['726101', 'einjähriges, einschnittiges Ackergras', AL],
  ['692101', 'Emmer', AL],
  ['708101', 'Esparsette Ganzpflanze', AL],
  ['795101', 'Färberwaid, Blatt', AL],
  ['711101', 'Faserhanf Ganzpflanze', AL],
  ['712101', 'Flachs (Faserlein) Ganzpflanze', AL],
  ['242101', 'Frühkartoffel', AL],
  ['718101', 'Futterkohl Ganzpflanze', AL],
  ['717101', 'Futterraps Ganzpflanze', AL],
  ['719101', 'Futterrübsen Ganzpflanze', AL],
  ['731101', 'Gehaltsrüben', AL],
  ['725101', 'Gemenge mit Leguminosenanteil > 75 % Ganzpflanze', AL],
  ['723101', 'Gemenge mit Leguminosenanteil > 0 bis 30 % Ganzpflanze', AL],
  ['724101', 'Gemenge mit Leguminosenanteil > 30 bis 75 % Ganzpflanze', AL],
  ['397101', 'Gemüse ohne Kohlarten (nur Vorfrucht)', AL],
  ['769101', 'Goldrute, Blühhorizont', AL],
  ['714101', 'Grünmais Ganzpflanze', AL],
  ['811101', 'Hanf (Öl); Samen', AL],
  ['233101', 'Hartweizen (Sommerdurum)', AL],
  ['235101', 'Hartweizen (Winterdurum)', AL],
  ['829101', 'Hopfen; lufttrocken', AL],
  ['810101', 'Hülsenfrucht-/Nichtleguminosengemenge zur Körnergewinnung', AL],
  ['809101', 'Hülsenfruchtgemenge zur Körnergewinnung', AL],
  ['800101', 'Iberischer Drachenkopf, Samen', AL],
  ['770101', 'Johanniskraut, Blühhorizont', AL],
  ['771101', 'Kamille, blühendes Kraut', AL],
  ['772101', 'Kapuzinerkresse, blühendes Kraut', AL],
  ['243101', 'Kartoffel', AL],
  ['729101', 'Kenaf Ganzpflanze', AL],
  ['739101', 'Klee-/Luzernevermehrung', AL],
  ['398101', 'Kohlgemüse (nur Vorfrucht)', AL],
  ['774101', 'Kornblume, blühendes Kraut', AL],
  ['773101', 'Kornblume, Blüte', AL],
  ['761101', 'Körnerhirse', AL],
  ['232101', 'Körnermais', AL],
  ['738101', 'Krambe (Ölkrambe)', AL],
  ['794101', 'Kümmel, Frucht (Droge)', AL],
  ['821101', 'Landsberger Gemenge; Ganzpflanze', AL],
  [
    '823101',
    'Leg.-/ Nichtleg.-Gemenge (Winter); Ganzpflanze, Legum.anteil >0-30%',
    AL,
  ],
  [
    '824101',
    'Leg.-/ Nichtleg.-Gemenge (Winter); Ganzpflanze, Legum.anteil >30-75%',
    AL,
  ],
  [
    '825101',
    'Leg.-/ Nichtleg.-Gemenge (Winter); Ganzpflanze, Legum.anteil >75%',
    AL,
  ],
  [
    '826101',
    'Leguminosen-Gemenge (fein- und/oder grobkörnig); Sommer, Ganzpflanze',
    AL,
  ],
  [
    '827101',
    'Leguminosen-Gemenge (fein- und/oder grobkörnig); Winter, Ganzpflanze',
    AL,
  ],
  ['737101', 'Leindotter', AL],
  ['816101', 'Liesch-Kolben-Schrot', AL],
  ['302101', 'Linsen zur Körnergewinnung', AL],
  ['700101', 'Lupine blau zur Körnergewinnung', AL],
  ['705101', 'Lupine Ganzpflanze', AL],
  ['775101', 'Majoran, Kraut bei Blühbeginn', AL],
  ['776101', 'Malve, blühendes Kraut', AL],
  ['732101', 'Masserüben', AL],
  ['812101', 'Miscanthus (Ganzpflanze); 1. Standjahr', AL],
  ['813101', 'Miscanthus (Ganzpflanze); 2. Standjahr', AL],
  ['713101', 'Miscanthus (Ganzpflanze); nach 2. Standjahr', AL],
  ['777101', 'Mohn, Saat', AL],
  ['778101', 'Mutterkraut, blühendes Kraut', AL],
  ['819101', 'Nichtleguminosen-Gemenge (Sommer); Ganzpflanze', AL],
  ['820101', 'Nichtleguminosen-Gemenge (Winter); Ganzpflanze', AL],
  ['239101', 'Öllein', AL],
  ['835101', 'Ölrettich (Samen)', AL],
  ['818101', 'Ölrettich; Ganzpflanze', AL],
  ['779101', 'Pfefferminze, nicht blühendes Kraut', AL],
  ['814101', 'Pflanzkartoffeln', AL],
  ['834101', 'Phacelia (Samen)', AL],
  ['722101', 'Phacelia Ganzpflanze', AL],
  ['780101', 'Ringelblume, blühendes Kraut', AL],
  ['781101', 'Ringelblume, Blüte', AL],
  ['394101', 'Rotationsbrache mit Leguminosen Ackerland', AL],
  ['395101', 'Rotationsbrache ohne Leguminosen Ackerland', AL],
  ['741101', 'Rübensamenvermehrung', AL],
  ['796101', 'Saflor, Samen', AL],
  ['783101', 'Salbei, nicht blühendes Kraut nach 1. Standjahr', AL],
  ['782101', 'Salbei, nicht blühendes Kraut, Ansaatjahr bzw. Pflanzjahr', AL],
  ['736101', 'Senf', AL],
  ['720101', 'Senf Ganzpflanze', AL],
  ['702101', 'Serradella Ganzpflanze', AL],
  ['740101', 'Serradellavermehrung', AL],
  ['244101', 'Silomais', AL],
  ['265101', 'Sojabohnen zur Körnergewinnung', AL],
  ['703101', 'Sommer-Ackerbohne Ganzpflanze', AL],
  ['366101', 'Sommer-Ackerbohnen zur Körnergewinnung', AL],
  ['704101', 'Sommer-Erbse Ganzpflanze', AL],
  ['262101', 'Sommer-Erbse zur Körnergewinnung', AL],
  ['765101', 'Sommer-Gemenge, Leguminosenanteil >0-30 %', AL],
  ['766101', 'Sommer-Gemenge, Leguminosenanteil >30- 75 %', AL],
  ['767101', 'Sommer-Gemenge, Leguminosenanteil >75 %', AL],
  ['229101', 'Sommergerste (Brau)', AL],
  ['228101', 'Sommergerste (Futter)', AL],
  ['710101', 'Sommergetreide Ganzpflanze', AL],
  ['803101', 'Sommer-Getreide-Gemenge', AL],
  ['267101', 'Sommerhafer', AL],
  ['237101', 'Sommerraps', AL],
  ['694101', 'Sommerroggen', AL],
  ['227101', 'Sommertriticale', AL],
  ['234101', 'Sommerweizen', AL],
  ['721101', 'Sonnenblume Ganzpflanze', AL],
  ['238101', 'Sonnenblumen', AL],
  ['707101', 'sonstige einjährige Körnerleguminosen Ganzpflanze', AL],
  ['701101', 'sonstige Leguminosen zur Körnergewinnung', AL],
  ['784101', 'Spitzwegerich, Kraut', AL],
  ['716101', 'Sudangras Ganzpflanze', AL],
  ['801101', 'Süßkartoffel', AL],
  ['263101', 'Süßlupinen zur Körnergewinnung', AL],
  ['817101', 'Szarvasi-/Riesenweizengras; Anlagejahr, 1 Schnitt', AL],
  ['727101', 'Tabak (lufttrocken)', AL],
  ['785101', 'Thymian, blühendes Kraut, 1. Standjahr', AL],
  ['786101', 'Thymian, blühendes Kraut, nach 1.Standjahr', AL],
  ['728101', 'Topinambur Ganzpflanze', AL],
  ['706101', 'Wicke Ganzpflanze', AL],
  ['808101', 'Wicke zur Körnergewinnung', AL],
  ['822101', 'Wickroggen; Ganzpflanze', AL],
  ['742101', 'Winter-Ackerbohne Ganzpflanze', AL],
  ['264101', 'Winter-Ackerbohnen zur Körnergewinnung', AL],
  ['743101', 'Winter-Erbse Ganzpflanze', AL],
  ['699101', 'Winter-Erbse zur Körnergewinnung', AL],
  ['762101', 'Winter-Gemenge, Leguminosenanteil > 0-30 %', AL],
  ['763101', 'Winter-Gemenge, Leguminosenanteil >30-75 %', AL],
  ['764101', 'Winter-Gemenge, Leguminosenanteil >75 %', AL],
  ['225101', 'Wintergerste', AL],
  ['230101', 'Wintergerste (Brau)', AL],
  ['709101', 'Wintergetreide Ganzpflanze', AL],
  ['802101', 'Winter-Getreide-Gemenge', AL],
  ['231101', 'Winterhafer', AL],
  ['236101', 'Winterraps', AL],
  ['226101', 'Winterroggen', AL],
  ['833101', 'Winterrübsen (Samen)', AL],
  ['245101', 'Wintertriticale', AL],
  ['224101', 'Winterweizen A, B', AL],
  ['246101', 'Winterweizen C', AL],
  ['247101', 'Winterweizen E', AL],
  ['815101', 'Wirtschaftskartoffeln', AL],
  ['788101', 'Zitronenmelisse, nicht blühendes Kraut, nach 1. Standjahr', AL],
  ['787101', 'Zitronenmelisse, nicht blühendes Kraut, Pflanzjahr', AL],
  ['715101', 'Zuckerhirse (Sorghum) Ganzpflanze', AL],
  ['240101', 'Zuckerrübe ohne Blattbergung', AL],
  ['241101', 'Zuckerrüben mit Blattbergung', AL],
  ['830101', 'Zwiebel, Bund-', AL],
  ['831101', 'Zwiebel, Trocken', AL],
  ['149301', 'Blumenkohl', GE],
  ['150301', 'Brokkoli', GE],
  ['151301', 'Buschbohnen', GE],
  ['152301', 'Chicoreerüben', GE],
  ['153301', 'Chinakohl', GE],
  ['154301', 'Dill, Frischmarkt', GE],
  ['155301', 'Dill, Industrieware', GE],
  ['290301', 'Erdbeere, Frühjahr', GE],
  ['291301', 'Erdbeere, nach Ernte', GE],
  ['292301', 'Erdbeere, Pflanzung', GE],
  ['156301', 'Feldsalat', GE],
  ['157301', 'Feldsalat, großblättrig', GE],
  ['158301', 'Gemüseerbse', GE],
  ['159301', 'Grünkohl', GE],
  ['160301', 'Gurke, Einleger', GE],
  ['161301', 'Knollenfenchel', GE],
  ['162301', 'Kohlrabi', GE],
  ['163301', 'Kürbis', GE],
  ['164301', 'Mairüben (mit Laub)', GE],
  ['293301', 'Meerrettich', GE],
  ['165301', 'Möhren, Bund-', GE],
  ['166301', 'Möhren, Industrie', GE],
  ['167301', 'Möhren, Wasch-', GE],
  ['168301', 'Pastinake', GE],
  ['169301', 'Petersilie, Blatt-, bis 1. Schnitt', GE],
  ['170301', 'Petersilie, Blatt-, nach einem Schnitt', GE],
  ['171301', 'Petersilie, Wurzel-', GE],
  ['172301', 'Porree, gepflanzt', GE],
  ['173301', 'Radies', GE],
  ['174301', 'Rettich, Bund-', GE],
  ['175301', 'Rettich, deutsch', GE],
  ['176301', 'Rettich, japanisch', GE],
  ['177301', 'Rhabarber 1. Standjahr', GE],
  ['178301', 'Rhabarber 2. Standjahr Austrieb', GE],
  ['179301', 'Rhabarber 2. Standjahr nach Ernte', GE],
  ['180301', 'Rhabarber 3. Standjahr Austrieb', GE],
  ['181301', 'Rhabarber 3. Standjahr nach Ernte', GE],
  ['182301', 'Rhabarber ab 4. Standjahr Austrieb', GE],
  ['183301', 'Rhabarber ab 4. Standjahr nach Ernte', GE],
  ['184301', 'Rosenkohl', GE],
  ['185301', 'Rote Rüben', GE],
  ['186301', 'Rotkohl', GE],
  ['187301', 'Rucola, Feinware', GE],
  ['188301', 'Rucola, Grobware', GE],
  ['189301', 'Salate, Baby Leaf Lettuce', GE],
  ['190301', 'Salate, Blatt-, grün (Lollo, Eichblatt, Krul)', GE],
  ['191301', 'Salate, Blatt-, rot (Lollo, Eichblatt, Krul)', GE],
  ['192301', 'Salate, Eissalat', GE],
  ['193301', 'Salate, Endivien, Frisee', GE],
  ['194301', 'Salate, Endivien, glattblattrig', GE],
  ['195301', 'Salate, Kopfsalat', GE],
  ['196301', 'Salate, Radicchio', GE],
  ['197301', 'Salate, Romana', GE],
  ['198301', 'Salate, Romana Herzen', GE],
  ['207301', 'Salate, verschiedene Arten', GE],
  ['199301', 'Salate, Zuckerhut', GE],
  ['200301', 'Schnittlauch, Anbau für Treiberei', GE],
  ['201301', 'Schnittlauch, gesät, bis 1. Schnitt', GE],
  ['202301', 'Schnittlauch, nach einem Schnitt', GE],
  ['203301', 'Schwarzwurzel', GE],
  ['204301', 'Sellerie, Bund-', GE],
  ['205301', 'Sellerie, Knollen-', GE],
  ['206301', 'Sellerie, Stangen-', GE],
  ['208301', 'Spargel 1. Standjahr', GE],
  ['209301', 'Spargel 2. Standjahr', GE],
  ['210301', 'Spargel 3. Standjahr', GE],
  ['211301', 'Spargel ab 4. Standjahr', GE],
  ['288301', 'Spinat', GE],
  ['212301', 'Spinat, Blatt-, FM, Baby', GE],
  ['213301', 'Spinat, Blatt-, Standard', GE],
  ['214301', 'Spinat, Hack, Standard', GE],
  ['215301', 'Stangenbohne, Standard', GE],
  ['216301', 'Teltower Rübchen (Herbstanbau)', GE],
  ['217301', 'Weißkohl, Frischmarkt', GE],
  ['218301', 'Weißkohl, Industrie', GE],
  ['219301', 'Wirsing', GE],
  ['220301', 'Zucchini', GE],
  ['221301', 'Zuckermais', GE],
  ['222301', 'Zwiebel, Bund-', GE],
  ['223301', 'Zwiebel, Trocken', GE],
  ['397201', 'Ackergras (2 Schnitte/Jahr)', GL],
  ['260201', 'Ackergras (3 - 4 Schnitte/Jahr)', GL],
  ['251201', 'Ackergras (5 Schnitte/Jahr)', GL],
  ['396201', 'Dauerbrache Grünland', GL],
  ['401201', 'Kleegras (30:70)', GL],
  ['402201', 'Kleegras (50:50)', GL],
  ['403201', 'Kleegras (70:30)', GL],
  ['252201', 'Luzerne-/Rotklee in Reinkultur', GL],
  ['404201', 'Luzernegras (30:70)', GL],
  ['405201', 'Luzernegras (50:50)', GL],
  ['406201', 'Luzernegras (70:30)', GL],
  ['261201', 'Mähweiden, 20 % Weideanteil', GL],
  ['400201', 'Mähweiden, 40 % Weideanteil', GL],
  ['248201', 'Mähweiden, 60 % Weideanteil', GL],
  ['399201', 'Mähweiden, 80 % Weideanteil', GL],
  ['392201', 'Rotationsbrache mit Leguminosen Grünland', GL],
  ['393201', 'Rotationsbrache ohne Leguminosen Grünland', GL],
  ['398201', 'Szarvasi-/Riesenweizengras (ab 2 Schnitte)', GL],
  ['253201', 'Weide extensiv', GL],
  ['250201', 'Weide intensiv', GL],
  ['249201', 'Wiesen 1-Schnittnutzung', GL],
  ['255201', 'Wiesen 2-Schnittnutzung', GL],
  ['256201', 'Wiesen 3-Schnittnutzung', GL],
  ['257201', 'Wiesen 4-Schnittnutzung', GL],
  ['258201', 'Wiesen 5-Schnittnutzung', GL],
  ['259201', 'Wiesen 6-Schnittnutzung', GL],
  ['6', 'Nichtleguminose, abgefroren', ZF],
  ['7', 'Nichtleguminose, nicht abgefroren, im Frühjahr eingearbeitet', ZF],
  ['8', 'Nichtleguminose, nicht abgefroren, im Herbst eingearbeitet', ZF],
  ['9', 'Leguminose, abgefroren', ZF],
  ['10', 'Leguminose, nicht abgefroren, im Frühjahr eingearbeitet', ZF],
  ['11', 'Leguminose, nicht abgefroren, im Herbst eingearbeitet', ZF],
  ['12', 'Futterleguminosen mit Nutzung', ZF],
  ['13', 'andere Zwischenfrüchte mit Nutzung', ZF],
  ['14', '-------ohne-------', ZF],
];

export const ST_KULTUREN: StKultur[] = ROWS.map(
  ([code, bezeichnung, einteilung]) => ({
    code,
    bezeichnung,
    einteilung,
  }),
);

const BY_CODE = new Map(ST_KULTUREN.map((k) => [k.code, k]));

const ZWISCHENFRUCHT_NICHTLEGUMINOSE = '6';
const ZWISCHENFRUCHT_LEGUMINOSE = '9';

/** agmeo crop → HF_Nr. Comments carry the DüV name (`DUEV_CROP_DATA.duevName`) the entry was matched on. */
const DEFAULT_CROP_TO_ST: Readonly<Record<AgmeoCropKey, string>> = {
  winterWheat: '224101', // Winterweizen A/B
  hardWheat: '235101', // Hartweizen (Winterdurum)
  canola: '236101', // Winterraps
  winterBarleyFodder: '225101', // Wintergerste
  winterRyeBaking: '226101', // Winterroggen
  triticaleFodder: '245101', // Wintertriticale
  springBarleyMalting: '229101', // Sommergerste (Brau)
  springOatsFodder: '267101', // Hafer
  silageMaize: '244101', // Silomais
  grainMaize: '232101', // Körnermais
  sugarBeet: '240101', // Zuckerrübe (ohne Blattbergung)
  potatoTableLate: '243101', // Kartoffel
  sunflower: '238101', // Sonnenblume
  spelt: '691101', // Dinkel (DüV proxy Winterweizen C)
  ryeWholePlantSilage: '709101', // Wintergetreide Ganzpflanze
  peasDry: '262101', // Erbsen (Sommer-Erbse zur Körnergewinnung)
  peasDryFodder: '262101',
  broadBeans: '366101', // Ackerbohnen
  soybeanBeans: '265101', // Sojabohnen
  lupine: '263101', // Lupinen (Süßlupinen zur Körnergewinnung)
  alfalfa: '252201', // Luzerne (Luzerne-/Rotklee in Reinkultur)
  fieldGrassWiltedSilage: '251201', // Ackergras 5-Schnitt
  permanentGrasslandWiltedSilage: '257201', // Wiesen 4-Schnittnutzung
  grassSeed: '260201', // Ackergras 3-4-Schnitt (DüV proxy)
  springWheatFodder: '234101',
  winterOats: '231101',
  springRye: '694101',
  springTriticale: '227101',
  springCanola: '237101',
  springDurum: '233101',
  winterBroadBeans: '264101',
  winterPeas: '699101',
  potatoStarch: '815101',
  seedPotato: '814101',
  potatoTableEarly: '242101',
  cornCobMix: '690101',
  maizeBiogas: '244101',
  buckwheat: '695101',
  millet: '761101',
  grainSorghum: '761101', // Körnerhirse
  lentils: '302101',
  linseed: '239101',
  hemp: '811101',
  poppy: '777101',
  vetch: '808101',
  emmer: '692101',
  clover: '252201',
  cloverGrass: '402201',
  alfalfaGrass: '405201',
  nonProductiveArea: '396101',
  cerealRyeIntercrop: ZWISCHENFRUCHT_NICHTLEGUMINOSE,
  mustardIntercrop: ZWISCHENFRUCHT_NICHTLEGUMINOSE,
  oilRadishIntercrop: ZWISCHENFRUCHT_NICHTLEGUMINOSE,
  phaceliaIntercrop: ZWISCHENFRUCHT_NICHTLEGUMINOSE,
  intercropMixture: ZWISCHENFRUCHT_NICHTLEGUMINOSE,
  blackOatIntercrop: ZWISCHENFRUCHT_NICHTLEGUMINOSE,
  buckwheatIntercrop: ZWISCHENFRUCHT_NICHTLEGUMINOSE,
  sunflowerIntercrop: ZWISCHENFRUCHT_NICHTLEGUMINOSE,
  nigerIntercrop: ZWISCHENFRUCHT_NICHTLEGUMINOSE,
  sorghumIntercrop: ZWISCHENFRUCHT_NICHTLEGUMINOSE,
  linseedIntercrop: ZWISCHENFRUCHT_NICHTLEGUMINOSE,
  camelinaIntercrop: ZWISCHENFRUCHT_NICHTLEGUMINOSE,
  persianCloverIntercrop: ZWISCHENFRUCHT_LEGUMINOSE,
  vetchIntercrop: ZWISCHENFRUCHT_LEGUMINOSE,
  crimsonCloverIntercrop: ZWISCHENFRUCHT_LEGUMINOSE,
  alexandrineCloverIntercrop: ZWISCHENFRUCHT_LEGUMINOSE,
  serradellaIntercrop: ZWISCHENFRUCHT_LEGUMINOSE,
  onion: '831101', // Zwiebel, Trocken
};

export function getStKultur(
  cropName: string,
  overrides?: Record<string, string>,
): StKultur | undefined {
  const code =
    overrides?.[cropName] ??
    (Object.hasOwn(DEFAULT_CROP_TO_ST, cropName)
      ? DEFAULT_CROP_TO_ST[cropName]
      : undefined);
  if (!code) return undefined;
  return (
    BY_CODE.get(code) ?? { code, bezeichnung: code, einteilung: 'Ackerland' }
  );
}

export function isStKulturCode(code: string): boolean {
  return BY_CODE.has(code);
}
