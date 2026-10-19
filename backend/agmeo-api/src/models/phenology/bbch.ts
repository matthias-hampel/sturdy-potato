/**
 * Ported from AGVOLUTION/agmeo src/lib/phenology/bbch.ts — logic, numbers and
 * thresholds unchanged; only imports adapted to the rewrite.
 */

import type { SupportedCrops } from '../crops.js';

type BBCHThreshold = {
  bbch: number;
  gdd: number;
  description: string;
};

const BBCH_THRESHOLDS: Partial<Record<SupportedCrops, BBCHThreshold[]>> = {
  winterWheat: [
    { bbch: 0, gdd: 0, description: 'bbch.germination' },
    { bbch: 10, gdd: 100, description: 'bbch.firstLeaf' },
    { bbch: 21, gdd: 200, description: 'bbch.tilleringBegins' },
    { bbch: 30, gdd: 500, description: 'bbch.stemElongation' },
    { bbch: 39, gdd: 800, description: 'bbch.flagLeaf' },
    { bbch: 51, gdd: 1000, description: 'bbch.headingBegins' },
    { bbch: 61, gdd: 1150, description: 'bbch.floweringBegins' },
    { bbch: 71, gdd: 1350, description: 'bbch.grainFilling' },
    { bbch: 87, gdd: 1700, description: 'bbch.hardDough' },
    { bbch: 92, gdd: 1900, description: 'bbch.harvestReady' },
  ],
  winterBarleyFodder: [
    { bbch: 0, gdd: 0, description: 'bbch.germination' },
    { bbch: 10, gdd: 90, description: 'bbch.firstLeaf' },
    { bbch: 21, gdd: 180, description: 'bbch.tilleringBegins' },
    { bbch: 30, gdd: 450, description: 'bbch.stemElongation' },
    { bbch: 39, gdd: 700, description: 'bbch.flagLeaf' },
    { bbch: 51, gdd: 900, description: 'bbch.headingBegins' },
    { bbch: 61, gdd: 1050, description: 'bbch.floweringBegins' },
    { bbch: 71, gdd: 1200, description: 'bbch.grainFilling' },
    { bbch: 87, gdd: 1500, description: 'bbch.hardDough' },
    { bbch: 92, gdd: 1650, description: 'bbch.harvestReady' },
  ],
  winterRyeBaking: [
    { bbch: 0, gdd: 0, description: 'bbch.germination' },
    { bbch: 10, gdd: 100, description: 'bbch.firstLeaf' },
    { bbch: 21, gdd: 200, description: 'bbch.tilleringBegins' },
    { bbch: 30, gdd: 480, description: 'bbch.stemElongation' },
    { bbch: 39, gdd: 750, description: 'bbch.flagLeaf' },
    { bbch: 51, gdd: 950, description: 'bbch.headingBegins' },
    { bbch: 61, gdd: 1100, description: 'bbch.floweringBegins' },
    { bbch: 71, gdd: 1300, description: 'bbch.grainFilling' },
    { bbch: 87, gdd: 1600, description: 'bbch.hardDough' },
    { bbch: 92, gdd: 1800, description: 'bbch.harvestReady' },
  ],
  triticaleFodder: [
    { bbch: 0, gdd: 0, description: 'bbch.germination' },
    { bbch: 10, gdd: 100, description: 'bbch.firstLeaf' },
    { bbch: 21, gdd: 200, description: 'bbch.tilleringBegins' },
    { bbch: 30, gdd: 500, description: 'bbch.stemElongation' },
    { bbch: 39, gdd: 780, description: 'bbch.flagLeaf' },
    { bbch: 51, gdd: 980, description: 'bbch.headingBegins' },
    { bbch: 61, gdd: 1130, description: 'bbch.floweringBegins' },
    { bbch: 71, gdd: 1330, description: 'bbch.grainFilling' },
    { bbch: 87, gdd: 1680, description: 'bbch.hardDough' },
    { bbch: 92, gdd: 1850, description: 'bbch.harvestReady' },
  ],
  springBarleyMalting: [
    { bbch: 0, gdd: 0, description: 'bbch.germination' },
    { bbch: 10, gdd: 80, description: 'bbch.firstLeaf' },
    { bbch: 21, gdd: 160, description: 'bbch.tilleringBegins' },
    { bbch: 30, gdd: 400, description: 'bbch.stemElongation' },
    { bbch: 39, gdd: 650, description: 'bbch.flagLeaf' },
    { bbch: 51, gdd: 850, description: 'bbch.headingBegins' },
    { bbch: 61, gdd: 1000, description: 'bbch.floweringBegins' },
    { bbch: 71, gdd: 1150, description: 'bbch.grainFilling' },
    { bbch: 87, gdd: 1400, description: 'bbch.hardDough' },
    { bbch: 92, gdd: 1550, description: 'bbch.harvestReady' },
  ],
  canola: [
    { bbch: 0, gdd: 0, description: 'bbch.germination' },
    { bbch: 10, gdd: 100, description: 'bbch.cotyledons' },
    { bbch: 15, gdd: 300, description: 'bbch.5leaves' },
    { bbch: 30, gdd: 600, description: 'bbch.stemElongation' },
    { bbch: 51, gdd: 800, description: 'bbch.budsVisible' },
    { bbch: 61, gdd: 950, description: 'bbch.firstFlowers' },
    { bbch: 69, gdd: 1100, description: 'bbch.fullFlowering' },
    { bbch: 79, gdd: 1400, description: 'bbch.podDevelopment' },
    { bbch: 87, gdd: 1700, description: 'bbch.seedRipening' },
    { bbch: 92, gdd: 1900, description: 'bbch.harvestReady' },
  ],
  silageMaize: [
    { bbch: 0, gdd: 0, description: 'bbch.germination' },
    { bbch: 10, gdd: 80, description: 'bbch.firstLeaf' },
    { bbch: 16, gdd: 350, description: 'bbch.6leaves' },
    { bbch: 30, gdd: 500, description: 'bbch.stemElongation' },
    { bbch: 51, gdd: 700, description: 'bbch.tasselEmergence' },
    { bbch: 61, gdd: 850, description: 'bbch.silking' },
    { bbch: 71, gdd: 1000, description: 'bbch.milkStage' },
    { bbch: 83, gdd: 1250, description: 'bbch.doughStage' },
    { bbch: 87, gdd: 1400, description: 'bbch.dentStage' },
    { bbch: 92, gdd: 1550, description: 'bbch.harvestReady' },
  ],
  grainMaize: [
    { bbch: 0, gdd: 0, description: 'bbch.germination' },
    { bbch: 10, gdd: 80, description: 'bbch.firstLeaf' },
    { bbch: 16, gdd: 350, description: 'bbch.6leaves' },
    { bbch: 30, gdd: 500, description: 'bbch.stemElongation' },
    { bbch: 51, gdd: 700, description: 'bbch.tasselEmergence' },
    { bbch: 61, gdd: 850, description: 'bbch.silking' },
    { bbch: 71, gdd: 1000, description: 'bbch.milkStage' },
    { bbch: 83, gdd: 1300, description: 'bbch.doughStage' },
    { bbch: 87, gdd: 1500, description: 'bbch.dentStage' },
    { bbch: 92, gdd: 1700, description: 'bbch.harvestReady' },
  ],
};

export function calculateBBCH(
  cumulativeGDD: number | null,
  crop: SupportedCrops,
): number | null {
  if (cumulativeGDD === null) return null;
  const thresholds = BBCH_THRESHOLDS[crop];
  if (!thresholds) return 0;

  let currentBBCH = 0;
  for (const threshold of thresholds) {
    if (cumulativeGDD >= threshold.gdd) {
      currentBBCH = threshold.bbch;
    } else {
      break;
    }
  }
  return currentBBCH;
}
