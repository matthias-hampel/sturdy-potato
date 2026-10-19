/**
 * Emission factors and crop parameters of the BEK method with their sources, as cited in
 * AGVOLUTION/agmeo (src/lib/co2calculator/method/parametersSources.ts, generated there from the
 * "Parameters - Berechnungsparameter" sheet by processCitations.ts). Ported verbatim; edit the
 * values here and keep the citation fields with them.
 */

/** One cited parameter: German description fields as in the source sheet. */
export interface ParameterDetails {
  id: string;
  Produktionsrichtung: string;
  Emissionsquelle: string;
  Beschreibung: string;
  Parameter: string;
  'Information zum Parameter:': string;
  Wert: number;
  Einheit: string;
  Bezeichnung: string;
  Kurzzitat: string;
  Langzitat?: string;
  comment?: string;
}
export type ParameterDetailsRecord = Record<string, ParameterDetails>;

export const parametersWithDetails: ParameterDetailsRecord = {
  'orgFertParams.pigSolidManure.noIncorporation': {
    id: 'orgFertParams.pigSolidManure.noIncorporation',
    Produktionsrichtung: 'Wirtschaftsdüngerausbringung Schwein',
    Emissionsquelle: 'Wirtschaftsdünger von Schweinen',
    Beschreibung: 'Festmist mit Breitverteiler ohne Einarbeitung',
    Parameter: 'Ammoniak-Emissionsfaktor',
    'Information zum Parameter:': '',
    Wert: 0.9,
    Einheit: 'kg NH3-N · (kg TAN)-1',
    Bezeichnung: 'EFNH3-N, SM, Bv, o E',
    Kurzzitat: 'Haenel et al. (2020), Table 5.8, S. 205',
    Langzitat:
      'Haenel, H.-D.; Rösemann, C.; Dämmgen, U.; Döring, U.; Wulf, S.; Eurich-Menden, B.; Freibauer, A.; Döhler, H.; Schreiner, C.; Osterburg, B.; Fuß, R. (2020): Calculations of gaseous and particulate emissions from German agriculture 1990 – 2018. Report on methods and data (RMD) Submission 2020. Thünen Report 77, Braunschweig, Johann Heinrich von Thünen-Institut',
  },
  'orgFertParams.pigSolidManure.4h': {
    id: 'orgFertParams.pigSolidManure.4h',
    Produktionsrichtung: 'Wirtschaftsdüngerausbringung Schwein',
    Emissionsquelle: 'Wirtschaftsdünger von Schweinen',
    Beschreibung:
      'Festmist mit Breitverteiler und Einarbeitung > 1 h bis ≤ 4 h',
    Parameter: 'Ammoniak-Emissionsfaktor',
    'Information zum Parameter:': '',
    Wert: 0.45,
    Einheit: 'kg NH3-N · (kg TAN)-1',
    Bezeichnung: 'EFNH3-N, SM, Bv, E < 4 h',
    Kurzzitat: 'Haenel et al. (2020), Table 5.8, S. 205',
    Langzitat:
      'Haenel, H.-D.; Rösemann, C.; Dämmgen, U.; Döring, U.; Wulf, S.; Eurich-Menden, B.; Freibauer, A.; Döhler, H.; Schreiner, C.; Osterburg, B.; Fuß, R. (2020): Calculations of gaseous and particulate emissions from German agriculture 1990 – 2018. Report on methods and data (RMD) Submission 2020. Thünen Report 77, Braunschweig, Johann Heinrich von Thünen-Institut',
  },
  'orgFertParams.pigSolidManure.8h': {
    id: 'orgFertParams.pigSolidManure.8h',
    Produktionsrichtung: 'Wirtschaftsdüngerausbringung Schwein',
    Emissionsquelle: 'Wirtschaftsdünger von Schweinen',
    Beschreibung:
      'Festmist mit Breitverteiler und Einarbeitung > 4 h bis ≤ 12 h',
    Parameter: 'Ammoniak-Emissionsfaktor',
    'Information zum Parameter:': '',
    Wert: 0.81,
    Einheit: 'kg NH3-N · (kg TAN)-1',
    Bezeichnung: 'EFNH3-N, SM, Bv, E < 12 h',
    Kurzzitat: 'Haenel et al. (2020), Table 5.8, S. 205',
    Langzitat:
      'Haenel, H.-D.; Rösemann, C.; Dämmgen, U.; Döring, U.; Wulf, S.; Eurich-Menden, B.; Freibauer, A.; Döhler, H.; Schreiner, C.; Osterburg, B.; Fuß, R. (2020): Calculations of gaseous and particulate emissions from German agriculture 1990 – 2018. Report on methods and data (RMD) Submission 2020. Thünen Report 77, Braunschweig, Johann Heinrich von Thünen-Institut',
  },
  'orgFertParams.pigSolidManure.1h': {
    id: 'orgFertParams.pigSolidManure.1h',
    Produktionsrichtung: 'Wirtschaftsdüngerausbringung Schwein',
    Emissionsquelle: 'Wirtschaftsdünger von Schweinen',
    Beschreibung: 'Festmist mit Breitverteiler und Einarbeitung ≤ 1 h',
    Parameter: 'Ammoniak-Emissionsfaktor',
    'Information zum Parameter:': '',
    Wert: 0.09,
    Einheit: 'kg NH3-N · (kg TAN)-1',
    Bezeichnung: 'EFNH3-N, SM, Bv, E < 1 h',
    Kurzzitat: 'Haenel et al. (2020), Table 5.8, S. 205',
    Langzitat:
      'Haenel, H.-D.; Rösemann, C.; Dämmgen, U.; Döring, U.; Wulf, S.; Eurich-Menden, B.; Freibauer, A.; Döhler, H.; Schreiner, C.; Osterburg, B.; Fuß, R. (2020): Calculations of gaseous and particulate emissions from German agriculture 1990 – 2018. Report on methods and data (RMD) Submission 2020. Thünen Report 77, Braunschweig, Johann Heinrich von Thünen-Institut',
  },
  'orgFertParams.pigSlurry.4h': {
    id: 'orgFertParams.pigSlurry.4h',
    Produktionsrichtung: 'Wirtschaftsdüngerausbringung Schwein',
    Emissionsquelle: 'Wirtschaftsdünger von Schweinen',
    Beschreibung: 'Gülle mit Schleppschlauch und Einarbeitung > 1 h bis ≤ 4 h',
    Parameter: 'Ammoniak-Emissionsfaktor',
    'Information zum Parameter:': '',
    Wert: 0.06,
    Einheit: 'kg NH3-N · (kg TAN)-1',
    Bezeichnung: 'EFNH3-N, SG, Sschl, E < 4 h',
    Kurzzitat: 'Haenel et al. (2020), Table 5.6, S. 204',
    Langzitat:
      'Haenel, H.-D.; Rösemann, C.; Dämmgen, U.; Döring, U.; Wulf, S.; Eurich-Menden, B.; Freibauer, A.; Döhler, H.; Schreiner, C.; Osterburg, B.; Fuß, R. (2020): Calculations of gaseous and particulate emissions from German agriculture 1990 – 2018. Report on methods and data (RMD) Submission 2020. Thünen Report 77, Braunschweig, Johann Heinrich von Thünen-Institut',
  },
  'orgFertParams.pigSlurry.1h': {
    id: 'orgFertParams.pigSlurry.1h',
    Produktionsrichtung: 'Wirtschaftsdüngerausbringung Schwein',
    Emissionsquelle: 'Wirtschaftsdünger von Schweinen',
    Beschreibung: 'Gülle mit Schleppschlauch und Einarbeitung ≤ 1 h',
    Parameter: 'Ammoniak-Emissionsfaktor',
    'Information zum Parameter:': '',
    Wert: 0.02,
    Einheit: 'kg NH3-N · (kg TAN)-1',
    Bezeichnung: 'EFNH3-N, SG, Sschl, E < 1 h',
    Kurzzitat: 'Haenel et al. (2020), Table 5.6, S. 204',
    Langzitat:
      'Haenel, H.-D.; Rösemann, C.; Dämmgen, U.; Döring, U.; Wulf, S.; Eurich-Menden, B.; Freibauer, A.; Döhler, H.; Schreiner, C.; Osterburg, B.; Fuß, R. (2020): Calculations of gaseous and particulate emissions from German agriculture 1990 – 2018. Report on methods and data (RMD) Submission 2020. Thünen Report 77, Braunschweig, Johann Heinrich von Thünen-Institut',
  },
  'orgFertParams.pigSlurry.noIncorporation': {
    id: 'orgFertParams.pigSlurry.noIncorporation',
    Produktionsrichtung: 'Wirtschaftsdüngerausbringung Schwein',
    Emissionsquelle: 'Wirtschaftsdünger von Schweinen',
    Beschreibung: 'Gülle mit Schleppschuh',
    Parameter: 'Ammoniak-Emissionsfaktor',
    'Information zum Parameter:': '',
    Wert: 0.12,
    Einheit: 'kg NH3-N · (kg TAN)-1',
    Bezeichnung: 'EFNH3-N, SG, Sschh',
    Kurzzitat: 'Haenel et al. (2020), Table 5.6, S. 204',
    Langzitat:
      'Haenel, H.-D.; Rösemann, C.; Dämmgen, U.; Döring, U.; Wulf, S.; Eurich-Menden, B.; Freibauer, A.; Döhler, H.; Schreiner, C.; Osterburg, B.; Fuß, R. (2020): Calculations of gaseous and particulate emissions from German agriculture 1990 – 2018. Report on methods and data (RMD) Submission 2020. Thünen Report 77, Braunschweig, Johann Heinrich von Thünen-Institut',
  },
  'orgFertParams.pigLiquidManure.4h': {
    id: 'orgFertParams.pigLiquidManure.4h',
    Produktionsrichtung: 'Wirtschaftsdüngerausbringung Schwein',
    Emissionsquelle: 'Wirtschaftsdünger von Schweinen',
    Beschreibung: 'Jauche mit Schleppschlauch und Einarbeitung > 1 h bis ≤ 4 h',
    Parameter: 'Ammoniak-Emissionsfaktor',
    'Information zum Parameter:': '',
    Wert: 0.05,
    Einheit: 'kg NH3-N · (kg TAN)-1',
    Bezeichnung: 'EFNH3-N, SJ, Sschl, E < 4 h',
    Kurzzitat: 'Haenel et al. (2020), Table 5.7, S. 205',
    Langzitat:
      'Haenel, H.-D.; Rösemann, C.; Dämmgen, U.; Döring, U.; Wulf, S.; Eurich-Menden, B.; Freibauer, A.; Döhler, H.; Schreiner, C.; Osterburg, B.; Fuß, R. (2020): Calculations of gaseous and particulate emissions from German agriculture 1990 – 2018. Report on methods and data (RMD) Submission 2020. Thünen Report 77, Braunschweig, Johann Heinrich von Thünen-Institut',
  },
  'orgFertParams.pigLiquidManure.1h': {
    id: 'orgFertParams.pigLiquidManure.1h',
    Produktionsrichtung: 'Wirtschaftsdüngerausbringung Schwein',
    Emissionsquelle: 'Wirtschaftsdünger von Schweinen',
    Beschreibung: 'Jauche mit Schleppschlauch und Einarbeitung ≤ 1 h',
    Parameter: 'Ammoniak-Emissionsfaktor',
    'Information zum Parameter:': '',
    Wert: 0.01,
    Einheit: 'kg NH3-N · (kg TAN)-1',
    Bezeichnung: 'EFNH3-N, SJ, Sschl, E < 1 h',
    Kurzzitat: 'Haenel et al. (2020), Table 5.7, S. 205',
    Langzitat:
      'Haenel, H.-D.; Rösemann, C.; Dämmgen, U.; Döring, U.; Wulf, S.; Eurich-Menden, B.; Freibauer, A.; Döhler, H.; Schreiner, C.; Osterburg, B.; Fuß, R. (2020): Calculations of gaseous and particulate emissions from German agriculture 1990 – 2018. Report on methods and data (RMD) Submission 2020. Thünen Report 77, Braunschweig, Johann Heinrich von Thünen-Institut',
  },
  'orgFertParams.pigLiquidManure.noIncorporation': {
    id: 'orgFertParams.pigLiquidManure.noIncorporation',
    Produktionsrichtung: 'Wirtschaftsdüngerausbringung Schwein',
    Emissionsquelle: 'Wirtschaftsdünger von Schweinen',
    Beschreibung: 'Jauche mit Schleppschuh',
    Parameter: 'Ammoniak-Emissionsfaktor',
    'Information zum Parameter:': '',
    Wert: 0.08,
    Einheit: 'kg NH3-N · (kg TAN)-1',
    Bezeichnung: 'EFNH3-N, SJ, Sschh',
    Kurzzitat: 'Haenel et al. (2020), Table 5.7, S. 205',
    Langzitat:
      'Haenel, H.-D.; Rösemann, C.; Dämmgen, U.; Döring, U.; Wulf, S.; Eurich-Menden, B.; Freibauer, A.; Döhler, H.; Schreiner, C.; Osterburg, B.; Fuß, R. (2020): Calculations of gaseous and particulate emissions from German agriculture 1990 – 2018. Report on methods and data (RMD) Submission 2020. Thünen Report 77, Braunschweig, Johann Heinrich von Thünen-Institut',
  },
  'orgFertParams.cattleSolidManure.noIncorporation': {
    id: 'orgFertParams.cattleSolidManure.noIncorporation',
    Produktionsrichtung: 'Wirtschaftsdüngerausbringung Rind',
    Emissionsquelle: 'Wirtschaftsdünger von Rindern',
    Beschreibung: 'Festmist mit Breitverteiler ohne Einarbeitung',
    Parameter: 'Ammoniak-Emissionsfaktor',
    'Information zum Parameter:': '',
    Wert: 0.9,
    Einheit: 'kg NH3-N · (kg TAN)-1',
    Bezeichnung: 'EFNH3-N, RM, Bv, o E',
    Kurzzitat: 'Haenel et al. (2020), Table 4.10, S. 123',
    Langzitat:
      'Haenel, H.-D.; Rösemann, C.; Dämmgen, U.; Döring, U.; Wulf, S.; Eurich-Menden, B.; Freibauer, A.; Döhler, H.; Schreiner, C.; Osterburg, B.; Fuß, R. (2020): Calculations of gaseous and particulate emissions from German agriculture 1990 – 2018. Report on methods and data (RMD) Submission 2020. Thünen Report 77, Braunschweig, Johann Heinrich von Thünen-Institut',
  },
  'orgFertParams.cattleSolidManure.4h': {
    id: 'orgFertParams.cattleSolidManure.4h',
    Produktionsrichtung: 'Wirtschaftsdüngerausbringung Rind',
    Emissionsquelle: 'Wirtschaftsdünger von Rindern',
    Beschreibung:
      'Festmist mit Breitverteiler und Einarbeitung > 1 h bis ≤ 4 h',
    Parameter: 'Ammoniak-Emissionsfaktor',
    'Information zum Parameter:': '',
    Wert: 0.45,
    Einheit: 'kg NH3-N · (kg TAN)-1',
    Bezeichnung: 'EFNH3-N, RM, Bv, E < 4 h',
    Kurzzitat: 'Haenel et al. (2020), Table 4.10, S. 123',
    Langzitat:
      'Haenel, H.-D.; Rösemann, C.; Dämmgen, U.; Döring, U.; Wulf, S.; Eurich-Menden, B.; Freibauer, A.; Döhler, H.; Schreiner, C.; Osterburg, B.; Fuß, R. (2020): Calculations of gaseous and particulate emissions from German agriculture 1990 – 2018. Report on methods and data (RMD) Submission 2020. Thünen Report 77, Braunschweig, Johann Heinrich von Thünen-Institut',
  },
  'orgFertParams.cattleSolidManure.8h': {
    id: 'orgFertParams.cattleSolidManure.8h',
    Produktionsrichtung: 'Wirtschaftsdüngerausbringung Rind',
    Emissionsquelle: 'Wirtschaftsdünger von Rindern',
    Beschreibung:
      'Festmist mit Breitverteiler und Einarbeitung > 4 h bis ≤ 12 h',
    Parameter: 'Ammoniak-Emissionsfaktor',
    'Information zum Parameter:': '',
    Wert: 0.81,
    Einheit: 'kg NH3-N · (kg TAN)-1',
    Bezeichnung: 'EFNH3-N, RM, Bv, E < 12 h',
    Kurzzitat: 'Haenel et al. (2020), Table 4.10, S. 123',
    Langzitat:
      'Haenel, H.-D.; Rösemann, C.; Dämmgen, U.; Döring, U.; Wulf, S.; Eurich-Menden, B.; Freibauer, A.; Döhler, H.; Schreiner, C.; Osterburg, B.; Fuß, R. (2020): Calculations of gaseous and particulate emissions from German agriculture 1990 – 2018. Report on methods and data (RMD) Submission 2020. Thünen Report 77, Braunschweig, Johann Heinrich von Thünen-Institut',
  },
  'orgFertParams.cattleSolidManure.1h': {
    id: 'orgFertParams.cattleSolidManure.1h',
    Produktionsrichtung: 'Wirtschaftsdüngerausbringung Rind',
    Emissionsquelle: 'Wirtschaftsdünger von Rindern',
    Beschreibung: 'Festmist mit Breitverteiler und Einarbeitung ≤ 1 h',
    Parameter: 'Ammoniak-Emissionsfaktor',
    'Information zum Parameter:': '',
    Wert: 0.09,
    Einheit: 'kg NH3-N · (kg TAN)-1',
    Bezeichnung: 'EFNH3-N, RM, Bv, E < 1 h',
    Kurzzitat: 'Haenel et al. (2020), Table 4.10, S. 123',
    Langzitat:
      'Haenel, H.-D.; Rösemann, C.; Dämmgen, U.; Döring, U.; Wulf, S.; Eurich-Menden, B.; Freibauer, A.; Döhler, H.; Schreiner, C.; Osterburg, B.; Fuß, R. (2020): Calculations of gaseous and particulate emissions from German agriculture 1990 – 2018. Report on methods and data (RMD) Submission 2020. Thünen Report 77, Braunschweig, Johann Heinrich von Thünen-Institut',
  },
  'orgFertParams.cattleSlurry.noIncorporation': {
    id: 'orgFertParams.cattleSlurry.noIncorporation',
    Produktionsrichtung: 'Wirtschaftsdüngerausbringung Rind',
    Emissionsquelle: 'Wirtschaftsdünger von Rindern',
    Beschreibung: 'Gülle mit Schleppschlauch ohne Einarbeitung',
    Parameter: 'Ammoniak-Emissionsfaktor',
    'Information zum Parameter:': '',
    Wert: 0.46,
    Einheit: 'kg NH3-N · (kg TAN)-1',
    Bezeichnung: 'EFNH3-N, RG, Sschl, o E',
    Kurzzitat: 'Haenel et al. (2020), Table 4.8, S. 122',
    Langzitat:
      'Haenel, H.-D.; Rösemann, C.; Dämmgen, U.; Döring, U.; Wulf, S.; Eurich-Menden, B.; Freibauer, A.; Döhler, H.; Schreiner, C.; Osterburg, B.; Fuß, R. (2020): Calculations of gaseous and particulate emissions from German agriculture 1990 – 2018. Report on methods and data (RMD) Submission 2020. Thünen Report 77, Braunschweig, Johann Heinrich von Thünen-Institut',
  },
  'orgFertParams.cattleSlurry.4h': {
    id: 'orgFertParams.cattleSlurry.4h',
    Produktionsrichtung: 'Wirtschaftsdüngerausbringung Rind',
    Emissionsquelle: 'Wirtschaftsdünger von Rindern',
    Beschreibung: 'Gülle mit Schleppschlauch und Einarbeitung > 1 h bis ≤ 4 h',
    Parameter: 'Ammoniak-Emissionsfaktor',
    'Information zum Parameter:': '',
    Wert: 0.15,
    Einheit: 'kg NH3-N · (kg TAN)-1',
    Bezeichnung: 'EFNH3-N, RG, Sschl, E < 4 h',
    Kurzzitat: 'Haenel et al. (2020), Table 4.8, S. 122',
    Langzitat:
      'Haenel, H.-D.; Rösemann, C.; Dämmgen, U.; Döring, U.; Wulf, S.; Eurich-Menden, B.; Freibauer, A.; Döhler, H.; Schreiner, C.; Osterburg, B.; Fuß, R. (2020): Calculations of gaseous and particulate emissions from German agriculture 1990 – 2018. Report on methods and data (RMD) Submission 2020. Thünen Report 77, Braunschweig, Johann Heinrich von Thünen-Institut',
  },
  'orgFertParams.cattleSlurry.1h': {
    id: 'orgFertParams.cattleSlurry.1h',
    Produktionsrichtung: 'Wirtschaftsdüngerausbringung Rind',
    Emissionsquelle: 'Wirtschaftsdünger von Rindern',
    Beschreibung: 'Gülle mit Schleppschlauch und Einarbeitung ≤ 1 h',
    Parameter: 'Ammoniak-Emissionsfaktor',
    'Information zum Parameter:': '',
    Wert: 0.04,
    Einheit: 'kg NH3-N · (kg TAN)-1',
    Bezeichnung: 'EFNH3-N, RG, Sschl, E < 1 h',
    Kurzzitat: 'Haenel et al. (2020), Table 4.8, S. 122',
    Langzitat:
      'Haenel, H.-D.; Rösemann, C.; Dämmgen, U.; Döring, U.; Wulf, S.; Eurich-Menden, B.; Freibauer, A.; Döhler, H.; Schreiner, C.; Osterburg, B.; Fuß, R. (2020): Calculations of gaseous and particulate emissions from German agriculture 1990 – 2018. Report on methods and data (RMD) Submission 2020. Thünen Report 77, Braunschweig, Johann Heinrich von Thünen-Institut',
  },
  'orgFertParams.cattleSlurry.8h': {
    id: 'orgFertParams.cattleSlurry.8h',
    Produktionsrichtung: 'Wirtschaftsdüngerausbringung Rind',
    Emissionsquelle: 'Wirtschaftsdünger von Rindern',
    Beschreibung: 'Gülle mit Schleppschuh',
    Parameter: 'Ammoniak-Emissionsfaktor',
    'Information zum Parameter:': '',
    Wert: 0.36,
    Einheit: 'kg NH3-N · (kg TAN)-1',
    Bezeichnung: 'EFNH3-N, RG, Sschh',
    Kurzzitat: 'Haenel et al. (2020), Table 4.8, S. 122',
    Langzitat:
      'Haenel, H.-D.; Rösemann, C.; Dämmgen, U.; Döring, U.; Wulf, S.; Eurich-Menden, B.; Freibauer, A.; Döhler, H.; Schreiner, C.; Osterburg, B.; Fuß, R. (2020): Calculations of gaseous and particulate emissions from German agriculture 1990 – 2018. Report on methods and data (RMD) Submission 2020. Thünen Report 77, Braunschweig, Johann Heinrich von Thünen-Institut',
  },
  'orgFertParams.cattleLiquidManure.4h': {
    id: 'orgFertParams.cattleLiquidManure.4h',
    Produktionsrichtung: 'Wirtschaftsdüngerausbringung Rind',
    Emissionsquelle: 'Wirtschaftsdünger von Rindern',
    Beschreibung: 'Jauche mit Schleppschlauch und Einarbeitung > 1 h bis ≤ 4 h',
    Parameter: 'Ammoniak-Emissionsfaktor',
    'Information zum Parameter:': '',
    Wert: 0.05,
    Einheit: 'kg NH3-N · (kg TAN)-1',
    Bezeichnung: 'EFNH3-N, RJ, Sschl, E < 4 h',
    Kurzzitat: 'Haenel et al. (2020), Table 4.9, S. 123',
    Langzitat:
      'Haenel, H.-D.; Rösemann, C.; Dämmgen, U.; Döring, U.; Wulf, S.; Eurich-Menden, B.; Freibauer, A.; Döhler, H.; Schreiner, C.; Osterburg, B.; Fuß, R. (2020): Calculations of gaseous and particulate emissions from German agriculture 1990 – 2018. Report on methods and data (RMD) Submission 2020. Thünen Report 77, Braunschweig, Johann Heinrich von Thünen-Institut',
  },
  'orgFertParams.cattleLiquidManure.1h': {
    id: 'orgFertParams.cattleLiquidManure.1h',
    Produktionsrichtung: 'Wirtschaftsdüngerausbringung Rind',
    Emissionsquelle: 'Wirtschaftsdünger von Rindern',
    Beschreibung: 'Jauche mit Schleppschlauch und Einarbeitung ≤ 1 h',
    Parameter: 'Ammoniak-Emissionsfaktor',
    'Information zum Parameter:': '',
    Wert: 0.01,
    Einheit: 'kg NH3-N · (kg TAN)-1',
    Bezeichnung: 'EFNH3-N, RJ, Sschl, E < 1 h',
    Kurzzitat: 'Haenel et al. (2020), Table 4.9, S. 123',
    Langzitat:
      'Haenel, H.-D.; Rösemann, C.; Dämmgen, U.; Döring, U.; Wulf, S.; Eurich-Menden, B.; Freibauer, A.; Döhler, H.; Schreiner, C.; Osterburg, B.; Fuß, R. (2020): Calculations of gaseous and particulate emissions from German agriculture 1990 – 2018. Report on methods and data (RMD) Submission 2020. Thünen Report 77, Braunschweig, Johann Heinrich von Thünen-Institut',
  },
  'crop.sugarBeet.rootProportion': {
    id: 'crop.sugarBeet.rootProportion',
    Produktionsrichtung: 'Ernte- und Wurzelrückstände',
    Emissionsquelle: '',
    Beschreibung:
      'Wurzelrückstand zu Haupt- und Nebenernteprodukte, andere Wurzelfrüchte',
    Parameter: 'Proportionalitätsfaktor',
    'Information zum Parameter:': 'siehe auch BEK-Handbuch, S. 34',
    Wert: 0.2,
    Einheit: 'kg TM · (kg TMHep + kg TMNep)-1',
    Bezeichnung: 'αWR, and Wrzlfrcht',
    Kurzzitat: 'IPCC (2006), Table 11.2, S. 11.18',
    Langzitat:
      'IPCC (2006): IPCC Guidelines for National Greenhouse Gas Inventories. Volume 4, Agriculture, Forestry and Other Land Use. Hayama, Japan, Intergovernmental Panel on Climate Change, https://www.ipcc-nggip.iges.or.jp/public/2006gl/vol4.html, access 12.02.2019',
  },
  'crop.potatoTableLate.rootProportion': {
    id: 'crop.potatoTableLate.rootProportion',
    Produktionsrichtung: 'Ernte- und Wurzelrückstände',
    Emissionsquelle: '',
    Beschreibung:
      'Wurzelrückstand zu Haupt- und Nebenernteprodukte, andere Wurzelfrüchte',
    Parameter: 'Proportionalitätsfaktor',
    'Information zum Parameter:': 'siehe auch BEK-Handbuch, S. 34',
    Wert: 0.2,
    Einheit: 'kg TM · (kg TMHep + kg TMNep)-1',
    Bezeichnung: 'αWR, and Kartoffeln',
    Kurzzitat: 'IPCC (2006), Table 11.2, S. 11.18',
    Langzitat:
      'IPCC (2006): IPCC Guidelines for National Greenhouse Gas Inventories. Volume 4, Agriculture, Forestry and Other Land Use. Hayama, Japan, Intergovernmental Panel on Climate Change, https://www.ipcc-nggip.iges.or.jp/public/2006gl/vol4.html, access 12.02.2019',
  },
  'crop.winterBarleyFodder.rootProportion': {
    id: 'crop.winterBarleyFodder.rootProportion',
    Produktionsrichtung: 'Ernte- und Wurzelrückstände',
    Emissionsquelle: '',
    Beschreibung: 'Wurzelrückstand zu Haupt- und Nebenernteprodukte, Gerste',
    Parameter: 'Proportionalitätsfaktor',
    'Information zum Parameter:': 'siehe auch BEK-Handbuch, S. 34',
    Wert: 0.22,
    Einheit: 'kg TM · (kg TMHep + kg TMNep)-1',
    Bezeichnung: 'αWR, Grst',
    Kurzzitat: 'IPCC (2006), Table 11.2, S. 11.18',
    Langzitat:
      'IPCC (2006): IPCC Guidelines for National Greenhouse Gas Inventories. Volume 4, Agriculture, Forestry and Other Land Use. Hayama, Japan, Intergovernmental Panel on Climate Change, https://www.ipcc-nggip.iges.or.jp/public/2006gl/vol4.html, access 12.02.2019',
  },
  'crop.canola.rootProportion': {
    id: 'crop.canola.rootProportion',
    Produktionsrichtung: 'Ernte- und Wurzelrückstände',
    Emissionsquelle: '',
    Beschreibung:
      'Wurzelrückstand zu Haupt- und Nebenernteprodukte, Getreide (allgemein)',
    Parameter: 'Proportionalitätsfaktor',
    'Information zum Parameter:': 'siehe auch BEK-Handbuch, S. 34',
    Wert: 0.22,
    Einheit: 'kg TM · (kg TMHep + kg TMNep)-1',
    Bezeichnung: 'αWR, Gtrd allg',
    Kurzzitat: 'IPCC (2006), Table 11.2, S. 11.18',
    Langzitat:
      'IPCC (2006): IPCC Guidelines for National Greenhouse Gas Inventories. Volume 4, Agriculture, Forestry and Other Land Use. Hayama, Japan, Intergovernmental Panel on Climate Change, https://www.ipcc-nggip.iges.or.jp/public/2006gl/vol4.html, access 12.02.2019',
  },
  'crop.springOatsFodder.rootProportion': {
    id: 'crop.springOatsFodder.rootProportion',
    Produktionsrichtung: 'Ernte- und Wurzelrückstände',
    Emissionsquelle: '',
    Beschreibung: 'Wurzelrückstand zu Haupt- und Nebenernteprodukte, Hafer',
    Parameter: 'Proportionalitätsfaktor',
    'Information zum Parameter:': 'siehe auch BEK-Handbuch, S. 34',
    Wert: 0.22,
    Einheit: 'kg TM · (kg TMHep + kg TMNep)-1',
    Bezeichnung: 'αWR, Hfr',
    Kurzzitat: 'IPCC (2006), Table 11.2, S. 11.18',
    Langzitat:
      'IPCC (2006): IPCC Guidelines for National Greenhouse Gas Inventories. Volume 4, Agriculture, Forestry and Other Land Use. Hayama, Japan, Intergovernmental Panel on Climate Change, https://www.ipcc-nggip.iges.or.jp/public/2006gl/vol4.html, access 12.02.2019',
  },
  'crop.silageMaize.rootProportion': {
    id: 'crop.silageMaize.rootProportion',
    Produktionsrichtung: 'Ernte- und Wurzelrückstände',
    Emissionsquelle: '',
    Beschreibung: 'Wurzelrückstand zu Haupt- und Nebenernteprodukte, Mais',
    Parameter: 'Proportionalitätsfaktor',
    'Information zum Parameter:': 'siehe auch BEK-Handbuch, S. 34',
    Wert: 0.22,
    Einheit: 'kg TM · (kg TMHep + kg TMNep)-1',
    Bezeichnung: 'αWR, Ms',
    Kurzzitat: 'IPCC (2006), Table 11.2, S. 11.18',
    Langzitat:
      'IPCC (2006): IPCC Guidelines for National Greenhouse Gas Inventories. Volume 4, Agriculture, Forestry and Other Land Use. Hayama, Japan, Intergovernmental Panel on Climate Change, https://www.ipcc-nggip.iges.or.jp/public/2006gl/vol4.html, access 12.02.2019',
  },
  'crop.winterWheat.rootProportion': {
    id: 'crop.winterWheat.rootProportion',
    Produktionsrichtung: 'Ernte- und Wurzelrückstände',
    Emissionsquelle: '',
    Beschreibung:
      'Wurzelrückstand zu Haupt- und Nebenernteprodukte, Winterweizen',
    Parameter: 'Proportionalitätsfaktor',
    'Information zum Parameter:': 'siehe auch BEK-Handbuch, S. 34',
    Wert: 0.23,
    Einheit: 'kg TM · (kg TMHep + kg TMNep)-1',
    Bezeichnung: 'αWR, Wwzn',
    Kurzzitat: 'IPCC (2006), Table 11.2, S. 11.18',
    Langzitat:
      'IPCC (2006): IPCC Guidelines for National Greenhouse Gas Inventories. Volume 4, Agriculture, Forestry and Other Land Use. Hayama, Japan, Intergovernmental Panel on Climate Change, https://www.ipcc-nggip.iges.or.jp/public/2006gl/vol4.html, access 12.02.2019',
  },
  'crop.sugarBeet.nContentRoot': {
    id: 'crop.sugarBeet.nContentRoot',
    Produktionsrichtung: 'Ernte- und Wurzelrückstände',
    Emissionsquelle: '',
    Beschreibung: 'Wurzelrückstand, andere Wurzelfrüchte',
    Parameter: 'Stickstoffgehalt',
    'Information zum Parameter:': 'siehe auch BEK-Handbuch, S. 34',
    Wert: 0.014,
    Einheit: 'kg N · (kg TM)-1',
    Bezeichnung: 'xN, WR, and Wrzlfrcht',
    Kurzzitat: 'IPCC (2006), Table 11.2, S. 11.18',
    Langzitat:
      'IPCC (2006): IPCC Guidelines for National Greenhouse Gas Inventories. Volume 4, Agriculture, Forestry and Other Land Use. Hayama, Japan, Intergovernmental Panel on Climate Change, https://www.ipcc-nggip.iges.or.jp/public/2006gl/vol4.html, access 12.02.2019',
  },
  'crop.potatoTableLate.nContentRoot': {
    id: 'crop.potatoTableLate.nContentRoot',
    Produktionsrichtung: 'Ernte- und Wurzelrückstände',
    Emissionsquelle: '',
    Beschreibung: 'Wurzelrückstand, andere Wurzelfrüchte',
    Parameter: 'Stickstoffgehalt',
    'Information zum Parameter:': 'siehe auch BEK-Handbuch, S. 34',
    Wert: 0.014,
    Einheit: 'kg N · (kg TM)-1',
    Bezeichnung: 'xN, WR, and Wrzlfrcht',
    Kurzzitat: 'IPCC (2006), Table 11.2, S. 11.18',
    Langzitat:
      'IPCC (2006): IPCC Guidelines for National Greenhouse Gas Inventories. Volume 4, Agriculture, Forestry and Other Land Use. Hayama, Japan, Intergovernmental Panel on Climate Change, https://www.ipcc-nggip.iges.or.jp/public/2006gl/vol4.html, access 12.02.2019',
  },
  'crop.winterBarleyFodder.nContentRoot': {
    id: 'crop.winterBarleyFodder.nContentRoot',
    Produktionsrichtung: 'Ernte- und Wurzelrückstände',
    Emissionsquelle: '',
    Beschreibung: 'Wurzelrückstand, Gerste',
    Parameter: 'Stickstoffgehalt',
    'Information zum Parameter:': 'siehe auch BEK-Handbuch, S. 34',
    Wert: 0.014,
    Einheit: 'kg N · (kg TM)-1',
    Bezeichnung: 'xN, WR, Grst',
    Kurzzitat: 'IPCC (2006), Table 11.2, S. 11.18',
    Langzitat:
      'IPCC (2006): IPCC Guidelines for National Greenhouse Gas Inventories. Volume 4, Agriculture, Forestry and Other Land Use. Hayama, Japan, Intergovernmental Panel on Climate Change, https://www.ipcc-nggip.iges.or.jp/public/2006gl/vol4.html, access 12.02.2019',
  },
  'crop.canola.nContentRoot': {
    id: 'crop.canola.nContentRoot',
    Produktionsrichtung: 'Ernte- und Wurzelrückstände',
    Emissionsquelle: '',
    Beschreibung: 'Wurzelrückstand, Getreide (allgemein)',
    Parameter: 'Stickstoffgehalt',
    'Information zum Parameter:': 'siehe auch BEK-Handbuch, S. 34',
    Wert: 0.009,
    Einheit: 'kg N · (kg TM)-1',
    Bezeichnung: 'xN, WR, Gtrd allg',
    Kurzzitat: 'IPCC (2006), Table 11.2, S. 11.18',
    Langzitat:
      'IPCC (2006): IPCC Guidelines for National Greenhouse Gas Inventories. Volume 4, Agriculture, Forestry and Other Land Use. Hayama, Japan, Intergovernmental Panel on Climate Change, https://www.ipcc-nggip.iges.or.jp/public/2006gl/vol4.html, access 12.02.2019',
  },
  'crop.springOatsFodder.nContentRoot': {
    id: 'crop.springOatsFodder.nContentRoot',
    Produktionsrichtung: 'Ernte- und Wurzelrückstände',
    Emissionsquelle: '',
    Beschreibung: 'Wurzelrückstand, Hafer',
    Parameter: 'Stickstoffgehalt',
    'Information zum Parameter:': 'siehe auch BEK-Handbuch, S. 34',
    Wert: 0.008,
    Einheit: 'kg N · (kg TM)-1',
    Bezeichnung: 'xN, WR, Hfr',
    Kurzzitat: 'IPCC (2006), Table 11.2, S. 11.18',
    Langzitat:
      'IPCC (2006): IPCC Guidelines for National Greenhouse Gas Inventories. Volume 4, Agriculture, Forestry and Other Land Use. Hayama, Japan, Intergovernmental Panel on Climate Change, https://www.ipcc-nggip.iges.or.jp/public/2006gl/vol4.html, access 12.02.2019',
  },
  'crop.silageMaize.nContentRoot': {
    id: 'crop.silageMaize.nContentRoot',
    Produktionsrichtung: 'Ernte- und Wurzelrückstände',
    Emissionsquelle: '',
    Beschreibung: 'Wurzelrückstand, Mais',
    Parameter: 'Stickstoffgehalt',
    'Information zum Parameter:': 'siehe auch BEK-Handbuch, S. 34',
    Wert: 0.007,
    Einheit: 'kg N · (kg TM)-1',
    Bezeichnung: 'xN, WR, Ms',
    Kurzzitat: 'IPCC (2006), Table 11.2, S. 11.18',
    Langzitat:
      'IPCC (2006): IPCC Guidelines for National Greenhouse Gas Inventories. Volume 4, Agriculture, Forestry and Other Land Use. Hayama, Japan, Intergovernmental Panel on Climate Change, https://www.ipcc-nggip.iges.or.jp/public/2006gl/vol4.html, access 12.02.2019',
  },
  'crop.winterWheat.nContentRoot': {
    id: 'crop.winterWheat.nContentRoot',
    Produktionsrichtung: 'Ernte- und Wurzelrückstände',
    Emissionsquelle: '',
    Beschreibung: 'Wurzelrückstand, Winterweizen',
    Parameter: 'Stickstoffgehalt',
    'Information zum Parameter:': 'siehe auch BEK-Handbuch, S. 34',
    Wert: 0.009,
    Einheit: 'kg N · (kg TM)-1',
    Bezeichnung: 'xN, WR, Wwzn',
    Kurzzitat: 'IPCC (2006), Table 11.2, S. 11.18',
    Langzitat:
      'IPCC (2006): IPCC Guidelines for National Greenhouse Gas Inventories. Volume 4, Agriculture, Forestry and Other Land Use. Hayama, Japan, Intergovernmental Panel on Climate Change, https://www.ipcc-nggip.iges.or.jp/public/2006gl/vol4.html, access 12.02.2019',
  },
  'ef.cao': {
    id: 'ef.cao',
    Produktionsrichtung: 'Kalkung',
    Emissionsquelle: '',
    Beschreibung: 'Anwendung von Kalkstein',
    Parameter: 'Kohlenstoffdioxid-Emissionsfaktor',
    'Information zum Parameter:': 'stöchiometrische Umrechnung',
    Wert: 0.786,
    Einheit: 'kg CO2 · (kg CaO)-1',
    Bezeichnung: 'EFCO2, Kalkung',
    Kurzzitat: '',
    Langzitat: '',
  },
  'ef.appliedN.ahl': {
    id: 'ef.appliedN.ahl',
    Produktionsrichtung: 'Stickstoffdüngung',
    Emissionsquelle: '',
    Beschreibung: 'Ammoniumnitrat-Harnstoff-Lösung (AHL)',
    Parameter: 'Ammoniak-Emissionsfaktor',
    'Information zum Parameter:': 'siehe auch BEK-Handbuch, S. 34',
    Wert: 0.081,
    Einheit: 'kg NH3-N · (kg N)-1',
    Bezeichnung: 'EFNH3-N, Anwd, AHL',
    Kurzzitat: 'Rösemann et al. (2021), Table 11.3, S. 344',
    Langzitat:
      'Rösemann, C.; Haenel, H.-D.; Vos, C.; Dämmgen, U.; Döring, U.; Wulf, S.; Eurich-Menden, B.; Freibauer, A.; Döhler, H.; Schreiner, C.; Osterburg, B.; Fuß, R. (2021): Calculations of gaseous and particulate emissions from German agriculture 1990 – 2019. Report on methods and data (RMD) Submission 2021. Thünen Report 84, Braunschweig, Johann Heinrich von Thünen-Institut',
  },
  'ef.urea': {
    id: 'ef.urea',
    Produktionsrichtung: 'Stickstoffdüngung',
    Emissionsquelle: '',
    Beschreibung: 'Anwendung von harnstoffhaltigen Mineraldüngern',
    Parameter: 'Kohlenstoffdioxid-Emissionsfaktor',
    'Information zum Parameter:': 'stöchiometrische Umrechnung',
    Wert: 1.57,
    Einheit: 'kg CO2 · (kg Harnstoff-N)-1',
    Bezeichnung: 'EFCO2, hrnstfhltg Dngr',
    Kurzzitat: '',
    Langzitat: '',
  },
  'ef.n2oN': {
    id: 'ef.n2oN',
    Produktionsrichtung: 'Stickstoffdüngung',
    Emissionsquelle: '',
    Beschreibung:
      'durch Wirtschaftsdünger oder Mineraldünger in den Boden zugeführter Stickstoff (direkt und indirekt durch Auswaschung)',
    Parameter: 'Lachgas-Emissionsfaktor',
    'Information zum Parameter:': '',
    Wert: 0.01225,
    Einheit: 'kg N2O-N · (kg N)-1',
    Bezeichnung: 'EFN2O-N, N-Dngr',
    Kurzzitat: 'Haenel et al. (2020), S. 342, 384; siehe BEK Handbuch, S.34',
    Langzitat:
      'Haenel, H.-D.; Rösemann, C.; Dämmgen, U.; Döring, U.; Wulf, S.; Eurich-Menden, B.; Freibauer, A.; Döhler, H.; Schreiner, C.; Osterburg, B.; Fuß, R. (2020): Calculations of gaseous and particulate emissions from German agriculture 1990 – 2018. Report on methods and data (RMD) Submission 2020. Thünen Report 77, Braunschweig, Johann Heinrich von Thünen-Institut',
  },
  'ef.appliedN.urea': {
    id: 'ef.appliedN.urea',
    Produktionsrichtung: 'Stickstoffdüngung',
    Emissionsquelle: '',
    Beschreibung: 'Harnstoff',
    Parameter: 'Ammoniak-Emissionsfaktor',
    'Information zum Parameter:': 'siehe auch BEK-Handbuch, S. 34',
    Wert: 0.128,
    Einheit: 'kg NH3-N · (kg N)-1',
    Bezeichnung: 'EFNH3-N, Anwd, Hrnstf',
    Kurzzitat: 'Rösemann et al. (2021), Table 11.3, S. 344',
    Langzitat:
      'Rösemann, C.; Haenel, H.-D.; Vos, C.; Dämmgen, U.; Döring, U.; Wulf, S.; Eurich-Menden, B.; Freibauer, A.; Döhler, H.; Schreiner, C.; Osterburg, B.; Fuß, R. (2021): Calculations of gaseous and particulate emissions from German agriculture 1990 – 2019. Report on methods and data (RMD) Submission 2021. Thünen Report 84, Braunschweig, Johann Heinrich von Thünen-Institut',
  },
  'ef.appliedN.ureaWithInhibitor': {
    id: 'ef.appliedN.ureaWithInhibitor',
    Produktionsrichtung: 'Stickstoffdüngung',
    Emissionsquelle: '',
    Beschreibung: 'Harnstoff mit Ureaseinhibitor',
    Parameter: 'Ammoniak-Emissionsfaktor',
    'Information zum Parameter:':
      'Durch Einsatz von Ureaseinhemmern Reduktion des Standard-Emissionsfaktors auf 30 %',
    Wert: 0.038,
    Einheit: 'kg NH3-N · (kg N)-1',
    Bezeichnung: 'EFNH3-N, Anwd, Hrnstf-Inhib',
    Kurzzitat: 'Rösemann et al. (2021), Table 11.3, S. 74, 344',
    Langzitat:
      'Rösemann, C.; Haenel, H.-D.; Vos, C.; Dämmgen, U.; Döring, U.; Wulf, S.; Eurich-Menden, B.; Freibauer, A.; Döhler, H.; Schreiner, C.; Osterburg, B.; Fuß, R. (2021): Calculations of gaseous and particulate emissions from German agriculture 1990 – 2019. Report on methods and data (RMD) Submission 2021. Thünen Report 84, Braunschweig, Johann Heinrich von Thünen-Institut',
  },
  'ef.appliedN.canAndOthersN': {
    id: 'ef.appliedN.canAndOthersN',
    Produktionsrichtung: 'Stickstoffdüngung',
    Emissionsquelle: '',
    Beschreibung:
      'Kalkammonsalpeter (KAS) und andere Stickstoff-Einnährstoffdünger',
    Parameter: 'Ammoniak-Emissionsfaktor',
    'Information zum Parameter:': 'siehe auch BEK-Handbuch, S. 34',
    Wert: 0.01,
    Einheit: 'kg NH3-N · (kg N)-1',
    Bezeichnung: 'EFNH3-N, Anwd, KAS',
    Kurzzitat: 'Rösemann et al. (2021), Table 11.3, S. 344',
    Langzitat:
      'Rösemann, C.; Haenel, H.-D.; Vos, C.; Dämmgen, U.; Döring, U.; Wulf, S.; Eurich-Menden, B.; Freibauer, A.; Döhler, H.; Schreiner, C.; Osterburg, B.; Fuß, R. (2021): Calculations of gaseous and particulate emissions from German agriculture 1990 – 2019. Report on methods and data (RMD) Submission 2021. Thünen Report 84, Braunschweig, Johann Heinrich von Thünen-Institut',
  },
  'ef.appliedN.np': {
    id: 'ef.appliedN.np',
    Produktionsrichtung: 'Stickstoffdüngung',
    Emissionsquelle: '',
    Beschreibung: 'NP-Dünger',
    Parameter: 'Ammoniak-Emissionsfaktor',
    'Information zum Parameter:': 'siehe auch BEK-Handbuch, S. 34',
    Wert: 0.041,
    Einheit: 'kg NH3-N · (kg N)-1',
    Bezeichnung: 'EFNH3-N, Anwd, NP',
    Kurzzitat: 'Rösemann et al. (2021), Table 11.3, S. 344',
    Langzitat:
      'Rösemann, C.; Haenel, H.-D.; Vos, C.; Dämmgen, U.; Döring, U.; Wulf, S.; Eurich-Menden, B.; Freibauer, A.; Döhler, H.; Schreiner, C.; Osterburg, B.; Fuß, R. (2021): Calculations of gaseous and particulate emissions from German agriculture 1990 – 2019. Report on methods and data (RMD) Submission 2021. Thünen Report 84, Braunschweig, Johann Heinrich von Thünen-Institut',
  },
  'orgFertParams.chickenSolidManure.noIncorporation': {
    id: 'orgFertParams.chickenSolidManure.noIncorporation',
    Produktionsrichtung: 'Wirtschaftsdüngerausbringung',
    Emissionsquelle: 'Wirtschaftsdünger von Hühnern',
    Beschreibung: 'Festmist mit Breitverteiler ohne Einarbeitung',
    Parameter: 'Ammoniak-Emissionsfaktor',
    'Information zum Parameter:': '',
    Wert: 0.9,
    Einheit: 'kg NH3-N · (kg UAN)-1',
    Bezeichnung: 'EFNH3-N, Htk, Bv, o E',
    Kurzzitat: 'Haenel et al. (2020), Table 8.3, S. 271',
    Langzitat:
      'Haenel, H.-D.; Rösemann, C.; Dämmgen, U.; Döring, U.; Wulf, S.; Eurich-Menden, B.; Freibauer, A.; Döhler, H.; Schreiner, C.; Osterburg, B.; Fuß, R. (2020): Calculations of gaseous and particulate emissions from German agriculture 1990 – 2018. Report on methods and data (RMD) Submission 2020. Thünen Report 77, Braunschweig, Johann Heinrich von Thünen-Institut',
  },
  'orgFertParams.chickenSolidManure.4h': {
    id: 'orgFertParams.chickenSolidManure.4h',
    Produktionsrichtung: 'Wirtschaftsdüngerausbringung',
    Emissionsquelle: 'Wirtschaftsdünger von Hühnern',
    Beschreibung:
      'Festmist mit Breitverteiler und Einarbeitung > 1 h bis ≤ 4 h',
    Parameter: 'Ammoniak-Emissionsfaktor',
    'Information zum Parameter:': '',
    Wert: 0.18,
    Einheit: 'kg NH3-N · (kg UAN)-1',
    Bezeichnung: 'EFNH3-N, Htk, Bv, E < 4 h',
    Kurzzitat: 'Haenel et al. (2020), Table 8.3, S. 271',
    Langzitat:
      'Haenel, H.-D.; Rösemann, C.; Dämmgen, U.; Döring, U.; Wulf, S.; Eurich-Menden, B.; Freibauer, A.; Döhler, H.; Schreiner, C.; Osterburg, B.; Fuß, R. (2020): Calculations of gaseous and particulate emissions from German agriculture 1990 – 2018. Report on methods and data (RMD) Submission 2020. Thünen Report 77, Braunschweig, Johann Heinrich von Thünen-Institut',
  },
  'orgFertParams.chickenSolidManure.8h': {
    id: 'orgFertParams.chickenSolidManure.8h',
    Produktionsrichtung: 'Wirtschaftsdüngerausbringung',
    Emissionsquelle: 'Wirtschaftsdünger von Hühnern',
    Beschreibung:
      'Festmist mit Breitverteiler und Einarbeitung > 12 h bis ≤ 24 h',
    Parameter: 'Ammoniak-Emissionsfaktor',
    'Information zum Parameter:': '',
    Wert: 0.45,
    Einheit: 'kg NH3-N · (kg UAN)-1',
    Bezeichnung: 'EFNH3-N, Htk, Bv, E < 24 h',
    Kurzzitat: 'Haenel et al. (2020), Table 8.3, S. 271',
    Langzitat:
      'Haenel, H.-D.; Rösemann, C.; Dämmgen, U.; Döring, U.; Wulf, S.; Eurich-Menden, B.; Freibauer, A.; Döhler, H.; Schreiner, C.; Osterburg, B.; Fuß, R. (2020): Calculations of gaseous and particulate emissions from German agriculture 1990 – 2018. Report on methods and data (RMD) Submission 2020. Thünen Report 77, Braunschweig, Johann Heinrich von Thünen-Institut',
  },
  'orgFertParams.chickenSolidManure.1h': {
    id: 'orgFertParams.chickenSolidManure.1h',
    Produktionsrichtung: 'Wirtschaftsdüngerausbringung',
    Emissionsquelle: 'Wirtschaftsdünger von Hühnern',
    Beschreibung: 'Festmist mit Breitverteiler und Einarbeitung ≤ 1 h',
    Parameter: 'Ammoniak-Emissionsfaktor',
    'Information zum Parameter:': '',
    Wert: 0,
    Einheit: 'kg NH3-N · (kg UAN)-1',
    Bezeichnung: 'EFNH3-N, Htk, Bv, E < 1 h',
    Kurzzitat: 'Haenel et al. (2020), Table 8.3, S. 271',
    Langzitat:
      'Haenel, H.-D.; Rösemann, C.; Dämmgen, U.; Döring, U.; Wulf, S.; Eurich-Menden, B.; Freibauer, A.; Döhler, H.; Schreiner, C.; Osterburg, B.; Fuß, R. (2020): Calculations of gaseous and particulate emissions from German agriculture 1990 – 2018. Report on methods and data (RMD) Submission 2020. Thünen Report 77, Braunschweig, Johann Heinrich von Thünen-Institut',
  },
  'gwp.ch4': {
    id: 'gwp.ch4',
    Produktionsrichtung: 'Wirtschaftsdüngerausbringung',
    Emissionsquelle: 'Wirtschaftsdünger von Hühnern',
    Beschreibung: 'Methan zu Kohlenstoffdioxidäquivalenten',
    Parameter: 'Treibhauspotenzial',
    'Information zum Parameter:': '',
    Wert: 25,
    Einheit: 'kg CO2e · (kg CH4)-1',
    Bezeichnung: 'GWP100, CH4',
    Kurzzitat: 'IPCC (2007), S. 33',
    Langzitat:
      'IPCC (2007): Climate change 2007. The physical science basis. Contribution of Working Group I to the Fourth Assessment Report of the IPCC, Cambridge/New York, Cambridge University Press, https://www.ipcc.ch/report/ar4/wg1/, access 14.10.2020',
  },
  'orgFertParams.horseManure.noIncorporation': {
    id: 'orgFertParams.horseManure.noIncorporation',
    Produktionsrichtung: 'Wirtschaftsdüngerausbringung',
    Emissionsquelle: 'Wirtschaftsdünger von Pferden',
    Beschreibung: 'Festmist mit Breitverteiler ohne Einarbeitung',
    Parameter: 'Ammoniak-Emissionsfaktor',
    'Information zum Parameter:': '',
    Wert: 0.9,
    Einheit: 'kg NH3-N · (kg TAN)-1',
    Bezeichnung: 'EFNH3-N, PfdM, Bv, o E',
    Kurzzitat: 'Haenel et al. (2020), Table 4.10, S. 123',
    Langzitat:
      'Haenel, H.-D.; Rösemann, C.; Dämmgen, U.; Döring, U.; Wulf, S.; Eurich-Menden, B.; Freibauer, A.; Döhler, H.; Schreiner, C.; Osterburg, B.; Fuß, R. (2020): Calculations of gaseous and particulate emissions from German agriculture 1990 – 2018. Report on methods and data (RMD) Submission 2020. Thünen Report 77, Braunschweig, Johann Heinrich von Thünen-Institut',
  },
  'orgFertParams.horseManure.4h': {
    id: 'orgFertParams.horseManure.4h',
    Produktionsrichtung: 'Wirtschaftsdüngerausbringung',
    Emissionsquelle: 'Wirtschaftsdünger von Pferden',
    Beschreibung:
      'Festmist mit Breitverteiler und Einarbeitung > 1 h bis ≤ 4 h',
    Parameter: 'Ammoniak-Emissionsfaktor',
    'Information zum Parameter:': '',
    Wert: 0.45,
    Einheit: 'kg NH3-N · (kg TAN)-1',
    Bezeichnung: 'EFNH3-N, PfdM, Bv, E < 4 h',
    Kurzzitat: 'Haenel et al. (2020), Table 4.10, S. 123',
    Langzitat:
      'Haenel, H.-D.; Rösemann, C.; Dämmgen, U.; Döring, U.; Wulf, S.; Eurich-Menden, B.; Freibauer, A.; Döhler, H.; Schreiner, C.; Osterburg, B.; Fuß, R. (2020): Calculations of gaseous and particulate emissions from German agriculture 1990 – 2018. Report on methods and data (RMD) Submission 2020. Thünen Report 77, Braunschweig, Johann Heinrich von Thünen-Institut',
  },
  'orgFertParams.horseManure.8h': {
    id: 'orgFertParams.horseManure.8h',
    Produktionsrichtung: 'Wirtschaftsdüngerausbringung',
    Emissionsquelle: 'Wirtschaftsdünger von Pferden',
    Beschreibung:
      'Festmist mit Breitverteiler und Einarbeitung > 4 h bis ≤ 12 h',
    Parameter: 'Ammoniak-Emissionsfaktor',
    'Information zum Parameter:': '',
    Wert: 0.81,
    Einheit: 'kg NH3-N · (kg TAN)-1',
    Bezeichnung: 'EFNH3-N, PfdM, Bv, E < 12 h',
    Kurzzitat: 'Haenel et al. (2020), Table 4.10, S. 123',
    Langzitat:
      'Haenel, H.-D.; Rösemann, C.; Dämmgen, U.; Döring, U.; Wulf, S.; Eurich-Menden, B.; Freibauer, A.; Döhler, H.; Schreiner, C.; Osterburg, B.; Fuß, R. (2020): Calculations of gaseous and particulate emissions from German agriculture 1990 – 2018. Report on methods and data (RMD) Submission 2020. Thünen Report 77, Braunschweig, Johann Heinrich von Thünen-Institut',
  },
  'orgFertParams.horseManure.1h': {
    id: 'orgFertParams.horseManure.1h',
    Produktionsrichtung: 'Wirtschaftsdüngerausbringung',
    Emissionsquelle: 'Wirtschaftsdünger von Pferden',
    Beschreibung: 'Festmist mit Breitverteiler und Einarbeitung ≤ 1 h',
    Parameter: 'Ammoniak-Emissionsfaktor',
    'Information zum Parameter:': '',
    Wert: 0.09,
    Einheit: 'kg NH3-N · (kg TAN)-1',
    Bezeichnung: 'EFNH3-N, PfdM, Bv, E < 1 h',
    Kurzzitat: 'Haenel et al. (2020), Table 4.10, S. 123',
    Langzitat:
      'Haenel, H.-D.; Rösemann, C.; Dämmgen, U.; Döring, U.; Wulf, S.; Eurich-Menden, B.; Freibauer, A.; Döhler, H.; Schreiner, C.; Osterburg, B.; Fuß, R. (2020): Calculations of gaseous and particulate emissions from German agriculture 1990 – 2018. Report on methods and data (RMD) Submission 2020. Thünen Report 77, Braunschweig, Johann Heinrich von Thünen-Institut',
  },
  'orgFertParams.turkeySolidManure.noIncorporation': {
    id: 'orgFertParams.turkeySolidManure.noIncorporation',
    Produktionsrichtung: 'Wirtschaftsdüngerausbringung',
    Emissionsquelle: 'Wirtschaftsdünger von Puten',
    Beschreibung: 'Festmist mit Breitverteiler ohne Einarbeitung',
    Parameter: 'Ammoniak-Emissionsfaktor',
    'Information zum Parameter:': '',
    Wert: 0.9,
    Einheit: 'kg NH3-N · (kg UAN)-1',
    Bezeichnung: 'EFNH3-N, PtM, Bv, o E',
    Kurzzitat: 'Haenel et al. (2020), Table 8.3, S. 271',
    Langzitat:
      'Haenel, H.-D.; Rösemann, C.; Dämmgen, U.; Döring, U.; Wulf, S.; Eurich-Menden, B.; Freibauer, A.; Döhler, H.; Schreiner, C.; Osterburg, B.; Fuß, R. (2020): Calculations of gaseous and particulate emissions from German agriculture 1990 – 2018. Report on methods and data (RMD) Submission 2020. Thünen Report 77, Braunschweig, Johann Heinrich von Thünen-Institut',
  },
  'orgFertParams.turkeySolidManure.4h': {
    id: 'orgFertParams.turkeySolidManure.4h',
    Produktionsrichtung: 'Wirtschaftsdüngerausbringung',
    Emissionsquelle: 'Wirtschaftsdünger von Puten',
    Beschreibung:
      'Festmist mit Breitverteiler und Einarbeitung > 1 h bis ≤ 4 h',
    Parameter: 'Ammoniak-Emissionsfaktor',
    'Information zum Parameter:': '',
    Wert: 0.18,
    Einheit: 'kg NH3-N · (kg UAN)-1',
    Bezeichnung: 'EFNH3-N, PtM, Bv, E < 4 h',
    Kurzzitat: 'Haenel et al. (2020), Table 8.3, S. 271',
    Langzitat:
      'Haenel, H.-D.; Rösemann, C.; Dämmgen, U.; Döring, U.; Wulf, S.; Eurich-Menden, B.; Freibauer, A.; Döhler, H.; Schreiner, C.; Osterburg, B.; Fuß, R. (2020): Calculations of gaseous and particulate emissions from German agriculture 1990 – 2018. Report on methods and data (RMD) Submission 2020. Thünen Report 77, Braunschweig, Johann Heinrich von Thünen-Institut',
  },
  'orgFertParams.turkeySolidManure.8h': {
    id: 'orgFertParams.turkeySolidManure.8h',
    Produktionsrichtung: 'Wirtschaftsdüngerausbringung',
    Emissionsquelle: 'Wirtschaftsdünger von Puten',
    Beschreibung:
      'Festmist mit Breitverteiler und Einarbeitung > 12 h bis ≤ 24 h',
    Parameter: 'Ammoniak-Emissionsfaktor',
    'Information zum Parameter:': '',
    Wert: 0.45,
    Einheit: 'kg NH3-N · (kg UAN)-1',
    Bezeichnung: 'EFNH3-N, PtM, Bv, E < 24 h',
    Kurzzitat: 'Haenel et al. (2020), Table 8.3, S. 271',
    Langzitat:
      'Haenel, H.-D.; Rösemann, C.; Dämmgen, U.; Döring, U.; Wulf, S.; Eurich-Menden, B.; Freibauer, A.; Döhler, H.; Schreiner, C.; Osterburg, B.; Fuß, R. (2020): Calculations of gaseous and particulate emissions from German agriculture 1990 – 2018. Report on methods and data (RMD) Submission 2020. Thünen Report 77, Braunschweig, Johann Heinrich von Thünen-Institut',
  },
  'orgFertParams.turkeySolidManure.1h': {
    id: 'orgFertParams.turkeySolidManure.1h',
    Produktionsrichtung: 'Wirtschaftsdüngerausbringung',
    Emissionsquelle: 'Wirtschaftsdünger von Puten',
    Beschreibung: 'Festmist mit Breitverteiler und Einarbeitung ≤ 1 h',
    Parameter: 'Ammoniak-Emissionsfaktor',
    'Information zum Parameter:': '',
    Wert: 0,
    Einheit: 'kg NH3-N · (kg UAN)-1',
    Bezeichnung: 'EFNH3-N, PtM, Bv, E < 1 h',
    Kurzzitat: 'Haenel et al. (2020), Table 8.3, S. 271',
    Langzitat:
      'Haenel, H.-D.; Rösemann, C.; Dämmgen, U.; Döring, U.; Wulf, S.; Eurich-Menden, B.; Freibauer, A.; Döhler, H.; Schreiner, C.; Osterburg, B.; Fuß, R. (2020): Calculations of gaseous and particulate emissions from German agriculture 1990 – 2018. Report on methods and data (RMD) Submission 2020. Thünen Report 77, Braunschweig, Johann Heinrich von Thünen-Institut',
  },
  'orgFertParams.digestateLiquid.noIncorporation': {
    id: 'orgFertParams.digestateLiquid.noIncorporation',
    Produktionsrichtung: 'Wirtschaftsdüngerausbringung Gärrest',
    Emissionsquelle: 'Gärrest',
    Beschreibung: 'Schleppschlauch ohne Einarbeitung',
    Parameter: 'Ammoniak-Emissionsfaktor',
    'Information zum Parameter:': '',
    Wert: 0.46,
    Einheit: 'kg NH3-N · (kg TAN)-1',
    Bezeichnung: 'EFNH3-N, Gr, Sschl, o E',
    Kurzzitat: 'Haenel et al. (2020), Table 4.8, S. 122',
    Langzitat:
      'Haenel, H.-D.; Rösemann, C.; Dämmgen, U.; Döring, U.; Wulf, S.; Eurich-Menden, B.; Freibauer, A.; Döhler, H.; Schreiner, C.; Osterburg, B.; Fuß, R. (2020): Calculations of gaseous and particulate emissions from German agriculture 1990 – 2018. Report on methods and data (RMD) Submission 2020. Thünen Report 77, Braunschweig, Johann Heinrich von Thünen-Institut',
  },
  'orgFertParams.digestateLiquid.4h': {
    id: 'orgFertParams.digestateLiquid.4h',
    Produktionsrichtung: 'Wirtschaftsdüngerausbringung Gärrest',
    Emissionsquelle: 'Gärrest',
    Beschreibung: 'Schleppschlauch und Einarbeitung > 1 h bis ≤ 4 h',
    Parameter: 'Ammoniak-Emissionsfaktor',
    'Information zum Parameter:': '',
    Wert: 0.15,
    Einheit: 'kg NH3-N · (kg TAN)-1',
    Bezeichnung: 'EFNH3-N, Gr, Sschl, E < 4 h',
    Kurzzitat: 'Haenel et al. (2020), Table 4.8, S. 122',
    Langzitat:
      'Haenel, H.-D.; Rösemann, C.; Dämmgen, U.; Döring, U.; Wulf, S.; Eurich-Menden, B.; Freibauer, A.; Döhler, H.; Schreiner, C.; Osterburg, B.; Fuß, R. (2020): Calculations of gaseous and particulate emissions from German agriculture 1990 – 2018. Report on methods and data (RMD) Submission 2020. Thünen Report 77, Braunschweig, Johann Heinrich von Thünen-Institut',
  },
  'orgFertParams.digestateLiquid.1h': {
    id: 'orgFertParams.digestateLiquid.1h',
    Produktionsrichtung: 'Wirtschaftsdüngerausbringung Gärrest',
    Emissionsquelle: 'Gärrest',
    Beschreibung: 'Schleppschlauch und Einarbeitung ≤ 1 h',
    Parameter: 'Ammoniak-Emissionsfaktor',
    'Information zum Parameter:': '',
    Wert: 0.04,
    Einheit: 'kg NH3-N · (kg TAN)-1',
    Bezeichnung: 'EFNH3-N, Gr, Sschl, E < 1 h',
    Kurzzitat: 'Haenel et al. (2020), Table 4.8, S. 122',
    Langzitat:
      'Haenel, H.-D.; Rösemann, C.; Dämmgen, U.; Döring, U.; Wulf, S.; Eurich-Menden, B.; Freibauer, A.; Döhler, H.; Schreiner, C.; Osterburg, B.; Fuß, R. (2020): Calculations of gaseous and particulate emissions from German agriculture 1990 – 2018. Report on methods and data (RMD) Submission 2020. Thünen Report 77, Braunschweig, Johann Heinrich von Thünen-Institut',
  },
  'ef.biodiesel': {
    id: 'ef.biodiesel',
    Produktionsrichtung: 'Energiebereitstellung und -konversion',
    Emissionsquelle: '',
    Beschreibung: 'Biodiesel herstellen',
    Parameter: 'Treibhausgas-Emissionsfaktor',
    'Information zum Parameter:': '',
    Wert: 0.536,
    Einheit: 'kg CO2e · (l)-1',
    Bezeichnung: 'EFCO2e, Bdslhst',
    Kurzzitat:
      'Berechnet aus Lauf et al. (2019), S. 129; Heizwert nach Richtlinie 2018/2001/EG, S. 143',
    Langzitat:
      'Lauf, T.; Memmler, M.; Schneider, S. (2019): Emissionsbilanz erneuerbarer Energieträger. Bestimmung der vermiedenen Emissionen im Jahr 2018. Climate Change 37/2019, Dessau-Roßlau, Umweltbundesamt; EU RL 2001 (2018): Richtlinie (EU) 2018/ 2001 des Europäischen Parlaments und des Rates vom 11. Dezember 2018 zur Förderung der Nutzung von Energie aus erneuerbaren Quellen, ABl L 328 vom 21.12.2018, S. 82–209',
  },
  'ef.diesel': {
    id: 'ef.diesel',
    Produktionsrichtung: 'Energiebereitstellung und -konversion',
    Emissionsquelle: '',
    Beschreibung: 'Dieselkraftstoff herstellen und verbrennen',
    Parameter: 'Treibhausgas-Emissionsfaktor',
    'Information zum Parameter:': '',
    Wert: 3.013,
    Einheit: 'kg CO2e · (l)-1',
    Bezeichnung: 'EFCO2e, Dslverbrng',
    Kurzzitat:
      'Berechnet aus Lauf et al. (2019), S. 131; Heizwert nach Richtlinie 2018/2001/EG, S. 144',
    Langzitat:
      'Lauf, T.; Memmler, M.; Schneider, S. (2019): Emissionsbilanz erneuerbarer Energieträger. Bestimmung der vermiedenen Emissionen im Jahr 2018. Climate Change 37/2019, Dessau-Roßlau, Umweltbundesamt; EU RL 2001 (2018): Richtlinie (EU) 2018/ 2001 des Europäischen Parlaments und des Rates vom 11. Dezember 2018 zur Förderung der Nutzung von Energie aus erneuerbaren Quellen, ABl L 328 vom 21.12.2018, S. 82–209',
  },
  'ef.hvo100': {
    id: 'ef.hvo100',
    Produktionsrichtung: 'Energiebereitstellung und -konversion',
    Emissionsquelle: '',
    Beschreibung:
      'HVO100 (Hydrotreated Vegetable Oil) herstellen und verbrennen',
    Parameter: 'Treibhausgas-Emissionsfaktor',
    'Information zum Parameter:':
      'Berechnet aus 17,2 g CO2eq/MJ (BLE 2024, S. 1-2) √ó 34 MJ/l (Hoyer 2024, S. 1) = 0,58 kg CO2e/l',
    Wert: 0.58,
    Einheit: 'kg CO2e · (l)-1',
    Bezeichnung: 'EFCO2e, HVO100verbrng',
    Kurzzitat: 'BLE (2024), S. 1-2; Wilhelm Hoyer B.V. & Co. KG (2024), S. 1',
    Langzitat:
      'Bundesanstalt für Landwirtschaft und Ernährung (BLE) (2024): Nachhaltigkeits-Teilnachweis für Biokraftstoffe nach §§ 11 ff. Biokraftstoff-Nachhaltigkeitsverordnung (Biokraft-NachV), Nachweisnummer DE-B-BLE-BM-01-999-12345678-NTNw-11813225, Bonn, S. 1: Abschnitt 3 Treibhausgaseinsparung (E = 17,2 g CO2eq/MJ), S. 2: Zusatzinformationen zur THG Emission; Wilhelm Hoyer B.V. & Co. KG (2024): Zertifikat Nachhaltigkeitsnachweis für Kraftstoffbezug, Visselhövede, S. 1: Abschnitt 2 Emissionswerte (Energiegehalt = 0,034 GJ/l = 34 MJ/l)',
  },
  'ef.electricityRenewablesMixDe2018': {
    id: 'ef.electricityRenewablesMixDe2018',
    Produktionsrichtung: 'Energiebereitstellung und -konversion',
    Emissionsquelle: '',
    Beschreibung:
      'Strom aus erneuerbaren Energien herstellen (Strommix aus erneuerbaren Energien von Deutschland im Jahr 2018)',
    Parameter: 'Treibhausgas-Emissionsfaktor',
    'Information zum Parameter:': '',
    Wert: 0.072,
    Einheit: 'kg CO2e · (kWhel)-1',
    Bezeichnung: 'EFCO2e, el-mix-DE; EE',
    Kurzzitat: 'Icha (2019), S. 10',
    Langzitat:
      'Icha, P. (2019): Entwicklung der spezifischen Kohlendioxid-Emissionen des deutschen Strommix in den Jahren 1990 - 2018. Climate Change 10/2019, Dessau-Roßlau, Umweltbundesamt',
  },
  'ef.electricityGridDe2018': {
    id: 'ef.electricityGridDe2018',
    Produktionsrichtung: 'Energiebereitstellung und -konversion',
    Emissionsquelle: '',
    Beschreibung: 'Strom herstellen (Strommix von Deutschland im Jahr 2018)',
    Parameter: 'Treibhausgas-Emissionsfaktor',
    'Information zum Parameter:': '',
    Wert: 0.474,
    Einheit: 'kg CO2e · (kWhel)-1',
    Bezeichnung: 'EFCO2e, el-mix-DE',
    Kurzzitat: 'Icha (2019), S. 10',
    Langzitat:
      'Icha, P. (2019): Entwicklung der spezifischen Kohlendioxid-Emissionen des deutschen Strommix in den Jahren 1990 - 2018. Climate Change 10/2019, Dessau-Roßlau, Umweltbundesamt',
  },
  'ef.supplyCao': {
    id: 'ef.supplyCao',
    Produktionsrichtung: 'Kalk',
    Emissionsquelle: '',
    Beschreibung: 'Kalk herstellen',
    Parameter: 'Treibhausgas-Emissionsfaktor',
    'Information zum Parameter:':
      'aus Ecoinvent v3.1, Aktivitätsdatensatz "lime production, milled loose, RoW", Allokationsmethode "ecoinvent default"',
    Wert: 0.021,
    Einheit: 'kg CO2e · (kg CaO)-1',
    Bezeichnung: 'EFCO2e, Kalk',
    Kurzzitat: 'Weidema et al. (2013)',
    Langzitat:
      'Eigentümer dieses Parameters ist Ecoinvent Weidema, B. P. et al. (2013): The ecoinvent database: Overview and methodology, Data quality guideline for the ecoinvent database version 3, www.ecoinvent.org',
  },
  'ef.machineManufacture': {
    id: 'ef.machineManufacture',
    Produktionsrichtung: 'Maschinen',
    Emissionsquelle: '',
    Beschreibung: 'Landwirtschaftliche Maschinen herstellen',
    Parameter: 'Treibhausgas-Emissionsfaktor',
    'Information zum Parameter:':
      'siehe auch BEK-Handbuch, S. 36. Der Treibhausgasemissionsfaktor für die Maschinenherstellung bezogen auf den verbrauchten Dieselkraftstoff von der herzustellenden Maschine.',
    Wert: 0.885,
    Einheit: 'kg CO2e · (l Diesel)-1',
    Bezeichnung: 'EFCO2e, Masch',
    Kurzzitat: 'Siehe BEK-Handbuch, S. 36',
    Langzitat: '',
  },
  'ef.supplyAhl': {
    id: 'ef.supplyAhl',
    Produktionsrichtung: 'Mineraldünger',
    Emissionsquelle: '',
    Beschreibung: 'AHL mit 30 % N, davon 50 % Harnstoff-N herstellen in EU',
    Parameter: 'Treibhausgas-Emissionsfaktor',
    'Information zum Parameter:':
      'Eigene Berechnungen mit Fertilizers Europe Carbon Footprint Calculator for Fertilizer Products',
    Wert: 3.397,
    Einheit: 'kg CO2e · (kg N)-1',
    Bezeichnung: 'EFCO2e, AHL-EU',
    Kurzzitat: 'Eigene Berechnungen mit Fertilizers Europe (2021)',
    Langzitat:
      'Fertilizers Europe (2021): Fertilizers Europe Carbon Footprint Calculator for Fertilizer Products. http://www.calcfert.com/#energy, access 23.04.2021',
  },
  'ef.supplyUrea': {
    id: 'ef.supplyUrea',
    Produktionsrichtung: 'Mineraldünger',
    Emissionsquelle: '',
    Beschreibung: 'Harnstoff mit 46 % N herstellen in EU (Farm Market)',
    Parameter: 'Treibhausgas-Emissionsfaktor',
    'Information zum Parameter:':
      'Eigene Berechnungen mit Fertilizers Europe Carbon Footprint Calculator for Fertilizer Products',
    Wert: 3.502,
    Einheit: 'kg CO2e · (kg N)-1',
    Bezeichnung: 'EFCO2e, Harnstoff-EU',
    Kurzzitat: 'Eigene Berechnungen mit Fertilizers Europe (2021)',
    Langzitat:
      'Fertilizers Europe (2021): Fertilizers Europe Carbon Footprint Calculator for Fertilizer Products. http://www.calcfert.com/#energy, access 23.04.2021',
  },
  'ef.supplyK2O': {
    id: 'ef.supplyK2O',
    Produktionsrichtung: 'Mineraldünger',
    Emissionsquelle: '',
    Beschreibung: 'Kalium-Einnährstoffdünger herstellen',
    Parameter: 'Treibhausgas-Emissionsfaktor',
    'Information zum Parameter:': '',
    Wert: 0.416,
    Einheit: 'kg CO2e · (kg K2O)-1',
    Bezeichnung: 'EFCO2e, K-Dünger',
    Kurzzitat: 'Giuntoli et al. (2017),  Table 10, S. 16',
    Langzitat:
      'Giuntoli J, Agostini A, Edwards R, Marelli L, Solid and gaseous bioenergy pathways: input values and GHG emissions. Calculated according to the methodology set in COM(2016) 767, EUR 27215 EN, doi:10.2790/27486.',
  },
  'ef.otherMineralN': {
    id: 'ef.otherMineralN',
    Produktionsrichtung: 'Mineraldünger',
    Emissionsquelle: '',
    Beschreibung:
      'KAS und andere Stickstoff-Einnährstoffdünger herstellen in EU',
    Parameter: 'Treibhausgas-Emissionsfaktor',
    'Information zum Parameter:':
      'Eigene Berechnungen mit Fertilizers Europe Carbon Footprint Calculator for Fertilizer Products',
    Wert: 3.52,
    Einheit: 'kg CO2e · (kg N)-1',
    Bezeichnung: 'EFCO2e, KAS-EU',
    Kurzzitat: 'Eigene Berechnungen mit Fertilizers Europe (2021)',
    Langzitat:
      'Fertilizers Europe (2021): Fertilizers Europe Carbon Footprint Calculator for Fertilizer Products. http://www.calcfert.com/#energy, access 23.04.2021',
  },
  'ef.supplyP2O5': {
    id: 'ef.supplyP2O5',
    Produktionsrichtung: 'Mineraldünger',
    Emissionsquelle: '',
    Beschreibung: 'Phosphor-Einnährstoffdünger herstellen',
    Parameter: 'Treibhausgas-Emissionsfaktor',
    'Information zum Parameter:': '',
    Wert: 0.542,
    Einheit: 'kg CO2e · (kg P2O5)-1',
    Bezeichnung: 'EFCO2e, P-Dünger',
    Kurzzitat: 'Giuntoli et al. (2017),  Table 9, S. 15',
    Langzitat:
      'Giuntoli J, Agostini A, Edwards R, Marelli L, Solid and gaseous bioenergy pathways: input values and GHG emissions. Calculated according to the methodology set in COM(2016) 767, EUR 27215 EN, doi:10.2790/27486.',
  },
  'ef.supplyPesticides': {
    id: 'ef.supplyPesticides',
    Produktionsrichtung: 'Pflanzenschutzmittel',
    Emissionsquelle: '',
    Beschreibung: 'Pflanzenschutzmittel herstellen',
    Parameter: 'Treibhausgas-Emissionsfaktor',
    'Information zum Parameter:':
      'aus Ecoinvent v3.1, Aktivitätsdatensatz "market for pesticide, unspecified, GLO", Allokationsmethode "ecoinvent default"',
    Wert: 11.09,
    Einheit: 'kg CO2e · (kg  Wirkstoff)-1',
    Bezeichnung: 'EFCO2e, PSM',
    Kurzzitat: 'Weidema et al. (2013)',
    Langzitat:
      'Eigentümer dieses Parameters ist Ecoinvent Weidema, B. P. et al. (2013): The ecoinvent database: Overview and methodology, Data quality guideline for the ecoinvent database version 3, www.ecoinvent.org',
  },
  'crop.winterBarleyFodder.supplySeed': {
    id: 'crop.winterBarleyFodder.supplySeed',
    Produktionsrichtung: 'Saatgut',
    Emissionsquelle: '',
    Beschreibung: 'Gerstensaatgut mit 84 % TM konventionell herstellen',
    Parameter: 'Treibhausgas-Emissionsfaktor',
    'Information zum Parameter:':
      'aus Ecoinvent v3.1, Aktivitätsdatensatz "barley seed production, for sowing,  GLO", Allokationsmethode "ecoinvent default"',
    Wert: 0.684,
    Einheit: 'kg CO2e · (kg FM)-1',
    Bezeichnung: 'EFCO2e, Stgt, Grst',
    Kurzzitat: 'Weidema et al. (2013)',
    Langzitat:
      'Eigentümer dieses Parameters ist Ecoinvent Weidema, B. P. et al. (2013): The ecoinvent database: Overview and methodology, Data quality guideline for the ecoinvent database version 3, www.ecoinvent.org',
  },
  'crop.potatoTableLate.supplySeed': {
    id: 'crop.potatoTableLate.supplySeed',
    Produktionsrichtung: 'Saatgut',
    Emissionsquelle: '',
    Beschreibung: 'Kartoffelpflanzgut mit 20 % TM konventionell herstellen',
    Parameter: 'Treibhausgas-Emissionsfaktor',
    'Information zum Parameter:':
      'aus Ecoinvent v3.1, Aktivitätsdatensatz "potato seed production, for setting, GLO", Allokationsmethode "ecoinvent default"',
    Wert: 0.321,
    Einheit: 'kg CO2e · (kg FM)-1',
    Bezeichnung: 'EFCO2e, Pflgt, Krtfln',
    Kurzzitat: 'Weidema et al. (2013)',
    Langzitat:
      'Eigentümer dieses Parameters ist Ecoinvent Weidema, B. P. et al. (2013): The ecoinvent database: Overview and methodology, Data quality guideline for the ecoinvent database version 3, www.ecoinvent.org',
  },
  'crop.silageMaize.supplySeed': {
    id: 'crop.silageMaize.supplySeed',
    Produktionsrichtung: 'Saatgut',
    Emissionsquelle: '',
    Beschreibung: 'Maissaatgut mit 88 % TM konventionell herstellen',
    Parameter: 'Treibhausgas-Emissionsfaktor',
    'Information zum Parameter:':
      'aus Ecoinvent v3.1, Aktivitätsdatensatz "maize seed production, for sowing, GLO", Allokationsmethode "ecoinvent default"',
    Wert: 2.136,
    Einheit: 'kg CO2e · (kg FM)-1',
    Bezeichnung: 'EFCO2e, Stgt, Ms',
    Kurzzitat: 'Weidema et al. (2013)',
    Langzitat:
      'Eigentümer dieses Parameters ist Ecoinvent Weidema, B. P. et al. (2013): The ecoinvent database: Overview and methodology, Data quality guideline for the ecoinvent database version 3, www.ecoinvent.org',
  },
  'crop.canola.supplySeed': {
    id: 'crop.canola.supplySeed',
    Produktionsrichtung: 'Saatgut',
    Emissionsquelle: '',
    Beschreibung: 'Rapssaatgut mit 94 % TM konventionell herstellen',
    Parameter: 'Treibhausgas-Emissionsfaktor',
    'Information zum Parameter:':
      'aus Ecoinvent v3.1, Aktivitätsdatensatz "rape seed production, for sowing, RoW", Allokationsmethode "ecoinvent default"',
    Wert: 2.096,
    Einheit: 'kg CO2e · (kg FM)-1',
    Bezeichnung: 'EFCO2e, Stgt, Rps',
    Kurzzitat: 'Weidema et al. (2013)',
    Langzitat:
      'Eigentümer dieses Parameters ist Ecoinvent Weidema, B. P. et al. (2013): The ecoinvent database: Overview and methodology, Data quality guideline for the ecoinvent database version 3, www.ecoinvent.org',
  },
  'crop.winterRyeBaking.supplySeed': {
    id: 'crop.winterRyeBaking.supplySeed',
    Produktionsrichtung: 'Saatgut',
    Emissionsquelle: '',
    Beschreibung: 'Roggensaatgut mit 85 % TM konventionell herstellen',
    Parameter: 'Treibhausgas-Emissionsfaktor',
    'Information zum Parameter:':
      'aus Ecoinvent v3.1, Aktivitätsdatensatz "rye seed production, for sowing, GLO", Allokationsmethode "ecoinvent default"',
    Wert: 0.828,
    Einheit: 'kg CO2e · (kg FM)-1',
    Bezeichnung: 'EFCO2e, Stgt, Rgn',
    Kurzzitat: 'Weidema et al. (2013)',
    Langzitat:
      'Eigentümer dieses Parameters ist Ecoinvent Weidema, B. P. et al. (2013): The ecoinvent database: Overview and methodology, Data quality guideline for the ecoinvent database version 3, www.ecoinvent.org',
  },
  'crop.winterWheat.supplySeed': {
    id: 'crop.winterWheat.supplySeed',
    Produktionsrichtung: 'Saatgut',
    Emissionsquelle: '',
    Beschreibung: 'Weizensaatgut mit 85 % TM konventionell herstellen',
    Parameter: 'Treibhausgas-Emissionsfaktor',
    'Information zum Parameter:':
      'aus Ecoinvent v3.1, Aktivitätsdatensatz "wheat seed production, for sowing, GLO", Allokationsmethode "ecoinvent default"',
    Wert: 0.89,
    Einheit: 'kg CO2e · (kg FM)-1',
    Bezeichnung: 'EFCO2e, Stgt, Wzn',
    Kurzzitat: 'Weidema et al. (2013)',
    Langzitat:
      'Eigentümer dieses Parameters ist Ecoinvent Weidema, B. P. et al. (2013): The ecoinvent database: Overview and methodology, Data quality guideline for the ecoinvent database version 3, www.ecoinvent.org',
  },
  'crop.sugarBeet.supplySeed': {
    id: 'crop.sugarBeet.supplySeed',
    Produktionsrichtung: 'Saatgut',
    Emissionsquelle: '',
    Beschreibung: 'Zuckerrübensaatgut mit 90 % TM konventionell herstellen',
    Parameter: 'Treibhausgas-Emissionsfaktor',
    'Information zum Parameter:':
      'aus Ecoinvent v3.1, Aktivitätsdatensatz "sugar beet seed production, for sowing, GLO", Allokationsmethode "ecoinvent default"',
    Wert: 2.069,
    Einheit: 'kg CO2e · (kg FM)-1',
    Bezeichnung: 'EFCO2e, Stgt, Zrbn',
    Kurzzitat: 'Weidema et al. (2013)',
    Langzitat:
      'Eigentümer dieses Parameters ist Ecoinvent Weidema, B. P. et al. (2013): The ecoinvent database: Overview and methodology, Data quality guideline for the ecoinvent database version 3, www.ecoinvent.org',
  },
  'ef.supplyNOrganic': {
    id: 'ef.supplyNOrganic',
    Produktionsrichtung: 'Wirtschaftsdünger (Zukauf oder Verkauf)',
    Emissionsquelle: '',
    Beschreibung:
      'Substitutionswert für Zukauf oder Verkauf von Stickstoff in Wirtschaftsdüngern',
    Parameter: 'Treibhausgas-Emissionsfaktor',
    'Information zum Parameter:':
      'siehe auch AHL mit 30 % N, davon 50 % Harnstoff-N herstellen in EU',
    Wert: 3.397,
    Einheit: 'kg CO2e · (kg N-MDÄ)-1',
    Bezeichnung: 'Subst EFCO2e, N in WSD',
    Kurzzitat: 'Eigene Berechnungen mit Fertilizers Europe (2021)',
    Langzitat:
      'Fertilizers Europe (2021): Fertilizers Europe Carbon Footprint Calculator for Fertilizer Products. http://www.calcfert.com/#energy, access 23.04.2021',
  },
  'cf.n2oN2on': {
    id: 'cf.n2oN2on',
    Produktionsrichtung: 'Stickstoffdüngung',
    Emissionsquelle: '',
    Beschreibung: 'Lachgas-Stickstoff zu Lachgas',
    Parameter: 'Umrechnungsfaktor',
    'Information zum Parameter:': 'stöchiometrische Umrechnung',
    Wert: 1.57,
    Einheit: 'kg N2O · (kg N2O-N)-1',
    Bezeichnung: 'URFN2O-N→N2O',
    Kurzzitat: '',
    Langzitat: '',
  },
  'gwp.n2o': {
    id: 'gwp.n2o',
    Produktionsrichtung: 'Stickstoffdüngung',
    Emissionsquelle: '',
    Beschreibung: 'Lachgas zu Kohlenstoffdioxidäquivalenten',
    Parameter: 'Treibhauspotenzial',
    'Information zum Parameter:': '',
    Wert: 273,
    Einheit: 'kg CO2e · (kg N2O)-1',
    Bezeichnung: 'GWP100, N2O',
    Kurzzitat: 'IPCC, 2021',
    Langzitat: 'IPCC, 2021',
  },
  'cf.cCo2': {
    id: 'cf.cCo2',
    Produktionsrichtung: 'Mineraldünger',
    Emissionsquelle: '',
    Beschreibung: 'Kohlenstoff zu Kohlenstoffdioxid',
    Parameter: 'Umrechnungsfaktor',
    'Information zum Parameter:': 'stöchiometrische Umrechnung',
    Wert: 3.67,
    Einheit: 'kg CO2 · (kg C)-1',
    Bezeichnung: 'URFC→CO2',
    Kurzzitat: '',
    Langzitat: '',
  },
  'pesticides.contentActiveIngredient': {
    id: 'pesticides.contentActiveIngredient',
    Produktionsrichtung: 'Pflanzenschutzmittel',
    Emissionsquelle: '',
    Beschreibung: 'Wirkstoffgehalt Pflanzenschutzmittel (PSM)',
    Parameter: '',
    'Information zum Parameter:': '',
    Wert: 0.35,
    Einheit: '% Wirkstoffgehalt · (psm Einheit)-1',
    Bezeichnung: 'Wirkstoffgehalt',
    Kurzzitat:
      'Wir nehmen momentan einen willkürlichen Wert von 35% für den Wirkstoff an. Mit der Weiterentwicklung des Produkts könnten wir bei Bedarf eine genauere Bestimmung vornehmen.',
    Langzitat: '',
  },
  'ef.nPrevious': {
    id: 'ef.nPrevious',
    Produktionsrichtung: 'Wirtschaftsdünger (Zukauf oder Verkauf)',
    Emissionsquelle: '',
    Beschreibung:
      'Substitutionswert für Zukauf oder Verkauf von Stickstoff in Wirtschaftsdüngern',
    Parameter: 'Treibhausgas-Emissionsfaktor',
    'Information zum Parameter:':
      'siehe auch AHL mit 30 % N, davon 50 % Harnstoff-N herstellen in EU',
    Wert: 3.397,
    Einheit: 'kg CO2e · (kg N-MDÄ)-1',
    Bezeichnung: 'Subst EFCO2e, N in WSD',
    Kurzzitat: 'Eigene Berechnungen mit Fertilizers Europe (2021)',
    Langzitat:
      'Fertilizers Europe (2021): Fertilizers Europe Carbon Footprint Calculator for Fertilizer Products. http://www.calcfert.com/#energy, access 23.04.2021',
  },
  'ef.supplyUan': {
    id: 'ef.supplyUan',
    Produktionsrichtung: 'Mineraldünger',
    Emissionsquelle: '',
    Beschreibung: 'AHL mit 30 % N, davon 50 % Harnstoff-N herstellen in EU',
    Parameter: 'Treibhausgas-Emissionsfaktor',
    'Information zum Parameter:':
      'Eigene Berechnungen mit Fertilizers Europe Carbon Footprint Calculator for Fertilizer Products',
    Wert: 3.397,
    Einheit: 'kg CO2e · (kg N)-1',
    Bezeichnung: 'EFCO2e, AHL-EU',
    Kurzzitat: 'Eigene Berechnungen mit Fertilizers Europe (2021)',
    Langzitat:
      'Fertilizers Europe (2021): Fertilizers Europe Carbon Footprint Calculator for Fertilizer Products. http://www.calcfert.com/#energy, access 23.04.2021',
  },
  nPerCHumus: {
    id: 'nPerCHumus',
    Produktionsrichtung: 'Humus-C',
    Emissionsquelle: '',
    Beschreibung:
      'Stickstoff zu Kohlenstoff in Humus von Acker- und Dauergrünland',
    Parameter: 'Proportionalitätsfaktor',
    'Information zum Parameter:': 'siehe auch BEK-Handbuch, S. 35',
    Wert: 0.0909,
    Einheit: 'kg C · (kg N)-1',
    Bezeichnung: 'αC:N, Mnrbd',
    Kurzzitat: 'Gensior (2020)',
    Langzitat:
      'Gensior, A. (2020): Mündliche Mitteilung. Braunschweig, Thünen Institut für Agrarklimaschutz.',
  },
  'ef.appliedN.others': {
    id: 'ef.appliedN.others',
    Produktionsrichtung: 'Stickstoffdüngung',
    Emissionsquelle: '',
    Beschreibung:
      'Kalkammonsalpeter (KAS) und andere Stickstoff-Einnährstoffdünger',
    Parameter: 'Ammoniak-Emissionsfaktor',
    'Information zum Parameter:': 'siehe auch BEK-Handbuch, S. 34',
    Wert: 0.01,
    Einheit: 'kg NH3-N · (kg N)-1',
    Bezeichnung: 'EFNH3-N, Anwd, KAS',
    Kurzzitat: 'Rösemann et al. (2021), Table 11.3, S. 344',
    Langzitat:
      'Rösemann, C.; Haenel, H.-D.; Vos, C.; Dämmgen, U.; Döring, U.; Wulf, S.; Eurich-Menden, B.; Freibauer, A.; Döhler, H.; Schreiner, C.; Osterburg, B.; Fuß, R. (2021): Calculations of gaseous and particulate emissions from German agriculture 1990 – 2019. Report on methods and data (RMD) Submission 2021. Thünen Report 84, Braunschweig, Johann Heinrich von Thünen-Institut',
  },
  'crop.winterWheat.nByproductFm': {
    id: 'crop.winterWheat.nByproductFm',
    Produktionsrichtung: 'Ernte- und Wurzelrückstände',
    Emissionsquelle: '',
    Beschreibung: 'Stickstoffgehalt, Nebenprodukt, Winterweizen',
    Parameter: 'Stickstoffgehalt',
    'Information zum Parameter:': '',
    Wert: 0.006,
    Einheit: 'kg N · (kg FM)-1',
    Bezeichnung: 'xN, NWR, Wwzn',
    Kurzzitat: 'DüV (2020), Anlage 7',
    Langzitat:
      'Verordnung über die Anwendung von Düngemitteln, Bodenhilfsstoffen, Kultursubstraten und Pflanzenhilfsmitteln nach den Grundsätzen der guten fachlichen Praxis beim Düngen 2 (Düngeverordnung - DüV) Anlage 7 (zu § 3 Absatz 2 und 6 und § 4 Absatz 3) Nährstoffgehalte pflanzlicher Erzeugnisse',
  },
  'crop.silageMaize.nByproductFm': {
    id: 'crop.silageMaize.nByproductFm',
    Produktionsrichtung: 'Ernte- und Wurzelrückstände',
    Emissionsquelle: '',
    Beschreibung: 'Stickstoffgehalt, Nebenprodukt, Mais',
    Parameter: 'Stickstoffgehalt',
    'Information zum Parameter:': '',
    Wert: 0.006,
    Einheit: 'kg N · (kg FM)-1',
    Bezeichnung: 'xN, NWR, Ms',
    Kurzzitat: 'DüV (2020), Anlage 7',
    Langzitat:
      'Verordnung über die Anwendung von Düngemitteln, Bodenhilfsstoffen, Kultursubstraten und Pflanzenhilfsmitteln nach den Grundsätzen der guten fachlichen Praxis beim Düngen 2 (Düngeverordnung - DüV) Anlage 7 (zu § 3 Absatz 2 und 6 und § 4 Absatz 3) Nährstoffgehalte pflanzlicher Erzeugnisse',
  },
  'crop.canola.nByproductFm': {
    id: 'crop.canola.nByproductFm',
    Produktionsrichtung: 'Ernte- und Wurzelrückstände',
    Emissionsquelle: '',
    Beschreibung: 'Stickstoffgehalt, Nebenprodukt, Winterraps',
    Parameter: 'Stickstoffgehalt',
    'Information zum Parameter:': '',
    Wert: 0.007,
    Einheit: 'kg N · (kg FM)-1',
    Bezeichnung: 'xN, NWR, Rs',
    Kurzzitat: 'DüV (2020), Anlage 7',
    Langzitat:
      'Verordnung über die Anwendung von Düngemitteln, Bodenhilfsstoffen, Kultursubstraten und Pflanzenhilfsmitteln nach den Grundsätzen der guten fachlichen Praxis beim Düngen 2 (Düngeverordnung - DüV) Anlage 7 (zu § 3 Absatz 2 und 6 und § 4 Absatz 3) Nährstoffgehalte pflanzlicher Erzeugnisse',
  },
  'crop.sugarBeet.nByproductFm': {
    id: 'crop.sugarBeet.nByproductFm',
    Produktionsrichtung: 'Ernte- und Wurzelrückstände',
    Emissionsquelle: '',
    Beschreibung: 'Stickstoffgehalt, Nebenprodukt, Zuckerrüben',
    Parameter: 'Stickstoffgehalt',
    'Information zum Parameter:': '',
    Wert: 0.004,
    Einheit: 'kg N · (kg FM)-1',
    Bezeichnung: 'xN, NWR, Zr',
    Kurzzitat: 'DüV (2020), Anlage 7',
    Langzitat:
      'Verordnung über die Anwendung von Düngemitteln, Bodenhilfsstoffen, Kultursubstraten und Pflanzenhilfsmitteln nach den Grundsätzen der guten fachlichen Praxis beim Düngen 2 (Düngeverordnung - DüV) Anlage 7 (zu § 3 Absatz 2 und 6 und § 4 Absatz 3) Nährstoffgehalte pflanzlicher Erzeugnisse',
  },
  'crop.winterBarleyFodder.nByproductFm': {
    id: 'crop.winterBarleyFodder.nByproductFm',
    Produktionsrichtung: 'Ernte- und Wurzelrückstände',
    Emissionsquelle: '',
    Beschreibung: 'Stickstoffgehalt, Nebenprodukt, Wintergerste',
    Parameter: 'Stickstoffgehalt',
    'Information zum Parameter:': '',
    Wert: 0.005,
    Einheit: 'kg N · (kg FM)-1',
    Bezeichnung: 'xN, NWR, Grst',
    Kurzzitat: '',
    Langzitat:
      'Verordnung über die Anwendung von Düngemitteln, Bodenhilfsstoffen, Kultursubstraten und Pflanzenhilfsmitteln nach den Grundsätzen der guten fachlichen Praxis beim Düngen 2 (Düngeverordnung - DüV) Anlage 7 (zu § 3 Absatz 2 und 6 und § 4 Absatz 3) Nährstoffgehalte pflanzlicher Erzeugnisse',
  },
  'crop.springBarleyMalting.nByproductFm': {
    id: 'crop.springBarleyMalting.nByproductFm',
    Produktionsrichtung: 'Ernte- und Wurzelrückstände',
    Emissionsquelle: '',
    Beschreibung: 'Stickstoffgehalt, Nebenprodukt, Wintergerste',
    Parameter: 'Stickstoffgehalt',
    'Information zum Parameter:': '',
    Wert: 0.005,
    Einheit: 'kg N · (kg FM)-1',
    Bezeichnung: 'xN, NWR, Grst',
    Kurzzitat: '',
    Langzitat:
      'Verordnung über die Anwendung von Düngemitteln, Bodenhilfsstoffen, Kultursubstraten und Pflanzenhilfsmitteln nach den Grundsätzen der guten fachlichen Praxis beim Düngen 2 (Düngeverordnung - DüV) Anlage 7 (zu § 3 Absatz 2 und 6 und § 4 Absatz 3) Nährstoffgehalte pflanzlicher Erzeugnisse',
  },
  'crop.springOatsFodder.nByproductFm': {
    id: 'crop.springOatsFodder.nByproductFm',
    Produktionsrichtung: 'Ernte- und Wurzelrückstände',
    Emissionsquelle: '',
    Beschreibung: 'Stickstoffgehalt, Nebenprodukt, Hafer',
    Parameter: 'Stickstoffgehalt',
    'Information zum Parameter:': '',
    Wert: 0.005,
    Einheit: 'kg N · (kg FM)-1',
    Bezeichnung: 'xN, NWR, Hafer',
    Kurzzitat: '',
    Langzitat:
      'Verordnung über die Anwendung von Düngemitteln, Bodenhilfsstoffen, Kultursubstraten und Pflanzenhilfsmitteln nach den Grundsätzen der guten fachlichen Praxis beim Düngen 2 (Düngeverordnung - DüV) Anlage 7 (zu § 3 Absatz 2 und 6 und § 4 Absatz 3) Nährstoffgehalte pflanzlicher Erzeugnisse',
  },
  'crop.potatoTableLate.nByproductFm': {
    id: 'crop.potatoTableLate.nByproductFm',
    Produktionsrichtung: 'Ernte- und Wurzelrückstände',
    Emissionsquelle: '',
    Beschreibung: 'Stickstoffgehalt, Nebenprodukt, Kartoffel',
    Parameter: 'Stickstoffgehalt',
    'Information zum Parameter:': '',
    Wert: 0.002,
    Einheit: 'kg N · (kg FM)-1',
    Bezeichnung: 'xN, NWR, Kartoffel',
    Kurzzitat: '',
    Langzitat:
      'Verordnung über die Anwendung von Düngemitteln, Bodenhilfsstoffen, Kultursubstraten und Pflanzenhilfsmitteln nach den Grundsätzen der guten fachlichen Praxis beim Düngen 2 (Düngeverordnung - DüV) Anlage 7 (zu § 3 Absatz 2 und 6 und § 4 Absatz 3) Nährstoffgehalte pflanzlicher Erzeugnisse',
  },
  'crop.winterRyeBaking.nByproductFm': {
    id: 'crop.winterRyeBaking.nByproductFm',
    Produktionsrichtung: 'Ernte- und Wurzelrückstände',
    Emissionsquelle: '',
    Beschreibung: 'Stickstoffgehalt, Nebenprodukt, Winterroggen',
    Parameter: 'Stickstoffgehalt',
    'Information zum Parameter:': '',
    Wert: 0.005,
    Einheit: 'kg N · (kg FM)-1',
    Bezeichnung: 'xN, NWR, Winterroggen',
    Kurzzitat: '',
    Langzitat:
      'Verordnung über die Anwendung von Düngemitteln, Bodenhilfsstoffen, Kultursubstraten und Pflanzenhilfsmitteln nach den Grundsätzen der guten fachlichen Praxis beim Düngen 2 (Düngeverordnung - DüV) Anlage 7 (zu § 3 Absatz 2 und 6 und § 4 Absatz 3) Nährstoffgehalte pflanzlicher Erzeugnisse',
  },
  'crop.winterWheat.dryMatterContent': {
    id: 'crop.winterWheat.dryMatterContent',
    Produktionsrichtung: 'Trockenmassegehalt, Hauptprodukt',
    Emissionsquelle: '',
    Beschreibung: 'Trockenmassgehalt, Haptprodukt, Winterweizen',
    Parameter: '',
    'Information zum Parameter:': '',
    Wert: 0.86,
    Einheit: 'kg TM · (kg FM)-1',
    Bezeichnung: 'xTM, HP, Wwzn',
    Kurzzitat: 'DüV (2020), Anlage 7',
    Langzitat:
      'Verordnung über die Anwendung von Düngemitteln, Bodenhilfsstoffen, Kultursubstraten und Pflanzenhilfsmitteln nach den Grundsätzen der guten fachlichen Praxis beim Düngen 2 (Düngeverordnung - DüV) Anlage 7 (zu § 3 Absatz 2 und 6 und § 4 Absatz 3) Nährstoffgehalte pflanzlicher Erzeugnisse',
  },
  'crop.silageMaize.dryMatterContent': {
    id: 'crop.silageMaize.dryMatterContent',
    Produktionsrichtung: 'Trockenmassegehalt, Hauptprodukt',
    Emissionsquelle: '',
    Beschreibung: 'Trockenmassgehalt, Haptprodukt, Silomais',
    Parameter: '',
    'Information zum Parameter:': '',
    Wert: 0.28,
    Einheit: 'kg TM · (kg FM)-1',
    Bezeichnung: 'xTM, HP, Ms',
    Kurzzitat: 'DüV (2020), Anlage 7',
    Langzitat:
      'Verordnung über die Anwendung von Düngemitteln, Bodenhilfsstoffen, Kultursubstraten und Pflanzenhilfsmitteln nach den Grundsätzen der guten fachlichen Praxis beim Düngen 2 (Düngeverordnung - DüV) Anlage 7 (zu § 3 Absatz 2 und 6 und § 4 Absatz 3) Nährstoffgehalte pflanzlicher Erzeugnisse',
  },
  'crop.canola.dryMatterContent': {
    id: 'crop.canola.dryMatterContent',
    Produktionsrichtung: 'Trockenmassegehalt, Hauptprodukt',
    Emissionsquelle: '',
    Beschreibung: 'Trockenmassgehalt, Haptprodukt, Raps',
    Parameter: '',
    'Information zum Parameter:': '',
    Wert: 0.91,
    Einheit: 'kg TM · (kg FM)-1',
    Bezeichnung: 'xTM, HP,Rs',
    Kurzzitat: 'DüV (2020), Anlage 7',
    Langzitat:
      'Verordnung über die Anwendung von Düngemitteln, Bodenhilfsstoffen, Kultursubstraten und Pflanzenhilfsmitteln nach den Grundsätzen der guten fachlichen Praxis beim Düngen 2 (Düngeverordnung - DüV) Anlage 7 (zu § 3 Absatz 2 und 6 und § 4 Absatz 3) Nährstoffgehalte pflanzlicher Erzeugnisse',
  },
  'crop.sugarBeet.dryMatterContent': {
    id: 'crop.sugarBeet.dryMatterContent',
    Produktionsrichtung: 'Trockenmassegehalt, Hauptprodukt',
    Emissionsquelle: '',
    Beschreibung: 'Trockenmassgehalt, Haptprodukt, Zuckerrüben',
    Parameter: '',
    'Information zum Parameter:': '',
    Wert: 0.23,
    Einheit: 'kg TM · (kg FM)-1',
    Bezeichnung: 'xTM, HP, Ms',
    Kurzzitat: 'DüV (2020), Anlage 7',
    Langzitat:
      'Verordnung über die Anwendung von Düngemitteln, Bodenhilfsstoffen, Kultursubstraten und Pflanzenhilfsmitteln nach den Grundsätzen der guten fachlichen Praxis beim Düngen 2 (Düngeverordnung - DüV) Anlage 7 (zu § 3 Absatz 2 und 6 und § 4 Absatz 3) Nährstoffgehalte pflanzlicher Erzeugnisse',
  },
  'crop.winterBarleyFodder.dryMatterContent': {
    id: 'crop.winterBarleyFodder.dryMatterContent',
    Produktionsrichtung: 'Trockenmassegehalt, Hauptprodukt',
    Emissionsquelle: '',
    Beschreibung: 'Trockenmassgehalt, Haptprodukt, Wintergerste',
    Parameter: '',
    'Information zum Parameter:': '',
    Wert: 0.86,
    Einheit: 'kg TM · (kg FM)-1',
    Bezeichnung: 'xTM, HP, Grst',
    Kurzzitat: '',
    Langzitat:
      'Verordnung über die Anwendung von Düngemitteln, Bodenhilfsstoffen, Kultursubstraten und Pflanzenhilfsmitteln nach den Grundsätzen der guten fachlichen Praxis beim Düngen 2 (Düngeverordnung - DüV) Anlage 7 (zu § 3 Absatz 2 und 6 und § 4 Absatz 3) Nährstoffgehalte pflanzlicher Erzeugnisse',
  },
  'crop.springBarleyMalting.dryMatterContent': {
    id: 'crop.springBarleyMalting.dryMatterContent',
    Produktionsrichtung: 'Trockenmassegehalt, Hauptprodukt',
    Emissionsquelle: '',
    Beschreibung: 'Trockenmassgehalt, Haptprodukt, Wintergerste',
    Parameter: '',
    'Information zum Parameter:': '',
    Wert: 0.86,
    Einheit: 'kg TM · (kg FM)-1',
    Bezeichnung: 'xTM, HP, SGrst',
    Kurzzitat: '',
    Langzitat:
      'Verordnung über die Anwendung von Düngemitteln, Bodenhilfsstoffen, Kultursubstraten und Pflanzenhilfsmitteln nach den Grundsätzen der guten fachlichen Praxis beim Düngen 2 (Düngeverordnung - DüV) Anlage 7 (zu § 3 Absatz 2 und 6 und § 4 Absatz 3) Nährstoffgehalte pflanzlicher Erzeugnisse',
  },
  'crop.springOatsFodder.dryMatterContent': {
    id: 'crop.springOatsFodder.dryMatterContent',
    Produktionsrichtung: 'Trockenmassegehalt, Hauptprodukt',
    Emissionsquelle: '',
    Beschreibung: 'Trockenmassgehalt, Haptprodukt, Sommerhafer',
    Parameter: '',
    'Information zum Parameter:': '',
    Wert: 0.86,
    Einheit: 'kg TM · (kg FM)-1',
    Bezeichnung: 'xTM, HP, Hafer',
    Kurzzitat: '',
    Langzitat:
      'Verordnung über die Anwendung von Düngemitteln, Bodenhilfsstoffen, Kultursubstraten und Pflanzenhilfsmitteln nach den Grundsätzen der guten fachlichen Praxis beim Düngen 2 (Düngeverordnung - DüV) Anlage 7 (zu § 3 Absatz 2 und 6 und § 4 Absatz 3) Nährstoffgehalte pflanzlicher Erzeugnisse',
  },
  'crop.potatoTableLate.dryMatterContent': {
    id: 'crop.potatoTableLate.dryMatterContent',
    Produktionsrichtung: 'Trockenmassegehalt, Hauptprodukt',
    Emissionsquelle: '',
    Beschreibung: 'Trockenmassgehalt, Haptprodukt, Kartoffeln',
    Parameter: '',
    'Information zum Parameter:': '',
    Wert: 0.22,
    Einheit: 'kg TM · (kg FM)-1',
    Bezeichnung: 'xTM, HP, Kartoffeln',
    Kurzzitat: '',
    Langzitat:
      'Verordnung über die Anwendung von Düngemitteln, Bodenhilfsstoffen, Kultursubstraten und Pflanzenhilfsmitteln nach den Grundsätzen der guten fachlichen Praxis beim Düngen 2 (Düngeverordnung - DüV) Anlage 7 (zu § 3 Absatz 2 und 6 und § 4 Absatz 3) Nährstoffgehalte pflanzlicher Erzeugnisse',
  },
  'crop.winterRyeBaking.dryMatterContent': {
    id: 'crop.winterRyeBaking.dryMatterContent',
    Produktionsrichtung: 'Trockenmassegehalt, Hauptprodukt',
    Emissionsquelle: '',
    Beschreibung: 'Trockenmassgehalt, Haptprodukt, Winterrogen',
    Parameter: '',
    'Information zum Parameter:': '',
    Wert: 0.86,
    Einheit: 'kg TM · (kg FM)-1',
    Bezeichnung: 'xTM, HP, Winterrogen',
    Kurzzitat: '',
    Langzitat:
      'Verordnung über die Anwendung von Düngemitteln, Bodenhilfsstoffen, Kultursubstraten und Pflanzenhilfsmitteln nach den Grundsätzen der guten fachlichen Praxis beim Düngen 2 (Düngeverordnung - DüV) Anlage 7 (zu § 3 Absatz 2 und 6 und § 4 Absatz 3) Nährstoffgehalte pflanzlicher Erzeugnisse',
  },
  'crop.winterWheat.MPBR': {
    id: 'crop.winterWheat.MPBR',
    Produktionsrichtung: 'Nebenprodukt',
    Emissionsquelle: '',
    Beschreibung: 'Haupternteprodukt-Nebenernteprodukt-Verhältnis Winterweizen',
    Parameter: 'Haupternteprodukt-Nebenernteprodukt-Verhältnis Winterweizen',
    'Information zum Parameter:':
      'Haupternteprodukt-Nebenernteprodukt-Verhältnis; Ertragsindex',
    Wert: 0.8,
    Einheit: 'kg NP · (kg HP)-1',
    Bezeichnung: 'HNV, Wwzn',
    Kurzzitat: 'DüV (2020), Anlage 7',
    Langzitat:
      'Verordnung über die Anwendung von Düngemitteln, Bodenhilfsstoffen, Kultursubstraten und Pflanzenhilfsmitteln nach den Grundsätzen der guten fachlichen Praxis beim Düngen 2 (Düngeverordnung - DüV) Anlage 7 (zu § 3 Absatz 2 und 6 und § 4 Absatz 3) Nährstoffgehalte pflanzlicher Erzeugnisse',
  },
  'crop.silageMaize.MPBR': {
    id: 'crop.silageMaize.MPBR',
    Produktionsrichtung: 'Nebenprodukt',
    Emissionsquelle: '',
    Beschreibung: 'Haupternteprodukt-Nebenernteprodukt-Verhältnis Silomais',
    Parameter: 'Haupternteprodukt-Nebenernteprodukt-Verhältnis Silomais',
    'Information zum Parameter:':
      'Haupternteprodukt-Nebenernteprodukt-Verhältnis; Ertragsindex',
    Wert: 0,
    Einheit: 'kg NP · (kg HP)-1',
    Bezeichnung: 'HNV, Ms',
    Kurzzitat: 'DüV (2020), Anlage 7',
    Langzitat:
      'Verordnung über die Anwendung von Düngemitteln, Bodenhilfsstoffen, Kultursubstraten und Pflanzenhilfsmitteln nach den Grundsätzen der guten fachlichen Praxis beim Düngen 2 (Düngeverordnung - DüV) Anlage 7 (zu § 3 Absatz 2 und 6 und § 4 Absatz 3) Nährstoffgehalte pflanzlicher Erzeugnisse',
  },
  'crop.canola.MPBR': {
    id: 'crop.canola.MPBR',
    Produktionsrichtung: 'Nebenprodukt',
    Emissionsquelle: '',
    Beschreibung: 'Haupternteprodukt-Nebenernteprodukt-Verhältnis Winterraps',
    Parameter: 'Haupternteprodukt-Nebenernteprodukt-Verhältnis Winterraps',
    'Information zum Parameter:':
      'Haupternteprodukt-Nebenernteprodukt-Verhältnis; Ertragsindex',
    Wert: 1.7,
    Einheit: 'kg NP · (kg HP)-1',
    Bezeichnung: 'HNV, Rs',
    Kurzzitat: 'DüV (2020), Anlage 7',
    Langzitat:
      'Verordnung über die Anwendung von Düngemitteln, Bodenhilfsstoffen, Kultursubstraten und Pflanzenhilfsmitteln nach den Grundsätzen der guten fachlichen Praxis beim Düngen 2 (Düngeverordnung - DüV) Anlage 7 (zu § 3 Absatz 2 und 6 und § 4 Absatz 3) Nährstoffgehalte pflanzlicher Erzeugnisse',
  },
  'crop.sugarBeet.MPBR': {
    id: 'crop.sugarBeet.MPBR',
    Produktionsrichtung: 'Nebenprodukt',
    Emissionsquelle: '',
    Beschreibung: 'Haupternteprodukt-Nebenernteprodukt-Verhältnis Zuckerrüben',
    Parameter: 'Haupternteprodukt-Nebenernteprodukt-Verhältnis Zuckerrüben',
    'Information zum Parameter:':
      'Haupternteprodukt-Nebenernteprodukt-Verhältnis; Ertragsindex',
    Wert: 0.7,
    Einheit: 'kg NP · (kg HP)-1',
    Bezeichnung: 'HNV, Zr',
    Kurzzitat: 'DüV (2020), Anlage 7',
    Langzitat:
      'Verordnung über die Anwendung von Düngemitteln, Bodenhilfsstoffen, Kultursubstraten und Pflanzenhilfsmitteln nach den Grundsätzen der guten fachlichen Praxis beim Düngen 2 (Düngeverordnung - DüV) Anlage 7 (zu § 3 Absatz 2 und 6 und § 4 Absatz 3) Nährstoffgehalte pflanzlicher Erzeugnisse',
  },
  'crop.winterBarleyFodder.MPBR': {
    id: 'crop.winterBarleyFodder.MPBR',
    Produktionsrichtung: 'Nebenprodukt',
    Emissionsquelle: '',
    Beschreibung: 'Haupternteprodukt-Nebenernteprodukt-Verhältnis Wintergerste',
    Parameter: 'Haupternteprodukt-Nebenernteprodukt-Verhältnis Wintergerste',
    'Information zum Parameter:':
      'Haupternteprodukt-Nebenernteprodukt-Verhältnis Wintergerste',
    Wert: 0.7,
    Einheit: 'kg NP · (kg HP)-1',
    Bezeichnung: 'HNV, Grst',
    Kurzzitat: '',
    Langzitat:
      'Verordnung über die Anwendung von Düngemitteln, Bodenhilfsstoffen, Kultursubstraten und Pflanzenhilfsmitteln nach den Grundsätzen der guten fachlichen Praxis beim Düngen 2 (Düngeverordnung - DüV) Anlage 7 (zu § 3 Absatz 2 und 6 und § 4 Absatz 3) Nährstoffgehalte pflanzlicher Erzeugnisse',
  },
  'crop.springBarleyMalting.MPBR': {
    id: 'crop.springBarleyMalting.MPBR',
    Produktionsrichtung: 'Nebenprodukt',
    Emissionsquelle: '',
    Beschreibung: 'Haupternteprodukt-Nebenernteprodukt-Verhältnis Sommergerste',
    Parameter: 'Haupternteprodukt-Nebenernteprodukt-Verhältnis Sommergerste',
    'Information zum Parameter:':
      'Haupternteprodukt-Nebenernteprodukt-Verhältnis Sommergerste',
    Wert: 0.7,
    Einheit: 'kg NP · (kg HP)-1',
    Bezeichnung: 'HNV, SGrst',
    Kurzzitat: '',
    Langzitat:
      'Verordnung über die Anwendung von Düngemitteln, Bodenhilfsstoffen, Kultursubstraten und Pflanzenhilfsmitteln nach den Grundsätzen der guten fachlichen Praxis beim Düngen 2 (Düngeverordnung - DüV) Anlage 7 (zu § 3 Absatz 2 und 6 und § 4 Absatz 3) Nährstoffgehalte pflanzlicher Erzeugnisse',
  },
  'crop.springOatsFodder.MPBR': {
    id: 'crop.springOatsFodder.MPBR',
    Produktionsrichtung: 'Nebenprodukt',
    Emissionsquelle: '',
    Beschreibung: 'Haupternteprodukt-Nebenernteprodukt-Verhältnis Hafer',
    Parameter: 'Haupternteprodukt-Nebenernteprodukt-Verhältnis Hafer',
    'Information zum Parameter:':
      'Haupternteprodukt-Nebenernteprodukt-Verhältnis Hafer',
    Wert: 1.1,
    Einheit: 'kg NP · (kg HP)-1',
    Bezeichnung: 'HNV, Hafer',
    Kurzzitat: '',
    Langzitat:
      'Verordnung über die Anwendung von Düngemitteln, Bodenhilfsstoffen, Kultursubstraten und Pflanzenhilfsmitteln nach den Grundsätzen der guten fachlichen Praxis beim Düngen 2 (Düngeverordnung - DüV) Anlage 7 (zu § 3 Absatz 2 und 6 und § 4 Absatz 3) Nährstoffgehalte pflanzlicher Erzeugnisse',
  },
  'crop.potatoTableLate.MPBR': {
    id: 'crop.potatoTableLate.MPBR',
    Produktionsrichtung: 'Nebenprodukt',
    Emissionsquelle: '',
    Beschreibung: 'Haupternteprodukt-Nebenernteprodukt-Verhältnis Kartoffel',
    Parameter: 'Haupternteprodukt-Nebenernteprodukt-Verhältnis Kartoffel',
    'Information zum Parameter:':
      'Haupternteprodukt-Nebenernteprodukt-Verhältnis Kartoffel',
    Wert: 0.2,
    Einheit: 'kg NP · (kg HP)-1',
    Bezeichnung: 'HNV, Kartoffel',
    Kurzzitat: '',
    Langzitat:
      'Verordnung über die Anwendung von Düngemitteln, Bodenhilfsstoffen, Kultursubstraten und Pflanzenhilfsmitteln nach den Grundsätzen der guten fachlichen Praxis beim Düngen 2 (Düngeverordnung - DüV) Anlage 7 (zu § 3 Absatz 2 und 6 und § 4 Absatz 3) Nährstoffgehalte pflanzlicher Erzeugnisse',
  },
  'crop.winterRyeBaking.MPBR': {
    id: 'crop.winterRyeBaking.MPBR',
    Produktionsrichtung: 'Nebenprodukt',
    Emissionsquelle: '',
    Beschreibung: 'Haupternteprodukt-Nebenernteprodukt-Verhältnis Winterrogen',
    Parameter: 'Haupternteprodukt-Nebenernteprodukt-Verhältnis Winterrogen',
    'Information zum Parameter:':
      'Haupternteprodukt-Nebenernteprodukt-Verhältnis Winterrogen',
    Wert: 0.9,
    Einheit: 'kg NP · (kg HP)-1',
    Bezeichnung: 'HNV, Winterrogen',
    Kurzzitat: '',
    Langzitat:
      'Verordnung über die Anwendung von Düngemitteln, Bodenhilfsstoffen, Kultursubstraten und Pflanzenhilfsmitteln nach den Grundsätzen der guten fachlichen Praxis beim Düngen 2 (Düngeverordnung - DüV) Anlage 7 (zu § 3 Absatz 2 und 6 und § 4 Absatz 3) Nährstoffgehalte pflanzlicher Erzeugnisse',
  },
  'crop.winterWheat.dryMatterContentByproduct': {
    id: 'crop.winterWheat.dryMatterContentByproduct',
    Produktionsrichtung: 'Nebenprodukt',
    Emissionsquelle: '',
    Beschreibung: 'Trockenmassegehalt, Nebenprodukt Winterweizen',
    Parameter: 'Trockenmassegehalt, Nebenprodukt Winterweizen',
    'Information zum Parameter:': 'Trochenmassegehalt, Nebenprodukt',
    Wert: 0.86,
    Einheit: 'kg TM · (kg FM)-1',
    Bezeichnung: 'xTM, NP, Wwzn',
    Kurzzitat: 'DüV (2020), Anlage 7',
    Langzitat:
      'Verordnung über die Anwendung von Düngemitteln, Bodenhilfsstoffen, Kultursubstraten und Pflanzenhilfsmitteln nach den Grundsätzen der guten fachlichen Praxis beim Düngen 2 (Düngeverordnung - DüV) Anlage 7 (zu § 3 Absatz 2 und 6 und § 4 Absatz 3) Nährstoffgehalte pflanzlicher Erzeugnisse',
  },
  'crop.silageMaize.dryMatterContentByproduct': {
    id: 'crop.silageMaize.dryMatterContentByproduct',
    Produktionsrichtung: 'Nebenprodukt',
    Emissionsquelle: '',
    Beschreibung: 'Trockenmassegehalt, Nebenprodukt Silomais',
    Parameter: 'Trockenmassegehalt, Nebenprodukt Silomais',
    'Information zum Parameter:': 'Trochenmassegehalt, Nebenprodukt',
    Wert: 0,
    Einheit: 'kg TM · (kg FM)-1',
    Bezeichnung: 'xTM, NP, Ms',
    Kurzzitat: '',
    Langzitat: 'Silomais erzeugt keine Nebenprodukte',
  },
  'crop.canola.dryMatterContentByproduct': {
    id: 'crop.canola.dryMatterContentByproduct',
    Produktionsrichtung: 'Nebenprodukt',
    Emissionsquelle: '',
    Beschreibung: 'Trockenmassegehalt, Nebenprodukt Winterraps',
    Parameter: 'Trockenmassegehalt, Nebenprodukt Winterraps',
    'Information zum Parameter:': 'Trochenmassegehalt, Nebenprodukt',
    Wert: 0.86,
    Einheit: 'kg TM · (kg FM)-1',
    Bezeichnung: 'xTM, NP, Rs',
    Kurzzitat: 'DüV (2020), Anlage 7',
    Langzitat:
      'Verordnung über die Anwendung von Düngemitteln, Bodenhilfsstoffen, Kultursubstraten und Pflanzenhilfsmitteln nach den Grundsätzen der guten fachlichen Praxis beim Düngen 2 (Düngeverordnung - DüV) Anlage 7 (zu § 3 Absatz 2 und 6 und § 4 Absatz 3) Nährstoffgehalte pflanzlicher Erzeugnisse',
  },
  'crop.sugarBeet.dryMatterContentByproduct': {
    id: 'crop.sugarBeet.dryMatterContentByproduct',
    Produktionsrichtung: 'Nebenprodukt',
    Emissionsquelle: '',
    Beschreibung: 'Trockenmassegehalt, Nebenprodukt Zuckerrüben',
    Parameter: 'Trockenmassegehalt, Nebenprodukt Zuckerrüben',
    'Information zum Parameter:': 'Trochenmassegehalt, Nebenprodukt',
    Wert: 0.18,
    Einheit: 'kg TM · (kg FM)-1',
    Bezeichnung: 'xTM,NP, Zr',
    Kurzzitat: 'DüV (2020), Anlage 7',
    Langzitat:
      'Verordnung über die Anwendung von Düngemitteln, Bodenhilfsstoffen, Kultursubstraten und Pflanzenhilfsmitteln nach den Grundsätzen der guten fachlichen Praxis beim Düngen 2 (Düngeverordnung - DüV) Anlage 7 (zu § 3 Absatz 2 und 6 und § 4 Absatz 3) Nährstoffgehalte pflanzlicher Erzeugnisse',
  },
  'crop.winterBarleyFodder.dryMatterContentByproduct': {
    id: 'crop.winterBarleyFodder.dryMatterContentByproduct',
    Produktionsrichtung: 'Nebenprodukt',
    Emissionsquelle: '',
    Beschreibung: 'Trockenmassegehalt, Nebenprodukt Wintergerste',
    Parameter: 'Trockenmassegehalt, Nebenprodukt Wintergerste',
    'Information zum Parameter:': 'Trochenmassegehalt, Nebenprodukt',
    Wert: 0.86,
    Einheit: 'kg TM · (kg FM)-1',
    Bezeichnung: 'xTM,NP, Grst',
    Kurzzitat: 'DüV (2020), Anlage 7',
    Langzitat:
      'Verordnung über die Anwendung von Düngemitteln, Bodenhilfsstoffen, Kultursubstraten und Pflanzenhilfsmitteln nach den Grundsätzen der guten fachlichen Praxis beim Düngen 2 (Düngeverordnung - DüV) Anlage 7 (zu § 3 Absatz 2 und 6 und § 4 Absatz 3) Nährstoffgehalte pflanzlicher Erzeugnisse',
  },
  'crop.springBarleyMalting.dryMatterContentByproduct': {
    id: 'crop.springBarleyMalting.dryMatterContentByproduct',
    Produktionsrichtung: 'Nebenprodukt',
    Emissionsquelle: '',
    Beschreibung: 'Trockenmassegehalt, Nebenprodukt Wintergerste',
    Parameter: 'Trockenmassegehalt, Nebenprodukt Sommergerste',
    'Information zum Parameter:': 'Trochenmassegehalt, Nebenprodukt',
    Wert: 0.86,
    Einheit: 'kg TM · (kg FM)-1',
    Bezeichnung: 'xTM,NP, Grst',
    Kurzzitat: 'DüV (2020), Anlage 7',
    Langzitat:
      'Verordnung über die Anwendung von Düngemitteln, Bodenhilfsstoffen, Kultursubstraten und Pflanzenhilfsmitteln nach den Grundsätzen der guten fachlichen Praxis beim Düngen 2 (Düngeverordnung - DüV) Anlage 7 (zu § 3 Absatz 2 und 6 und § 4 Absatz 3) Nährstoffgehalte pflanzlicher Erzeugnisse',
  },
  'crop.springOatsFodder.dryMatterContentByproduct': {
    id: 'crop.springOatsFodder.dryMatterContentByproduct',
    Produktionsrichtung: 'Nebenprodukt',
    Emissionsquelle: '',
    Beschreibung: 'Trockenmassegehalt, Nebenprodukt Sommerhafer',
    Parameter: 'Trockenmassegehalt, Nebenprodukt Sommerhafer',
    'Information zum Parameter:': 'Trochenmassegehalt, Nebenprodukt',
    Wert: 0.86,
    Einheit: 'kg TM · (kg FM)-1',
    Bezeichnung: 'xTM,NP, Hafer',
    Kurzzitat: 'DüV (2020), Anlage 7',
    Langzitat:
      'Verordnung über die Anwendung von Düngemitteln, Bodenhilfsstoffen, Kultursubstraten und Pflanzenhilfsmitteln nach den Grundsätzen der guten fachlichen Praxis beim Düngen 2 (Düngeverordnung - DüV) Anlage 7 (zu § 3 Absatz 2 und 6 und § 4 Absatz 3) Nährstoffgehalte pflanzlicher Erzeugnisse',
  },
  'crop.potatoTableLate.dryMatterContentByproduct': {
    id: 'crop.potatoTableLate.dryMatterContentByproduct',
    Produktionsrichtung: 'Nebenprodukt',
    Emissionsquelle: '',
    Beschreibung: 'Trockenmassegehalt, Nebenprodukt Kartoffel',
    Parameter: 'Trockenmassegehalt, Nebenprodukt Kartoffel',
    'Information zum Parameter:': 'Trochenmassegehalt, Nebenprodukt',
    Wert: 0.15,
    Einheit: 'kg TM · (kg FM)-1',
    Bezeichnung: 'xTM,NP, Kartoffel',
    Kurzzitat: 'DüV (2020), Anlage 7',
    Langzitat:
      'Verordnung über die Anwendung von Düngemitteln, Bodenhilfsstoffen, Kultursubstraten und Pflanzenhilfsmitteln nach den Grundsätzen der guten fachlichen Praxis beim Düngen 2 (Düngeverordnung - DüV) Anlage 7 (zu § 3 Absatz 2 und 6 und § 4 Absatz 3) Nährstoffgehalte pflanzlicher Erzeugnisse',
  },
  'crop.winterRyeBaking.dryMatterContentByproduct': {
    id: 'crop.winterRyeBaking.dryMatterContentByproduct',
    Produktionsrichtung: 'Nebenprodukt',
    Emissionsquelle: '',
    Beschreibung: 'Trockenmassegehalt, Nebenprodukt Winterroggen',
    Parameter: 'Trockenmassegehalt, Nebenprodukt Winterroggen',
    'Information zum Parameter:': 'Trochenmassegehalt, Nebenprodukt',
    Wert: 0.86,
    Einheit: 'kg TM · (kg FM)-1',
    Bezeichnung: 'xTM,NP, Winterroggen',
    Kurzzitat: 'DüV (2020), Anlage 7',
    Langzitat:
      'Verordnung über die Anwendung von Düngemitteln, Bodenhilfsstoffen, Kultursubstraten und Pflanzenhilfsmitteln nach den Grundsätzen der guten fachlichen Praxis beim Düngen 2 (Düngeverordnung - DüV) Anlage 7 (zu § 3 Absatz 2 und 6 und § 4 Absatz 3) Nährstoffgehalte pflanzlicher Erzeugnisse',
  },
  'crop.winterWheat.p2o5ByproductFm': {
    id: 'crop.winterWheat.p2o5ByproductFm',
    Produktionsrichtung: 'Nebenprodukt',
    Emissionsquelle: '',
    Beschreibung: 'P2O5 Gehalt, Nebenprodukt, Winterweizen',
    Parameter: 'P2O5 Gehalt, Nebenprodukt, Winterweizen',
    'Information zum Parameter:': 'P2O5 Gehalt, Nebenprodukt, Winterweizen',
    Wert: 0.003,
    Einheit: 'kg P2O5 · (kg FM)-1',
    Bezeichnung: 'xP2O5, Sek, Wwzn',
    Kurzzitat: 'DüV (2020), Anlage 7',
    Langzitat:
      'Verordnung über die Anwendung von Düngemitteln, Bodenhilfsstoffen, Kultursubstraten und Pflanzenhilfsmitteln nach den Grundsätzen der guten fachlichen Praxis beim Düngen 2 (Düngeverordnung - DüV) Anlage 7 (zu § 3 Absatz 2 und 6 und § 4 Absatz 3) Nährstoffgehalte pflanzlicher Erzeugnisse',
  },
  'crop.winterWheat.k2oByproductFm': {
    id: 'crop.winterWheat.k2oByproductFm',
    Produktionsrichtung: 'Nebenprodukt',
    Emissionsquelle: '',
    Beschreibung: 'K2O Gehalt, Nebenprodukt, Winterweizen',
    Parameter: 'K2O Gehalt, Nebenprodukt, Winterweizen',
    'Information zum Parameter:': 'K2O Gehalt, Nebenprodukt, Winterweizen',
    Wert: 0.014,
    Einheit: 'kg K2O · (kg FM)-1',
    Bezeichnung: 'xK2O, Sek, Wwzn',
    Kurzzitat: 'LFL 2021',
    Langzitat:
      'https://www.lfl.bayern.de/mam/cms07/iab/dateien/basisdaten22_tabelle_1a_20211210.pdf',
  },
  'crop.canola.p2o5ByproductFm': {
    id: 'crop.canola.p2o5ByproductFm',
    Produktionsrichtung: 'Nebenprodukt',
    Emissionsquelle: '',
    Beschreibung: 'P2O5 Gehalt, Nebenprodukt, Winterraps',
    Parameter: 'P2O5 Gehalt, Nebenprodukt, Winterraps',
    'Information zum Parameter:': 'P2O5 Gehalt, Nebenprodukt, Winterraps',
    Wert: 0.004,
    Einheit: 'kg P2O5 · (kg FM)-1',
    Bezeichnung: 'xP2O5, Sek, Rs',
    Kurzzitat: 'DüV (2020), Anlage 7',
    Langzitat:
      'Verordnung über die Anwendung von Düngemitteln, Bodenhilfsstoffen, Kultursubstraten und Pflanzenhilfsmitteln nach den Grundsätzen der guten fachlichen Praxis beim Düngen 2 (Düngeverordnung - DüV) Anlage 7 (zu § 3 Absatz 2 und 6 und § 4 Absatz 3) Nährstoffgehalte pflanzlicher Erzeugnisse',
  },
  'crop.canola.k2oByproductFm': {
    id: 'crop.canola.k2oByproductFm',
    Produktionsrichtung: 'Nebenprodukt',
    Emissionsquelle: '',
    Beschreibung: 'K2O Gehalt, Nebenprodukt, Winterraps',
    Parameter: 'K2O Gehalt, Nebenprodukt, Winterraps',
    'Information zum Parameter:': 'K2O Gehalt, Nebenprodukt, Winterraps',
    Wert: 0.0235,
    Einheit: 'kg K2O · (kg FM)-1',
    Bezeichnung: 'xK2O, Sek, Rs',
    Kurzzitat: 'LFL 2021',
    Langzitat:
      'https://www.lfl.bayern.de/mam/cms07/iab/dateien/basisdaten22_tabelle_1a_20211210.pdf',
  },
  'crop.sugarBeet.p2o5ByproductFm': {
    id: 'crop.sugarBeet.p2o5ByproductFm',
    Produktionsrichtung: 'Nebenprodukt',
    Emissionsquelle: '',
    Beschreibung: 'P2O5 Gehalt, Nebenprodukt, Zuckerrüben',
    Parameter: 'P2O5 Gehalt, Nebenprodukt, Zuckerrüben',
    'Information zum Parameter:': 'P2O5 Gehalt, Nebenprodukt, Zuckerrüben',
    Wert: 0.0011,
    Einheit: 'kg P2O5 · (kg FM)-1',
    Bezeichnung: 'xP2O5, Sek, Zr',
    Kurzzitat: 'DüV (2020), Anlage 7',
    Langzitat:
      'Verordnung über die Anwendung von Düngemitteln, Bodenhilfsstoffen, Kultursubstraten und Pflanzenhilfsmitteln nach den Grundsätzen der guten fachlichen Praxis beim Düngen 2 (Düngeverordnung - DüV) Anlage 7 (zu § 3 Absatz 2 und 6 und § 4 Absatz 3) Nährstoffgehalte pflanzlicher Erzeugnisse',
  },
  'crop.sugarBeet.k2oByproductFm': {
    id: 'crop.sugarBeet.k2oByproductFm',
    Produktionsrichtung: 'Nebenprodukt',
    Emissionsquelle: '',
    Beschreibung: 'K2O Gehalt, Nebenprodukt, Zuckerrüben',
    Parameter: 'K2O Gehalt, Nebenprodukt, Zuckerrüben',
    'Information zum Parameter:': 'K2O Gehalt, Nebenprodukt, Zuckerrüben',
    Wert: 0.0071,
    Einheit: 'kg K2O · (kg FM)-1',
    Bezeichnung: 'xK2O, Sek, Zr',
    Kurzzitat: '',
    Langzitat:
      'https://www.lfl.bayern.de/mam/cms07/iab/dateien/basisdaten22_tabelle_1a_20211210.pdf',
  },
  'crop.silageMaize.p2o5ByproductFm': {
    id: 'crop.silageMaize.p2o5ByproductFm',
    Produktionsrichtung: 'Nebenprodukt',
    Emissionsquelle: '',
    Beschreibung: 'P2O5 Gehalt, Nebenprodukt, Silomais',
    Parameter: 'P2O5 Gehalt, Nebenprodukt, Silomais',
    'Information zum Parameter:': 'P2O5 Gehalt, Nebenprodukt, Silomais',
    Wert: 0,
    Einheit: 'kg P2O5 · (kg FM)-1',
    Bezeichnung: 'xP2O5, Sek, Ms',
    Kurzzitat: '',
    Langzitat: 'Silomais erzeugt keine Nebenprodukte',
  },
  'crop.silageMaize.k2oByproductFm': {
    id: 'crop.silageMaize.k2oByproductFm',
    Produktionsrichtung: 'Nebenprodukt',
    Emissionsquelle: '',
    Beschreibung: 'K2O Gehalt, Nebenprodukt, Silomais',
    Parameter: 'K2O Gehalt, Nebenprodukt, Silomais',
    'Information zum Parameter:': 'K2O Gehalt, Nebenprodukt, Silomais',
    Wert: 0,
    Einheit: 'kg K2O · (kg FM)-1',
    Bezeichnung: 'xK2O, Sek, Ms',
    Kurzzitat: '',
    Langzitat: 'Silomais erzeugt keine Nebenprodukte',
  },
  'crop.winterWheat.humusMain': {
    id: 'crop.winterWheat.humusMain',
    Produktionsrichtung: 'Humus-C',
    Emissionsquelle: '',
    Beschreibung: 'Humusauswirkung durch den Anbau von Winterweizen',
    Parameter: '',
    'Information zum Parameter:': '',
    Wert: -400,
    Einheit: 'kg Humus-C/ha',
    Bezeichnung: 'Humus-C, MP, Wwzn',
    Kurzzitat: '',
    Langzitat: 'VDLUFA-Methodenbuch',
  },
  'crop.silageMaize.humusMain': {
    id: 'crop.silageMaize.humusMain',
    Produktionsrichtung: 'Humus-C',
    Emissionsquelle: '',
    Beschreibung: 'Humusauswirkung durch den Anbau von Silomais',
    Parameter: '',
    'Information zum Parameter:': '',
    Wert: -800,
    Einheit: 'kg Humus-C/ha',
    Bezeichnung: 'Humus-C, MP, Ms',
    Kurzzitat: '',
    Langzitat: 'VDLUFA-Methodenbuch',
  },
  'crop.canola.humusMain': {
    id: 'crop.canola.humusMain',
    Produktionsrichtung: 'Humus-C',
    Emissionsquelle: '',
    Beschreibung: 'Humusauswirkung durch den Anbau von Raps',
    Parameter: '',
    'Information zum Parameter:': '',
    Wert: -400,
    Einheit: 'kg Humus-C/ha',
    Bezeichnung: 'Humus-C, MP, Rs',
    Kurzzitat: '',
    Langzitat: 'VDLUFA-Methodenbuch',
  },
  'crop.sugarBeet.humusMain': {
    id: 'crop.sugarBeet.humusMain',
    Produktionsrichtung: 'Humus-C',
    Emissionsquelle: '',
    Beschreibung: 'Humusauswirkung durch den Anbau von Zuckerrüben',
    Parameter: '',
    'Information zum Parameter:': '',
    Wert: -1300,
    Einheit: 'kg Humus-C/ha',
    Bezeichnung: 'Humus-C, MP, Zr',
    Kurzzitat: '',
    Langzitat: 'VDLUFA-Methodenbuch',
  },
  'crop.winterBarleyFodder.humusMain': {
    id: 'crop.winterBarleyFodder.humusMain',
    Produktionsrichtung: 'Humus-C',
    Emissionsquelle: '',
    Beschreibung: 'Humusauswirkung durch den Anbau von Wintergerste',
    Parameter: '',
    'Information zum Parameter:': '',
    Wert: -400,
    Einheit: 'kg Humus-C/ha',
    Bezeichnung: 'Humus-C, MP, Grst',
    Kurzzitat: '',
    Langzitat: 'VDLUFA-Methodenbuch',
  },
  'crop.springBarleyMalting.humusMain': {
    id: 'crop.springBarleyMalting.humusMain',
    Produktionsrichtung: 'Humus-C',
    Emissionsquelle: '',
    Beschreibung: 'Humusauswirkung durch den Anbau von Wintergerste',
    Parameter: '',
    'Information zum Parameter:': '',
    Wert: -400,
    Einheit: 'kg Humus-C/ha',
    Bezeichnung: 'Humus-C, MP, Grst',
    Kurzzitat: '',
    Langzitat: 'VDLUFA-Methodenbuch',
  },
  'crop.springOatsFodder.humusMain': {
    id: 'crop.springOatsFodder.humusMain',
    Produktionsrichtung: 'Humus-C',
    Emissionsquelle: '',
    Beschreibung: 'Humusauswirkung durch den Anbau von Hafer',
    Parameter: '',
    'Information zum Parameter:': '',
    Wert: -400,
    Einheit: 'kg Humus-C/ha',
    Bezeichnung: 'Humus-C, MP, Hafer',
    Kurzzitat: '',
    Langzitat: 'VDLUFA-Methodenbuch',
  },
  'crop.potatoTableLate.humusMain': {
    id: 'crop.potatoTableLate.humusMain',
    Produktionsrichtung: 'Humus-C',
    Emissionsquelle: '',
    Beschreibung: 'Humusauswirkung durch den Anbau von Kartoffel',
    Parameter: '',
    'Information zum Parameter:': '',
    Wert: -1000,
    Einheit: 'kg Humus-C/ha',
    Bezeichnung: 'Humus-C, MP, Kartoffel',
    Kurzzitat: '',
    Langzitat: 'VDLUFA-Methodenbuch',
  },
  'crop.winterRyeBaking.humusMain': {
    id: 'crop.winterRyeBaking.humusMain',
    Produktionsrichtung: 'Humus-C',
    Emissionsquelle: '',
    Beschreibung: 'Humusauswirkung durch den Anbau von Winterroggen',
    Parameter: '',
    'Information zum Parameter:': '',
    Wert: -400,
    Einheit: 'kg Humus-C/ha',
    Bezeichnung: 'Humus-C, MP, Winterroggen',
    Kurzzitat: '',
    Langzitat: 'VDLUFA-Methodenbuch',
  },
  'crop.winterWheat.piecesToKg': {
    id: 'crop.winterWheat.piecesToKg',
    Produktionsrichtung: 'Saatgut',
    Emissionsquelle: '',
    Beschreibung: 'Umrechnung von der Einheit Sack Saatgut in kg',
    Parameter: 'U zu kg',
    'Information zum Parameter:': 'U zu kg',
    Wert: 1,
    Einheit: 'kg · ( U )-1',
    Bezeichnung: 'Ukg, Wwzn',
    Kurzzitat: '',
    Langzitat: 'Direkte Beobachtung',
  },
  'crop.silageMaize.piecesToKg': {
    id: 'crop.silageMaize.piecesToKg',
    Produktionsrichtung: 'Saatgut',
    Emissionsquelle: '',
    Beschreibung: 'Umrechnung von der Einheit Sack Saatgut in kg',
    Parameter: 'U zu kg',
    'Information zum Parameter:': 'U zu kg',
    Wert: 15,
    Einheit: 'kg · ( U )-1',
    Bezeichnung: 'Ukg, Ms',
    Kurzzitat: '',
    Langzitat: 'Direkte Beobachtung',
  },
  'crop.canola.piecesToKg': {
    id: 'crop.canola.piecesToKg',
    Produktionsrichtung: 'Saatgut',
    Emissionsquelle: '',
    Beschreibung: 'Umrechnung von der Einheit Sack Saatgut in kg',
    Parameter: 'U zu kg',
    'Information zum Parameter:': 'U zu kg',
    Wert: 7.2,
    Einheit: 'kg · ( U )-1',
    Bezeichnung: 'Ukg, Rs',
    Kurzzitat: '',
    Langzitat: 'Direkte Beobachtung',
  },
  'crop.sugarBeet.piecesToKg': {
    id: 'crop.sugarBeet.piecesToKg',
    Produktionsrichtung: 'Saatgut',
    Emissionsquelle: '',
    Beschreibung: 'Umrechnung von der Einheit Sack Saatgut in kg',
    Parameter: 'U zu kg',
    'Information zum Parameter:': 'U zu kg',
    Wert: 1,
    Einheit: 'kg · ( U )-1',
    Bezeichnung: 'Ukg, Zr',
    Kurzzitat: '',
    Langzitat: 'Direkte Beobachtung',
  },
  'crop.winterBarleyFodder.p2o5ByproductFm': {
    id: 'crop.winterBarleyFodder.p2o5ByproductFm',
    Produktionsrichtung: 'Nebenprodukt',
    Emissionsquelle: '',
    Beschreibung: 'P2O5 Gehalt, Nebenprodukt, Wintergerste',
    Parameter: 'P2O5 Gehalt, Nebenprodukt, Wintergerste',
    'Information zum Parameter:': 'P2O5 Gehalt, Nebenprodukt, Zuckerrüben',
    Wert: 0.003,
    Einheit: 'kg P2O5 · (kg FM)-1',
    Bezeichnung: 'xP2O5, Sek, Grst',
    Kurzzitat: 'DüV (2020), Anlage 7',
    Langzitat:
      'Verordnung über die Anwendung von Düngemitteln, Bodenhilfsstoffen, Kultursubstraten und Pflanzenhilfsmitteln nach den Grundsätzen der guten fachlichen Praxis beim Düngen 2 (Düngeverordnung - DüV) Anlage 7 (zu § 3 Absatz 2 und 6 und § 4 Absatz 3) Nährstoffgehalte pflanzlicher Erzeugnisse',
  },
  'crop.winterBarleyFodder.k2oByproductFm': {
    id: 'crop.winterBarleyFodder.k2oByproductFm',
    Produktionsrichtung: 'Nebenprodukt',
    Emissionsquelle: '',
    Beschreibung: 'K2O Gehalt, Nebenprodukt, Wintergerste',
    Parameter: 'K2O Gehalt, Nebenprodukt, Wintergerste',
    'Information zum Parameter:': 'K2O Gehalt, Nebenprodukt, Wintergerste',
    Wert: 0.017,
    Einheit: 'kg K2O · (kg FM)-1',
    Bezeichnung: 'xK2O, Sek, Grst',
    Kurzzitat: '',
    Langzitat:
      'https://www.lfl.bayern.de/mam/cms07/iab/dateien/basisdaten22_tabelle_1a_20211210.pdf',
  },
  'crop.winterBarleyFodder.piecesToKg': {
    id: 'crop.winterBarleyFodder.piecesToKg',
    Produktionsrichtung: 'Saatgut',
    Emissionsquelle: '',
    Beschreibung: 'Umrechnung von der Einheit Sack Saatgut in kg',
    Parameter: 'U zu kg',
    'Information zum Parameter:': 'U zu kg',
    Wert: 1,
    Einheit: 'kg · ( U )-1',
    Bezeichnung: 'Ukg, Grst',
    Kurzzitat: '',
    Langzitat: 'Direkte Beobachtung',
  },
  'crop.springBarleyMalting.p2o5ByproductFm': {
    id: 'crop.springBarleyMalting.p2o5ByproductFm',
    Produktionsrichtung: 'Nebenprodukt',
    Emissionsquelle: '',
    Beschreibung: 'P2O5 Gehalt, Nebenprodukt, Sommergerste',
    Parameter: 'P2O5 Gehalt, Nebenprodukt, Wintergerste',
    'Information zum Parameter:': 'P2O5 Gehalt, Nebenprodukt, Zuckerrüben',
    Wert: 0.003,
    Einheit: 'kg P2O5 · (kg FM)-1',
    Bezeichnung: 'xP2O5, Sek, SGrst',
    Kurzzitat: 'DüV (2020), Anlage 7',
    Langzitat:
      'Verordnung über die Anwendung von Düngemitteln, Bodenhilfsstoffen, Kultursubstraten und Pflanzenhilfsmitteln nach den Grundsätzen der guten fachlichen Praxis beim Düngen 2 (Düngeverordnung - DüV) Anlage 7 (zu § 3 Absatz 2 und 6 und § 4 Absatz 3) Nährstoffgehalte pflanzlicher Erzeugnisse',
  },
  'crop.springBarleyMalting.k2oByproductFm': {
    id: 'crop.springBarleyMalting.k2oByproductFm',
    Produktionsrichtung: 'Nebenprodukt',
    Emissionsquelle: '',
    Beschreibung: 'K2O Gehalt, Nebenprodukt, Sommergerste',
    Parameter: 'K2O Gehalt, Nebenprodukt, Wintergerste',
    'Information zum Parameter:': 'K2O Gehalt, Nebenprodukt, Wintergerste',
    Wert: 0.017,
    Einheit: 'kg K2O · (kg FM)-1',
    Bezeichnung: 'xK2O, Sek, SGrst',
    Kurzzitat: '',
    Langzitat:
      'https://www.lfl.bayern.de/mam/cms07/iab/dateien/basisdaten22_tabelle_1a_20211210.pdf',
  },
  'crop.springBarleyMalting.piecesToKg': {
    id: 'crop.springBarleyMalting.piecesToKg',
    Produktionsrichtung: 'Saatgut',
    Emissionsquelle: '',
    Beschreibung: 'Umrechnung von der Einheit Sack Saatgut in kg',
    Parameter: 'U zu kg',
    'Information zum Parameter:': 'U zu kg',
    Wert: 1,
    Einheit: 'kg · ( U )-1',
    Bezeichnung: 'Ukg, SGrst',
    Kurzzitat: '',
    Langzitat: 'Direkte Beobachtung',
  },
  'crop.springBarleyMalting.supplySeed': {
    id: 'crop.springBarleyMalting.supplySeed',
    Produktionsrichtung: 'Saatgut',
    Emissionsquelle: '',
    Beschreibung: 'Gerstensaatgut mit 84 % TM konventionell herstellen',
    Parameter: 'Treibhausgas-Emissionsfaktor',
    'Information zum Parameter:':
      'aus Ecoinvent v3.1, Aktivitätsdatensatz "barley seed production, for sowing,  GLO", Allokationsmethode "ecoinvent default"',
    Wert: 0.684,
    Einheit: 'kg CO2e · (kg FM)-1',
    Bezeichnung: 'EFCO2e, Stgt, Grst',
    Kurzzitat: 'Weidema et al. (2013)',
    Langzitat:
      'Eigentümer dieses Parameters ist Ecoinvent Weidema, B. P. et al. (2013): The ecoinvent database: Overview and methodology, Data quality guideline for the ecoinvent database version 3, www.ecoinvent.org',
  },
  'crop.springBarleyMalting.rootProportion': {
    id: 'crop.springBarleyMalting.rootProportion',
    Produktionsrichtung: 'Ernte- und Wurzelrückstände',
    Emissionsquelle: '',
    Beschreibung: 'Wurzelrückstand zu Haupt- und Nebenernteprodukte, Gerste',
    Parameter: 'Proportionalitätsfaktor',
    'Information zum Parameter:': 'siehe auch BEK-Handbuch, S. 34',
    Wert: 0.22,
    Einheit: 'kg TM · (kg TMHep + kg TMNep)-1',
    Bezeichnung: 'αWR, SGrst',
    Kurzzitat: 'IPCC (2006), Table 11.2, S. 11.18',
    Langzitat:
      'Da keine exakte Quelle gefunden wurde, wird der Wert von Barley verwendet: IPCC (2006): IPCC Guidelines for National Greenhouse Gas Inventories. Volume 4, Agriculture, Forestry and Other Land Use. Hayama, Japan, Intergovernmental Panel on Climate Change, https://www.ipcc-nggip.iges.or.jp/public/2006gl/vol4.html, access 12.02.2019',
  },
  'crop.springBarleyMalting.nContentRoot': {
    id: 'crop.springBarleyMalting.nContentRoot',
    Produktionsrichtung: 'Ernte- und Wurzelrückstände',
    Emissionsquelle: '',
    Beschreibung: 'Wurzelrückstand, Sommergerste',
    Parameter: 'Stickstoffgehalt',
    'Information zum Parameter:': 'siehe auch BEK-Handbuch, S. 34',
    Wert: 0.014,
    Einheit: 'kg N · (kg TM)-1',
    Bezeichnung: 'xN, WR, Grst',
    Kurzzitat: 'IPCC (2006), Table 11.2, S. 11.18',
    Langzitat:
      'Da keine exakte Quelle gefunden wurde, wird der Wert von Barley verwendet: IPCC (2006): IPCC Guidelines for National Greenhouse Gas Inventories. Volume 4, Agriculture, Forestry and Other Land Use. Hayama, Japan, Intergovernmental Panel on Climate Change, https://www.ipcc-nggip.iges.or.jp/public/2006gl/vol4.html, access 12.02.2019',
  },
  'crop.springOatsFodder.supplySeed': {
    id: 'crop.springOatsFodder.supplySeed',
    Produktionsrichtung: 'Saatgut',
    Emissionsquelle: '',
    Beschreibung:
      'Saatgut anderer Getreidearten mit 84,6 % TM konventionell herstellen',
    Parameter: 'Treibhausgas-Emissionsfaktor',
    'Information zum Parameter:': 'siehe auch BEK-Handbuch, S. 36',
    Wert: 0.801,
    Einheit: 'kg CO2e · (kg FM)-1',
    Bezeichnung: 'EFCO2e, Stgt, and Getreide',
    Kurzzitat: 'siehe BEK-Handbuch, S. 36',
    Langzitat: '',
  },
  'crop.springOatsFodder.p2o5ByproductFm': {
    id: 'crop.springOatsFodder.p2o5ByproductFm',
    Produktionsrichtung: 'Nebenprodukt',
    Emissionsquelle: '',
    Beschreibung: 'P2O5 Gehalt, Nebenprodukt, Sommerhafer',
    Parameter: 'P2O5 Gehalt, Nebenprodukt, Sommerhafer',
    'Information zum Parameter:': 'P2O5 Gehalt, Nebenprodukt, Sommerhafer',
    Wert: 0.003,
    Einheit: 'kg P2O5 · (kg FM)-1',
    Bezeichnung: 'xP2O5, Sek, Hafer',
    Kurzzitat: 'DüV (2020), Anlage 7',
    Langzitat:
      'Verordnung über die Anwendung von Düngemitteln, Bodenhilfsstoffen, Kultursubstraten und Pflanzenhilfsmitteln nach den Grundsätzen der guten fachlichen Praxis beim Düngen 2 (Düngeverordnung - DüV) Anlage 7 (zu § 3 Absatz 2 und 6 und § 4 Absatz 3) Nährstoffgehalte pflanzlicher Erzeugnisse',
  },
  'crop.springOatsFodder.k2oByproductFm': {
    id: 'crop.springOatsFodder.k2oByproductFm',
    Produktionsrichtung: 'Nebenprodukt',
    Emissionsquelle: '',
    Beschreibung: 'K2O Gehalt, Nebenprodukt, Sommerhafer',
    Parameter: 'K2O Gehalt, Nebenprodukt, Sommerhafer',
    'Information zum Parameter:': 'K2O Gehalt, Nebenprodukt, Sommerhafer',
    Wert: 0.017,
    Einheit: 'kg K2O · (kg FM)-1',
    Bezeichnung: 'xK2O, Sek, Hafer',
    Kurzzitat: '',
    Langzitat:
      'https://www.lfl.bayern.de/mam/cms07/iab/dateien/basisdaten22_tabelle_1a_20211210.pdf',
  },
  'crop.springOatsFodder.piecesToKg': {
    id: 'crop.springOatsFodder.piecesToKg',
    Produktionsrichtung: 'Saatgut',
    Emissionsquelle: '',
    Beschreibung: 'Umrechnung von der Einheit Sack Saatgut in kg',
    Parameter: 'U zu kg',
    'Information zum Parameter:': 'U zu kg Sommerhafer',
    Wert: 1,
    Einheit: 'kg · ( U )-1',
    Bezeichnung: 'Ukg, SGrst',
    Kurzzitat: '',
    Langzitat: 'Direkte Beobachtung',
  },
  'crop.potatoTableLate.p2o5ByproductFm': {
    id: 'crop.potatoTableLate.p2o5ByproductFm',
    Produktionsrichtung: 'Nebenprodukt',
    Emissionsquelle: '',
    Beschreibung: 'P2O5 Gehalt, Nebenprodukt, Sommerhafer',
    Parameter: 'P2O5 Gehalt, Nebenprodukt, Sommerhafer',
    'Information zum Parameter:': 'P2O5 Gehalt, Nebenprodukt, Kartoffel',
    Wert: 0.0004,
    Einheit: 'kg P2O5 · (kg FM)-1',
    Bezeichnung: 'xP2O5, Sek, Kartoffel',
    Kurzzitat: 'DüV (2020), Anlage 7',
    Langzitat:
      'Verordnung über die Anwendung von Düngemitteln, Bodenhilfsstoffen, Kultursubstraten und Pflanzenhilfsmitteln nach den Grundsätzen der guten fachlichen Praxis beim Düngen 2 (Düngeverordnung - DüV) Anlage 7 (zu § 3 Absatz 2 und 6 und § 4 Absatz 3) Nährstoffgehalte pflanzlicher Erzeugnisse',
  },
  'crop.potatoTableLate.k2oByproductFm': {
    id: 'crop.potatoTableLate.k2oByproductFm',
    Produktionsrichtung: 'Nebenprodukt',
    Emissionsquelle: '',
    Beschreibung: 'K2O Gehalt, Nebenprodukt, Sommerhafer',
    Parameter: 'K2O Gehalt, Nebenprodukt, Sommerhafer',
    'Information zum Parameter:': 'K2O Gehalt, Nebenprodukt, Kartoffel',
    Wert: 0.0036,
    Einheit: 'kg K2O · (kg FM)-1',
    Bezeichnung: 'xK2O, Sek, Kartoffel',
    Kurzzitat: '',
    Langzitat:
      'https://www.lfl.bayern.de/mam/cms07/iab/dateien/basisdaten22_tabelle_1a_20211210.pdf',
  },
  'crop.potatoTableLate.piecesToKg': {
    id: 'crop.potatoTableLate.piecesToKg',
    Produktionsrichtung: 'Saatgut',
    Emissionsquelle: '',
    Beschreibung: 'Umrechnung von der Einheit Sack Saatgut in kg',
    Parameter: 'U zu kg',
    'Information zum Parameter:': 'U zu kg Kartoffel',
    Wert: 1,
    Einheit: 'kg · ( U )-1',
    Bezeichnung: 'Ukg, Kartoffel',
    Kurzzitat: '',
    Langzitat: 'Direkte Beobachtung',
  },
  'crop.winterRyeBaking.p2o5ByproductFm': {
    id: 'crop.winterRyeBaking.p2o5ByproductFm',
    Produktionsrichtung: 'Nebenprodukt',
    Emissionsquelle: '',
    Beschreibung: 'P2O5 Gehalt, Nebenprodukt, Winteroggen',
    Parameter: 'P2O5 Gehalt, Nebenprodukt, Sommerhafer',
    'Information zum Parameter:': 'P2O5 Gehalt, Nebenprodukt, Kartoffel',
    Wert: 0.003,
    Einheit: 'kg P2O5 · (kg FM)-1',
    Bezeichnung: 'xP2O5, Sek, Winteroggen',
    Kurzzitat: 'DüV (2020), Anlage 7',
    Langzitat:
      'Verordnung über die Anwendung von Düngemitteln, Bodenhilfsstoffen, Kultursubstraten und Pflanzenhilfsmitteln nach den Grundsätzen der guten fachlichen Praxis beim Düngen 2 (Düngeverordnung - DüV) Anlage 7 (zu § 3 Absatz 2 und 6 und § 4 Absatz 3) Nährstoffgehalte pflanzlicher Erzeugnisse',
  },
  'crop.winterRyeBaking.k2oByproductFm': {
    id: 'crop.winterRyeBaking.k2oByproductFm',
    Produktionsrichtung: 'Nebenprodukt',
    Emissionsquelle: '',
    Beschreibung: 'K2O Gehalt, Nebenprodukt, Winteroggen',
    Parameter: 'K2O Gehalt, Nebenprodukt, Sommerhafer',
    'Information zum Parameter:': 'K2O Gehalt, Nebenprodukt, Kartoffel',
    Wert: 0.02,
    Einheit: 'kg K2O · (kg FM)-1',
    Bezeichnung: 'xK2O, Sek, Winteroggen',
    Kurzzitat: '',
    Langzitat:
      'https://www.lfl.bayern.de/mam/cms07/iab/dateien/basisdaten22_tabelle_1a_20211210.pdf',
  },
  'crop.winterRyeBaking.piecesToKg': {
    id: 'crop.winterRyeBaking.piecesToKg',
    Produktionsrichtung: 'Saatgut',
    Emissionsquelle: '',
    Beschreibung: 'Umrechnung von der Einheit Sack Saatgut in kg',
    Parameter: 'U zu kg',
    'Information zum Parameter:': 'U zu kg Kartoffel',
    Wert: 1,
    Einheit: 'kg · ( U )-1',
    Bezeichnung: 'Ukg, Winteroggen',
    Kurzzitat: '',
    Langzitat: 'Direkte Beobachtung',
  },
  'crop.winterRyeBaking.nContentRoot': {
    id: 'crop.winterRyeBaking.nContentRoot',
    Produktionsrichtung: 'Ernte- und Wurzelrückstände',
    Emissionsquelle: '',
    Beschreibung: 'Wurzelrückstand, Winterroggen',
    Parameter: 'Stickstoffgehalt',
    'Information zum Parameter:': 'siehe auch BEK-Handbuch, S. 34',
    Wert: 0.009,
    Einheit: 'kg N · (kg TM)-1',
    Bezeichnung: 'xN, WR, Winterroggen',
    Kurzzitat: 'IPCC (2006), Table 11.2, S. 11.18',
    Langzitat:
      'IPCC (2006): IPCC Guidelines for National Greenhouse Gas Inventories. Volume 4, Agriculture, Forestry and Other Land Use. Hayama, Japan, Intergovernmental Panel on Climate Change, https://www.ipcc-nggip.iges.or.jp/public/2006gl/vol4.html, access 12.02.2019',
  },
  'crop.winterRyeBaking.rootProportion': {
    id: 'crop.winterRyeBaking.rootProportion',
    Produktionsrichtung: 'Ernte- und Wurzelrückstände',
    Emissionsquelle: '',
    Beschreibung:
      'Wurzelrückstand zu Haupt- und Nebenernteprodukte, Getreide (allgemein)',
    Parameter: 'Proportionalitätsfaktor',
    'Information zum Parameter:': 'siehe auch BEK-Handbuch, S. 34',
    Wert: 0.22,
    Einheit: 'kg TM · (kg TMHep + kg TMNep)-1',
    Bezeichnung: 'αWR, Gtrd allg',
    Kurzzitat: 'IPCC (2006), Table 11.2, S. 11.18',
    Langzitat:
      'IPCC (2006): IPCC Guidelines for National Greenhouse Gas Inventories. Volume 4, Agriculture, Forestry and Other Land Use. Hayama, Japan, Intergovernmental Panel on Climate Change, https://www.ipcc-nggip.iges.or.jp/public/2006gl/vol4.html, access 12.02.2019',
  },
  'crop.winterWheat.thousandGrainWeight': {
    id: 'crop.winterWheat.thousandGrainWeight',
    Produktionsrichtung: 'Saatgut',
    Emissionsquelle: '',
    Beschreibung: 'Tausendkornmasse Winterweizen',
    Parameter: 'Tausendkornmasse Winterweizen',
    'Information zum Parameter:': 'Tausendkornmasse Winterweizen',
    Wert: 47.5,
    Einheit: 'g · (1000  Körner)-1',
    Bezeichnung: 'TKG, Wwzn',
    Kurzzitat: '',
    Langzitat: 'Direkte Beobachtung',
  },
  'crop.silageMaize.thousandGrainWeight': {
    id: 'crop.silageMaize.thousandGrainWeight',
    Produktionsrichtung: 'Saatgut',
    Emissionsquelle: '',
    Beschreibung: 'Tausendkornmasse Silomais',
    Parameter: 'Tausendkornmasse Silomais',
    'Information zum Parameter:': 'Tausendkornmasse Silomais',
    Wert: 325,
    Einheit: 'g · (1000  Körner)-1',
    Bezeichnung: 'TKG, Mais',
    Kurzzitat: '',
    Langzitat: 'Direkte Beobachtung',
  },
  'crop.canola.thousandGrainWeight': {
    id: 'crop.canola.thousandGrainWeight',
    Produktionsrichtung: 'Saatgut',
    Emissionsquelle: '',
    Beschreibung: 'Tausendkornmasse Raps',
    Parameter: 'Tausendkornmasse Raps',
    'Information zum Parameter:': 'Tausendkornmasse Raps',
    Wert: 5.25,
    Einheit: 'g · (1000  Körner)-1',
    Bezeichnung: 'TKG, Raps',
    Kurzzitat: '',
    Langzitat: 'Direkte Beobachtung',
  },
  'crop.sugarBeet.thousandGrainWeight': {
    id: 'crop.sugarBeet.thousandGrainWeight',
    Produktionsrichtung: 'Saatgut',
    Emissionsquelle: '',
    Beschreibung: 'Tausendkornmasse Zuckerrüben',
    Parameter: 'Tausendkornmasse Zuckerrüben',
    'Information zum Parameter:': 'Tausendkornmasse Zuckerrüben',
    Wert: 11,
    Einheit: 'g · (1000  Körner)-1',
    Bezeichnung: 'TKG, Zuckerrüben',
    Kurzzitat: '',
    Langzitat: 'Direkte Beobachtung',
  },
  'crop.winterBarleyFodder.thousandGrainWeight': {
    id: 'crop.winterBarleyFodder.thousandGrainWeight',
    Produktionsrichtung: 'Saatgut',
    Emissionsquelle: '',
    Beschreibung: 'Tausendkornmasse Wintergerste',
    Parameter: 'Tausendkornmasse Wintergerste',
    'Information zum Parameter:': 'Tausendkornmasse Wintergerste',
    Wert: 47.5,
    Einheit: 'g · (1000  Körner)-1',
    Bezeichnung: 'TKG, Wintergerste',
    Kurzzitat: '',
    Langzitat: 'Direkte Beobachtung',
  },
  'crop.springBarleyMalting.thousandGrainWeight': {
    id: 'crop.springBarleyMalting.thousandGrainWeight',
    Produktionsrichtung: 'Saatgut',
    Emissionsquelle: '',
    Beschreibung: 'Tausendkornmasse Sommergerste',
    Parameter: 'Tausendkornmasse Sommergerste',
    'Information zum Parameter:': 'Tausendkornmasse Sommergerste',
    Wert: 47.5,
    Einheit: 'g · (1000  Körner)-1',
    Bezeichnung: 'TKG, Sommergerste',
    Kurzzitat: '',
    Langzitat: 'Direkte Beobachtung',
  },
  'crop.springOatsFodder.thousandGrainWeight': {
    id: 'crop.springOatsFodder.thousandGrainWeight',
    Produktionsrichtung: 'Saatgut',
    Emissionsquelle: '',
    Beschreibung: 'Tausendkornmasse Sommerhafer',
    Parameter: 'Tausendkornmasse Sommerhafer',
    'Information zum Parameter:': 'Tausendkornmasse Sommerhafer',
    Wert: 37.5,
    Einheit: 'g · (1000  Körner)-1',
    Bezeichnung: 'TKG, Sommerhafer',
    Kurzzitat: '',
    Langzitat: 'Direkte Beobachtung',
  },
  'crop.winterRyeBaking.thousandGrainWeight': {
    id: 'crop.winterRyeBaking.thousandGrainWeight',
    Produktionsrichtung: 'Saatgut',
    Emissionsquelle: '',
    Beschreibung: 'Tausendkornmasse Winterroggen',
    Parameter: 'Tausendkornmasse Winterroggen',
    'Information zum Parameter:': 'Tausendkornmasse Winterroggen',
    Wert: 35,
    Einheit: 'g · (1000  Körner)-1',
    Bezeichnung: 'TKG, Winterroggen',
    Kurzzitat: '',
    Langzitat: 'Direkte Beobachtung',
  },
  'crop.sunflower.dryMatterContent': {
    id: 'crop.sunflower.dryMatterContent',
    Produktionsrichtung: 'Trockenmassegehalt, Hauptprodukt',
    Emissionsquelle: '',
    Beschreibung: 'Trockenmassgehalt, Haptprodukt, Sonnenblume',
    Parameter: '',
    'Information zum Parameter:': '',
    Wert: 0.91,
    Einheit: 'kg TM · (kg FM)-1',
    Bezeichnung: 'xTM, HP, Snnblmn',
    Kurzzitat: '',
    Langzitat:
      'Verordnung über die Anwendung von Düngemitteln, Bodenhilfsstoffen, Kultursubstraten und Pflanzenhilfsmitteln nach den Grundsätzen der guten fachlichen Praxis beim Düngen 2 (Düngeverordnung - DüV) Anlage 7 (zu § 3 Absatz 2 und 6 und § 4 Absatz 3) Nährstoffgehalte pflanzlicher Erzeugnisse',
  },
  'crop.sunflower.dryMatterContentByproduct': {
    id: 'crop.sunflower.dryMatterContentByproduct',
    Produktionsrichtung: 'Nebenprodukt',
    Emissionsquelle: '',
    Beschreibung: 'Trockenmassegehalt, Nebenprodukt, Sonnenblume',
    Parameter: '',
    'Information zum Parameter:': '',
    Wert: 0.86,
    Einheit: 'kg TM · (kg FM)-1',
    Bezeichnung: 'xTM,NP, Snnblmn',
    Kurzzitat: '',
    Langzitat:
      'Verordnung über die Anwendung von Düngemitteln, Bodenhilfsstoffen, Kultursubstraten und Pflanzenhilfsmitteln nach den Grundsätzen der guten fachlichen Praxis beim Düngen 2 (Düngeverordnung - DüV) Anlage 7 (zu § 3 Absatz 2 und 6 und § 4 Absatz 3) Nährstoffgehalte pflanzlicher Erzeugnisse',
  },
  'crop.sunflower.humusMain': {
    id: 'crop.sunflower.humusMain',
    Produktionsrichtung: 'Humus-C',
    Emissionsquelle: '',
    Beschreibung: 'Humusauswirkung durch den Anbau von Sonnenblume',
    Parameter: '',
    'Information zum Parameter:': '',
    Wert: -400,
    Einheit: 'kg Humus-C/ha',
    Bezeichnung: 'Humus-C, MP, Snnblmn',
    Kurzzitat: '',
    Langzitat: 'VDLUFA-Methodenbuch',
  },
  'crop.sunflower.k2oByproductFm': {
    id: 'crop.sunflower.k2oByproductFm',
    Produktionsrichtung: 'Nebenprodukt',
    Emissionsquelle: '',
    Beschreibung: 'K2O Gehalt, Nebenprodukt, Sonnenblume',
    Parameter: '',
    'Information zum Parameter:': '',
    Wert: 0.045,
    Einheit: 'kg K2O · (kg FM)-1',
    Bezeichnung: 'xK2O, Sek, Snnblmn',
    Kurzzitat: '',
    Langzitat:
      'https://www.lfl.bayern.de/mam/cms07/iab/dateien/basisdaten22_tabelle_1a_20211210.pdf',
  },
  'crop.sunflower.MPBR': {
    id: 'crop.sunflower.MPBR',
    Produktionsrichtung: 'Nebenprodukt',
    Emissionsquelle: '',
    Beschreibung: 'Haupternteprodukt-Nebenernteprodukt-Verhältnis Sonnenblume',
    Parameter: '',
    'Information zum Parameter:': '',
    Wert: 2,
    Einheit: 'kg NP · (kg HP)-1',
    Bezeichnung: 'HNV, Snnblmn',
    Kurzzitat: '',
    Langzitat:
      'Verordnung über die Anwendung von Düngemitteln, Bodenhilfsstoffen, Kultursubstraten und Pflanzenhilfsmitteln nach den Grundsätzen der guten fachlichen Praxis beim Düngen 2 (Düngeverordnung - DüV) Anlage 7 (zu § 3 Absatz 2 und 6 und § 4 Absatz 3) Nährstoffgehalte pflanzlicher Erzeugnisse',
  },
  'crop.sunflower.nByproductFm': {
    id: 'crop.sunflower.nByproductFm',
    Produktionsrichtung: 'Ernte- und Wurzelrückstände',
    Emissionsquelle: '',
    Beschreibung: 'Stickstoffgehalt, Nebenprodukt, Sonnenblume',
    Parameter: '',
    'Information zum Parameter:': '',
    Wert: 0.01,
    Einheit: 'kg N · (kg FM)-1',
    Bezeichnung: 'xN, NWR, Snnblmn',
    Kurzzitat: '',
    Langzitat:
      'Verordnung über die Anwendung von Düngemitteln, Bodenhilfsstoffen, Kultursubstraten und Pflanzenhilfsmitteln nach den Grundsätzen der guten fachlichen Praxis beim Düngen 2 (Düngeverordnung - DüV) Anlage 7 (zu § 3 Absatz 2 und 6 und § 4 Absatz 3) Nährstoffgehalte pflanzlicher Erzeugnisse',
  },
  'crop.sunflower.nContentRoot': {
    id: 'crop.sunflower.nContentRoot',
    Produktionsrichtung: 'Ernte- und Wurzelrückstände',
    Emissionsquelle: '',
    Beschreibung: 'Wurzelrückstand, Sonnenblume',
    Parameter: '',
    'Information zum Parameter:': '',
    Wert: 0.009,
    Einheit: 'kg N · (kg TM)-1',
    Bezeichnung: 'xN, WR, Snnblmn',
    Kurzzitat: '',
    Langzitat: '',
  },
  'crop.sunflower.p2o5ByproductFm': {
    id: 'crop.sunflower.p2o5ByproductFm',
    Produktionsrichtung: 'Nebenprodukt',
    Emissionsquelle: '',
    Beschreibung: 'P2O5 Gehalt, Nebenprodukt, Sonnenblume',
    Parameter: '',
    'Information zum Parameter:': '',
    Wert: 0.009,
    Einheit: 'kg P2O5 · (kg FM)-1',
    Bezeichnung: 'xP2O5, Sek, Snnblmn',
    Kurzzitat: '',
    Langzitat:
      'Verordnung über die Anwendung von Düngemitteln, Bodenhilfsstoffen, Kultursubstraten und Pflanzenhilfsmitteln nach den Grundsätzen der guten fachlichen Praxis beim Düngen 2 (Düngeverordnung - DüV) Anlage 7 (zu § 3 Absatz 2 und 6 und § 4 Absatz 3) Nährstoffgehalte pflanzlicher Erzeugnisse',
  },
  'crop.sunflower.piecesToKg': {
    id: 'crop.sunflower.piecesToKg',
    Produktionsrichtung: 'Saatgut',
    Emissionsquelle: '',
    Beschreibung: 'Umrechnung von der Einheit Sack Saatgut in kg',
    Parameter: '',
    'Information zum Parameter:': '',
    Wert: 2.4,
    Einheit: 'kg · ( U )-1',
    Bezeichnung: 'Ukg, Snnblmn',
    Kurzzitat: '',
    Langzitat: 'Direkte Beobachtung',
  },
  'crop.sunflower.rootProportion': {
    id: 'crop.sunflower.rootProportion',
    Produktionsrichtung: 'Ernte- und Wurzelrückstände',
    Emissionsquelle: '',
    Beschreibung:
      'Wurzelrückstand zu Haupt- und Nebenernteprodukte, Sonnenblume',
    Parameter: '',
    'Information zum Parameter:': '',
    Wert: 0.22,
    Einheit: 'kg TM · (kg TMHep + kg TMNep)-1',
    Bezeichnung: 'αWR, Snnblmn',
    Kurzzitat: '',
    Langzitat: '',
  },
  'crop.sunflower.supplySeed': {
    id: 'crop.sunflower.supplySeed',
    Produktionsrichtung: 'Saatgut',
    Emissionsquelle: '',
    Beschreibung: 'Sonnenblumensaatgut mit 94 % TM konventionell herstellen',
    Parameter: 'Treibhausgas-Emissionsfaktor',
    'Information zum Parameter:':
      'aus Ecoinvent v3.1, Aktivitätsdatensatz "sunflower seed production, for sowing", Allokationsmethode "ecoinvent default"',
    Wert: 1.529,
    Einheit: 'kg CO2e · (kg FM)-1',
    Bezeichnung: 'EFCO2e, Stgt, Snnblmn',
    Kurzzitat: 'Weidema et al. (2013)',
    Langzitat:
      'Eigentümer dieses Parameters ist Ecoinvent Weidema, B. P. et al. (2013): The ecoinvent database: Overview and methodology, Data quality guideline for the ecoinvent database version 3, www.ecoinvent.org',
  },
  'crop.sunflower.thousandGrainWeight': {
    id: 'crop.sunflower.thousandGrainWeight',
    Produktionsrichtung: 'Saatgut',
    Emissionsquelle: '',
    Beschreibung: 'Tausendkornmasse Sonnenblume',
    Parameter: '',
    'Information zum Parameter:': '',
    Wert: 65,
    Einheit: 'g · (1000 Körner)-1',
    Bezeichnung: 'TKG, Snnblmn',
    Kurzzitat: '',
    Langzitat: 'Direkte Beobachtung',
  },
  'crop.triticaleFodder.dryMatterContent': {
    id: 'crop.triticaleFodder.dryMatterContent',
    Produktionsrichtung: 'Trockenmassegehalt, Hauptprodukt',
    Emissionsquelle: '',
    Beschreibung: 'Trockenmassgehalt, Haptprodukt, Triticale',
    Parameter: '',
    'Information zum Parameter:': '',
    Wert: 0.86,
    Einheit: 'kg TM · (kg FM)-1',
    Bezeichnung: 'xTM, HP, Trtcl',
    Kurzzitat: 'DüV (2020), Anlage 7',
    Langzitat:
      'Verordnung über die Anwendung von Düngemitteln, Bodenhilfsstoffen, Kultursubstraten und Pflanzenhilfsmitteln nach den Grundsätzen der guten fachlichen Praxis beim Düngen 2 (Düngeverordnung - DüV) Anlage 7 (zu § 3 Absatz 2 und 6 und § 4 Absatz 3) Nährstoffgehalte pflanzlicher Erzeugnisse',
  },
  'crop.triticaleFodder.dryMatterContentByproduct': {
    id: 'crop.triticaleFodder.dryMatterContentByproduct',
    Produktionsrichtung: 'Nebenprodukt',
    Emissionsquelle: '',
    Beschreibung: 'Trockenmassegehalt, Nebenprodukt, Triticale',
    Parameter: '',
    'Information zum Parameter:': '',
    Wert: 0.86,
    Einheit: 'kg TM · (kg FM)-1',
    Bezeichnung: 'xTM,NP, Trtcl',
    Kurzzitat: 'DüV (2020), Anlage 7',
    Langzitat:
      'Verordnung über die Anwendung von Düngemitteln, Bodenhilfsstoffen, Kultursubstraten und Pflanzenhilfsmitteln nach den Grundsätzen der guten fachlichen Praxis beim Düngen 2 (Düngeverordnung - DüV) Anlage 7 (zu § 3 Absatz 2 und 6 und § 4 Absatz 3) Nährstoffgehalte pflanzlicher Erzeugnisse',
  },
  'crop.triticaleFodder.humusMain': {
    id: 'crop.triticaleFodder.humusMain',
    Produktionsrichtung: 'Humus-C',
    Emissionsquelle: '',
    Beschreibung: 'Humusauswirkung durch den Anbau von Triticale',
    Parameter: '',
    'Information zum Parameter:': '',
    Wert: -400,
    Einheit: 'kg Humus-C/ha',
    Bezeichnung: 'Humus-C, MP, Trtcl',
    Kurzzitat: '',
    Langzitat: 'VDLUFA-Methodenbuch',
  },
  'crop.triticaleFodder.k2oByproductFm': {
    id: 'crop.triticaleFodder.k2oByproductFm',
    Produktionsrichtung: 'Nebenprodukt',
    Emissionsquelle: '',
    Beschreibung: 'K2O Gehalt, Nebenprodukt, Triticale',
    Parameter: '',
    'Information zum Parameter:': '',
    Wert: 0.017,
    Einheit: 'kg K2O · (kg FM)-1',
    Bezeichnung: 'xK2O, Sek, Trtcl',
    Kurzzitat: 'DüV (2020), Anlage 7',
    Langzitat:
      'Verordnung über die Anwendung von Düngemitteln, Bodenhilfsstoffen, Kultursubstraten und Pflanzenhilfsmitteln nach den Grundsätzen der guten fachlichen Praxis beim Düngen 2 (Düngeverordnung - DüV) Anlage 7 (zu § 3 Absatz 2 und 6 und § 4 Absatz 3) Nährstoffgehalte pflanzlicher Erzeugnisse',
  },
  'crop.triticaleFodder.MPBR': {
    id: 'crop.triticaleFodder.MPBR',
    Produktionsrichtung: 'Nebenprodukt',
    Emissionsquelle: '',
    Beschreibung: 'Haupternteprodukt-Nebenernteprodukt-Verhältnis Triticale',
    Parameter: '',
    'Information zum Parameter:': '',
    Wert: 0.9,
    Einheit: 'kg NP · (kg HP)-1',
    Bezeichnung: 'HNV, Trtcl',
    Kurzzitat: 'DüV (2020), Anlage 7',
    Langzitat:
      'Verordnung über die Anwendung von Düngemitteln, Bodenhilfsstoffen, Kultursubstraten und Pflanzenhilfsmitteln nach den Grundsätzen der guten fachlichen Praxis beim Düngen 2 (Düngeverordnung - DüV) Anlage 7 (zu § 3 Absatz 2 und 6 und § 4 Absatz 3) Nährstoffgehalte pflanzlicher Erzeugnisse',
  },
  'crop.triticaleFodder.nByproductFm': {
    id: 'crop.triticaleFodder.nByproductFm',
    Produktionsrichtung: 'Ernte- und Wurzelrückstände',
    Emissionsquelle: '',
    Beschreibung: 'Stickstoffgehalt, Nebenprodukt, Triticale',
    Parameter: '',
    'Information zum Parameter:': '',
    Wert: 0.005,
    Einheit: 'kg N · (kg FM)-1',
    Bezeichnung: 'xN, NWR, Trtcl',
    Kurzzitat: 'DüV (2020), Anlage 7',
    Langzitat:
      'Verordnung über die Anwendung von Düngemitteln, Bodenhilfsstoffen, Kultursubstraten und Pflanzenhilfsmitteln nach den Grundsätzen der guten fachlichen Praxis beim Düngen 2 (Düngeverordnung - DüV) Anlage 7 (zu § 3 Absatz 2 und 6 und § 4 Absatz 3) Nährstoffgehalte pflanzlicher Erzeugnisse',
  },
  'crop.triticaleFodder.nContentRoot': {
    id: 'crop.triticaleFodder.nContentRoot',
    Produktionsrichtung: 'Ernte- und Wurzelrückstände',
    Emissionsquelle: '',
    Beschreibung: 'Wurzelrückstand, Triticale',
    Parameter: '',
    'Information zum Parameter:': '',
    Wert: 0.009,
    Einheit: 'kg N · (kg TM)-1',
    Bezeichnung: 'xN, WR, Trtcl',
    Kurzzitat: 'IPCC (2006), Table 11.2, S. 11.18',
    Langzitat:
      'IPCC (2006): IPCC Guidelines for National Greenhouse Gas Inventories. Volume 4, Agriculture, Forestry and Other Land Use. Hayama, Japan, Intergovernmental Panel on Climate Change, https://www.ipcc-nggip.iges.or.jp/public/2006gl/vol4.html, access 12.02.2019',
  },
  'crop.triticaleFodder.p2o5ByproductFm': {
    id: 'crop.triticaleFodder.p2o5ByproductFm',
    Produktionsrichtung: 'Nebenprodukt',
    Emissionsquelle: '',
    Beschreibung: 'P2O5 Gehalt, Nebenprodukt, Triticale',
    Parameter: '',
    'Information zum Parameter:': '',
    Wert: 0.003,
    Einheit: 'kg P2O5 · (kg FM)-1',
    Bezeichnung: 'xP2O5, Sek, Trtcl',
    Kurzzitat: 'DüV (2020), Anlage 7',
    Langzitat:
      'Verordnung über die Anwendung von Düngemitteln, Bodenhilfsstoffen, Kultursubstraten und Pflanzenhilfsmitteln nach den Grundsätzen der guten fachlichen Praxis beim Düngen 2 (Düngeverordnung - DüV) Anlage 7 (zu § 3 Absatz 2 und 6 und § 4 Absatz 3) Nährstoffgehalte pflanzlicher Erzeugnisse',
  },
  'crop.triticaleFodder.piecesToKg': {
    id: 'crop.triticaleFodder.piecesToKg',
    Produktionsrichtung: 'Saatgut',
    Emissionsquelle: '',
    Beschreibung: 'Umrechnung von der Einheit Sack Saatgut in kg',
    Parameter: '',
    'Information zum Parameter:': '',
    Wert: 1,
    Einheit: 'kg · ( U )-1',
    Bezeichnung: 'Ukg, Trtcl',
    Kurzzitat: '',
    Langzitat: '',
  },
  'crop.triticaleFodder.rootProportion': {
    id: 'crop.triticaleFodder.rootProportion',
    Produktionsrichtung: 'Ernte- und Wurzelrückstände',
    Emissionsquelle: '',
    Beschreibung: 'Wurzelrückstand zu Haupt- und Nebenernteprodukte, Triticale',
    Parameter: '',
    'Information zum Parameter:': '',
    Wert: 0.22,
    Einheit: 'kg TM · (kg TMHep + kg TMNep)-1',
    Bezeichnung: 'αWR, Trtcl',
    Kurzzitat: 'IPCC (2006), Table 11.2, S. 11.18',
    Langzitat:
      'IPCC (2006): IPCC Guidelines for National Greenhouse Gas Inventories. Volume 4, Agriculture, Forestry and Other Land Use. Hayama, Japan, Intergovernmental Panel on Climate Change, https://www.ipcc-nggip.iges.or.jp/public/2006gl/vol4.html, access 12.02.2019',
  },
  'crop.triticaleFodder.supplySeed': {
    id: 'crop.triticaleFodder.supplySeed',
    Produktionsrichtung: 'Saatgut',
    Emissionsquelle: '',
    Beschreibung: 'Triticalensaatgut mit 94 % TM konventionell herstellen',
    Parameter: '',
    'Information zum Parameter:': '',
    Wert: 0.89,
    Einheit: 'kg CO2e · (kg FM)-1',
    Bezeichnung: 'EFCO2e, Stgt, Trtcl',
    Kurzzitat: '',
    Langzitat:
      'Kein Wert für Triticale gefunden. Dieser Wert wurde von Winterweizen übernommen ( Eigentümer dieses Parameters ist Ecoinvent Weidema, B. P. et al. (2013): The ecoinvent database: Overview and methodology, Data quality guideline for the ecoinvent database version 3, www.ecoinvent.org)',
  },
  'crop.triticaleFodder.thousandGrainWeight': {
    id: 'crop.triticaleFodder.thousandGrainWeight',
    Produktionsrichtung: 'Saatgut',
    Emissionsquelle: '',
    Beschreibung: 'Tausendkornmasse Triticale',
    Parameter: '',
    'Information zum Parameter:': '',
    Wert: 32,
    Einheit: 'g · (1000 Körner)-1',
    Bezeichnung: 'TKG, Trtcl',
    Kurzzitat: '',
    Langzitat: 'Direkte Beobachtung',
  },
  'crop.peasDryFodder.dryMatterContent': {
    id: 'crop.peasDryFodder.dryMatterContent',
    Produktionsrichtung: 'Trockenmassegehalt, Hauptprodukt',
    Emissionsquelle: '',
    Beschreibung: 'Trockenmassgehalt, Haptprodukt, Futtererbse',
    Parameter: '',
    'Information zum Parameter:': '',
    Wert: 0.86,
    Einheit: 'kg TM · (kg FM)-1',
    Bezeichnung: 'xTM, HP, Erbs',
    Kurzzitat: '',
    Langzitat:
      'Verordnung über die Anwendung von Düngemitteln, Bodenhilfsstoffen, Kultursubstraten und Pflanzenhilfsmitteln nach den Grundsätzen der guten fachlichen Praxis beim Düngen 2 (Düngeverordnung - DüV) Anlage 7 (zu § 3 Absatz 2 und 6 und § 4 Absatz 3) Nährstoffgehalte pflanzlicher Erzeugnisse',
  },
  'crop.peasDryFodder.dryMatterContentByproduct': {
    id: 'crop.peasDryFodder.dryMatterContentByproduct',
    Produktionsrichtung: 'Nebenprodukt',
    Emissionsquelle: '',
    Beschreibung: 'Trockenmassegehalt, Nebenprodukt, Futtererbse',
    Parameter: '',
    'Information zum Parameter:': '',
    Wert: 0.86,
    Einheit: 'kg TM · (kg FM)-1',
    Bezeichnung: 'xTM,NP, Erbs',
    Kurzzitat: '',
    Langzitat:
      'Verordnung über die Anwendung von Düngemitteln, Bodenhilfsstoffen, Kultursubstraten und Pflanzenhilfsmitteln nach den Grundsätzen der guten fachlichen Praxis beim Düngen 2 (Düngeverordnung - DüV) Anlage 7 (zu § 3 Absatz 2 und 6 und § 4 Absatz 3) Nährstoffgehalte pflanzlicher Erzeugnisse',
  },
  'crop.peasDryFodder.humusMain': {
    id: 'crop.peasDryFodder.humusMain',
    Produktionsrichtung: 'Humus-C',
    Emissionsquelle: '',
    Beschreibung: 'Humusauswirkung durch den Anbau von Futtererbse',
    Parameter: '',
    'Information zum Parameter:': '',
    Wert: 160,
    Einheit: 'kg Humus-C/ha',
    Bezeichnung: 'Humus-C, MP, Erbs',
    Kurzzitat: '',
    Langzitat: 'VDLUFA-Methodenbuch',
  },
  'crop.peasDryFodder.k2oByproductFm': {
    id: 'crop.peasDryFodder.k2oByproductFm',
    Produktionsrichtung: 'Nebenprodukt',
    Emissionsquelle: '',
    Beschreibung: 'K2O Gehalt, Nebenprodukt, Futtererbse',
    Parameter: '',
    'Information zum Parameter:': '',
    Wert: 0.026,
    Einheit: 'kg K2O · (kg FM)-1',
    Bezeichnung: 'xK2O, Sek, Erbs',
    Kurzzitat: '',
    Langzitat:
      'https://www.lfl.bayern.de/mam/cms07/iab/dateien/basisdaten22_tabelle_1a_20211210.pdf',
  },
  'crop.peasDryFodder.MPBR': {
    id: 'crop.peasDryFodder.MPBR',
    Produktionsrichtung: 'Nebenprodukt',
    Emissionsquelle: '',
    Beschreibung: 'Haupternteprodukt-Nebenernteprodukt-Verhältnis Futtererbse',
    Parameter: '',
    'Information zum Parameter:': '',
    Wert: 1,
    Einheit: 'kg NP · (kg HP)-1',
    Bezeichnung: 'HNV, Erbs',
    Kurzzitat: '',
    Langzitat:
      'Verordnung über die Anwendung von Düngemitteln, Bodenhilfsstoffen, Kultursubstraten und Pflanzenhilfsmitteln nach den Grundsätzen der guten fachlichen Praxis beim Düngen 2 (Düngeverordnung - DüV) Anlage 7 (zu § 3 Absatz 2 und 6 und § 4 Absatz 3) Nährstoffgehalte pflanzlicher Erzeugnisse',
  },
  'crop.peasDryFodder.nByproductFm': {
    id: 'crop.peasDryFodder.nByproductFm',
    Produktionsrichtung: 'Ernte- und Wurzelrückstände',
    Emissionsquelle: '',
    Beschreibung: 'Stickstoffgehalt, Nebenprodukt, Futtererbse',
    Parameter: '',
    'Information zum Parameter:': '',
    Wert: 0.015,
    Einheit: 'kg N · (kg FM)-1',
    Bezeichnung: 'xN, NWR, Erbs',
    Kurzzitat: '',
    Langzitat:
      'Verordnung über die Anwendung von Düngemitteln, Bodenhilfsstoffen, Kultursubstraten und Pflanzenhilfsmitteln nach den Grundsätzen der guten fachlichen Praxis beim Düngen 2 (Düngeverordnung - DüV) Anlage 7 (zu § 3 Absatz 2 und 6 und § 4 Absatz 3) Nährstoffgehalte pflanzlicher Erzeugnisse',
  },
  'crop.peasDryFodder.nContentRoot': {
    id: 'crop.peasDryFodder.nContentRoot',
    Produktionsrichtung: 'Ernte- und Wurzelrückstände',
    Emissionsquelle: '',
    Beschreibung: 'Wurzelrückstand, Futtererbse',
    Parameter: '',
    'Information zum Parameter:': '',
    Wert: 0.008,
    Einheit: 'kg N · (kg TM)-1',
    Bezeichnung: 'xN, WR, Erbs',
    Kurzzitat: '',
    Langzitat:
      'IPCC (2006): IPCC Guidelines for National Greenhouse Gas Inventories. Volume 4, Agriculture, Forestry and Other Land Use. Hayama, Japan, Intergovernmental Panel on Climate Change, https://www.ipcc-nggip.iges.or.jp/public/2006gl/vol4.html, access 12.02.2019',
  },
  'crop.peasDryFodder.p2o5ByproductFm': {
    id: 'crop.peasDryFodder.p2o5ByproductFm',
    Produktionsrichtung: 'Nebenprodukt',
    Emissionsquelle: '',
    Beschreibung: 'P2O5 Gehalt, Nebenprodukt, Futtererbse',
    Parameter: '',
    'Information zum Parameter:': '',
    Wert: 0.003,
    Einheit: 'kg P2O5 · (kg FM)-1',
    Bezeichnung: 'xP2O5, Sek, Erbs',
    Kurzzitat: '',
    Langzitat:
      'Verordnung über die Anwendung von Düngemitteln, Bodenhilfsstoffen, Kultursubstraten und Pflanzenhilfsmitteln nach den Grundsätzen der guten fachlichen Praxis beim Düngen 2 (Düngeverordnung - DüV) Anlage 7 (zu § 3 Absatz 2 und 6 und § 4 Absatz 3) Nährstoffgehalte pflanzlicher Erzeugnisse',
  },
  'crop.peasDryFodder.piecesToKg': {
    id: 'crop.peasDryFodder.piecesToKg',
    Produktionsrichtung: 'Saatgut',
    Emissionsquelle: '',
    Beschreibung: 'Umrechnung von der Einheit Sack Saatgut in kg',
    Parameter: '',
    'Information zum Parameter:': '',
    Wert: 20,
    Einheit: 'kg · ( U )-1',
    Bezeichnung: 'Ukg, Erbs',
    Kurzzitat: '',
    Langzitat: 'Direkte Beobachtung',
  },
  'crop.peasDryFodder.rootProportion': {
    id: 'crop.peasDryFodder.rootProportion',
    Produktionsrichtung: 'Ernte- und Wurzelrückstände',
    Emissionsquelle: '',
    Beschreibung:
      'Wurzelrückstand zu Haupt- und Nebenernteprodukte, Futtererbse',
    Parameter: '',
    'Information zum Parameter:': '',
    Wert: 0.19,
    Einheit: 'kg TM · (kg TMHep + kg TMNep)-1',
    Bezeichnung: 'αWR, Erbs',
    Kurzzitat: '',
    Langzitat:
      'IPCC (2006): IPCC Guidelines for National Greenhouse Gas Inventories. Volume 4, Agriculture, Forestry and Other Land Use. Hayama, Japan, Intergovernmental Panel on Climate Change, https://www.ipcc-nggip.iges.or.jp/public/2006gl/vol4.html, access 12.02.2019',
  },
  'crop.peasDryFodder.supplySeed': {
    id: 'crop.peasDryFodder.supplySeed',
    Produktionsrichtung: 'Saatgut',
    Emissionsquelle: '',
    Beschreibung: 'Erbsensaatgut mit 87 % TM konventionell herstellen',
    Parameter: 'Treibhausgas-Emissionsfaktor',
    'Information zum Parameter:':
      'aus Ecoinvent v3.1, Aktivitätsdatensatz "pea seed production, for sowing, RoW", Allokationsmethode "ecoinvent default"',
    Wert: 0.504,
    Einheit: 'kg CO2e · (kg FM)-1',
    Bezeichnung: 'EFCO2e, Stgt, Erbs',
    Kurzzitat: 'Weidema et al. (2013)',
    Langzitat:
      'Eigentümer dieses Parameters ist Ecoinvent Weidema, B. P. et al. (2013): The ecoinvent database: Overview and methodology, Data quality guideline for the ecoinvent database version 3, www.ecoinvent.org',
  },
  'crop.peasDryFodder.thousandGrainWeight': {
    id: 'crop.peasDryFodder.thousandGrainWeight',
    Produktionsrichtung: 'Saatgut',
    Emissionsquelle: '',
    Beschreibung: 'Tausendkornmasse Futtererbse',
    Parameter: '',
    'Information zum Parameter:': '',
    Wert: 200,
    Einheit: 'g · (1000 Körner)-1',
    Bezeichnung: 'TKG, Erbs',
    Kurzzitat: '',
    Langzitat: 'Direkte Beobachtung',
  },
  'crop.grainMaize.rootProportion': {
    id: 'crop.grainMaize.rootProportion',
    Produktionsrichtung: 'Ernte- und Wurzelrückstände',
    Emissionsquelle: '',
    Beschreibung: 'Wurzelrückstand zu Haupt- und Nebenernteprodukte, Mais',
    Parameter: 'Proportionalitätsfaktor',
    'Information zum Parameter:': 'siehe auch BEK-Handbuch, S. 34',
    Wert: 0.22,
    Einheit: 'kg TM · (kg TMHep + kg TMNep)-1',
    Bezeichnung: 'αWR, Ms',
    Kurzzitat: 'IPCC (2006), Table 11.2, S. 11.18',
    Langzitat:
      'IPCC (2006): IPCC Guidelines for National Greenhouse Gas Inventories. Volume 4, Agriculture, Forestry and Other Land Use. Hayama, Japan, Intergovernmental Panel on Climate Change, https://www.ipcc-nggip.iges.or.jp/public/2006gl/vol4.html, access 12.02.2019',
  },
  'crop.grainMaize.nContentRoot': {
    id: 'crop.grainMaize.nContentRoot',
    Produktionsrichtung: 'Ernte- und Wurzelrückstände',
    Emissionsquelle: '',
    Beschreibung: 'Wurzelrückstand, Mais',
    Parameter: 'Stickstoffgehalt',
    'Information zum Parameter:': 'siehe auch BEK-Handbuch, S. 34',
    Wert: 0.007,
    Einheit: 'kg N · (kg TM)-1',
    Bezeichnung: 'xN, WR, Ms',
    Kurzzitat: 'IPCC (2006), Table 11.2, S. 11.18',
    Langzitat:
      'IPCC (2006): IPCC Guidelines for National Greenhouse Gas Inventories. Volume 4, Agriculture, Forestry and Other Land Use. Hayama, Japan, Intergovernmental Panel on Climate Change, https://www.ipcc-nggip.iges.or.jp/public/2006gl/vol4.html, access 12.02.2019',
  },
  'crop.grainMaize.supplySeed': {
    id: 'crop.grainMaize.supplySeed',
    Produktionsrichtung: 'Saatgut',
    Emissionsquelle: '',
    Beschreibung: 'Maissaatgut mit 88 % TM konventionell herstellen',
    Parameter: 'Treibhausgas-Emissionsfaktor',
    'Information zum Parameter:':
      'aus Ecoinvent v3.1, Aktivitätsdatensatz "maize seed production, for sowing, GLO", Allokationsmethode "ecoinvent default"',
    Wert: 2.136,
    Einheit: 'kg CO2e · (kg FM)-1',
    Bezeichnung: 'EFCO2e, Stgt, Ms',
    Kurzzitat: 'Weidema et al. (2013)',
    Langzitat:
      'Eigentümer dieses Parameters ist Ecoinvent Weidema, B. P. et al. (2013): The ecoinvent database: Overview and methodology, Data quality guideline for the ecoinvent database version 3, www.ecoinvent.org',
  },
  'crop.grainMaize.dryMatterContent': {
    id: 'crop.grainMaize.dryMatterContent',
    Produktionsrichtung: 'Trockenmassegehalt, Hauptprodukt',
    Emissionsquelle: '',
    Beschreibung: 'Trockenmassgehalt, Haptprodukt, Körnermais',
    Parameter: '',
    'Information zum Parameter:': '',
    Wert: 0.86,
    Einheit: 'kg TM · (kg FM)-1',
    Bezeichnung: 'xTM, HP, Ms',
    Kurzzitat: 'DüV (2020), Anlage 7',
    Langzitat:
      'Verordnung über die Anwendung von Düngemitteln, Bodenhilfsstoffen, Kultursubstraten und Pflanzenhilfsmitteln nach den Grundsätzen der guten fachlichen Praxis beim Düngen 2 (Düngeverordnung - DüV) Anlage 7 (zu § 3 Absatz 2 und 6 und § 4 Absatz 3) Nährstoffgehalte pflanzlicher Erzeugnisse',
  },
  'crop.grainMaize.MPBR': {
    id: 'crop.grainMaize.MPBR',
    Produktionsrichtung: 'Nebenprodukt',
    Emissionsquelle: '',
    Beschreibung: 'Haupternteprodukt-Nebenernteprodukt-Verhältnis Körnermais',
    Parameter: 'Haupternteprodukt-Nebenernteprodukt-Verhältnis Körnermais',
    'Information zum Parameter:':
      'Haupternteprodukt-Nebenernteprodukt-Verhältnis; Ertragsindex',
    Wert: 1,
    Einheit: 'kg NP · (kg HP)-1',
    Bezeichnung: 'HNV, Ms',
    Kurzzitat: 'DüV (2020), Anlage 7',
    Langzitat:
      'Verordnung über die Anwendung von Düngemitteln, Bodenhilfsstoffen, Kultursubstraten und Pflanzenhilfsmitteln nach den Grundsätzen der guten fachlichen Praxis beim Düngen 2 (Düngeverordnung - DüV) Anlage 7 (zu § 3 Absatz 2 und 6 und § 4 Absatz 3) Nährstoffgehalte pflanzlicher Erzeugnisse',
  },
  'crop.grainMaize.dryMatterContentByproduct': {
    id: 'crop.grainMaize.dryMatterContentByproduct',
    Produktionsrichtung: 'Nebenprodukt',
    Emissionsquelle: '',
    Beschreibung: 'Trockenmassegehalt, Nebenprodukt Körnermais',
    Parameter: 'Trockenmassegehalt, Nebenprodukt Körnermais',
    'Information zum Parameter:': 'Trochenmassegehalt, Nebenprodukt',
    Wert: 0.86,
    Einheit: 'kg TM · (kg FM)-1',
    Bezeichnung: 'xTM, NP, Ms',
    Kurzzitat: '',
    Langzitat:
      'Verordnung über die Anwendung von Düngemitteln, Bodenhilfsstoffen, Kultursubstraten und Pflanzenhilfsmitteln nach den Grundsätzen der guten fachlichen Praxis beim Düngen 2 (Düngeverordnung - DüV) Anlage 7 (zu § 3 Absatz 2 und 6 und § 4 Absatz 3) Nährstoffgehalte pflanzlicher Erzeugnisse',
  },
  'crop.grainMaize.p2o5ByproductFm': {
    id: 'crop.grainMaize.p2o5ByproductFm',
    Produktionsrichtung: 'Nebenprodukt',
    Emissionsquelle: '',
    Beschreibung: 'P2O5 Gehalt, Nebenprodukt, Körnermais',
    Parameter: 'P2O5 Gehalt, Nebenprodukt, Körnermais',
    'Information zum Parameter:': 'P2O5 Gehalt, Nebenprodukt, Körnermais',
    Wert: 0.002,
    Einheit: 'kg P2O5 · (kg FM)-1',
    Bezeichnung: 'xP2O5, Sek, Ms',
    Kurzzitat: '',
    Langzitat:
      'Verordnung über die Anwendung von Düngemitteln, Bodenhilfsstoffen, Kultursubstraten und Pflanzenhilfsmitteln nach den Grundsätzen der guten fachlichen Praxis beim Düngen 2 (Düngeverordnung - DüV) Anlage 7 (zu § 3 Absatz 2 und 6 und § 4 Absatz 3) Nährstoffgehalte pflanzlicher Erzeugnisse',
  },
  'crop.grainMaize.k2oByproductFm': {
    id: 'crop.grainMaize.k2oByproductFm',
    Produktionsrichtung: 'Nebenprodukt',
    Emissionsquelle: '',
    Beschreibung: 'K2O Gehalt, Nebenprodukt, Körnermais',
    Parameter: 'K2O Gehalt, Nebenprodukt, Körnermais',
    'Information zum Parameter:': 'K2O Gehalt, Nebenprodukt, Körnermais',
    Wert: 0.02,
    Einheit: 'kg K2O · (kg FM)-1',
    Bezeichnung: 'xK2O, Sek, Ms',
    Kurzzitat: '',
    Langzitat:
      'https://www.lfl.bayern.de/mam/cms07/iab/dateien/basisdaten22_tabelle_1a_20211210.pdf',
  },
  'crop.grainMaize.humusMain': {
    id: 'crop.grainMaize.humusMain',
    Produktionsrichtung: 'Humus-C',
    Emissionsquelle: '',
    Beschreibung: 'Humusauswirkung durch den Anbau von Körnermais',
    Parameter: '',
    'Information zum Parameter:': '',
    Wert: -800,
    Einheit: 'kg Humus-C/ha',
    Bezeichnung: 'Humus-C, MP, Ms',
    Kurzzitat: '',
    Langzitat: 'VDLUFA-Methodenbuch',
  },
  'crop.grainMaize.piecesToKg': {
    id: 'crop.grainMaize.piecesToKg',
    Produktionsrichtung: 'Saatgut',
    Emissionsquelle: '',
    Beschreibung: 'Umrechnung von der Einheit Sack Saatgut in kg',
    Parameter: 'U zu kg',
    'Information zum Parameter:': 'U zu kg',
    Wert: 15,
    Einheit: 'kg · ( U )-1',
    Bezeichnung: 'Ukg, Ms',
    Kurzzitat: '',
    Langzitat: 'Direkte Beobachtung',
  },
  'crop.grainMaize.thousandGrainWeight': {
    id: 'crop.grainMaize.thousandGrainWeight',
    Produktionsrichtung: 'Saatgut',
    Emissionsquelle: '',
    Beschreibung: 'Tausendkornmasse Körnermais',
    Parameter: 'Tausendkornmasse Körnermais',
    'Information zum Parameter:': 'Tausendkornmasse Körnermais',
    Wert: 325,
    Einheit: 'g · (1000  Körner)-1',
    Bezeichnung: 'TKG, Mais',
    Kurzzitat: '',
    Langzitat: 'Direkte Beobachtung',
  },
  'crop.grainMaize.nByproductFm': {
    id: 'crop.grainMaize.nByproductFm',
    Produktionsrichtung: 'Ernte- und Wurzelrückstände',
    Emissionsquelle: '',
    Beschreibung: 'Stickstoffgehalt, Nebenprodukt, Mais',
    Parameter: 'Stickstoffgehalt',
    'Information zum Parameter:': '',
    Wert: 0.009,
    Einheit: 'kg N · (kg FM)-1',
    Bezeichnung: 'xN, NWR, Ms',
    Kurzzitat: 'DüV (2020), Anlage 7',
    Langzitat:
      'Verordnung über die Anwendung von Düngemitteln, Bodenhilfsstoffen, Kultursubstraten und Pflanzenhilfsmitteln nach den Grundsätzen der guten fachlichen Praxis beim Düngen 2 (Düngeverordnung - DüV) Anlage 7 (zu § 3 Absatz 2 und 6 und § 4 Absatz 3) Nährstoffgehalte pflanzlicher Erzeugnisse',
  },
  'crop.hardWheat.rootProportion': {
    id: 'crop.hardWheat.rootProportion',
    Produktionsrichtung: 'Ernte- und Wurzelrückstände',
    Emissionsquelle: '',
    Beschreibung:
      'Wurzelrückstand zu Haupt- und Nebenernteprodukte, Hartweizen',
    Parameter: 'Proportionalitätsfaktor',
    'Information zum Parameter:': 'siehe auch BEK-Handbuch, S. 34',
    Wert: 0.23,
    Einheit: 'kg TM · (kg TMHep + kg TMNep)-1',
    Bezeichnung: 'αWR, Hwzn',
    Kurzzitat: 'Gleich wie Winterweizen',
    Langzitat: 'Gleich wie Winterweizen',
  },
  'crop.hardWheat.nContentRoot': {
    id: 'crop.hardWheat.nContentRoot',
    Produktionsrichtung: 'Ernte- und Wurzelrückstände',
    Emissionsquelle: '',
    Beschreibung: 'Wurzelrückstand, Hartweizen',
    Parameter: 'Stickstoffgehalt',
    'Information zum Parameter:': 'siehe auch BEK-Handbuch, S. 34',
    Wert: 0.009,
    Einheit: 'kg N · (kg TM)-1',
    Bezeichnung: 'xN, WR, Hwzn',
    Kurzzitat: 'Gleich wie Winterweizen',
    Langzitat: 'Gleich wie Winterweizen',
  },
  'crop.hardWheat.supplySeed': {
    id: 'crop.hardWheat.supplySeed',
    Produktionsrichtung: 'Saatgut',
    Emissionsquelle: '',
    Beschreibung: 'Weizensaatgut mit 85 % TM konventionell herstellen',
    Parameter: 'Treibhausgas-Emissionsfaktor',
    'Information zum Parameter:':
      'aus Ecoinvent v3.1, Aktivitätsdatensatz "wheat seed production, for sowing, GLO", Allokationsmethode "ecoinvent default"',
    Wert: 0.89,
    Einheit: 'kg CO2e · (kg FM)-1',
    Bezeichnung: 'EFCO2e, Stgt, Hwzn',
    Kurzzitat: 'Gleich wie Winterweizen',
    Langzitat: 'Gleich wie Winterweizen',
  },
  'crop.hardWheat.nByproductFm': {
    id: 'crop.hardWheat.nByproductFm',
    Produktionsrichtung: 'Ernte- und Wurzelrückstände',
    Emissionsquelle: '',
    Beschreibung: 'Stickstoffgehalt, Nebenprodukt, Hartweizen',
    Parameter: 'Stickstoffgehalt',
    'Information zum Parameter:': '',
    Wert: 0.006,
    Einheit: 'kg N · (kg FM)-1',
    Bezeichnung: 'xN, NWR, Hwzn',
    Kurzzitat: 'Gleich wie Winterweizen',
    Langzitat: 'Gleich wie Winterweizen',
  },
  'crop.hardWheat.dryMatterContent': {
    id: 'crop.hardWheat.dryMatterContent',
    Produktionsrichtung: 'Trockenmassegehalt, Hauptprodukt',
    Emissionsquelle: '',
    Beschreibung: 'Trockenmassgehalt, Haptprodukt, Hartweizen',
    Parameter: '',
    'Information zum Parameter:': '',
    Wert: 0.86,
    Einheit: 'kg TM · (kg FM)-1',
    Bezeichnung: 'xTM, HP, Hwzn',
    Kurzzitat: 'Gleich wie Winterweizen',
    Langzitat: 'Gleich wie Winterweizen',
  },
  'crop.hardWheat.MPBR': {
    id: 'crop.hardWheat.MPBR',
    Produktionsrichtung: 'Nebenprodukt',
    Emissionsquelle: '',
    Beschreibung: 'Haupternteprodukt-Nebenernteprodukt-Verhältnis Hartweizen',
    Parameter: 'Haupternteprodukt-Nebenernteprodukt-Verhältnis Hartweizen',
    'Information zum Parameter:':
      'Haupternteprodukt-Nebenernteprodukt-Verhältnis; Ertragsindex',
    Wert: 0.8,
    Einheit: 'kg NP · (kg HP)-1',
    Bezeichnung: 'HNV, Hwzn',
    Kurzzitat: 'Gleich wie Winterweizen',
    Langzitat: 'Gleich wie Winterweizen',
  },
  'crop.hardWheat.p2o5ByproductFm': {
    id: 'crop.hardWheat.p2o5ByproductFm',
    Produktionsrichtung: 'Nebenprodukt',
    Emissionsquelle: '',
    Beschreibung: 'P2O5 Gehalt, Nebenprodukt, Hartweizen',
    Parameter: 'P2O5 Gehalt, Nebenprodukt, Hartweizen',
    'Information zum Parameter:': 'P2O5 Gehalt, Nebenprodukt, Hartweizen',
    Wert: 0.003,
    Einheit: 'kg P2O5 · (kg FM)-1',
    Bezeichnung: 'xP2O5, Sek, Hwzn',
    Kurzzitat: 'Gleich wie Winterweizen',
    Langzitat: 'Gleich wie Winterweizen',
  },
  'crop.hardWheat.k2oByproductFm': {
    id: 'crop.hardWheat.k2oByproductFm',
    Produktionsrichtung: 'Nebenprodukt',
    Emissionsquelle: '',
    Beschreibung: 'K2O Gehalt, Nebenprodukt, Hartweizen',
    Parameter: 'K2O Gehalt, Nebenprodukt, Hartweizen',
    'Information zum Parameter:': 'K2O Gehalt, Nebenprodukt, Hartweizen',
    Wert: 0.014,
    Einheit: 'kg K2O · (kg FM)-1',
    Bezeichnung: 'xK2O, Sek, Hwzn',
    Kurzzitat: 'Gleich wie Winterweizen',
    Langzitat: 'Gleich wie Winterweizen',
  },
  'crop.hardWheat.humusMain': {
    id: 'crop.hardWheat.humusMain',
    Produktionsrichtung: 'Humus-C',
    Emissionsquelle: '',
    Beschreibung: 'Humusauswirkung durch den Anbau von Hartweizen',
    Parameter: '',
    'Information zum Parameter:': '',
    Wert: -400,
    Einheit: 'kg Humus-C/ha',
    Bezeichnung: 'Humus-C, MP, Hwzn',
    Kurzzitat: 'Gleich wie Winterweizen',
    Langzitat: 'Gleich wie Winterweizen',
  },
  'crop.hardWheat.piecesToKg': {
    id: 'crop.hardWheat.piecesToKg',
    Produktionsrichtung: 'Saatgut',
    Emissionsquelle: '',
    Beschreibung: 'Umrechnung von der Einheit Sack Saatgut in kg',
    Parameter: 'U zu kg',
    'Information zum Parameter:': 'U zu kg',
    Wert: 1,
    Einheit: 'kg · ( U )-1',
    Bezeichnung: 'Ukg, Hwzn',
    Kurzzitat: 'Gleich wie Winterweizen',
    Langzitat: 'Gleich wie Winterweizen',
  },
  'crop.soybeanBeans.dryMatterContent': {
    id: 'crop.soybeanBeans.dryMatterContent',
    Produktionsrichtung: 'Trockenmassegehalt, Hauptprodukt',
    Emissionsquelle: '',
    Beschreibung: 'Trockenmassgehalt, Haptprodukt, Sojabohnen',
    Parameter: '',
    'Information zum Parameter:': '',
    Wert: 0.86,
    Einheit: 'kg TM · (kg FM)-1',
    Bezeichnung: 'xTM, HP, Sja',
    Kurzzitat: '',
    Langzitat:
      'Verordnung über die Anwendung von Düngemitteln, Bodenhilfsstoffen, Kultursubstraten und Pflanzenhilfsmitteln nach den Grundsätzen der guten fachlichen Praxis beim Düngen 2 (Düngeverordnung - DüV) Anlage 7 (zu § 3 Absatz 2 und 6 und § 4 Absatz 3) Nährstoffgehalte pflanzlicher Erzeugnisse',
  },
  'crop.soybeanBeans.dryMatterContentByproduct': {
    id: 'crop.soybeanBeans.dryMatterContentByproduct',
    Produktionsrichtung: 'Nebenprodukt',
    Emissionsquelle: '',
    Beschreibung: 'Trockenmassegehalt, Nebenprodukt, Sojabohnen',
    Parameter: '',
    'Information zum Parameter:': '',
    Wert: 0.86,
    Einheit: 'kg TM · (kg FM)-1',
    Bezeichnung: 'xTM,NP, Sja',
    Kurzzitat: '',
    Langzitat:
      'Verordnung über die Anwendung von Düngemitteln, Bodenhilfsstoffen, Kultursubstraten und Pflanzenhilfsmitteln nach den Grundsätzen der guten fachlichen Praxis beim Düngen 2 (Düngeverordnung - DüV) Anlage 7 (zu § 3 Absatz 2 und 6 und § 4 Absatz 3) Nährstoffgehalte pflanzlicher Erzeugnisse',
  },
  'crop.soybeanBeans.humusMain': {
    id: 'crop.soybeanBeans.humusMain',
    Produktionsrichtung: 'Humus-C',
    Emissionsquelle: '',
    Beschreibung: 'Humusauswirkung durch den Anbau von Sojabohnen',
    Parameter: '',
    'Information zum Parameter:': '',
    Wert: 160,
    Einheit: 'kg Humus-C/ha',
    Bezeichnung: 'Humus-C, MP, Sja',
    Kurzzitat: '',
    Langzitat: 'VDLUFA-Methodenbuch',
  },
  'crop.soybeanBeans.k2oByproductFm': {
    id: 'crop.soybeanBeans.k2oByproductFm',
    Produktionsrichtung: 'Nebenprodukt',
    Emissionsquelle: '',
    Beschreibung: 'K2O Gehalt, Nebenprodukt, Sojabohnen',
    Parameter: '',
    'Information zum Parameter:': '',
    Wert: 0.04,
    Einheit: 'kg K2O · (kg FM)-1',
    Bezeichnung: 'xK2O, Sek, Sja',
    Kurzzitat: '',
    Langzitat:
      'https://www.lfl.bayern.de/mam/cms07/iab/dateien/basisdaten22_tabelle_1a_20211210.pdf',
  },
  'crop.soybeanBeans.MPBR': {
    id: 'crop.soybeanBeans.MPBR',
    Produktionsrichtung: 'Nebenprodukt',
    Emissionsquelle: '',
    Beschreibung: 'Haupternteprodukt-Nebenernteprodukt-Verhältnis Sojabohnen',
    Parameter: '',
    'Information zum Parameter:': '',
    Wert: 1,
    Einheit: 'kg NP · (kg HP)-1',
    Bezeichnung: 'HNV, Sja',
    Kurzzitat: '',
    Langzitat:
      'Verordnung über die Anwendung von Düngemitteln, Bodenhilfsstoffen, Kultursubstraten und Pflanzenhilfsmitteln nach den Grundsätzen der guten fachlichen Praxis beim Düngen 2 (Düngeverordnung - DüV) Anlage 7 (zu § 3 Absatz 2 und 6 und § 4 Absatz 3) Nährstoffgehalte pflanzlicher Erzeugnisse',
  },
  'crop.soybeanBeans.nByproductFm': {
    id: 'crop.soybeanBeans.nByproductFm',
    Produktionsrichtung: 'Ernte- und Wurzelrückstände',
    Emissionsquelle: '',
    Beschreibung: 'Stickstoffgehalt, Nebenprodukt, Sojabohnen',
    Parameter: '',
    'Information zum Parameter:': '',
    Wert: 0.007,
    Einheit: 'kg N · (kg FM)-1',
    Bezeichnung: 'xN, NWR, Sja',
    Kurzzitat: '',
    Langzitat:
      'Verordnung über die Anwendung von Düngemitteln, Bodenhilfsstoffen, Kultursubstraten und Pflanzenhilfsmitteln nach den Grundsätzen der guten fachlichen Praxis beim Düngen 2 (Düngeverordnung - DüV) Anlage 7 (zu § 3 Absatz 2 und 6 und § 4 Absatz 3) Nährstoffgehalte pflanzlicher Erzeugnisse',
  },
  'crop.soybeanBeans.nContentRoot': {
    id: 'crop.soybeanBeans.nContentRoot',
    Produktionsrichtung: 'Ernte- und Wurzelrückstände',
    Emissionsquelle: '',
    Beschreibung: 'Wurzelrückstand, Sojabohnen',
    Parameter: '',
    'Information zum Parameter:': '',
    Wert: 0.008,
    Einheit: 'kg N · (kg TM)-1',
    Bezeichnung: 'xN, WR, Sja',
    Kurzzitat: '',
    Langzitat:
      'IPCC (2006): IPCC Guidelines for National Greenhouse Gas Inventories. Volume 4, Agriculture, Forestry and Other Land Use. Hayama, Japan, Intergovernmental Panel on Climate Change, https://www.ipcc-nggip.iges.or.jp/public/2006gl/vol4.html, access 12.02.2019',
  },
  'crop.soybeanBeans.p2o5ByproductFm': {
    id: 'crop.soybeanBeans.p2o5ByproductFm',
    Produktionsrichtung: 'Nebenprodukt',
    Emissionsquelle: '',
    Beschreibung: 'P2O5 Gehalt, Nebenprodukt, Sojabohnen',
    Parameter: '',
    'Information zum Parameter:': '',
    Wert: 0.003,
    Einheit: 'kg P2O5 · (kg FM)-1',
    Bezeichnung: 'xP2O5, Sek, Sja',
    Kurzzitat: '',
    Langzitat:
      'Verordnung über die Anwendung von Düngemitteln, Bodenhilfsstoffen, Kultursubstraten und Pflanzenhilfsmitteln nach den Grundsätzen der guten fachlichen Praxis beim Düngen 2 (Düngeverordnung - DüV) Anlage 7 (zu § 3 Absatz 2 und 6 und § 4 Absatz 3) Nährstoffgehalte pflanzlicher Erzeugnisse',
  },
  'crop.soybeanBeans.piecesToKg': {
    id: 'crop.soybeanBeans.piecesToKg',
    Produktionsrichtung: 'Saatgut',
    Emissionsquelle: '',
    Beschreibung: 'Umrechnung von der Einheit Sack Saatgut in kg',
    Parameter: '',
    'Information zum Parameter:': '',
    Wert: 18,
    Einheit: 'kg · ( U )-1',
    Bezeichnung: 'Ukg, Sja',
    Kurzzitat: '',
    Langzitat: 'Direkte Beobachtung',
  },
  'crop.soybeanBeans.rootProportion': {
    id: 'crop.soybeanBeans.rootProportion',
    Produktionsrichtung: 'Ernte- und Wurzelrückstände',
    Emissionsquelle: '',
    Beschreibung:
      'Wurzelrückstand zu Haupt- und Nebenernteprodukte, Sojabohnen',
    Parameter: '',
    'Information zum Parameter:': '',
    Wert: 0.19,
    Einheit: 'kg TM · (kg TMHep + kg TMNep)-1',
    Bezeichnung: 'αWR, Sja',
    Kurzzitat: '',
    Langzitat:
      'IPCC (2006): IPCC Guidelines for National Greenhouse Gas Inventories. Volume 4, Agriculture, Forestry and Other Land Use. Hayama, Japan, Intergovernmental Panel on Climate Change, https://www.ipcc-nggip.iges.or.jp/public/2006gl/vol4.html, access 12.02.2019',
  },
  'crop.soybeanBeans.supplySeed': {
    id: 'crop.soybeanBeans.supplySeed',
    Produktionsrichtung: 'Saatgut',
    Emissionsquelle: '',
    Beschreibung: 'Sojabohnensaatgut mit 89 % TM konventionell herstellen',
    Parameter: 'Treibhausgas-Emissionsfaktor',
    'Information zum Parameter:':
      'aus Ecoinvent v3.1, Aktivitätsdatensatz "soybean seed production, for sowing, RoW", Allokationsmethode "ecoinvent default"',
    Wert: 1.86,
    Einheit: 'kg CO2e · (kg FM)-1',
    Bezeichnung: 'EFCO2e, Stgt, Sja',
    Kurzzitat: 'Weidema et al. (2013)',
    Langzitat:
      'Eigentümer dieses Parameters ist Ecoinvent Weidema, B. P. et al. (2013): The ecoinvent database: Overview and methodology, Data quality guideline for the ecoinvent database version 3, www.ecoinvent.org',
  },
  'crop.soybeanBeans.thousandGrainWeight': {
    id: 'crop.soybeanBeans.thousandGrainWeight',
    Produktionsrichtung: 'Saatgut',
    Emissionsquelle: '',
    Beschreibung: 'Tausendkornmasse Sojabohnen',
    Parameter: '',
    'Information zum Parameter:': '',
    Wert: 120,
    Einheit: 'g · (1000 Körner)-1',
    Bezeichnung: 'TKG, Sja',
    Kurzzitat: '',
    Langzitat: 'Direkte Beobachtung',
  },
  'crop.broadBeans.dryMatterContent': {
    id: 'crop.broadBeans.dryMatterContent',
    Produktionsrichtung: 'Trockenmassegehalt, Hauptprodukt',
    Emissionsquelle: '',
    Beschreibung: 'Trockenmassgehalt, Haptprodukt, Ackerbohnen',
    Parameter: '',
    'Information zum Parameter:': '',
    Wert: 0.86,
    Einheit: 'kg TM · (kg FM)-1',
    Bezeichnung: 'xTM, HP, Abhn',
    Kurzzitat: '',
    Langzitat:
      'Verordnung über die Anwendung von Düngemitteln, Bodenhilfsstoffen, Kultursubstraten und Pflanzenhilfsmitteln nach den Grundsätzen der guten fachlichen Praxis beim Düngen 2 (Düngeverordnung - DüV) Anlage 7 (zu § 3 Absatz 2 und 6 und § 4 Absatz 3) Nährstoffgehalte pflanzlicher Erzeugnisse',
  },
  'crop.broadBeans.dryMatterContentByproduct': {
    id: 'crop.broadBeans.dryMatterContentByproduct',
    Produktionsrichtung: 'Nebenprodukt',
    Emissionsquelle: '',
    Beschreibung: 'Trockenmassegehalt, Nebenprodukt, Ackerbohnen',
    Parameter: '',
    'Information zum Parameter:': '',
    Wert: 0.86,
    Einheit: 'kg TM · (kg FM)-1',
    Bezeichnung: 'xTM,NP, Abhn',
    Kurzzitat: '',
    Langzitat:
      'Verordnung über die Anwendung von Düngemitteln, Bodenhilfsstoffen, Kultursubstraten und Pflanzenhilfsmitteln nach den Grundsätzen der guten fachlichen Praxis beim Düngen 2 (Düngeverordnung - DüV) Anlage 7 (zu § 3 Absatz 2 und 6 und § 4 Absatz 3) Nährstoffgehalte pflanzlicher Erzeugnisse',
  },
  'crop.broadBeans.humusMain': {
    id: 'crop.broadBeans.humusMain',
    Produktionsrichtung: 'Humus-C',
    Emissionsquelle: '',
    Beschreibung: 'Humusauswirkung durch den Anbau von Ackerbohnen',
    Parameter: '',
    'Information zum Parameter:': '',
    Wert: 160,
    Einheit: 'kg Humus-C/ha',
    Bezeichnung: 'Humus-C, MP, Abhn',
    Kurzzitat: '',
    Langzitat: 'VDLUFA-Methodenbuch',
  },
  'crop.broadBeans.k2oByproductFm': {
    id: 'crop.broadBeans.k2oByproductFm',
    Produktionsrichtung: 'Nebenprodukt',
    Emissionsquelle: '',
    Beschreibung: 'K2O Gehalt, Nebenprodukt, Ackerbohnen',
    Parameter: '',
    'Information zum Parameter:': '',
    Wert: 0.026,
    Einheit: 'kg K2O · (kg FM)-1',
    Bezeichnung: 'xK2O, Sek, Abhn',
    Kurzzitat: '',
    Langzitat:
      'https://www.lfl.bayern.de/mam/cms07/iab/dateien/basisdaten22_tabelle_1a_20211210.pdf',
  },
  'crop.broadBeans.MPBR': {
    id: 'crop.broadBeans.MPBR',
    Produktionsrichtung: 'Nebenprodukt',
    Emissionsquelle: '',
    Beschreibung: 'Haupternteprodukt-Nebenernteprodukt-Verhältnis Ackerbohnen',
    Parameter: '',
    'Information zum Parameter:': '',
    Wert: 1,
    Einheit: 'kg NP · (kg HP)-1',
    Bezeichnung: 'HNV, Abhn',
    Kurzzitat: '',
    Langzitat:
      'Verordnung über die Anwendung von Düngemitteln, Bodenhilfsstoffen, Kultursubstraten und Pflanzenhilfsmitteln nach den Grundsätzen der guten fachlichen Praxis beim Düngen 2 (Düngeverordnung - DüV) Anlage 7 (zu § 3 Absatz 2 und 6 und § 4 Absatz 3) Nährstoffgehalte pflanzlicher Erzeugnisse',
  },
  'crop.broadBeans.nByproductFm': {
    id: 'crop.broadBeans.nByproductFm',
    Produktionsrichtung: 'Ernte- und Wurzelrückstände',
    Emissionsquelle: '',
    Beschreibung: 'Stickstoffgehalt, Nebenprodukt, Ackerbohnen',
    Parameter: '',
    'Information zum Parameter:': '',
    Wert: 0.015,
    Einheit: 'kg N · (kg FM)-1',
    Bezeichnung: 'xN, NWR, Abhn',
    Kurzzitat: '',
    Langzitat:
      'Verordnung über die Anwendung von Düngemitteln, Bodenhilfsstoffen, Kultursubstraten und Pflanzenhilfsmitteln nach den Grundsätzen der guten fachlichen Praxis beim Düngen 2 (Düngeverordnung - DüV) Anlage 7 (zu § 3 Absatz 2 und 6 und § 4 Absatz 3) Nährstoffgehalte pflanzlicher Erzeugnisse',
  },
  'crop.broadBeans.nContentRoot': {
    id: 'crop.broadBeans.nContentRoot',
    Produktionsrichtung: 'Ernte- und Wurzelrückstände',
    Emissionsquelle: '',
    Beschreibung: 'Wurzelrückstand, Ackerbohnen',
    Parameter:
      'https://www.ipcc-nggip.iges.or.jp/public/2006gl/pdf/4_Volume4/V4_11_Ch11_N2O&CO2.pdf',
    'Information zum Parameter:': '',
    Wert: 0.008,
    Einheit: 'kg N · (kg TM)-1',
    Bezeichnung: 'xN, WR, Abhn',
    Kurzzitat: '',
    Langzitat:
      'IPCC (2006): IPCC Guidelines for National Greenhouse Gas Inventories. Volume 4, Agriculture, Forestry and Other Land Use. Hayama, Japan, Intergovernmental Panel on Climate Change, https://www.ipcc-nggip.iges.or.jp/public/2006gl/vol4.html, access 12.02.2019',
  },
  'crop.broadBeans.p2o5ByproductFm': {
    id: 'crop.broadBeans.p2o5ByproductFm',
    Produktionsrichtung: 'Nebenprodukt',
    Emissionsquelle: '',
    Beschreibung: 'P2O5 Gehalt, Nebenprodukt, Ackerbohnen',
    Parameter: '',
    'Information zum Parameter:': '',
    Wert: 0.003,
    Einheit: 'kg P2O5 · (kg FM)-1',
    Bezeichnung: 'xP2O5, Sek, Abhn',
    Kurzzitat: '',
    Langzitat:
      'Verordnung über die Anwendung von Düngemitteln, Bodenhilfsstoffen, Kultursubstraten und Pflanzenhilfsmitteln nach den Grundsätzen der guten fachlichen Praxis beim Düngen 2 (Düngeverordnung - DüV) Anlage 7 (zu § 3 Absatz 2 und 6 und § 4 Absatz 3) Nährstoffgehalte pflanzlicher Erzeugnisse',
  },
  'crop.broadBeans.piecesToKg': {
    id: 'crop.broadBeans.piecesToKg',
    Produktionsrichtung: 'Saatgut',
    Emissionsquelle: '',
    Beschreibung: 'Umrechnung von der Einheit Sack Saatgut in kg',
    Parameter: '',
    'Information zum Parameter:': '',
    Wert: 19,
    Einheit: 'kg · ( U )-1',
    Bezeichnung: 'Ukg, Abhn',
    Kurzzitat: '',
    Langzitat: 'Direkte Beobachtung',
  },
  'crop.broadBeans.rootProportion': {
    id: 'crop.broadBeans.rootProportion',
    Produktionsrichtung: 'Ernte- und Wurzelrückstände',
    Emissionsquelle: '',
    Beschreibung:
      'Wurzelrückstand zu Haupt- und Nebenernteprodukte, Ackerbohnen',
    Parameter: '',
    'Information zum Parameter:': '',
    Wert: 0.19,
    Einheit: 'kg TM · (kg TMHep + kg TMNep)-1',
    Bezeichnung: 'αWR, Abhn',
    Kurzzitat: '',
    Langzitat:
      'IPCC (2006): IPCC Guidelines for National Greenhouse Gas Inventories. Volume 4, Agriculture, Forestry and Other Land Use. Hayama, Japan, Intergovernmental Panel on Climate Change, https://www.ipcc-nggip.iges.or.jp/public/2006gl/vol4.html, access 12.02.2019',
  },
  'crop.broadBeans.supplySeed': {
    id: 'crop.broadBeans.supplySeed',
    Produktionsrichtung: 'Saatgut',
    Emissionsquelle: '',
    Beschreibung: 'Ackerbohnensaatgut mit 87 % TM konventionell herstellen',
    Parameter: 'Treibhausgas-Emissionsfaktor',
    'Information zum Parameter:':
      'aus Ecoinvent v3.1, Aktivitätsdatensatz "fava bean seeed production, for sowing, RoW", Allokationsmethode "ecoinvent default"',
    Wert: 0.648,
    Einheit: 'kg CO2e · (kg FM)-1',
    Bezeichnung: 'EFCO2e, Stgt, Abhn',
    Kurzzitat: 'Weidema et al. (2013)',
    Langzitat:
      'Eigentümer dieses Parameters ist Ecoinvent Weidema, B. P. et al. (2013): The ecoinvent database: Overview and methodology, Data quality guideline for the ecoinvent database version 3, www.ecoinvent.org',
  },
  'crop.broadBeans.thousandGrainWeight': {
    id: 'crop.broadBeans.thousandGrainWeight',
    Produktionsrichtung: 'Saatgut',
    Emissionsquelle: '',
    Beschreibung: 'Tausendkornmasse Ackerbohnen',
    Parameter: '',
    'Information zum Parameter:': '',
    Wert: 380,
    Einheit: 'g · (1000 Körner)-1',
    Bezeichnung: 'TKG, Abhn',
    Kurzzitat: '',
    Langzitat: 'Direkte Beobachtung',
  },
  'crop.permanentGrasslandWiltedSilage.dryMatterContent': {
    id: 'crop.permanentGrasslandWiltedSilage.dryMatterContent',
    Produktionsrichtung: 'Trockenmassegehalt, Hauptprodukt',
    Emissionsquelle: '',
    Beschreibung: 'Trockenmassgehalt, Haptprodukt, Dauergrünland',
    Parameter: '',
    'Information zum Parameter:': '',
    Wert: 0.2,
    Einheit: 'kg TM · (kg FM)-1',
    Bezeichnung: 'xTM, HP, Dgl',
    Kurzzitat: '',
    Langzitat: '',
  },
  'crop.permanentGrasslandWiltedSilage.dryMatterContentByproduct': {
    id: 'crop.permanentGrasslandWiltedSilage.dryMatterContentByproduct',
    Produktionsrichtung: 'Nebenprodukt',
    Emissionsquelle: '',
    Beschreibung: 'Trockenmassegehalt, Nebenprodukt, Dauergrünland',
    Parameter: '',
    'Information zum Parameter:': '',
    Wert: 0,
    Einheit: 'kg TM · (kg FM)-1',
    Bezeichnung: 'xTM,NP, Dgl',
    Kurzzitat: '',
    Langzitat: 'Keine Nebenernteprodukte',
  },
  'crop.permanentGrasslandWiltedSilage.humusMain': {
    id: 'crop.permanentGrasslandWiltedSilage.humusMain',
    Produktionsrichtung: 'Humus-C',
    Emissionsquelle: '',
    Beschreibung: 'Humusauswirkung durch den Anbau von Dauergrünland',
    Parameter: '',
    'Information zum Parameter:': '',
    Wert: 600,
    Einheit: 'kg Humus-C/ha',
    Bezeichnung: 'Humus-C, MP, Dgl',
    Kurzzitat: '',
    Langzitat: '',
  },
  'crop.permanentGrasslandWiltedSilage.k2oByproductFm': {
    id: 'crop.permanentGrasslandWiltedSilage.k2oByproductFm',
    Produktionsrichtung: 'Nebenprodukt',
    Emissionsquelle: '',
    Beschreibung: 'K2O Gehalt, Nebenprodukt, Dauergrünland',
    Parameter: '',
    'Information zum Parameter:': '',
    Wert: 0,
    Einheit: 'kg K2O · (kg FM)-1',
    Bezeichnung: 'xK2O, Sek, Dgl',
    Kurzzitat: '',
    Langzitat: 'Keine Nebenernteprodukte',
  },
  'crop.permanentGrasslandWiltedSilage.MPBR': {
    id: 'crop.permanentGrasslandWiltedSilage.MPBR',
    Produktionsrichtung: 'Nebenprodukt',
    Emissionsquelle: '',
    Beschreibung:
      'Haupternteprodukt-Nebenernteprodukt-Verhältnis Dauergrünland',
    Parameter: '',
    'Information zum Parameter:': '',
    Wert: 0,
    Einheit: 'kg NP · (kg HP)-1',
    Bezeichnung: 'HNV, Dgl',
    Kurzzitat: '',
    Langzitat: 'Keine Nebenernteprodukte',
  },
  'crop.permanentGrasslandWiltedSilage.nByproductFm': {
    id: 'crop.permanentGrasslandWiltedSilage.nByproductFm',
    Produktionsrichtung: 'Ernte- und Wurzelrückstände',
    Emissionsquelle: '',
    Beschreibung: 'Stickstoffgehalt, Nebenprodukt, Dauergrünland',
    Parameter: '',
    'Information zum Parameter:': '',
    Wert: 0,
    Einheit: 'kg N · (kg FM)-1',
    Bezeichnung: 'xN, NWR, Dgl',
    Kurzzitat: '',
    Langzitat: 'Keine Nebenernteprodukte',
  },
  'crop.permanentGrasslandWiltedSilage.nContentRoot': {
    id: 'crop.permanentGrasslandWiltedSilage.nContentRoot',
    Produktionsrichtung: 'Ernte- und Wurzelrückstände',
    Emissionsquelle: '',
    Beschreibung: 'Wurzelrückstand, Dauergrünland',
    Parameter: '',
    'Information zum Parameter:': '',
    Wert: 0.012,
    Einheit: 'kg N · (kg TM)-1',
    Bezeichnung: 'xN, WR, Dgl',
    Kurzzitat: '',
    Langzitat: 'Keine Nebenernteprodukte',
  },
  'crop.permanentGrasslandWiltedSilage.p2o5ByproductFm': {
    id: 'crop.permanentGrasslandWiltedSilage.p2o5ByproductFm',
    Produktionsrichtung: 'Nebenprodukt',
    Emissionsquelle: '',
    Beschreibung: 'P2O5 Gehalt, Nebenprodukt, Dauergrünland',
    Parameter: '',
    'Information zum Parameter:': '',
    Wert: 0,
    Einheit: 'kg P2O5 · (kg FM)-1',
    Bezeichnung: 'xP2O5, Sek, Dgl',
    Kurzzitat: '',
    Langzitat: 'Keine Nebenernteprodukte',
  },
  'crop.permanentGrasslandWiltedSilage.piecesToKg': {
    id: 'crop.permanentGrasslandWiltedSilage.piecesToKg',
    Produktionsrichtung: 'Saatgut',
    Emissionsquelle: '',
    Beschreibung: 'Umrechnung von der Einheit Sack Saatgut in kg',
    Parameter: '',
    'Information zum Parameter:': '',
    Wert: 1,
    Einheit: 'kg · ( U )-1',
    Bezeichnung: 'Ukg, Dgl',
    Kurzzitat: '',
    Langzitat: '',
  },
  'crop.permanentGrasslandWiltedSilage.restsHumusBuildingPotential': {
    id: 'crop.permanentGrasslandWiltedSilage.restsHumusBuildingPotential',
    Produktionsrichtung: '',
    Emissionsquelle: '',
    Beschreibung: 'Keine Nebenernteprodukte',
    Parameter: '',
    'Information zum Parameter:': '',
    Wert: 0,
    Einheit: '',
    Bezeichnung: 'Keine Nebenernteprodukte',
    Kurzzitat: '',
    Langzitat: 'Keine Nebenernteprodukte',
  },
  'crop.permanentGrasslandWiltedSilage.rootProportion': {
    id: 'crop.permanentGrasslandWiltedSilage.rootProportion',
    Produktionsrichtung: 'Ernte- und Wurzelrückstände',
    Emissionsquelle: '',
    Beschreibung:
      'Wurzelrückstand zu Haupt- und Nebenernteprodukte, Dauergrünland',
    Parameter: '',
    'Information zum Parameter:': '',
    Wert: 0.8,
    Einheit: 'kg TM · (kg TMHep + kg TMNep)-1',
    Bezeichnung: 'αWR, Dgl',
    Kurzzitat: '',
    Langzitat: '',
  },
  'crop.permanentGrasslandWiltedSilage.supplySeed': {
    id: 'crop.permanentGrasslandWiltedSilage.supplySeed',
    Produktionsrichtung: 'Saatgut',
    Emissionsquelle: '',
    Beschreibung: 'Dauergrünlandsaatgut',
    Parameter: 'Treibhausgas-Emissionsfaktor',
    'Information zum Parameter:': '',
    Wert: 0.31,
    Einheit: 'kg CO2e · (kg FM)-1',
    Bezeichnung: 'EFCO2e, Stgt, Dgl',
    Kurzzitat: '',
    Langzitat: '',
  },
  'crop.permanentGrasslandWiltedSilage.thousandGrainWeight': {
    id: 'crop.permanentGrasslandWiltedSilage.thousandGrainWeight',
    Produktionsrichtung: 'Saatgut',
    Emissionsquelle: '',
    Beschreibung: 'Tausendkornmasse Dauergrünland',
    Parameter: '',
    'Information zum Parameter:': '',
    Wert: 2.5,
    Einheit: 'g · (1000 Körner)-1',
    Bezeichnung: 'TKG, Dgl',
    Kurzzitat: '',
    Langzitat: 'Direkte Beobachtung',
  },
  'crop.ryeWholePlantSilage.dryMatterContent': {
    id: 'crop.ryeWholePlantSilage.dryMatterContent',
    Produktionsrichtung: 'Trockenmassegehalt, Hauptprodukt',
    Emissionsquelle: '',
    Beschreibung: 'Trockenmassgehalt, Haptprodukt, GPS Roggen',
    Parameter: '',
    'Information zum Parameter:': '',
    Wert: 0.3,
    Einheit: 'kg TM · (kg FM)-1',
    Bezeichnung: 'xTM, HP, GPS R',
    Kurzzitat: '',
    Langzitat: '',
  },
  'crop.ryeWholePlantSilage.dryMatterContentByproduct': {
    id: 'crop.ryeWholePlantSilage.dryMatterContentByproduct',
    Produktionsrichtung: 'Nebenprodukt',
    Emissionsquelle: '',
    Beschreibung: 'Trockenmassegehalt, Nebenprodukt, GPS Roggen',
    Parameter: '',
    'Information zum Parameter:': '',
    Wert: 0,
    Einheit: 'kg TM · (kg FM)-1',
    Bezeichnung: 'xTM,NP, GPS R',
    Kurzzitat: '',
    Langzitat: 'Keine Nebenernteprodukte',
  },
  'crop.ryeWholePlantSilage.humusMain': {
    id: 'crop.ryeWholePlantSilage.humusMain',
    Produktionsrichtung: 'Humus-C',
    Emissionsquelle: '',
    Beschreibung: 'Humusauswirkung durch den Anbau von GPS Roggen',
    Parameter: '',
    'Information zum Parameter:': '',
    Wert: -800,
    Einheit: 'kg Humus-C/ha',
    Bezeichnung: 'Humus-C, MP, GPS R',
    Kurzzitat: '',
    Langzitat: 'VDLUFA-Methodenbuch',
  },
  'crop.ryeWholePlantSilage.k2oByproductFm': {
    id: 'crop.ryeWholePlantSilage.k2oByproductFm',
    Produktionsrichtung: 'Nebenprodukt',
    Emissionsquelle: '',
    Beschreibung: 'K2O Gehalt, Nebenprodukt, GPS Roggen',
    Parameter: '',
    'Information zum Parameter:': '',
    Wert: 0,
    Einheit: 'kg K2O · (kg FM)-1',
    Bezeichnung: 'xK2O, Sek, GPS R',
    Kurzzitat: '',
    Langzitat: 'Keine Nebenernteprodukte',
  },
  'crop.ryeWholePlantSilage.MPBR': {
    id: 'crop.ryeWholePlantSilage.MPBR',
    Produktionsrichtung: 'Nebenprodukt',
    Emissionsquelle: '',
    Beschreibung: 'Haupternteprodukt-Nebenernteprodukt-Verhältnis GPS Roggen',
    Parameter: '',
    'Information zum Parameter:': '',
    Wert: 0,
    Einheit: 'kg NP · (kg HP)-1',
    Bezeichnung: 'HNV, GPS R',
    Kurzzitat: '',
    Langzitat: 'Keine Nebenernteprodukte',
  },
  'crop.ryeWholePlantSilage.nByproductFm': {
    id: 'crop.ryeWholePlantSilage.nByproductFm',
    Produktionsrichtung: 'Ernte- und Wurzelrückstände',
    Emissionsquelle: '',
    Beschreibung: 'Stickstoffgehalt, Nebenprodukt, GPS Roggen',
    Parameter: '',
    'Information zum Parameter:': '',
    Wert: 0,
    Einheit: 'kg N · (kg FM)-1',
    Bezeichnung: 'xN, NWR, GPS R',
    Kurzzitat: '',
    Langzitat: 'Keine Nebenernteprodukte',
  },
  'crop.ryeWholePlantSilage.nContentRoot': {
    id: 'crop.ryeWholePlantSilage.nContentRoot',
    Produktionsrichtung: 'Wurzelrückstand, Winterroggen',
    Emissionsquelle: '',
    Beschreibung: 'Stickstoffgehalt',
    Parameter: '',
    'Information zum Parameter:': '',
    Wert: 0.009,
    Einheit: 'kg N · (kg TM)-1',
    Bezeichnung: 'xN, WR, Winterroggen',
    Kurzzitat: 'IPCC (2006), Table 11.2, S. 11.18',
    Langzitat:
      'IPCC (2006): IPCC Guidelines for National Greenhouse Gas Inventories. Volume 4, Agriculture, Forestry and Other Land Use. Hayama, Japan, Intergovernmental Panel on Climate Change, https://www.ipcc-nggip.iges.or.jp/public/2006gl/vol4.html, access 12.02.2019',
  },
  'crop.ryeWholePlantSilage.p2o5ByproductFm': {
    id: 'crop.ryeWholePlantSilage.p2o5ByproductFm',
    Produktionsrichtung: 'Nebenprodukt',
    Emissionsquelle: '',
    Beschreibung: 'P2O5 Gehalt, Nebenprodukt, GPS Roggen',
    Parameter: '',
    'Information zum Parameter:': '',
    Wert: 0,
    Einheit: 'kg P2O5 · (kg FM)-1',
    Bezeichnung: 'xP2O5, Sek, GPS R',
    Kurzzitat: '',
    Langzitat: 'Keine Nebenernteprodukte',
  },
  'crop.ryeWholePlantSilage.piecesToKg': {
    id: 'crop.ryeWholePlantSilage.piecesToKg',
    Produktionsrichtung: 'Saatgut',
    Emissionsquelle: '',
    Beschreibung: 'Umrechnung von der Einheit Sack Saatgut in kg',
    Parameter: '',
    'Information zum Parameter:': '',
    Wert: 1,
    Einheit: 'kg · ( U )-1',
    Bezeichnung: 'Ukg, GPS R',
    Kurzzitat: '',
    Langzitat: '',
  },
  'crop.ryeWholePlantSilage.restsHumusBuildingPotential': {
    id: 'crop.ryeWholePlantSilage.restsHumusBuildingPotential',
    Produktionsrichtung: '',
    Emissionsquelle: '',
    Beschreibung: 'Keine Nebenernteprodukte',
    Parameter: '',
    'Information zum Parameter:': '',
    Wert: 0,
    Einheit: '',
    Bezeichnung: 'Keine Nebenernteprodukte',
    Kurzzitat: '',
    Langzitat: 'Keine Nebenernteprodukte',
  },
  'crop.ryeWholePlantSilage.rootProportion': {
    id: 'crop.ryeWholePlantSilage.rootProportion',
    Produktionsrichtung: 'Ernte- und Wurzelrückstände',
    Emissionsquelle: '',
    Beschreibung:
      'Wurzelrückstand zu Haupt- und Nebenernteprodukte, Getreide (allgemein)',
    Parameter: 'Proportionalitätsfaktor',
    'Information zum Parameter:': 'siehe auch BEK-Handbuch, S. 34',
    Wert: 0.22,
    Einheit: 'kg TM · (kg TMHep + kg TMNep)-1',
    Bezeichnung: 'αWR, Gtrd allg',
    Kurzzitat: 'IPCC (2006), Table 11.2, S. 11.18',
    Langzitat:
      'IPCC (2006): IPCC Guidelines for National Greenhouse Gas Inventories. Volume 4, Agriculture, Forestry and Other Land Use. Hayama, Japan, Intergovernmental Panel on Climate Change, https://www.ipcc-nggip.iges.or.jp/public/2006gl/vol4.html, access 12.02.2019',
  },
  'crop.ryeWholePlantSilage.supplySeed': {
    id: 'crop.ryeWholePlantSilage.supplySeed',
    Produktionsrichtung: 'Saatgut',
    Emissionsquelle: '',
    Beschreibung: 'Roggensaatgut mit 85 % TM konventionell herstellen',
    Parameter: 'Treibhausgas-Emissionsfaktor',
    'Information zum Parameter:':
      'aus Ecoinvent v3.1, Aktivitätsdatensatz "rye seed production, for sowing, GLO", Allokationsmethode "ecoinvent default"',
    Wert: 0.828,
    Einheit: 'kg CO2e · (kg FM)-1',
    Bezeichnung: 'EFCO2e, Stgt, Rgn',
    Kurzzitat: 'Weidema et al. (2013)',
    Langzitat:
      'Eigentümer dieses Parameters ist Ecoinvent Weidema, B. P. et al. (2013): The ecoinvent database: Overview and methodology, Data quality guideline for the ecoinvent database version 3, www.ecoinvent.org',
  },
  'crop.ryeWholePlantSilage.thousandGrainWeight': {
    id: 'crop.ryeWholePlantSilage.thousandGrainWeight',
    Produktionsrichtung: 'Saatgut',
    Emissionsquelle: '',
    Beschreibung: 'Tausendkornmasse Winterroggen',
    Parameter: 'Tausendkornmasse Winterroggen',
    'Information zum Parameter:': 'Tausendkornmasse Winterroggen',
    Wert: 35,
    Einheit: 'g · (1000  Körner)-1',
    Bezeichnung: 'TKG, Winterroggen',
    Kurzzitat: '',
    Langzitat: 'Direkte Beobachtung',
  },
  'crop.lupine.dryMatterContent': {
    id: 'crop.lupine.dryMatterContent',
    Produktionsrichtung: 'Trockenmassegehalt, Hauptprodukt',
    Emissionsquelle: '',
    Beschreibung: 'Trockenmassgehalt, Haptprodukt, Lupine',
    Parameter: '',
    'Information zum Parameter:': '',
    Wert: 0.86,
    Einheit: 'kg TM · (kg FM)-1',
    Bezeichnung: 'xTM, HP, Lpn',
    Kurzzitat: '',
    Langzitat:
      'Verordnung über die Anwendung von Düngemitteln, Bodenhilfsstoffen, Kultursubstraten und Pflanzenhilfsmitteln nach den Grundsätzen der guten fachlichen Praxis beim Düngen 2 (Düngeverordnung - DüV) Anlage 7 (zu § 3 Absatz 2 und 6 und § 4 Absatz 3) Nährstoffgehalte pflanzlicher Erzeugnisse',
  },
  'crop.lupine.dryMatterContentByproduct': {
    id: 'crop.lupine.dryMatterContentByproduct',
    Produktionsrichtung: 'Nebenprodukt',
    Emissionsquelle: '',
    Beschreibung: 'Trockenmassegehalt, Nebenprodukt, Lupine',
    Parameter: '',
    'Information zum Parameter:': '',
    Wert: 0.86,
    Einheit: 'kg TM · (kg FM)-1',
    Bezeichnung: 'xTM,NP, Lpn',
    Kurzzitat: '',
    Langzitat:
      'Verordnung über die Anwendung von Düngemitteln, Bodenhilfsstoffen, Kultursubstraten und Pflanzenhilfsmitteln nach den Grundsätzen der guten fachlichen Praxis beim Düngen 2 (Düngeverordnung - DüV) Anlage 7 (zu § 3 Absatz 2 und 6 und § 4 Absatz 3) Nährstoffgehalte pflanzlicher Erzeugnisse',
  },
  'crop.lupine.humusMain': {
    id: 'crop.lupine.humusMain',
    Produktionsrichtung: 'Humus-C',
    Emissionsquelle: '',
    Beschreibung: 'Humusauswirkung durch den Anbau von Lupine',
    Parameter: '',
    'Information zum Parameter:': '',
    Wert: 160,
    Einheit: 'kg Humus-C/ha',
    Bezeichnung: 'Humus-C, MP, Lpn',
    Kurzzitat: '',
    Langzitat: 'VDLUFA-Methodenbuch',
  },
  'crop.lupine.k2oByproductFm': {
    id: 'crop.lupine.k2oByproductFm',
    Produktionsrichtung: 'Nebenprodukt',
    Emissionsquelle: '',
    Beschreibung: 'K2O Gehalt, Nebenprodukt, Lupine',
    Parameter: '',
    'Information zum Parameter:': '',
    Wert: 0.026,
    Einheit: 'kg K2O · (kg FM)-1',
    Bezeichnung: 'xK2O, Sek, Lpn',
    Kurzzitat: '',
    Langzitat:
      'https://www.lfl.bayern.de/mam/cms07/iab/dateien/basisdaten22_tabelle_1a_20211210.pdf',
  },
  'crop.lupine.MPBR': {
    id: 'crop.lupine.MPBR',
    Produktionsrichtung: 'Nebenprodukt',
    Emissionsquelle: '',
    Beschreibung: 'Haupternteprodukt-Nebenernteprodukt-Verhältnis Lupine',
    Parameter: '',
    'Information zum Parameter:': '',
    Wert: 1,
    Einheit: 'kg NP · (kg HP)-1',
    Bezeichnung: 'HNV, Lpn',
    Kurzzitat: '',
    Langzitat:
      'Verordnung über die Anwendung von Düngemitteln, Bodenhilfsstoffen, Kultursubstraten und Pflanzenhilfsmitteln nach den Grundsätzen der guten fachlichen Praxis beim Düngen 2 (Düngeverordnung - DüV) Anlage 7 (zu § 3 Absatz 2 und 6 und § 4 Absatz 3) Nährstoffgehalte pflanzlicher Erzeugnisse',
  },
  'crop.lupine.nByproductFm': {
    id: 'crop.lupine.nByproductFm',
    Produktionsrichtung: 'Ernte- und Wurzelrückstände',
    Emissionsquelle: '',
    Beschreibung: 'Stickstoffgehalt, Nebenprodukt, Lupine',
    Parameter: '',
    'Information zum Parameter:': '',
    Wert: 0.015,
    Einheit: 'kg N · (kg FM)-1',
    Bezeichnung: 'xN, NWR, Lpn',
    Kurzzitat: '',
    Langzitat:
      'Verordnung über die Anwendung von Düngemitteln, Bodenhilfsstoffen, Kultursubstraten und Pflanzenhilfsmitteln nach den Grundsätzen der guten fachlichen Praxis beim Düngen 2 (Düngeverordnung - DüV) Anlage 7 (zu § 3 Absatz 2 und 6 und § 4 Absatz 3) Nährstoffgehalte pflanzlicher Erzeugnisse',
  },
  'crop.lupine.nContentRoot': {
    id: 'crop.lupine.nContentRoot',
    Produktionsrichtung: 'Ernte- und Wurzelrückstände',
    Emissionsquelle: '',
    Beschreibung: 'Wurzelrückstand, Lupine',
    Parameter: '',
    'Information zum Parameter:': '',
    Wert: 0.008,
    Einheit: 'kg N · (kg TM)-1',
    Bezeichnung: 'xN, WR, Lpn',
    Kurzzitat: '',
    Langzitat:
      'gleich wie Soja : IPCC (2006): IPCC Guidelines for National Greenhouse Gas Inventories. Volume 4, Agriculture, Forestry and Other Land Use. Hayama, Japan, Intergovernmental Panel on Climate Change, https://www.ipcc-nggip.iges.or.jp/public/2006gl/vol4.html, access 12.02.2019',
  },
  'crop.lupine.p2o5ByproductFm': {
    id: 'crop.lupine.p2o5ByproductFm',
    Produktionsrichtung: 'Nebenprodukt',
    Emissionsquelle: '',
    Beschreibung: 'P2O5 Gehalt, Nebenprodukt, Lupine',
    Parameter: '',
    'Information zum Parameter:': '',
    Wert: 0.003,
    Einheit: 'kg P2O5 · (kg FM)-1',
    Bezeichnung: 'xP2O5, Sek, Lpn',
    Kurzzitat: '',
    Langzitat:
      'Verordnung über die Anwendung von Düngemitteln, Bodenhilfsstoffen, Kultursubstraten und Pflanzenhilfsmitteln nach den Grundsätzen der guten fachlichen Praxis beim Düngen 2 (Düngeverordnung - DüV) Anlage 7 (zu § 3 Absatz 2 und 6 und § 4 Absatz 3) Nährstoffgehalte pflanzlicher Erzeugnisse',
  },
  'crop.lupine.piecesToKg': {
    id: 'crop.lupine.piecesToKg',
    Produktionsrichtung: 'Saatgut',
    Emissionsquelle: '',
    Beschreibung: 'Umrechnung von der Einheit Sack Saatgut in kg',
    Parameter: '',
    'Information zum Parameter:': '',
    Wert: 56.25,
    Einheit: 'kg · ( U )-1',
    Bezeichnung: 'Ukg, Lpn',
    Kurzzitat: '',
    Langzitat: 'Gleich wie Soja',
  },
  'crop.lupine.rootProportion': {
    id: 'crop.lupine.rootProportion',
    Produktionsrichtung: 'Ernte- und Wurzelrückstände',
    Emissionsquelle: '',
    Beschreibung: 'Wurzelrückstand zu Haupt- und Nebenernteprodukte, Lupine',
    Parameter: '',
    'Information zum Parameter:': '',
    Wert: 0.19,
    Einheit: 'kg TM · (kg TMHep + kg TMNep)-1',
    Bezeichnung: 'αWR, Lpn',
    Kurzzitat: '',
    Langzitat:
      'gleich wie Soja : IPCC (2006): IPCC Guidelines for National Greenhouse Gas Inventories. Volume 4, Agriculture, Forestry and Other Land Use. Hayama, Japan, Intergovernmental Panel on Climate Change, https://www.ipcc-nggip.iges.or.jp/public/2006gl/vol4.html, access 12.02.2019',
  },
  'crop.lupine.supplySeed': {
    id: 'crop.lupine.supplySeed',
    Produktionsrichtung: 'Saatgut',
    Emissionsquelle: '',
    Beschreibung: 'Lupinesaatgut mit 89 % TM konventionell herstellen',
    Parameter: 'Treibhausgas-Emissionsfaktor',
    'Information zum Parameter:':
      'aus Ecoinvent v3.1, Aktivitätsdatensatz "soybean seed production, for sowing, RoW", Allokationsmethode "ecoinvent default"',
    Wert: 1.86,
    Einheit: 'kg CO2e · (kg FM)-1',
    Bezeichnung: 'EFCO2e, Stgt, Lpn',
    Kurzzitat: 'Weidema et al. (2013)',
    Langzitat:
      'gleich wie Soja : Eigentümer dieses Parameters ist Ecoinvent Weidema, B. P. et al. (2013): The ecoinvent database: Overview and methodology, Data quality guideline for the ecoinvent database version 3, www.ecoinvent.org',
  },
  'crop.lupine.thousandGrainWeight': {
    id: 'crop.lupine.thousandGrainWeight',
    Produktionsrichtung: 'Saatgut',
    Emissionsquelle: '',
    Beschreibung: 'Tausendkornmasse Lupine',
    Parameter: '',
    'Information zum Parameter:': '',
    Wert: 375,
    Einheit: 'g · (1000 Körner)-1',
    Bezeichnung: 'TKG, Lpn',
    Kurzzitat: '',
    Langzitat: 'Direkte Beobachtung',
  },
  'crop.spelt.dryMatterContent': {
    id: 'crop.spelt.dryMatterContent',
    Produktionsrichtung: 'Trockenmassegehalt, Hauptprodukt',
    Emissionsquelle: '',
    Beschreibung: 'Trockenmassgehalt, Haptprodukt, Dinkel',
    Parameter: '',
    'Information zum Parameter:': '',
    Wert: 0.86,
    Einheit: 'kg TM · (kg FM)-1',
    Bezeichnung: 'xTM, HP, Dkl',
    Kurzzitat: '',
    Langzitat:
      'https://www.lfl.bayern.de/mam/cms07/iab/dateien/basisdaten22_tabelle_1a_20211210.pdf',
  },
  'crop.spelt.dryMatterContentByproduct': {
    id: 'crop.spelt.dryMatterContentByproduct',
    Produktionsrichtung: 'Nebenprodukt',
    Emissionsquelle: '',
    Beschreibung: 'Trockenmassegehalt, Nebenprodukt, Dinkel',
    Parameter: '',
    'Information zum Parameter:': '',
    Wert: 0.86,
    Einheit: 'kg TM · (kg FM)-1',
    Bezeichnung: 'xTM,NP, Dkl',
    Kurzzitat: '',
    Langzitat:
      'https://www.lfl.bayern.de/mam/cms07/iab/dateien/basisdaten22_tabelle_1a_20211210.pdf',
  },
  'crop.spelt.humusMain': {
    id: 'crop.spelt.humusMain',
    Produktionsrichtung: 'Humus-C',
    Emissionsquelle: '',
    Beschreibung: 'Humusauswirkung durch den Anbau von Dinkel',
    Parameter: '',
    'Information zum Parameter:': '',
    Wert: -400,
    Einheit: 'kg Humus-C/ha',
    Bezeichnung: 'Humus-C, MP, Dkl',
    Kurzzitat: '',
    Langzitat: 'VDLUFA-Methodenbuch',
  },
  'crop.spelt.k2oByproductFm': {
    id: 'crop.spelt.k2oByproductFm',
    Produktionsrichtung: 'Nebenprodukt',
    Emissionsquelle: '',
    Beschreibung: 'K2O Gehalt, Nebenprodukt, Dinkel',
    Parameter: '',
    'Information zum Parameter:': '',
    Wert: 0.014,
    Einheit: 'kg K2O · (kg FM)-1',
    Bezeichnung: 'xK2O, Sek, Dkl',
    Kurzzitat: '',
    Langzitat:
      'https://www.lfl.bayern.de/mam/cms07/iab/dateien/basisdaten22_tabelle_1a_20211210.pdf',
  },
  'crop.spelt.MPBR': {
    id: 'crop.spelt.MPBR',
    Produktionsrichtung: 'Nebenprodukt',
    Emissionsquelle: '',
    Beschreibung: 'Haupternteprodukt-Nebenernteprodukt-Verhältnis Dinkel',
    Parameter: '',
    'Information zum Parameter:': '',
    Wert: 0.8,
    Einheit: 'kg NP · (kg HP)-1',
    Bezeichnung: 'HNV, Dkl',
    Kurzzitat: '',
    Langzitat:
      'https://www.lfl.bayern.de/mam/cms07/iab/dateien/basisdaten22_tabelle_1a_20211210.pdf',
  },
  'crop.spelt.nByproductFm': {
    id: 'crop.spelt.nByproductFm',
    Produktionsrichtung: 'Ernte- und Wurzelrückstände',
    Emissionsquelle: '',
    Beschreibung: 'Stickstoffgehalt, Nebenprodukt, Dinkel',
    Parameter: '',
    'Information zum Parameter:': '',
    Wert: 0.005,
    Einheit: 'kg N · (kg FM)-1',
    Bezeichnung: 'xN, NWR, Dkl',
    Kurzzitat: '',
    Langzitat:
      'https://www.lfl.bayern.de/mam/cms07/iab/dateien/basisdaten22_tabelle_1a_20211210.pdf',
  },
  'crop.spelt.nContentRoot': {
    id: 'crop.spelt.nContentRoot',
    Produktionsrichtung: 'Ernte- und Wurzelrückstände',
    Emissionsquelle: '',
    Beschreibung: 'Wurzelrückstand, Dinkel',
    Parameter: '',
    'Information zum Parameter:': '',
    Wert: 0.009,
    Einheit: 'kg N · (kg TM)-1',
    Bezeichnung: 'xN, WR, Dkl',
    Kurzzitat: '',
    Langzitat:
      'Kein Wert für Dinkel gefunden. Dieser Wert wurde von Winterweizen übernommen',
  },
  'crop.spelt.p2o5ByproductFm': {
    id: 'crop.spelt.p2o5ByproductFm',
    Produktionsrichtung: 'Nebenprodukt',
    Emissionsquelle: '',
    Beschreibung: 'P2O5 Gehalt, Nebenprodukt, Dinkel',
    Parameter: '',
    'Information zum Parameter:': '',
    Wert: 0.003,
    Einheit: 'kg P2O5 · (kg FM)-1',
    Bezeichnung: 'xP2O5, Sek, Dkl',
    Kurzzitat: '',
    Langzitat:
      'https://www.lfl.bayern.de/mam/cms07/iab/dateien/basisdaten22_tabelle_1a_20211210.pdf',
  },
  'crop.spelt.piecesToKg': {
    id: 'crop.spelt.piecesToKg',
    Produktionsrichtung: 'Saatgut',
    Emissionsquelle: '',
    Beschreibung: 'Umrechnung von der Einheit Sack Saatgut in kg',
    Parameter: '',
    'Information zum Parameter:': '',
    Wert: 1,
    Einheit: 'kg · ( U )-1',
    Bezeichnung: 'Ukg, Dkl',
    Kurzzitat: '',
    Langzitat: '',
  },
  'crop.spelt.rootProportion': {
    id: 'crop.spelt.rootProportion',
    Produktionsrichtung: 'Ernte- und Wurzelrückstände',
    Emissionsquelle: '',
    Beschreibung: 'Wurzelrückstand zu Haupt- und Nebenernteprodukte, Dinkel',
    Parameter: '',
    'Information zum Parameter:': '',
    Wert: 0.23,
    Einheit: 'kg TM · (kg TMHep + kg TMNep)-1',
    Bezeichnung: 'αWR, Dkl',
    Kurzzitat: '',
    Langzitat:
      'Kein Wert für Dinkel gefunden. Dieser Wert wurde von Winterweizen übernommen',
  },
  'crop.spelt.supplySeed': {
    id: 'crop.spelt.supplySeed',
    Produktionsrichtung: 'Saatgut',
    Emissionsquelle: '',
    Beschreibung: 'Dinkelnsaatgut mit 94 % TM konventionell herstellen',
    Parameter: '',
    'Information zum Parameter:': '',
    Wert: 0.89,
    Einheit: 'kg CO2e · (kg FM)-1',
    Bezeichnung: 'EFCO2e, Stgt, Dkl',
    Kurzzitat: '',
    Langzitat:
      'Kein Wert für Dinkel gefunden. Dieser Wert wurde von Winterweizen übernommen ( Eigentümer dieses Parameters ist Ecoinvent Weidema, B. P. et al. (2013): The ecoinvent database: Overview and methodology, Data quality guideline for the ecoinvent database version 3, www.ecoinvent.org)',
  },
  'crop.spelt.thousandGrainWeight': {
    id: 'crop.spelt.thousandGrainWeight',
    Produktionsrichtung: 'Saatgut',
    Emissionsquelle: '',
    Beschreibung: 'Tausendkornmasse Dinkel',
    Parameter: '',
    'Information zum Parameter:': '',
    Wert: 32,
    Einheit: 'g · (1000 Körner)-1',
    Bezeichnung: 'TKG, Dkl',
    Kurzzitat: '',
    Langzitat:
      'Kein Wert für Dinkel gefunden. Dieser Wert wurde von Winterweizen übernommen',
  },
  'crop.permanentGrasslandMulched.dryMatterContent': {
    id: 'crop.permanentGrasslandMulched.dryMatterContent',
    Produktionsrichtung: 'Trockenmassegehalt, Hauptprodukt',
    Emissionsquelle: '',
    Beschreibung: 'Trockenmassgehalt, Haptprodukt, Dauergrünland gemucht',
    Parameter: '',
    'Information zum Parameter:': '',
    Wert: 0.2,
    Einheit: 'kg TM · (kg FM)-1',
    Bezeichnung: 'xTM, HP, Dglm',
    Kurzzitat: '',
    Langzitat: 'Kein Hauptprodukt aus dem Feld entfernt.',
  },
  'crop.permanentGrasslandMulched.dryMatterContentByproduct': {
    id: 'crop.permanentGrasslandMulched.dryMatterContentByproduct',
    Produktionsrichtung: 'Nebenprodukt',
    Emissionsquelle: '',
    Beschreibung: 'Trockenmassegehalt, Nebenprodukt, Dauergrünland gemucht',
    Parameter: '',
    'Information zum Parameter:': '',
    Wert: 0.2,
    Einheit: 'kg TM · (kg FM)-1',
    Bezeichnung: 'xTM,NP, Dglm',
    Kurzzitat: '',
    Langzitat: 'gemäß DüV, genauso wie Ackergras und andere Futterbaukulturen',
  },
  'crop.permanentGrasslandMulched.humusMain': {
    id: 'crop.permanentGrasslandMulched.humusMain',
    Produktionsrichtung: 'Humus-C',
    Emissionsquelle: '',
    Beschreibung: 'Humusauswirkung durch den Anbau von Dauergrünland gemucht',
    Parameter: '',
    'Information zum Parameter:': '',
    Wert: 600,
    Einheit: 'kg Humus-C/ha',
    Bezeichnung: 'Humus-C, MP, Dglm',
    Kurzzitat: '',
    Langzitat: 'VDLUFA/ mehrjähriges Feldfutter, je Hauptnutzungsjahr',
  },
  'crop.permanentGrasslandMulched.k2oByproductFm': {
    id: 'crop.permanentGrasslandMulched.k2oByproductFm',
    Produktionsrichtung: 'Nebenprodukt',
    Emissionsquelle: '',
    Beschreibung: 'K2O Gehalt, Nebenprodukt, Dauergrünland gemucht',
    Parameter: '',
    'Information zum Parameter:': '',
    Wert: 0.025,
    Einheit: 'kg K2O · (kg FM)-1',
    Bezeichnung: 'xK2O, Sek, Dglm',
    Kurzzitat: '',
    Langzitat: 'LfL; wie HP',
  },
  'crop.permanentGrasslandMulched.MPBR': {
    id: 'crop.permanentGrasslandMulched.MPBR',
    Produktionsrichtung: 'Nebenprodukt',
    Emissionsquelle: '',
    Beschreibung:
      'Haupternteprodukt-Nebenernteprodukt-Verhältnis Dauergrünland gemucht',
    Parameter: '',
    'Information zum Parameter:': '',
    Wert: 1,
    Einheit: 'kg NP · (kg HP)-1',
    Bezeichnung: 'HNV, Dglm',
    Kurzzitat: '',
    Langzitat: 'wie HP, deswegen 1',
  },
  'crop.permanentGrasslandMulched.nByproductFm': {
    id: 'crop.permanentGrasslandMulched.nByproductFm',
    Produktionsrichtung: 'Ernte- und Wurzelrückstände',
    Emissionsquelle: '',
    Beschreibung: 'Stickstoffgehalt, Nebenprodukt, Dauergrünland gemucht',
    Parameter: '',
    'Information zum Parameter:': '',
    Wert: 0.0182,
    Einheit: 'kg N · (kg FM)-1',
    Bezeichnung: 'xN, NWR, Dglm',
    Kurzzitat: '',
    Langzitat: 'LfL; wie HP',
  },
  'crop.permanentGrasslandMulched.nContentRoot': {
    id: 'crop.permanentGrasslandMulched.nContentRoot',
    Produktionsrichtung: 'Ernte- und Wurzelrückstände',
    Emissionsquelle: '',
    Beschreibung: 'Wurzelrückstand, Dauergrünland gemucht',
    Parameter: '',
    'Information zum Parameter:': '',
    Wert: 0.012,
    Einheit: 'kg N · (kg TM)-1',
    Bezeichnung: 'xN, WR, Dglm',
    Kurzzitat: '',
    Langzitat: '',
  },
  'crop.permanentGrasslandMulched.p2o5ByproductFm': {
    id: 'crop.permanentGrasslandMulched.p2o5ByproductFm',
    Produktionsrichtung: 'Nebenprodukt',
    Emissionsquelle: '',
    Beschreibung: 'P2O5 Gehalt, Nebenprodukt, Dauergrünland gemucht',
    Parameter: '',
    'Information zum Parameter:': '',
    Wert: 0.0065,
    Einheit: 'kg P2O5 · (kg FM)-1',
    Bezeichnung: 'xP2O5, Sek, Dglm',
    Kurzzitat: '',
    Langzitat: 'LfL; wie HP',
  },
  'crop.permanentGrasslandMulched.piecesToKg': {
    id: 'crop.permanentGrasslandMulched.piecesToKg',
    Produktionsrichtung: 'Saatgut',
    Emissionsquelle: '',
    Beschreibung: 'Umrechnung von der Einheit Sack Saatgut in kg',
    Parameter: '',
    'Information zum Parameter:': '',
    Wert: 1,
    Einheit: 'kg · ( U )-1',
    Bezeichnung: 'Ukg, Dglm',
    Kurzzitat: '',
    Langzitat: '',
  },
  'crop.permanentGrasslandMulched.restsHumusBuildingPotential': {
    id: 'crop.permanentGrasslandMulched.restsHumusBuildingPotential',
    Produktionsrichtung: 'restHumusBuildingPotential',
    Emissionsquelle: '',
    Beschreibung: 'restHumusBuildingPotential',
    Parameter: '',
    'Information zum Parameter:': '',
    Wert: 0.016,
    Einheit: 'kg Humus-C *( kg FM)-1',
    Bezeichnung: 'restHumusBuildingPotential',
    Kurzzitat: '',
    Langzitat: 'VDLUFA Grunschnitt',
  },
  'crop.permanentGrasslandMulched.rootProportion': {
    id: 'crop.permanentGrasslandMulched.rootProportion',
    Produktionsrichtung: 'Ernte- und Wurzelrückstände',
    Emissionsquelle: '',
    Beschreibung:
      'Wurzelrückstand zu Haupt- und Nebenernteprodukte, Dauergrünland',
    Parameter: 'Proportionalitätsfaktor',
    'Information zum Parameter:': 'siehe auch BEK-Handbuch, S. 34',
    Wert: 0.8,
    Einheit: 'kg TM · (kg TMHep + kg TMNep)-1',
    Bezeichnung: 'αWR, Dglm',
    Kurzzitat: 'IPCC (2006), Table 11.2, S. 11.18',
    Langzitat:
      'IPCC (2006): IPCC Guidelines for National Greenhouse Gas Inventories. Volume 4, Agriculture, Forestry and Other Land Use. Hayama, Japan, Intergovernmental Panel on Climate Change, https://www.ipcc-nggip.iges.or.jp/public/2006gl/vol4.html, access 12.02.2019',
  },
  'crop.permanentGrasslandMulched.supplySeed': {
    id: 'crop.permanentGrasslandMulched.supplySeed',
    Produktionsrichtung: 'Saatgut',
    Emissionsquelle: '',
    Beschreibung: 'Dauergrünland gemuchtsaatgut',
    Parameter: 'Treibhausgas-Emissionsfaktor',
    'Information zum Parameter:': '',
    Wert: 0.31,
    Einheit: 'kg CO2e · (kg FM)-1',
    Bezeichnung: 'EFCO2e, Stgt, Dglm',
    Kurzzitat: '',
    Langzitat: '',
  },
  'crop.permanentGrasslandMulched.thousandGrainWeight': {
    id: 'crop.permanentGrasslandMulched.thousandGrainWeight',
    Produktionsrichtung: 'Saatgut',
    Emissionsquelle: '',
    Beschreibung: 'Tausendkornmasse Dauergrünland gemucht',
    Parameter: '',
    'Information zum Parameter:': '',
    Wert: 2.5,
    Einheit: 'g · (1000 Körner)-1',
    Bezeichnung: 'TKG, Dglm',
    Kurzzitat: '',
    Langzitat: 'Direkte Beobachtung',
  },
  'orgFertParams.cattleLiquidManure.8h': {
    id: 'orgFertParams.cattleLiquidManure.8h',
    Produktionsrichtung: 'Wirtschaftsdüngerausbringung Rind',
    Emissionsquelle: 'Wirtschaftsdünger von Rindern',
    Beschreibung:
      'Jauche mit Schleppschlauch und Einarbeitung > 4 h bis ≤ 12 h',
    Parameter: 'Ammoniak-Emissionsfaktor',
    'Information zum Parameter:': '',
    Wert: 0.12,
    Einheit: 'kg NH3-N · (kg TAN)-1',
    Bezeichnung: 'EFNH3-N, RJ, Sschl, E < 4 h',
    Kurzzitat: 'Haenel et al. (2020), Table 4.9, S. 123',
    Langzitat:
      'Haenel, H.-D.; Rösemann, C.; Dämmgen, U.; Döring, U.; Wulf, S.; Eurich-Menden, B.; Freibauer, A.; Döhler, H.; Schreiner, C.; Osterburg, B.; Fuß, R. (2020): Calculations of gaseous and particulate emissions from German agriculture 1990 – 2018. Report on methods and data (RMD) Submission 2020. Thünen Report 77, Braunschweig, Johann Heinrich von Thünen-Institut',
  },
  'orgFertParams.cattleLiquidManure.noIncorporation': {
    id: 'orgFertParams.cattleLiquidManure.noIncorporation',
    Produktionsrichtung: 'Wirtschaftsdüngerausbringung Rind',
    Emissionsquelle: 'Wirtschaftsdünger von Rindern',
    Beschreibung: 'Jauche mit Schleppschlauch ohne Einarbeitung',
    Parameter: 'Ammoniak-Emissionsfaktor',
    'Information zum Parameter:': '',
    Wert: 0.18,
    Einheit: 'kg NH3-N · (kg TAN)-1',
    Bezeichnung: 'EFNH3-N, RJ, Sschl, o E',
    Kurzzitat: 'Haenel et al. (2020), Table 4.9, S. 123',
    Langzitat:
      'Haenel, H.-D.; Rösemann, C.; Dämmgen, U.; Döring, U.; Wulf, S.; Eurich-Menden, B.; Freibauer, A.; Döhler, H.; Schreiner, C.; Osterburg, B.; Fuß, R. (2020): Calculations of gaseous and particulate emissions from German agriculture 1990 – 2018. Report on methods and data (RMD) Submission 2020. Thünen Report 77, Braunschweig, Johann Heinrich von Thünen-Institut',
  },
  'orgFertParams.pigLiquidManure.8h': {
    id: 'orgFertParams.pigLiquidManure.8h',
    Produktionsrichtung: 'Wirtschaftsdüngerausbringung Schwein',
    Emissionsquelle: 'Wirtschaftsdünger von Schweinen',
    Beschreibung: 'Jauche mit Schleppschlauch und Einarbeitung >4 h bis ≤ 12 h',
    Parameter: 'Ammoniak-Emissionsfaktor',
    'Information zum Parameter:': '',
    Wert: 0.12,
    Einheit: 'kg NH3-N · (kg TAN)-1',
    Bezeichnung: 'EFNH3-N, SJ, Sschl, E > 4 h',
    Kurzzitat: 'Haenel et al. (2020), Table 5.7, S. 205',
    Langzitat:
      'Haenel, H.-D.; Rösemann, C.; Dämmgen, U.; Döring, U.; Wulf, S.; Eurich-Menden, B.; Freibauer, A.; Döhler, H.; Schreiner, C.; Osterburg, B.; Fuß, R. (2020): Calculations of gaseous and particulate emissions from German agriculture 1990 – 2018. Report on methods and data (RMD) Submission 2020. Thünen Report 77, Braunschweig, Johann Heinrich von Thünen-Institut',
  },
  'orgFertParams.pigSlurry.8h': {
    id: 'orgFertParams.pigSlurry.8h',
    Produktionsrichtung: 'Wirtschaftsdüngerausbringung Schwein',
    Emissionsquelle: 'Wirtschaftsdünger von Schweinen',
    Beschreibung: 'Gülle mit Schleppschlauch und Einarbeitung > 1 h bis ≤ 4 h',
    Parameter: 'Ammoniak-Emissionsfaktor',
    'Information zum Parameter:': '',
    Wert: 0.11,
    Einheit: 'kg NH3-N · (kg TAN)-1',
    Bezeichnung: 'EFNH3-N, SG, Sschl, E > 4 h',
    Kurzzitat: 'Haenel et al. (2020), Table 5.6, S. 204',
    Langzitat:
      'Haenel, H.-D.; Rösemann, C.; Dämmgen, U.; Döring, U.; Wulf, S.; Eurich-Menden, B.; Freibauer, A.; Döhler, H.; Schreiner, C.; Osterburg, B.; Fuß, R. (2020): Calculations of gaseous and particulate emissions from German agriculture 1990 – 2018. Report on methods and data (RMD) Submission 2020. Thünen Report 77, Braunschweig, Johann Heinrich von Thünen-Institut',
  },
  'orgFertParams.digestateLiquid.8h': {
    id: 'orgFertParams.digestateLiquid.8h',
    Produktionsrichtung: 'Wirtschaftsdüngerausbringung Gärrest',
    Emissionsquelle: 'Gärrest',
    Beschreibung: 'Schleppschlauch ohne Einarbeitung',
    Parameter: 'Ammoniak-Emissionsfaktor',
    'Information zum Parameter:': '',
    Wert: 0.46,
    Einheit: 'kg NH3-N · (kg TAN)-1',
    Bezeichnung: 'EFNH3-N, Gr, Sschl, o E',
    Kurzzitat: 'Haenel et al. (2020), Table 4.8, S. 122',
    Langzitat:
      'Haenel, H.-D.; Rösemann, C.; Dämmgen, U.; Döring, U.; Wulf, S.; Eurich-Menden, B.; Freibauer, A.; Döhler, H.; Schreiner, C.; Osterburg, B.; Fuß, R. (2020): Calculations of gaseous and particulate emissions from German agriculture 1990 – 2018. Report on methods and data (RMD) Submission 2020. Thünen Report 77, Braunschweig, Johann Heinrich von Thünen-Institut',
  },
  'ef.supplyGreenFertilizer': {
    id: 'ef.supplyGreenFertilizer',
    Produktionsrichtung: 'Mineraldünger',
    Emissionsquelle: '',
    Beschreibung: 'Harnstoff 46% blau',
    Parameter: 'Treibhausgas-Emissionsfaktor',
    'Information zum Parameter:': 'SKW',
    Wert: 0.21,
    Einheit: 'kg CO2e · (kg N)-1',
    Bezeichnung: 'EF___',
    Kurzzitat: 'SKW',
    Langzitat: '',
  },
  'ef.supplyGreenFertilizerLiquid': {
    id: 'ef.supplyGreenFertilizerLiquid',
    Produktionsrichtung: 'Mineraldünger',
    Emissionsquelle: '',
    Beschreibung: 'Harnstoff 46% blau (flussig)',
    Parameter: 'Treibhausgas-Emissionsfaktor',
    'Information zum Parameter:': 'SKW',
    Wert: 0.23,
    Einheit: 'kg CO2e · (kg N)-1',
    Bezeichnung: 'EF____',
    Kurzzitat: 'SKW',
    Langzitat: '',
  },
  'ef.heizoelDieselBafa2025': {
    id: 'ef.heizoelDieselBafa2025',
    Produktionsrichtung: 'Energiebereitstellung und -konversion',
    Emissionsquelle: '',
    Beschreibung: 'Wärme aus Heizöl leicht bzw. Diesel bereitstellen',
    Parameter: 'Treibhausgas-Emissionsfaktor',
    'Information zum Parameter:':
      'BAFA Tabelle 2: 0,266 tCO₂/MWh ≡ 0,266 kg CO₂e/kWh',
    Wert: 0.266,
    Einheit: 'kg CO2e · (kWhth)-1',
    Bezeichnung: 'EFCO2e, Heizoel-Diesel',
    Kurzzitat: 'BAFA (2025), Tab. 2',
    Langzitat:
      'Bundesamt für Wirtschaft und Ausfuhrkontrolle (BAFA) (2025): Informationsblatt CO₂-Faktoren zur Bundesförderung für Energie- und Ressourceneffizienz in der Wirtschaft (EEW), Stand 20.02.2025, Tabelle 2: CO₂-Faktoren der Energieträger. Eschborn. URL: https://www.bafa.de/SharedDocs/Downloads/DE/Energie/eew_infoblatt_co2_faktoren_2025.pdf',
  },
  'ef.erdgasBafa2025': {
    id: 'ef.erdgasBafa2025',
    Produktionsrichtung: 'Energiebereitstellung und -konversion',
    Emissionsquelle: '',
    Beschreibung: 'Wärme aus Erdgas bereitstellen',
    Parameter: 'Treibhausgas-Emissionsfaktor',
    'Information zum Parameter:':
      'BAFA Tabelle 2: 0,201 tCO₂/MWh ≡ 0,201 kg CO₂e/kWh',
    Wert: 0.201,
    Einheit: 'kg CO2e · (kWhth)-1',
    Bezeichnung: 'EFCO2e, Erdgas',
    Kurzzitat: 'BAFA (2025), Tab. 2',
    Langzitat:
      'Bundesamt für Wirtschaft und Ausfuhrkontrolle (BAFA) (2025): Informationsblatt CO₂-Faktoren zur Bundesförderung für Energie- und Ressourceneffizienz in der Wirtschaft (EEW), Stand 20.02.2025, Tabelle 2: CO₂-Faktoren der Energieträger. Eschborn. URL: https://www.bafa.de/SharedDocs/Downloads/DE/Energie/eew_infoblatt_co2_faktoren_2025.pdf',
  },
  'ef.fluessiggasBafa2025': {
    id: 'ef.fluessiggasBafa2025',
    Produktionsrichtung: 'Energiebereitstellung und -konversion',
    Emissionsquelle: '',
    Beschreibung: 'Wärme aus Flüssiggas (LPG) bereitstellen',
    Parameter: 'Treibhausgas-Emissionsfaktor',
    'Information zum Parameter:':
      'BAFA Tabelle 2: 0,239 tCO₂/MWh ≡ 0,239 kg CO₂e/kWh',
    Wert: 0.239,
    Einheit: 'kg CO2e · (kWhth)-1',
    Bezeichnung: 'EFCO2e, Fluessiggas',
    Kurzzitat: 'BAFA (2025), Tab. 2',
    Langzitat:
      'Bundesamt für Wirtschaft und Ausfuhrkontrolle (BAFA) (2025): Informationsblatt CO₂-Faktoren zur Bundesförderung für Energie- und Ressourceneffizienz in der Wirtschaft (EEW), Stand 20.02.2025, Tabelle 2: CO₂-Faktoren der Energieträger. Eschborn. URL: https://www.bafa.de/SharedDocs/Downloads/DE/Energie/eew_infoblatt_co2_faktoren_2025.pdf',
  },
  'ef.biogasBafa2025': {
    id: 'ef.biogasBafa2025',
    Produktionsrichtung: 'Energiebereitstellung und -konversion',
    Emissionsquelle: '',
    Beschreibung: 'Wärme aus Biogas bereitstellen',
    Parameter: 'Treibhausgas-Emissionsfaktor',
    'Information zum Parameter:':
      'BAFA Tabelle 2: 0,152 tCO₂/MWh ≡ 0,152 kg CO₂e/kWh',
    Wert: 0.152,
    Einheit: 'kg CO2e · (kWhth)-1',
    Bezeichnung: 'EFCO2e, Biogas',
    Kurzzitat: 'BAFA (2025), Tab. 2',
    Langzitat:
      'Bundesamt für Wirtschaft und Ausfuhrkontrolle (BAFA) (2025): Informationsblatt CO₂-Faktoren zur Bundesförderung für Energie- und Ressourceneffizienz in der Wirtschaft (EEW), Stand 20.02.2025, Tabelle 2: CO₂-Faktoren der Energieträger. Eschborn. URL: https://www.bafa.de/SharedDocs/Downloads/DE/Energie/eew_infoblatt_co2_faktoren_2025.pdf',
  },
  'ef.pelletsBafa2025': {
    id: 'ef.pelletsBafa2025',
    Produktionsrichtung: 'Energiebereitstellung und -konversion',
    Emissionsquelle: '',
    Beschreibung: 'Wärme aus Holzpellets bereitstellen',
    Parameter: 'Treibhausgas-Emissionsfaktor',
    'Information zum Parameter:':
      'BAFA Tabelle 2: 0,036 tCO₂/MWh ≡ 0,036 kg CO₂e/kWh',
    Wert: 0.036,
    Einheit: 'kg CO2e · (kWhth)-1',
    Bezeichnung: 'EFCO2e, Pellets',
    Kurzzitat: 'BAFA (2025), Tab. 2',
    Langzitat:
      'Bundesamt für Wirtschaft und Ausfuhrkontrolle (BAFA) (2025): Informationsblatt CO₂-Faktoren zur Bundesförderung für Energie- und Ressourceneffizienz in der Wirtschaft (EEW), Stand 20.02.2025, Tabelle 2: CO₂-Faktoren der Energieträger. Eschborn. URL: https://www.bafa.de/SharedDocs/Downloads/DE/Energie/eew_infoblatt_co2_faktoren_2025.pdf',
  },
  'ef.biomasseHolzBafa2025': {
    id: 'ef.biomasseHolzBafa2025',
    Produktionsrichtung: 'Energiebereitstellung und -konversion',
    Emissionsquelle: '',
    Beschreibung:
      'Wärme aus Biomasse Holz, trocken (<20% Restfeuchte) bereitstellen',
    Parameter: 'Treibhausgas-Emissionsfaktor',
    'Information zum Parameter:':
      'BAFA Tabelle 2: 0,027 tCO₂/MWh ≡ 0,027 kg CO₂e/kWh',
    Wert: 0.027,
    Einheit: 'kg CO2e · (kWhth)-1',
    Bezeichnung: 'EFCO2e, Biomasse-Holz',
    Kurzzitat: 'BAFA (2025), Tab. 2',
    Langzitat:
      'Bundesamt für Wirtschaft und Ausfuhrkontrolle (BAFA) (2025): Informationsblatt CO₂-Faktoren zur Bundesförderung für Energie- und Ressourceneffizienz in der Wirtschaft (EEW), Stand 20.02.2025, Tabelle 2: CO₂-Faktoren der Energieträger. Eschborn. URL: https://www.bafa.de/SharedDocs/Downloads/DE/Energie/eew_infoblatt_co2_faktoren_2025.pdf',
  },
  'ef.nahFernwaermeBafa2025': {
    id: 'ef.nahFernwaermeBafa2025',
    Produktionsrichtung: 'Energiebereitstellung und -konversion',
    Emissionsquelle: '',
    Beschreibung: 'Wärme aus Nah- bzw. Fernwärme beziehen',
    Parameter: 'Treibhausgas-Emissionsfaktor',
    'Information zum Parameter:':
      'BAFA Tabelle 2: 0,280 tCO₂/MWh ≡ 0,280 kg CO₂e/kWh',
    Wert: 0.28,
    Einheit: 'kg CO2e · (kWhth)-1',
    Bezeichnung: 'EFCO2e, Nah-Fernwaerme',
    Kurzzitat: 'BAFA (2025), Tab. 2',
    Langzitat:
      'Bundesamt für Wirtschaft und Ausfuhrkontrolle (BAFA) (2025): Informationsblatt CO₂-Faktoren zur Bundesförderung für Energie- und Ressourceneffizienz in der Wirtschaft (EEW), Stand 20.02.2025, Tabelle 2: CO₂-Faktoren der Energieträger. Eschborn. URL: https://www.bafa.de/SharedDocs/Downloads/DE/Energie/eew_infoblatt_co2_faktoren_2025.pdf',
  },
};

export type ParameterKeys =
  | 'orgFertParams.pigSolidManure.noIncorporation'
  | 'orgFertParams.pigSolidManure.4h'
  | 'orgFertParams.pigSolidManure.8h'
  | 'orgFertParams.pigSolidManure.1h'
  | 'orgFertParams.pigSlurry.4h'
  | 'orgFertParams.pigSlurry.1h'
  | 'orgFertParams.pigSlurry.noIncorporation'
  | 'orgFertParams.pigLiquidManure.4h'
  | 'orgFertParams.pigLiquidManure.1h'
  | 'orgFertParams.pigLiquidManure.noIncorporation'
  | 'orgFertParams.cattleSolidManure.noIncorporation'
  | 'orgFertParams.cattleSolidManure.4h'
  | 'orgFertParams.cattleSolidManure.8h'
  | 'orgFertParams.cattleSolidManure.1h'
  | 'orgFertParams.cattleSlurry.noIncorporation'
  | 'orgFertParams.cattleSlurry.4h'
  | 'orgFertParams.cattleSlurry.1h'
  | 'orgFertParams.cattleSlurry.8h'
  | 'orgFertParams.cattleLiquidManure.4h'
  | 'orgFertParams.cattleLiquidManure.1h'
  | 'crop.sugarBeet.rootProportion'
  | 'crop.potatoTableLate.rootProportion'
  | 'crop.winterBarleyFodder.rootProportion'
  | 'crop.canola.rootProportion'
  | 'crop.springOatsFodder.rootProportion'
  | 'crop.silageMaize.rootProportion'
  | 'crop.winterWheat.rootProportion'
  | 'crop.sugarBeet.nContentRoot'
  | 'crop.potatoTableLate.nContentRoot'
  | 'crop.winterBarleyFodder.nContentRoot'
  | 'crop.canola.nContentRoot'
  | 'crop.springOatsFodder.nContentRoot'
  | 'crop.silageMaize.nContentRoot'
  | 'crop.winterWheat.nContentRoot'
  | 'ef.cao'
  | 'ef.appliedN.ahl'
  | 'ef.urea'
  | 'ef.n2oN'
  | 'ef.appliedN.urea'
  | 'ef.appliedN.ureaWithInhibitor'
  | 'ef.appliedN.canAndOthersN'
  | 'ef.appliedN.np'
  | 'orgFertParams.chickenSolidManure.noIncorporation'
  | 'orgFertParams.chickenSolidManure.4h'
  | 'orgFertParams.chickenSolidManure.8h'
  | 'orgFertParams.chickenSolidManure.1h'
  | 'gwp.ch4'
  | 'orgFertParams.horseManure.noIncorporation'
  | 'orgFertParams.horseManure.4h'
  | 'orgFertParams.horseManure.8h'
  | 'orgFertParams.horseManure.1h'
  | 'orgFertParams.turkeySolidManure.noIncorporation'
  | 'orgFertParams.turkeySolidManure.4h'
  | 'orgFertParams.turkeySolidManure.8h'
  | 'orgFertParams.turkeySolidManure.1h'
  | 'orgFertParams.digestateLiquid.noIncorporation'
  | 'orgFertParams.digestateLiquid.4h'
  | 'orgFertParams.digestateLiquid.1h'
  | 'ef.biodiesel'
  | 'ef.diesel'
  | 'ef.hvo100'
  | 'ef.electricityRenewablesMixDe2018'
  | 'ef.electricityGridDe2018'
  | 'ef.heizoelDieselBafa2025'
  | 'ef.erdgasBafa2025'
  | 'ef.fluessiggasBafa2025'
  | 'ef.biogasBafa2025'
  | 'ef.pelletsBafa2025'
  | 'ef.biomasseHolzBafa2025'
  | 'ef.nahFernwaermeBafa2025'
  | 'ef.supplyCao'
  | 'ef.machineManufacture'
  | 'ef.supplyAhl'
  | 'ef.supplyUrea'
  | 'ef.supplyK2O'
  | 'ef.otherMineralN'
  | 'ef.supplyP2O5'
  | 'ef.supplyPesticides'
  | 'crop.winterBarleyFodder.supplySeed'
  | 'crop.potatoTableLate.supplySeed'
  | 'crop.silageMaize.supplySeed'
  | 'crop.canola.supplySeed'
  | 'crop.winterRyeBaking.supplySeed'
  | 'crop.winterWheat.supplySeed'
  | 'crop.sugarBeet.supplySeed'
  | 'ef.supplyNOrganic'
  | 'cf.n2oN2on'
  | 'gwp.n2o'
  | 'cf.cCo2'
  | 'pesticides.contentActiveIngredient'
  | 'ef.nPrevious'
  | 'ef.supplyUan'
  | 'nPerCHumus'
  | 'ef.appliedN.others'
  | 'crop.winterWheat.nByproductFm'
  | 'crop.silageMaize.nByproductFm'
  | 'crop.canola.nByproductFm'
  | 'crop.sugarBeet.nByproductFm'
  | 'crop.winterBarleyFodder.nByproductFm'
  | 'crop.springBarleyMalting.nByproductFm'
  | 'crop.springOatsFodder.nByproductFm'
  | 'crop.potatoTableLate.nByproductFm'
  | 'crop.winterRyeBaking.nByproductFm'
  | 'crop.winterWheat.dryMatterContent'
  | 'crop.silageMaize.dryMatterContent'
  | 'crop.canola.dryMatterContent'
  | 'crop.sugarBeet.dryMatterContent'
  | 'crop.winterBarleyFodder.dryMatterContent'
  | 'crop.springBarleyMalting.dryMatterContent'
  | 'crop.springOatsFodder.dryMatterContent'
  | 'crop.potatoTableLate.dryMatterContent'
  | 'crop.winterRyeBaking.dryMatterContent'
  | 'crop.winterWheat.MPBR'
  | 'crop.silageMaize.MPBR'
  | 'crop.canola.MPBR'
  | 'crop.sugarBeet.MPBR'
  | 'crop.winterBarleyFodder.MPBR'
  | 'crop.springBarleyMalting.MPBR'
  | 'crop.springOatsFodder.MPBR'
  | 'crop.potatoTableLate.MPBR'
  | 'crop.winterRyeBaking.MPBR'
  | 'crop.winterWheat.dryMatterContentByproduct'
  | 'crop.silageMaize.dryMatterContentByproduct'
  | 'crop.canola.dryMatterContentByproduct'
  | 'crop.sugarBeet.dryMatterContentByproduct'
  | 'crop.winterBarleyFodder.dryMatterContentByproduct'
  | 'crop.springBarleyMalting.dryMatterContentByproduct'
  | 'crop.springOatsFodder.dryMatterContentByproduct'
  | 'crop.potatoTableLate.dryMatterContentByproduct'
  | 'crop.winterRyeBaking.dryMatterContentByproduct'
  | 'crop.winterWheat.p2o5ByproductFm'
  | 'crop.winterWheat.k2oByproductFm'
  | 'crop.canola.p2o5ByproductFm'
  | 'crop.canola.k2oByproductFm'
  | 'crop.sugarBeet.p2o5ByproductFm'
  | 'crop.sugarBeet.k2oByproductFm'
  | 'crop.silageMaize.p2o5ByproductFm'
  | 'crop.silageMaize.k2oByproductFm'
  | 'crop.winterWheat.humusMain'
  | 'crop.silageMaize.humusMain'
  | 'crop.canola.humusMain'
  | 'crop.sugarBeet.humusMain'
  | 'crop.winterBarleyFodder.humusMain'
  | 'crop.springBarleyMalting.humusMain'
  | 'crop.springOatsFodder.humusMain'
  | 'crop.potatoTableLate.humusMain'
  | 'crop.winterRyeBaking.humusMain'
  | 'crop.winterWheat.piecesToKg'
  | 'crop.silageMaize.piecesToKg'
  | 'crop.canola.piecesToKg'
  | 'crop.sugarBeet.piecesToKg'
  | 'crop.winterBarleyFodder.p2o5ByproductFm'
  | 'crop.winterBarleyFodder.k2oByproductFm'
  | 'crop.winterBarleyFodder.piecesToKg'
  | 'crop.springBarleyMalting.p2o5ByproductFm'
  | 'crop.springBarleyMalting.k2oByproductFm'
  | 'crop.springBarleyMalting.piecesToKg'
  | 'crop.springBarleyMalting.supplySeed'
  | 'crop.springBarleyMalting.rootProportion'
  | 'crop.springBarleyMalting.nContentRoot'
  | 'crop.springOatsFodder.supplySeed'
  | 'crop.springOatsFodder.p2o5ByproductFm'
  | 'crop.springOatsFodder.k2oByproductFm'
  | 'crop.springOatsFodder.piecesToKg'
  | 'crop.potatoTableLate.p2o5ByproductFm'
  | 'crop.potatoTableLate.k2oByproductFm'
  | 'crop.potatoTableLate.piecesToKg'
  | 'crop.winterRyeBaking.p2o5ByproductFm'
  | 'crop.winterRyeBaking.k2oByproductFm'
  | 'crop.winterRyeBaking.piecesToKg'
  | 'crop.winterRyeBaking.nContentRoot'
  | 'crop.winterRyeBaking.rootProportion'
  | 'crop.winterWheat.thousandGrainWeight'
  | 'crop.silageMaize.thousandGrainWeight'
  | 'crop.canola.thousandGrainWeight'
  | 'crop.sugarBeet.thousandGrainWeight'
  | 'crop.winterBarleyFodder.thousandGrainWeight'
  | 'crop.springBarleyMalting.thousandGrainWeight'
  | 'crop.springOatsFodder.thousandGrainWeight'
  | 'crop.winterRyeBaking.thousandGrainWeight'
  | 'crop.sunflower.dryMatterContent'
  | 'crop.sunflower.dryMatterContentByproduct'
  | 'crop.sunflower.humusMain'
  | 'crop.sunflower.k2oByproductFm'
  | 'crop.sunflower.MPBR'
  | 'crop.sunflower.nByproductFm'
  | 'crop.sunflower.nContentRoot'
  | 'crop.sunflower.p2o5ByproductFm'
  | 'crop.sunflower.piecesToKg'
  | 'crop.sunflower.rootProportion'
  | 'crop.sunflower.supplySeed'
  | 'crop.sunflower.thousandGrainWeight'
  | 'crop.triticaleFodder.dryMatterContent'
  | 'crop.triticaleFodder.dryMatterContentByproduct'
  | 'crop.triticaleFodder.humusMain'
  | 'crop.triticaleFodder.k2oByproductFm'
  | 'crop.triticaleFodder.MPBR'
  | 'crop.triticaleFodder.nByproductFm'
  | 'crop.triticaleFodder.nContentRoot'
  | 'crop.triticaleFodder.p2o5ByproductFm'
  | 'crop.triticaleFodder.piecesToKg'
  | 'crop.triticaleFodder.rootProportion'
  | 'crop.triticaleFodder.supplySeed'
  | 'crop.triticaleFodder.thousandGrainWeight'
  | 'crop.peasDryFodder.dryMatterContent'
  | 'crop.peasDryFodder.dryMatterContentByproduct'
  | 'crop.peasDryFodder.humusMain'
  | 'crop.peasDryFodder.k2oByproductFm'
  | 'crop.peasDryFodder.MPBR'
  | 'crop.peasDryFodder.nByproductFm'
  | 'crop.peasDryFodder.nContentRoot'
  | 'crop.peasDryFodder.p2o5ByproductFm'
  | 'crop.peasDryFodder.piecesToKg'
  | 'crop.peasDryFodder.rootProportion'
  | 'crop.peasDryFodder.supplySeed'
  | 'crop.peasDryFodder.thousandGrainWeight'
  | 'crop.grainMaize.rootProportion'
  | 'crop.grainMaize.nContentRoot'
  | 'crop.grainMaize.supplySeed'
  | 'crop.grainMaize.dryMatterContent'
  | 'crop.grainMaize.MPBR'
  | 'crop.grainMaize.dryMatterContentByproduct'
  | 'crop.grainMaize.p2o5ByproductFm'
  | 'crop.grainMaize.k2oByproductFm'
  | 'crop.grainMaize.humusMain'
  | 'crop.grainMaize.piecesToKg'
  | 'crop.grainMaize.thousandGrainWeight'
  | 'crop.grainMaize.nByproductFm'
  | 'crop.hardWheat.rootProportion'
  | 'crop.hardWheat.nContentRoot'
  | 'crop.hardWheat.supplySeed'
  | 'crop.hardWheat.nByproductFm'
  | 'crop.hardWheat.dryMatterContent'
  | 'crop.hardWheat.MPBR'
  | 'crop.hardWheat.p2o5ByproductFm'
  | 'crop.hardWheat.k2oByproductFm'
  | 'crop.hardWheat.humusMain'
  | 'crop.hardWheat.piecesToKg'
  | 'crop.soybeanBeans.dryMatterContent'
  | 'crop.soybeanBeans.dryMatterContentByproduct'
  | 'crop.soybeanBeans.humusMain'
  | 'crop.soybeanBeans.k2oByproductFm'
  | 'crop.soybeanBeans.MPBR'
  | 'crop.soybeanBeans.nByproductFm'
  | 'crop.soybeanBeans.nContentRoot'
  | 'crop.soybeanBeans.p2o5ByproductFm'
  | 'crop.soybeanBeans.piecesToKg'
  | 'crop.soybeanBeans.rootProportion'
  | 'crop.soybeanBeans.supplySeed'
  | 'crop.soybeanBeans.thousandGrainWeight'
  | 'crop.broadBeans.dryMatterContent'
  | 'crop.broadBeans.dryMatterContentByproduct'
  | 'crop.broadBeans.humusMain'
  | 'crop.broadBeans.k2oByproductFm'
  | 'crop.broadBeans.MPBR'
  | 'crop.broadBeans.nByproductFm'
  | 'crop.broadBeans.nContentRoot'
  | 'crop.broadBeans.p2o5ByproductFm'
  | 'crop.broadBeans.piecesToKg'
  | 'crop.broadBeans.rootProportion'
  | 'crop.broadBeans.supplySeed'
  | 'crop.broadBeans.thousandGrainWeight'
  | 'crop.permanentGrasslandWiltedSilage.dryMatterContent'
  | 'crop.permanentGrasslandWiltedSilage.dryMatterContentByproduct'
  | 'crop.permanentGrasslandWiltedSilage.humusMain'
  | 'crop.permanentGrasslandWiltedSilage.k2oByproductFm'
  | 'crop.permanentGrasslandWiltedSilage.MPBR'
  | 'crop.permanentGrasslandWiltedSilage.nByproductFm'
  | 'crop.permanentGrasslandWiltedSilage.nContentRoot'
  | 'crop.permanentGrasslandWiltedSilage.p2o5ByproductFm'
  | 'crop.permanentGrasslandWiltedSilage.piecesToKg'
  | 'crop.permanentGrasslandWiltedSilage.restsHumusBuildingPotential'
  | 'crop.permanentGrasslandWiltedSilage.rootProportion'
  | 'crop.permanentGrasslandWiltedSilage.supplySeed'
  | 'crop.permanentGrasslandWiltedSilage.thousandGrainWeight'
  | 'crop.ryeWholePlantSilage.dryMatterContent'
  | 'crop.ryeWholePlantSilage.dryMatterContentByproduct'
  | 'crop.ryeWholePlantSilage.humusMain'
  | 'crop.ryeWholePlantSilage.k2oByproductFm'
  | 'crop.ryeWholePlantSilage.MPBR'
  | 'crop.ryeWholePlantSilage.nByproductFm'
  | 'crop.ryeWholePlantSilage.nContentRoot'
  | 'crop.ryeWholePlantSilage.p2o5ByproductFm'
  | 'crop.ryeWholePlantSilage.piecesToKg'
  | 'crop.ryeWholePlantSilage.restsHumusBuildingPotential'
  | 'crop.ryeWholePlantSilage.rootProportion'
  | 'crop.ryeWholePlantSilage.supplySeed'
  | 'crop.ryeWholePlantSilage.thousandGrainWeight'
  | 'crop.lupine.dryMatterContent'
  | 'crop.lupine.dryMatterContentByproduct'
  | 'crop.lupine.humusMain'
  | 'crop.lupine.k2oByproductFm'
  | 'crop.lupine.MPBR'
  | 'crop.lupine.nByproductFm'
  | 'crop.lupine.nContentRoot'
  | 'crop.lupine.p2o5ByproductFm'
  | 'crop.lupine.piecesToKg'
  | 'crop.lupine.rootProportion'
  | 'crop.lupine.supplySeed'
  | 'crop.lupine.thousandGrainWeight'
  | 'crop.spelt.dryMatterContent'
  | 'crop.spelt.dryMatterContentByproduct'
  | 'crop.spelt.humusMain'
  | 'crop.spelt.k2oByproductFm'
  | 'crop.spelt.MPBR'
  | 'crop.spelt.nByproductFm'
  | 'crop.spelt.nContentRoot'
  | 'crop.spelt.p2o5ByproductFm'
  | 'crop.spelt.piecesToKg'
  | 'crop.spelt.rootProportion'
  | 'crop.spelt.supplySeed'
  | 'crop.spelt.thousandGrainWeight'
  | 'crop.permanentGrasslandMulched.dryMatterContent'
  | 'crop.permanentGrasslandMulched.dryMatterContentByproduct'
  | 'crop.permanentGrasslandMulched.humusMain'
  | 'crop.permanentGrasslandMulched.k2oByproductFm'
  | 'crop.permanentGrasslandMulched.MPBR'
  | 'crop.permanentGrasslandMulched.nByproductFm'
  | 'crop.permanentGrasslandMulched.nContentRoot'
  | 'crop.permanentGrasslandMulched.p2o5ByproductFm'
  | 'crop.permanentGrasslandMulched.piecesToKg'
  | 'crop.permanentGrasslandMulched.restsHumusBuildingPotential'
  | 'crop.permanentGrasslandMulched.rootProportion'
  | 'crop.permanentGrasslandMulched.supplySeed'
  | 'crop.permanentGrasslandMulched.thousandGrainWeight'
  | 'orgFertParams.cattleLiquidManure.8h'
  | 'orgFertParams.cattleLiquidManure.noIncorporation'
  | 'orgFertParams.pigLiquidManure.8h'
  | 'orgFertParams.pigSlurry.8h'
  | 'orgFertParams.digestateLiquid.8h'
  | 'ef.supplyGreenFertilizer'
  | 'ef.supplyGreenFertilizerLiquid';
