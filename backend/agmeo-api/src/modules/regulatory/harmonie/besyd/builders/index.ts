/** Ported from agmeo `src/lib/federalExport/harmonie-export/besyd/builders/index.ts`. */

export type {
  FieldData,
  CultivationData,
  OrganicFertilizationData,
  MineralFertilizationData,
  NminData,
  MacroNutrientData,
  LegumeData,
  GrazingData,
  HarvestData,
  FieldIdentifiers,
  CropCodeInfo,
} from './types.js';
export { getFieldIdentifiers } from './types.js';

export {
  IMPBETR_COLUMNS,
  buildImpBetr,
  serializeImpBetrRow,
} from './impbetr.js';

export type { ImpAnbauBuildContext } from './impanbau.js';
export {
  IMPANBAU_COLUMNS,
  buildImpAnbau,
  serializeImpAnbauRow,
} from './impanbau.js';

export type { ImpOrgBuildContext } from './imporg.js';
export { IMPORG_COLUMNS, buildImpOrg, serializeImpOrgRow } from './imporg.js';

export type { ImpMindBuildContext } from './impmind.js';
export {
  IMPMIND_COLUMNS,
  buildImpMind,
  serializeImpMindRow,
} from './impmind.js';

export type { ImpNminBuildContext } from './impnmin.js';
export {
  IMPNMIN_COLUMNS,
  buildImpNmin,
  serializeImpNminRow,
} from './impnmin.js';

export type { ImpMakroBuildContext } from './impmakro.js';
export {
  IMPMAKRO_COLUMNS,
  buildImpMakro,
  serializeImpMakroRow,
} from './impmakro.js';

export type { ImpNlegumBuildContext } from './impnlegum.js';
export {
  IMPNLEGUM_COLUMNS,
  getLegumeCode,
  buildImpNlegum,
  serializeImpNlegumRow,
} from './impnlegum.js';

export {
  IMPNLEGUMBETRIEB_COLUMNS,
  buildImpNlegumBetrieb,
  serializeImpNlegumBetriebRow,
} from './impnlegumbetrieb.js';

export type { ImpWeideBuildContext } from './impweide.js';
export {
  IMPWEIDE_COLUMNS,
  IMPWEIDEBETRIEB_COLUMNS,
  buildImpWeide,
  buildImpWeideBetrieb,
  serializeImpWeideRow,
  serializeImpWeideBetriebRow,
} from './impweide.js';

export type { ImpErnteBuildContext } from './impernte.js';
export {
  IMPERNTE_COLUMNS,
  buildImpErnte,
  serializeImpErnteRow,
} from './impernte.js';
