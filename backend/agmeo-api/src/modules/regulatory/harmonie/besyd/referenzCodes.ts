/** Ported from agmeo `src/lib/federalExport/harmonie-export/besyd/referenzCodes.ts`. */

import type { BesydBundesland } from './types.js';

// Table 1: Bundesland
export const BUNDESLAND_CODES = {
  '12': 'Brandenburg',
  '14': 'Sachsen',
  '15': 'Sachsen-Anhalt',
  '16': 'Thüringen',
} as const;

// Table 2: Amt (Office/Authority) - for Saxony
export const AMT_CODES = {
  '1': 'Döbeln',
  '2': 'Großenhain',
  '3': 'Kamenz',
  '4': 'Löbau',
  '6': 'Wurzen',
  '8': 'Plauen',
  '9': 'Rötha',
  '10': 'Pirna',
  '13': 'Zwickau',
  '14': 'Zwönitz',
  '99': 'Amt allgemein',
} as const;

// Table 3: Berechnungsgrundlage
export const BERECHNUNGSGRUNDLAGE_CODES = {
  DV: 'Konventioneller Landbau',
  ÖL: 'Ökologischer Landbau',
} as const;

// Table 4: Boden-Klima-Raum
export type BodenKlimaRaum = {
  code: string;
  name: string;
  bundeslaender: BesydBundesland[];
};

export const BODEN_KLIMA_RAUM_CODES: BodenKlimaRaum[] = [
  {
    code: '101',
    name: 'mittlere diluviale Böden Mecklenburg-Vorpommern',
    bundeslaender: ['12'],
  },
  {
    code: '102',
    name: 'sandige diluviale Böden des nordostdeutschen Binnentieflandes',
    bundeslaender: ['12', '15'],
  },
  {
    code: '104',
    name: 'trocken-warme diluviale Böden des ostdeutschen Tieflandes',
    bundeslaender: ['12', '14', '15'],
  },
  {
    code: '105',
    name: 'vorpommersche Sandböden im Uecker-Randow-Gebiet',
    bundeslaender: ['12'],
  },
  { code: '106', name: 'Oderbruch', bundeslaender: ['12'] },
  {
    code: '107',
    name: 'Lößböden in der Ackerebene (Ost)',
    bundeslaender: ['14', '15', '16'],
  },
  {
    code: '108',
    name: 'Lößböden in den Übergangslagen (Ost)',
    bundeslaender: ['14', '15', '16'],
  },
  { code: '109', name: 'diluviale Böden der Altmark', bundeslaender: ['15'] },
  {
    code: '111',
    name: 'Verwitterungsböden in den Übergangslagen (Ost)',
    bundeslaender: ['14', '16'],
  },
  { code: '158', name: 'Nordwest-Mecklenburg / Rügen', bundeslaender: ['12'] },
  { code: '192', name: 'Harz', bundeslaender: ['15', '16'] },
  { code: '193', name: 'Rhön', bundeslaender: ['16'] },
  { code: '194', name: 'Thüringer Wald', bundeslaender: ['16'] },
  { code: '195', name: 'Erzgebirge', bundeslaender: ['14'] },
];

export function getBodenKlimaRaumByBundesland(
  bundesland: BesydBundesland,
): BodenKlimaRaum[] {
  return BODEN_KLIMA_RAUM_CODES.filter((bkr) =>
    bkr.bundeslaender.includes(bundesland),
  );
}

// Table 5: Bodenart
export const BODENART_CODES = {
  '1': 'S Sand',
  '2': 'Sl anlehmiger Sand',
  '3': 'lS lehmiger Sand',
  '4': 'SL stark lehmiger Sand',
  '5': 'sL sandiger Lehm',
  '6': 'L Lehm',
  '7': 'lT lehmiger Ton',
  '8': 'T Ton',
  '9': 'Mo anmoorig, Moor',
  '11': 'BG1 Sand',
  '12': 'BG2 schwach lehmiger Sand',
  '13': 'BG3 stark lehmiger Sand',
  '14': 'BG4 sandiger/schluffiger Lehm',
  '15': 'BG5 toniger Lehm bis Ton',
  '16': 'BG6 Moor',
} as const;

// Table 6: Entstehung
export const ENTSTEHUNG_CODES = {
  '1': 'Al Alluvialböden',
  '2': 'D Diluvialböden',
  '3': 'Lö Lößböden',
  '4': 'V Verwitterungsböden',
  '5': 'K Kippenböden',
} as const;

// Table 7: Wasserschutzgebiet
export const WASSERSCHUTZGEBIET_CODES = {
  n: 'nein',
  j: 'ja (Zone nicht bekannt)',
  '1': 'ja Wasserschutzzone I',
  '2': 'ja Wasserschutzzone II',
  '3': 'ja Wasserschutzzone III',
} as const;

// Table 8: Humuseinstufung
export const HUMUS_EINSTUFUNG_CODES = {
  '1': 'schwach humos (<2 %)',
  '2': 'humos (2 % bis 4 %)',
  '3': 'stark humos (>4 % bis <8 %)',
  '4': 'sehr stark humos (8 % bis <15 %)',
  '5': 'Anmoor (15 % bis <30 %)',
  '6': 'Hochmoor (≥30 %)',
  '7': 'Niedermoor (≥30 %)',
} as const;

// Table 10: Nebenprodukt
export const NEBENPRODUKT_CODES = {
  '1': 'Nebenprodukt abgefahren',
  '2': 'Nebenprodukt auf Schlag',
  '4': 'Haupt- und Nebenprodukt auf Schlag',
} as const;

// Table 11: Verwendung
export const VERWENDUNG_CODES = {
  '11': 'Nahrung',
  '12': 'Saat-, Pflanzgut',
  '13': 'industrielle Verarbeitung',
  '14': 'Futter',
  '15': 'bleibt auf dem Schlag',
  '21': 'Heu',
  '22': 'Silage',
  '23': 'Streu',
  '24': 'Frischfutter',
  '25': 'Kompost',
  '26': 'Weide',
  '27': 'Mulchen',
  '28': 'abgefroren',
} as const;

// Table 12: Beregnung
export const BEREGNUNG_CODES = {
  '0': 'keine Beregnung',
  '1': 'Beregnung',
} as const;

// Table 13: Bestellung
export const BESTELLUNG_CODES = {
  '127': 'Untersaat',
  '12A': 'Nachsaat',
} as const;

// Table 15: Organische Dünger
export type OrganicFertilizerCode = {
  code: string;
  name: string;
  category: string;
};

export const ORGANIC_FERTILIZER_CODES: OrganicFertilizerCode[] = [
  // Stallmist
  { code: '211', name: 'Stallmist/ Rind', category: 'Stallmist' },
  { code: '212', name: 'Stallmist/ Schwein', category: 'Stallmist' },
  { code: '213', name: 'Stallmist/ Schaf', category: 'Stallmist' },
  { code: '214', name: 'Stallmist/ Geflügel', category: 'Stallmist' },
  { code: '215', name: 'Stallmist/ Pferd', category: 'Stallmist' },
  { code: '216', name: 'Stallmist/ Ziege', category: 'Stallmist' },
  { code: '217', name: 'Stallmist/ Kaninchen', category: 'Stallmist' },
  { code: '218', name: 'Stallmist/ Gehegewild', category: 'Stallmist' },
  {
    code: '219',
    name: 'Stallmist/ Rind, Schwein (50:50)',
    category: 'Stallmist',
  },
  { code: '21a', name: 'Frischmist/ Rind (ökol.)', category: 'Stallmist' },
  { code: '21b', name: 'Rottemist/ Rind (ökol.)', category: 'Stallmist' },
  { code: '21c', name: 'Stallmist/ Masthähnchen', category: 'Stallmist' },
  { code: '21d', name: 'Stallmist/ Pute', category: 'Stallmist' },
  { code: '21e', name: 'Stallmist/ Pekingente', category: 'Stallmist' },
  { code: '21f', name: 'Stallmist/ Flugente', category: 'Stallmist' },
  { code: '21g', name: 'Stallmist/ Gänse', category: 'Stallmist' },
  { code: '998', name: 'Stallmist andere', category: 'Stallmist' },

  // Jauche
  { code: '221', name: 'Jauche/ Rind', category: 'Jauche' },
  { code: '222', name: 'Jauche/ Schwein', category: 'Jauche' },
  { code: '229', name: 'Jauche/ Rind, Schwein (50:50)', category: 'Jauche' },

  // Gülle
  { code: '231', name: 'Gülle dünn/ Rind', category: 'Gülle' },
  { code: '232', name: 'Gülle dünn/ Schwein', category: 'Gülle' },
  { code: '234', name: 'Gülle dünn/ Geflügel', category: 'Gülle' },
  { code: '241', name: 'Gülle normal/ Rind', category: 'Gülle' },
  { code: '242', name: 'Gülle normal/ Schwein', category: 'Gülle' },
  { code: '244', name: 'Gülle normal/ Geflügel', category: 'Gülle' },
  {
    code: '249',
    name: 'Gülle normal/ Rind, Schwein (50:50)',
    category: 'Gülle',
  },
  { code: '251', name: 'Gülle dick/ Rind', category: 'Gülle' },
  { code: '252', name: 'Gülle dick/ Schwein', category: 'Gülle' },
  { code: '254', name: 'Gülle dick/ Geflügel', category: 'Gülle' },
  { code: '999', name: 'Gülle andere', category: 'Gülle' },

  // Geflügelkot
  { code: '272', name: 'Hühnerfrischkot', category: 'Geflügelkot' },
  { code: '274', name: 'Hühnertrockenkot', category: 'Geflügelkot' },
  { code: '277', name: 'getrockneter Hühnerkot', category: 'Geflügelkot' },

  // Pflanzenrückstände
  { code: '361', name: 'Stroh', category: 'Pflanzenrückstände' },
  {
    code: '362',
    name: 'Grünmasse Blatt/Kraut',
    category: 'Pflanzenrückstände',
  },
  {
    code: '363',
    name: 'Grünmasse Zw.frucht/Frucht',
    category: 'Pflanzenrückstände',
  },
  {
    code: '364',
    name: 'Ernterückstände Gemüse',
    category: 'Pflanzenrückstände',
  },
  {
    code: '365',
    name: 'Rebenhäcksel (Hopfen)',
    category: 'Pflanzenrückstände',
  },

  // Klärschlamm
  { code: '480', name: 'Klärschlamm fest (≥15%TM)', category: 'Klärschlamm' },
  {
    code: '481',
    name: 'Klärschlamm flüssig (<15%TM)',
    category: 'Klärschlamm',
  },
  { code: '48g', name: 'Klärschlammkompost', category: 'Klärschlamm' },

  // Kompost
  { code: '482', name: 'Grüngutkompost', category: 'Kompost' },
  { code: '485', name: 'Stallmistkompost', category: 'Kompost' },
  { code: '486', name: 'Bioabfallkompost', category: 'Kompost' },
  {
    code: '48a',
    name: 'Stallmistkompost 1-3 Monate (ökol.)',
    category: 'Kompost',
  },
  {
    code: '48b',
    name: 'Stallmistkompost 7-9 Monate (ökol.)',
    category: 'Kompost',
  },
  {
    code: '48c',
    name: 'Stallmistkompost 13-15 Monate (ökol.)',
    category: 'Kompost',
  },
  {
    code: '48d',
    name: 'Stallmistkompost 19-21 Monate (ökol.)',
    category: 'Kompost',
  },

  // Gärrückstände
  {
    code: '487',
    name: 'Gärrückstand tier. flüssig',
    category: 'Gärrückstände',
  },
  {
    code: '488',
    name: 'Gärrückstand pflanzl. Sub. flüssig',
    category: 'Gärrückstände',
  },
  { code: '48e', name: 'Gärrückstand tier. fest', category: 'Gärrückstände' },
  {
    code: '48f',
    name: 'Gärrückstand pflanzl. Sub. fest',
    category: 'Gärrückstände',
  },
  {
    code: '48h',
    name: 'Gärrückstand tier. / pflanzl. flüssig',
    category: 'Gärrückstände',
  },
  {
    code: '48i',
    name: 'Gärrückstand tier. / pflanzl. fest',
    category: 'Gärrückstände',
  },

  // Tierische Produkte
  { code: '483', name: 'Fleischknochenmehl', category: 'Tierische Produkte' },
  { code: '484', name: 'Knochenmehl', category: 'Tierische Produkte' },
  {
    code: '526',
    name: 'Hornmehl, -gries, -späne',
    category: 'Tierische Produkte',
  },
  { code: '527', name: 'Haar- und Federnmehl', category: 'Tierische Produkte' },
  {
    code: '528',
    name: 'Provita Haarmehl-Pellets',
    category: 'Tierische Produkte',
  },
  { code: '535', name: 'Schafwolle', category: 'Tierische Produkte' },
  { code: '536', name: 'Schafwollpellets', category: 'Tierische Produkte' },
  { code: '537', name: 'Molke', category: 'Tierische Produkte' },
  { code: '558', name: 'Federmehl', category: 'Tierische Produkte' },
  { code: '559', name: 'Blutmehl', category: 'Tierische Produkte' },
  { code: '560', name: 'Fischmehl', category: 'Tierische Produkte' },

  // Pflanzliche Produkte
  { code: '501', name: 'Ackerbohnenschrot', category: 'Pflanzliche Produkte' },
  { code: '502', name: 'Erbsenschrot', category: 'Pflanzliche Produkte' },
  { code: '503', name: 'Lupinenschrot', category: 'Pflanzliche Produkte' },
  { code: '504', name: 'Rapsschrot', category: 'Pflanzliche Produkte' },
  { code: '505', name: 'Rizinusschrot', category: 'Pflanzliche Produkte' },
  { code: '506', name: 'Vinasse', category: 'Pflanzliche Produkte' },
  {
    code: '507',
    name: 'Maltaflor BIO (Malzkeime)',
    category: 'Pflanzliche Produkte',
  },
  {
    code: '508',
    name: 'Provita Phytoperls (Maisrückst.)',
    category: 'Pflanzliche Produkte',
  },
  {
    code: '509',
    name: 'AGRO BIOSOL (Pilzbiomasse)',
    category: 'Pflanzliche Produkte',
  },
  { code: '510', name: 'Pilzsubstrat', category: 'Pflanzliche Produkte' },
  { code: '520', name: 'Obsttrester', category: 'Pflanzliche Produkte' },
  { code: '521', name: 'Weintrester', category: 'Pflanzliche Produkte' },
  { code: '524', name: 'Biertreber', category: 'Pflanzliche Produkte' },
  {
    code: '525',
    name: 'Kartoffelfruchtwasser',
    category: 'Pflanzliche Produkte',
  },
  { code: '538', name: 'Getreideschlempe', category: 'Pflanzliche Produkte' },
  { code: '539', name: 'Kartoffelschlempe', category: 'Pflanzliche Produkte' },
  {
    code: '540',
    name: 'Bioethanolschlempe (Trockenschl.)',
    category: 'Pflanzliche Produkte',
  },
  { code: '543', name: 'Melasse', category: 'Pflanzliche Produkte' },
  { code: '545', name: 'Bioilsa', category: 'Pflanzliche Produkte' },
  {
    code: '546',
    name: 'OPF (Organic Plant Feed)',
    category: 'Pflanzliche Produkte',
  },
  {
    code: '547',
    name: 'PPL (Potato Protein Liquid)',
    category: 'Pflanzliche Produkte',
  },
  {
    code: '548',
    name: 'Luzerne- und Kleegrasmehl',
    category: 'Pflanzliche Produkte',
  },
  { code: '550', name: 'Wickenschrot', category: 'Pflanzliche Produkte' },
  {
    code: '555',
    name: 'Sojaextraktionsschrot',
    category: 'Pflanzliche Produkte',
  },
  { code: '556', name: 'Malzkeime', category: 'Pflanzliche Produkte' },
  { code: '557', name: 'Maiskleber', category: 'Pflanzliche Produkte' },

  // Sonstiges
  { code: '489', name: 'Silagesickersaft', category: 'Sonstiges' },
  { code: '490', name: 'Bodenhilfsstoff', category: 'Sonstiges' },
  { code: '491', name: 'Kultursubstrat', category: 'Sonstiges' },
  { code: '492', name: 'Pflanzenhilfsmittel', category: 'Sonstiges' },
  { code: '493', name: 'Abfälle', category: 'Sonstiges' },
];

export function getOrganicFertilizerByCode(
  code: string,
): OrganicFertilizerCode | undefined {
  return ORGANIC_FERTILIZER_CODES.find((f) => f.code === code);
}

// Table 16: Methode PK-Untersuchung
export const METHODE_PK_CODES = {
  C: 'CAL-Methode',
  D: 'DL-Methode',
} as const;

// Table 18: Mineralische Düngerartgruppe
export const MINERAL_FERTILIZER_GROUP_CODES = {
  '110': 'N',
  '111': 'N-Bindung',
  '120': 'NP',
  '130': 'NK',
  '140': 'NPK',
  '150': 'P',
  '160': 'PK',
  '170': 'K',
  '180': 'Mg',
  '181': 'S',
  '190': 'Kalk',
} as const;

// Table 19: Versorgungsstufen
export const VERSORGUNGSSTUFE_CODES = {
  A: 'sehr niedrig',
  B: 'niedrig',
  C: 'mittel',
  D: 'hoch',
  E: 'sehr hoch',
} as const;

// Table 20: Berechnungsart Gehaltsklassen
export const VSZIEL_CODES = {
  F: 'Feste Zu-, Abschläge',
  B: 'Mitte B',
  C: 'Mitte C',
  AC: 'Anfang C',
} as const;

// Table 21: Leguminosen
export type LegumeCode = {
  code: string;
  name: string;
  category: string;
};

export const LEGUME_CODES: LegumeCode[] = [
  // Körnerleguminosen
  {
    code: '0304',
    name: 'Ackerbohne (30% RP) Korn',
    category: 'Körnerleguminosen',
  },
  { code: '0301', name: 'Erbse (26% RP) Korn', category: 'Körnerleguminosen' },
  {
    code: '0307',
    name: 'Lupine blau (33% RP) Korn',
    category: 'Körnerleguminosen',
  },
  {
    code: '0327',
    name: 'Lupine weiß (35% RP) Korn',
    category: 'Körnerleguminosen',
  },
  {
    code: '0317',
    name: 'Lupine gelb (45% RP) Korn',
    category: 'Körnerleguminosen',
  },
  { code: '0305', name: 'Wicke (28% RP) Korn', category: 'Körnerleguminosen' },
  { code: '0311', name: 'Linse (28% RP) Korn', category: 'Körnerleguminosen' },
  {
    code: '0308',
    name: 'Sojabohne (32% RP) Korn',
    category: 'Körnerleguminosen',
  },
  {
    code: '0309',
    name: 'Hülsenfruchtgemenge (33% RP) Korn',
    category: 'Körnerleguminosen',
  },
  {
    code: '0310',
    name: 'Hülsenfrucht-/Nichtleguminosengemenge (22% RP) Korn',
    category: 'Körnerleguminosen',
  },
  {
    code: '0330',
    name: 'sonstige einjährige Körnerleguminosen (28% RP) Korn',
    category: 'Körnerleguminosen',
  },

  // Kleegras / Luzernegras
  { code: '1208', name: 'Kleegras (30:70)', category: 'Kleegras' },
  { code: '1008', name: 'Kleegras (50:50)', category: 'Kleegras' },
  { code: '1108', name: 'Kleegras (70:30)', category: 'Kleegras' },
  { code: '1227', name: 'Luzernegras (30:70)', category: 'Luzernegras' },
  { code: '1027', name: 'Luzernegras (50:50)', category: 'Luzernegras' },
  { code: '1127', name: 'Luzernegras (70:30)', category: 'Luzernegras' },

  // Kleearten
  { code: '1001', name: 'Rotklee', category: 'Klee' },
  { code: '1002', name: 'Weißklee', category: 'Klee' },
  { code: '1003', name: 'Inkarnatklee', category: 'Klee' },
  { code: '1004', name: 'Gelbklee', category: 'Klee' },
  { code: '1005', name: 'Hornklee', category: 'Klee' },
  { code: '1006', name: 'Perserklee', category: 'Klee' },
  { code: '1009', name: 'Alexandrinerklee', category: 'Klee' },
  { code: '1022', name: 'Klee allgemein', category: 'Klee' },
  { code: '1023', name: 'Luzerne', category: 'Klee' },

  // Ganzpflanze
  { code: '1064', name: 'Ackerbohne, Ganzpflanze', category: 'Ganzpflanze' },
  { code: '1060', name: 'Erbse, Ganzpflanze', category: 'Ganzpflanze' },
  { code: '1026', name: 'Lupine, Ganzpflanze', category: 'Ganzpflanze' },
  { code: '1051', name: 'Wicke, Ganzpflanze', category: 'Ganzpflanze' },

  // Zwischenfrüchte
  {
    code: '2001',
    name: 'Zwischenfrucht Leguminosen/Nichtleguminosen',
    category: 'Zwischenfrüchte',
  },
  {
    code: '2002',
    name: 'Zwischenfrucht Leguminosen',
    category: 'Zwischenfrüchte',
  },
];

// Table 24: Mineralische Düngerart (selected)
export type MineralFertilizerCode = {
  id: number;
  name: string;
  group: string;
};

export const MINERAL_FERTILIZER_CODES: MineralFertilizerCode[] = [
  // N-Dünger
  { id: 10, name: 'Alzon 46', group: 'N' },
  { id: 20, name: 'Alzon flüssig 28', group: 'N' },
  { id: 30, name: 'Alzon flüssig-S 25/6', group: 'N' },
  { id: 40, name: 'Ammoniak, flüssig (82)', group: 'N' },
  { id: 50, name: 'Ammoniumnitrat-Harnstoff-Lösung AHL 28', group: 'N' },
  { id: 60, name: 'Ammoniumnitrat-Harnstoff-Lösung AHL 30', group: 'N' },
  { id: 90, name: 'Ammonsulfatsalpeter 26', group: 'N' },
  { id: 130, name: 'Entec 26', group: 'N' },
  { id: 150, name: 'Harnstoff 46', group: 'N' },
  { id: 160, name: 'Kalkammonsalpeter 27', group: 'N' },
  { id: 250, name: 'Schwefels. Ammoniak 21, SSA-kristallin', group: 'N' },
  { id: 270, name: 'Sulfan 24', group: 'N' },

  // NP-Dünger
  { id: 290, name: 'DAP 18+46', group: 'NP' },
  { id: 300, name: 'Entec 25+15', group: 'NP' },
  { id: 320, name: 'MAP 11+52', group: 'NP' },

  // NPK-Dünger
  { id: 380, name: 'Entec 24+8+7', group: 'NPK' },
  { id: 450, name: 'Nitrophoska 15+15+15 (+0+2)', group: 'NPK' },
  { id: 500, name: 'NPK 15+15+15', group: 'NPK' },
  { id: 510, name: 'NPK 16+16+16', group: 'NPK' },

  // P-Dünger
  { id: 700, name: 'Superphosphat 18', group: 'P' },
  { id: 740, name: 'Triple-Superphosphat 46', group: 'P' },

  // K-Dünger
  { id: 960, name: '50er Kali', group: 'K' },
  { id: 970, name: '60er Kali', group: 'K' },
  { id: 990, name: 'Kaliumsulfat 50', group: 'K' },
  { id: 1010, name: 'Korn-Kali 40', group: 'K' },

  // Mg-Dünger
  { id: 1050, name: 'Bittersalz 16', group: 'Mg' },
  { id: 1080, name: 'Kieserit fein 27', group: 'Mg' },

  // Kalk
  { id: 1110, name: 'Branntkalk 70', group: 'Kalk' },
  { id: 1190, name: 'Kohlensaurer Kalk 80', group: 'Kalk' },
  { id: 1200, name: 'Kohlensaurer Kalk 85', group: 'Kalk' },
  { id: 1210, name: 'Kohlensaurer Kalk 90', group: 'Kalk' },
];

export function getMineralFertilizerById(
  id: number,
): MineralFertilizerCode | undefined {
  return MINERAL_FERTILIZER_CODES.find((f) => f.id === id);
}

const normalizeName = (name: string) =>
  name.toLowerCase().replace(/[^a-zäöüß]/g, '');

/**
 * Tabelle 24 REFERENCE_ID for a product name — only when the name is the
 * catalogue entry (ignoring the trailing nutrient figure, "Kalkammonsalpeter"
 * ↔ "Kalkammonsalpeter 27"); a wrong id is worse than none.
 */
export function mineralReferenceIdForName(
  name: string | undefined,
): number | undefined {
  if (!name) return undefined;
  const wanted = normalizeName(name);
  if (wanted.length < 4) return undefined;
  const matches = MINERAL_FERTILIZER_CODES.filter(
    (f) => normalizeName(f.name) === wanted,
  );
  return matches.length === 1 ? matches[0].id : undefined;
}

export function searchMineralFertilizers(
  query: string,
): MineralFertilizerCode[] {
  const q = query.toLowerCase();
  return MINERAL_FERTILIZER_CODES.filter(
    (f) =>
      f.name.toLowerCase().includes(q) || f.group.toLowerCase().includes(q),
  );
}
