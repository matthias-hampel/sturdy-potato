/**
 * Preflight rule engine — pure and synchronous.
 *
 * Rules mirror the import validation stages of the authorities' programs
 * (XSD → Pflichtfelder → Stammdaten → Eingaberoutinen → Plausibilität) so a
 * file that passes here is not rejected on upload.
 */

import type {
  ExportData,
  MissingCropMapping,
  MissingField,
  PreflightIssue,
  PreflightResult,
  PreflightSeverity,
  PreflightStage,
} from '../../types.js';

export type ExportFormat = 'enni' | 'endo';

export type RuleContext<M> = {
  data: ExportData;
  metadata: M;
  format: ExportFormat;
};

export type Rule<M> = {
  code: string;
  severity: PreflightSeverity;
  stage: PreflightStage;
  check: (
    ctx: RuleContext<M>,
  ) => Omit<PreflightIssue, 'code' | 'severity' | 'stage'>[];
};

/** Metadata-level checks that also drive the "complete these fields" form. */
export type MetadataRule<M> = {
  check: (ctx: RuleContext<M>) => {
    missingFields?: MissingField[];
    missingCropMappings?: MissingCropMapping[];
  };
};

export function runRules<M>(
  rules: Rule<M>[],
  metadataRules: MetadataRule<M>[],
  ctx: RuleContext<M>,
): PreflightResult {
  const issues: PreflightIssue[] = [];
  const seen = new Set<string>();

  for (const rule of rules) {
    for (const found of rule.check(ctx)) {
      const key = `${rule.code}:${found.fieldId ?? ''}:${found.cultivationId ?? ''}:${found.value ?? ''}`;
      if (seen.has(key)) continue;
      seen.add(key);
      issues.push({
        code: rule.code,
        severity: rule.severity,
        stage: rule.stage,
        ...found,
      });
    }
  }

  const missingFields: MissingField[] = [];
  const missingCropMappings: MissingCropMapping[] = [];
  for (const rule of metadataRules) {
    const result = rule.check(ctx);
    if (result.missingFields) missingFields.push(...result.missingFields);
    if (result.missingCropMappings)
      missingCropMappings.push(...result.missingCropMappings);
  }

  const order: Record<PreflightSeverity, number> = {
    blocking: 0,
    warning: 1,
    info: 2,
  };
  issues.sort((a, b) => order[a.severity] - order[b.severity]);

  const isValid =
    missingFields.length === 0 &&
    missingCropMappings.length === 0 &&
    !issues.some((issue) => issue.severity === 'blocking');

  return { isValid, missingFields, missingCropMappings, issues };
}

/**
 * Crop → cultivation counts of the export year, sorted by crop name. The XML
 * dialects file a Herbstansaat with its own Fruchtart and need its code; the
 * table formats book its applications on the Hauptfrucht and do not.
 */
export function cropCounts(
  data: ExportData,
  includeHerbstansaat = true,
): { cropName: string; count: number }[] {
  const counts = new Map<string, number>();
  for (const field of data.fields) {
    for (const cult of field.cultivations) {
      if (cult.herbstansaat && !includeHerbstansaat) continue;
      counts.set(cult.crop, (counts.get(cult.crop) ?? 0) + 1);
      if (cult.previousCrop)
        counts.set(cult.previousCrop, (counts.get(cult.previousCrop) ?? 0) + 1);
    }
  }
  return [...counts.entries()]
    .map(([cropName, count]) => ({ cropName, count }))
    .sort((a, b) => a.cropName.localeCompare(b.cropName));
}
