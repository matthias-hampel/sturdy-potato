import type { BesydOrgMetadata } from '../../besyd/types.js';
import type { EndoOrgMetadata } from '../../endo/types.js';
import type { EnniOrgMetadata } from '../../enni/types.js';
import type { ExportData, PreflightResult } from '../../types.js';
import { runRules } from './engine.js';
import { BESYD_METADATA_RULES, BESYD_RULES } from './rules/besyd.js';
import {
  ENDO_METADATA_RULES,
  ENDO_RULES,
  ENNI_METADATA_RULES,
  ENNI_RULES,
} from './rules/enniEndo.js';

export function runEnniPreflightRules(
  data: ExportData,
  metadata?: EnniOrgMetadata,
): PreflightResult {
  return runRules(ENNI_RULES, ENNI_METADATA_RULES, {
    data,
    metadata: metadata ?? {},
    format: 'enni',
  });
}

export function runEndoPreflightRules(
  data: ExportData,
  metadata?: EndoOrgMetadata,
): PreflightResult {
  return runRules(ENDO_RULES, ENDO_METADATA_RULES, {
    data,
    metadata: metadata ?? {},
    format: 'endo',
  });
}

export function runBesydPreflightRules(
  data: ExportData,
  metadata?: BesydOrgMetadata,
): PreflightResult {
  return runRules(BESYD_RULES, BESYD_METADATA_RULES, {
    data,
    metadata: metadata ?? {},
    format: 'besyd',
  });
}
