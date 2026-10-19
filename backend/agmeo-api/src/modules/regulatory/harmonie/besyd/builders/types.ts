/** Ported from agmeo `src/lib/federalExport/harmonie-export/besyd/builders/types.ts`. */

export type FieldData = {
  id: string;
  name: string;
  areaInHa: number;
  flik?: string;
  /** BESyD Tabelle 5 Bodenart code */
  bodenart?: string;
  nitrateSensitiveZone?: boolean;
};

export type CultivationData = {
  id: string;
  fieldId: string;
  crop: string;
  areaInHa: number;
  sowingDate: Date;
  previousCrop?: string;
  /** Set whenever `previousCrop` resolves to a Fruchtart (recorded or derived). */
  previousCropSowingDate?: Date;
  previousCropYield?: number;
  expectedYield?: number;
  isSecondCrop?: boolean;
  filmOrFleece?: boolean;
  /** Crude protein of the main product in % TM (grassland only in IMPANBAU). */
  rawProteinPercent?: number;
  cuts?: number;
  grazingSharePercent?: number;
};

export type OrganicFertilizationData = {
  cultivationId: string;
  fieldId: string;
  applicationDate?: Date | string;
  fertilizerCode?: string;
  fertilizerName?: string;
  /** t/ha or m³/ha */
  amountPerHa?: number;
  /** t or m³ */
  totalAmount?: number;
  dryMatterPercent?: number;
  /** all contents in % of fresh mass */
  nPercent?: number;
  nh4Percent?: number;
  pPercent?: number;
  p2o5Percent?: number;
  kPercent?: number;
  mgPercent?: number;
  sPercent?: number;
  /** DüV Anlage 3 Mindestwirksamkeit in % of total N */
  mindestwirksamkeitPercent?: number;
};

export type GrazingData = {
  cultivationId: string;
  fieldId: string;
  endDate?: Date;
  animalGroup: string;
  animalCode?: string;
  animalName: string;
  animals: number;
  days: number;
  nKgPerAnimalDay?: number;
  p2o5KgPerAnimalDay?: number;
};

export type MineralFertilizationData = {
  cultivationId: string;
  fieldId: string;
  applicationDate?: Date | string;
  fertilizerGroupCode?: string;
  fertilizerName?: string;
  /** dt/ha */
  amountPerHa?: number;
  /** dt */
  totalAmount?: number;
  /** all contents in % */
  nPercent?: number;
  pPercent?: number;
  p2o5Percent?: number;
  kPercent?: number;
  mgPercent?: number;
  caoPercent?: number;
  sPercent?: number;
  referenceId?: number;
};

export type NminData = {
  cultivationId: string;
  fieldId: string;
  sampleDate?: Date;
  probeNr?: string;
  nmin030?: number;
  nmin3060?: number;
  nmin6090?: number;
  nmin015?: number;
  nmin1530?: number;
  /** Nmin-Richtwert used instead of a measurement — filed as the flag alone, without layer values. */
  useReferenceValue: boolean;
};

export type MacroNutrientData = {
  fieldId: string;
  sampleDate: Date;
  probeNr?: string;
  laborNr?: string;
  humusPercent?: number;
  ph?: number;
  pMgPer100g?: number;
  kMgPer100g?: number;
  mgMgPer100g?: number;
  methodPK?: 'C' | 'D';
  fineContentPercent?: number;
  corgPercent?: number;
  ntPercent?: number;
};

export type LegumeData = {
  cultivationId: string;
  fieldId: string;
  harvestDate?: Date | string;
  legumeCode?: string;
  legumeName?: string;
  yieldDtPerHa?: number;
  totalYieldDt?: number;
  nFixationKgPerDt?: number;
};

export type HarvestData = {
  cultivationId: string;
  fieldId: string;
  harvestDate: Date;
  cropName?: string;
  yieldMainProductDtPerHa?: number;
  yieldByProductDtPerHa?: number;
  yieldGrazingDtPerHa?: number;
  usageMainProduct?: string;
  usageByProduct?: string;
  legumeSharePercent?: number;
  nRemovalTotal?: number;
  nRemovalByProduct?: number;
  nRemovalMainProduct?: number;
  pRemovalTotal?: number;
  pRemovalByProduct?: number;
  pRemovalMainProduct?: number;
  kRemovalTotal?: number;
  kRemovalByProduct?: number;
  kRemovalMainProduct?: number;
  mgRemovalTotal?: number;
  mgRemovalByProduct?: number;
  mgRemovalMainProduct?: number;
  sRemovalTotal?: number;
  sRemovalByProduct?: number;
  sRemovalMainProduct?: number;
  rawProteinPercent?: number;
  dryMatterMainPercent?: number;
  dryMatterByProductPercent?: number;
  mainToByProductRatio?: number;
};

export type FieldIdentifiers = { fstnr: string; snr: string };
export type CropCodeInfo = { datumf: string; frucht: string };

/** FSTNR / SNR of every field: its 1-based position in the name-sorted field list, built once per export. */
export function getFieldIdentifiers(
  fields: FieldData[],
): Map<string, FieldIdentifiers> {
  const sorted = [...fields].sort(
    (a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id),
  );
  return new Map(
    sorted.map((f, index) => {
      const num = (index + 1).toString().padStart(3, '0');
      return [f.id, { fstnr: num, snr: num }];
    }),
  );
}
