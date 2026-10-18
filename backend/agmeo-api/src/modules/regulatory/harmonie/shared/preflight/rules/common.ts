/**
 * Rules shared by every format. Severities differ per format where the
 * authorities' import behaves differently; those rules take the format from
 * the context.
 */

import type {
  ExportCultivation,
  ExportField,
  ExportSoilSample,
} from '../../../types.js';
import { formatGermanDate, isDateInWindow } from '../../../utils.js';
import {
  classifyCultivations,
  isGrasslandCrop,
  isHauptfruchtCandidate,
} from '../../fruchtklasse.js';
import { assignSchlagnummern } from '../../xmlHelpers.js';
import type { ExportFormat, Rule } from '../engine.js';

type BaseMetadata = object;

export const FORMAT_STATES: Record<ExportFormat, readonly string[]> = {
  enni: ['NI'],
  endo: ['SH'],
};

const FLIK_MAX_LENGTH: Record<ExportFormat, number> = { enni: 16, endo: 16 };

const SOIL_SAMPLE_MAX_AGE_MS = 6 * 365.25 * 86400000;
/** Plausibility caps (same values as the sanity checker of the settings page). */
const MAX_N_KG_PER_HA = 350;
const MAX_FIELD_SIZE_HA = 200;
/** DüV §6(4): farm average of organic N incl. grazing. */
const N170_FARM_AVERAGE = 170;
/** DüV §2 Nr. 10 "wesentliche Nährstoffmengen" — above these the application is aufzeichnungspflichtig. */
const WESENTLICH_N_KG_PER_HA = 50;
const WESENTLICH_P2O5_KG_PER_HA = 30;
/**
 * DüV §3(6): soils above these P contents are capped at the P removal. The
 * threshold depends on the lab method (mg per 100 g soil); CAL and DL are
 * reported as P2O5, EUF as P.
 */
const P_CAP_THRESHOLDS: Record<string, { threshold: number; unit: string }> = {
  cal: { threshold: 20, unit: 'mg P2O5/100 g (CAL)' },
  dl: { threshold: 25, unit: 'mg P2O5/100 g (DL)' },
  euf: { threshold: 3.6, unit: 'mg P/100 g (EUF)' },
};

const fieldRef = (field: ExportField) => ({
  scope: 'field' as const,
  fieldId: field.id,
  fieldName: field.name,
});
const cultRef = (field: ExportField, cult: ExportCultivation) => ({
  scope: 'cultivation' as const,
  fieldId: field.id,
  fieldName: field.name,
  cultivationId: cult.cultivationId,
  params: { crop: cult.crop },
});

/** Nothing to file: the farm has no fields at all (crop-less fields are still filed by the XML dialects). */
const exportEmpty: Rule<BaseMetadata> = {
  code: 'export_empty',
  severity: 'blocking',
  stage: 'eingaberoutinen',
  check: ({ data }) => (data.fields.length > 0 ? [] : [{ scope: 'betrieb' }]),
};

const fieldsWithCultivation = (fields: ExportField[]) =>
  fields.filter((f) => f.cultivations.length > 0);

/** The farm's Bundesland does not accept this format (blocking for both Dube2.5 dialects). */
export function bundeslandMismatch(
  severity: Rule<BaseMetadata>['severity'],
): Rule<BaseMetadata> {
  return {
    code: 'bundesland_mismatch',
    severity,
    stage: 'pflichtfelder',
    check: ({ data, format }) => {
      if (
        !data.federalState ||
        FORMAT_STATES[format].includes(data.federalState)
      )
        return [];
      return [
        {
          scope: 'betrieb',
          value: data.federalState,
          params: { state: data.federalState },
        },
      ];
    },
  };
}

const schlagnameMissing: Rule<BaseMetadata> = {
  code: 'schlagname_missing',
  severity: 'warning',
  stage: 'pflichtfelder',
  check: ({ data }) => {
    // The placeholder must match the Schlagnummer the export itself assigns.
    const fields = data.fields;
    const nummern = assignSchlagnummern(fields);
    return fields
      .filter((f) => !f.name)
      .map((f) => ({
        ...fieldRef(f),
        fieldName: `Feld #${nummern.get(f.id) ?? ''}`,
        value: '',
      }));
  },
};

const schlagnummerMissing: Rule<BaseMetadata> = {
  code: 'schlagnummer_missing',
  severity: 'warning',
  stage: 'pflichtfelder',
  check: ({ data }) =>
    data.fields
      .filter((f) => !f.parcelId)
      .map((f) => ({ ...fieldRef(f), value: '' })),
};

const schlagnummerNotInteger: Rule<BaseMetadata> = {
  code: 'schlagnummer_not_integer',
  severity: 'warning',
  stage: 'pflichtfelder',
  check: ({ data }) =>
    data.fields
      .filter((f) => {
        if (!f.parcelId) return false;
        const num = parseInt(f.parcelId, 10);
        return isNaN(num) || num <= 0;
      })
      .map((f) => ({ ...fieldRef(f), value: f.parcelId ?? '' })),
};

/** Colliding Parzellennummern are renumbered deterministically; the rule tells which field got which number. */
const schlagnummerDuplicate: Rule<BaseMetadata> = {
  code: 'schlagnummer_duplicate',
  severity: 'warning',
  stage: 'eingaberoutinen',
  check: ({ data }) => {
    const fields = data.fields;
    const assigned = assignSchlagnummern(fields);
    return fields
      .filter(
        (f) =>
          f.parcelId && String(parseInt(f.parcelId, 10)) !== assigned.get(f.id),
      )
      .filter((f) => !isNaN(parseInt(f.parcelId ?? '', 10)))
      .map((f) => ({
        ...fieldRef(f),
        value: f.parcelId ?? '',
        params: { assigned: assigned.get(f.id) ?? '' },
      }));
  },
};

export const flikMissing: Rule<BaseMetadata> = {
  code: 'flik_missing',
  severity: 'warning',
  stage: 'pflichtfelder',
  check: ({ data }) =>
    data.fields
      .filter((f) => !f.flik)
      .map((f) => ({ ...fieldRef(f), value: '' })),
};

const flikTooLong: Rule<BaseMetadata> = {
  code: 'flik_too_long',
  severity: 'warning',
  stage: 'xsd',
  check: ({ data, format }) =>
    data.fields
      .filter((f) => f.flik && f.flik.length > FLIK_MAX_LENGTH[format])
      .map((f) => ({
        ...fieldRef(f),
        value: f.flik ?? '',
        params: { max: FLIK_MAX_LENGTH[format] },
      })),
};

/** Dube2.5 dialects file a crop-less field as KEINE-AUFZEICHNUNGSPFLICHT — the farmer should add the crop if it was farmed. */
const fieldWithoutCultivation: Rule<BaseMetadata> = {
  code: 'field_without_cultivation',
  severity: 'info',
  stage: 'eingaberoutinen',
  check: ({ data }) =>
    data.fields.filter((f) => f.cultivations.length === 0).map(fieldRef),
};

const datesParam = (dates: Date[]) => dates.map(formatGermanDate).join(', ');

/** Applications of this year's crop dated before the window belong to (and are filed with) the previous Düngejahr. */
const fertilizationPreviousDuengejahr: Rule<BaseMetadata> = {
  code: 'fertilization_previous_duengejahr',
  severity: 'info',
  stage: 'eingaberoutinen',
  check: ({ data }) =>
    data.fields.flatMap((f) =>
      f.cultivations.flatMap((c) => {
        const dates = c.droppedFertilizationDates.filter(
          (d) => d < data.duengejahr.start,
        );
        if (dates.length === 0) return [];
        return [
          {
            ...cultRef(f, c),
            value: dates[0].toISOString().slice(0, 10),
            params: {
              crop: c.crop,
              count: dates.length,
              dates: datesParam(dates),
              year: data.year - 1,
            },
          },
        ];
      }),
    ),
};

/** Applications of this year's crop dated after the window: no export picks them up. */
const fertilizationOutsideDuengejahr: Rule<BaseMetadata> = {
  code: 'fertilization_outside_duengejahr',
  severity: 'info',
  stage: 'eingaberoutinen',
  check: ({ data }) =>
    data.fields.flatMap((f) =>
      f.cultivations.flatMap((c) => {
        const dates = c.droppedFertilizationDates.filter(
          (d) => d > data.duengejahr.end,
        );
        if (dates.length === 0) return [];
        return [
          {
            ...cultRef(f, c),
            value: dates[0].toISOString().slice(0, 10),
            params: {
              crop: c.crop,
              count: dates.length,
              dates: datesParam(dates),
            },
          },
        ];
      }),
    ),
};

/** Autumn applications booked on next year's crop are filed here as HERBSTANSAAT. */
const fertilizationReportedAsHerbstansaat: Rule<BaseMetadata> = {
  code: 'fertilization_reported_as_herbstansaat',
  severity: 'info',
  stage: 'eingaberoutinen',
  check: ({ data }) =>
    data.fields.flatMap((f) =>
      f.cultivations
        .filter((c) => c.herbstansaat && c.fertilizations.length > 0)
        .map((c) => ({
          ...cultRef(f, c),
          value: c.fertilizations[0].date.toISOString().slice(0, 10),
          params: {
            crop: c.crop,
            year: data.year + 1,
            count: c.fertilizations.length,
            dates: datesParam(c.fertilizations.map((fert) => fert.date)),
          },
        })),
    ),
};

const cultivationOutsideDuengejahr: Rule<BaseMetadata> = {
  code: 'cultivation_outside_duengejahr',
  severity: 'info',
  stage: 'eingaberoutinen',
  check: ({ data }) =>
    data.fields.flatMap((f) =>
      f.cultivations
        .filter(
          (c) =>
            c.harvest &&
            !isDateInWindow(c.harvest.date, data.duengejahr) &&
            c.harvest.date < data.duengejahr.start,
        )
        .map((c) => cultRef(f, c)),
    ),
};

/** ENNI Eingaberoutine: only one Hauptfrucht per Ackerschlag and year. */
export const multipleHauptfrucht: Rule<BaseMetadata> = {
  code: 'multiple_hauptfrucht',
  severity: 'blocking',
  stage: 'eingaberoutinen',
  check: ({ data }) =>
    data.fields
      .filter((f) => {
        const mains = f.cultivations.filter(isHauptfruchtCandidate);
        if (mains.length < 2) return false;
        // Two main crops with a sowing order become Haupt-/Zweitfrucht; without
        // sowing dates the order is arbitrary and the authority will reject the file.
        return mains.some((c) => !c.sowingDate);
      })
      .map((f) => ({
        ...fieldRef(f),
        params: {
          count: classifyCultivations(f.cultivations).filter(
            (k) => k === 'HAUPTFRUCHT',
          ).length,
        },
      })),
};

export function vorfruchtMissing(
  severity: Rule<BaseMetadata>['severity'],
): Rule<BaseMetadata> {
  return {
    code: 'vorfrucht_missing',
    severity,
    stage: 'pflichtfelder',
    check: ({ data }) =>
      data.fields.flatMap((f) =>
        f.cultivations
          .filter((c) => isHauptfruchtCandidate(c) && !c.previousCrop)
          .map((c) => cultRef(f, c)),
      ),
  };
}

export const sowingDateMissing: Rule<BaseMetadata> = {
  code: 'sowing_date_missing',
  severity: 'warning',
  stage: 'pflichtfelder',
  check: ({ data }) =>
    data.fields.flatMap((f) =>
      f.cultivations
        .filter(
          (c) => !c.sowingDate && !c.herbstansaat && !isGrasslandCrop(c.crop),
        )
        .map((c) => cultRef(f, c)),
    ),
};

const nminMissing: Rule<BaseMetadata> = {
  code: 'nmin_missing',
  severity: 'info',
  stage: 'stammdaten',
  check: ({ data }) =>
    data.fields.flatMap((f) =>
      f.cultivations
        .filter((c) => isHauptfruchtCandidate(c) && !c.nmin)
        .map((c) => cultRef(f, c)),
    ),
};

const soilSampleMissing: Rule<BaseMetadata> = {
  code: 'soil_sample_missing',
  severity: 'info',
  stage: 'stammdaten',
  check: ({ data }) =>
    data.fields.filter((f) => f.soilSamples.length === 0).map(fieldRef),
};

const plusSixYears = (date: Date) => {
  const until = new Date(date);
  until.setUTCFullYear(until.getUTCFullYear() + 6);
  return until;
};

/** DüV §4(4): a current analysis is filed; the info tells the farmer how long it stays valid. */
const soilSampleValidUntil: Rule<BaseMetadata> = {
  code: 'soil_sample_valid_until',
  severity: 'info',
  stage: 'stammdaten',
  check: ({ data }) =>
    data.fields.flatMap((f) => {
      const latest = f.soilSamples[0];
      if (
        !latest ||
        data.duengejahr.end.getTime() - latest.date.getTime() >
          SOIL_SAMPLE_MAX_AGE_MS
      )
        return [];
      return [
        {
          ...fieldRef(f),
          value: latest.date.toISOString().slice(0, 10),
          params: {
            date: formatGermanDate(latest.date),
            validUntil: formatGermanDate(plusSixYears(latest.date)),
          },
        },
      ];
    }),
};

/** DüV §4(4): the P/K/Mg analysis must not be older than six years. */
const soilSampleOlderThan6Years: Rule<BaseMetadata> = {
  code: 'soil_sample_older_than_6_years',
  severity: 'warning',
  stage: 'stammdaten',
  check: ({ data }) =>
    data.fields
      .filter((f) => {
        const latest = f.soilSamples[0];
        return (
          latest &&
          data.duengejahr.end.getTime() - latest.date.getTime() >
            SOIL_SAMPLE_MAX_AGE_MS
        );
      })
      .map((f) => ({
        ...fieldRef(f),
        value: f.soilSamples[0].date.toISOString().slice(0, 10),
      })),
};

function pCap(sample: ExportSoilSample): { threshold: number; unit: string } {
  const method = (sample.method ?? 'cal').toLowerCase();
  return P_CAP_THRESHOLDS[
    method.startsWith('dl') ? 'dl' : method.startsWith('euf') ? 'euf' : 'cal'
  ];
}

/** DüV §3(6): P fertilization on a field above the method's threshold is limited to the removal. */
const pCapExceeded: Rule<BaseMetadata> = {
  code: 'p_cap_exceeded',
  severity: 'warning',
  stage: 'plausibilitaet',
  check: ({ data }) =>
    data.fields.flatMap((f) => {
      const latest = f.soilSamples[0];
      if (!latest || latest.p2o5 === null) return [];
      const { threshold, unit } = pCap(latest);
      if (latest.p2o5 <= threshold) return [];
      const p2o5Applied = f.cultivations.reduce(
        (sum, c) =>
          sum +
          c.fertilizations.reduce((s, fert) => s + (fert.p2o5KgPerHa ?? 0), 0),
        0,
      );
      if (p2o5Applied <= 0) return [];
      return [
        {
          ...fieldRef(f),
          value: latest.p2o5.toFixed(1),
          params: {
            p2o5: latest.p2o5.toFixed(1),
            threshold,
            unit,
            applied: Math.round(p2o5Applied),
          },
        },
      ];
    }),
};

const isOrganic = (fert: ExportCultivation['fertilizations'][number]) =>
  fert.naehrstofftraegerart !== 'MINERALDUENGER';

/** DüV §6(4): organic N (incl. grazing) averaged over the farm's fertilized area must stay below 170 kg N/ha. */
const n170FarmAverageExceeded: Rule<BaseMetadata> = {
  code: 'n170_farm_average_exceeded',
  severity: 'warning',
  stage: 'plausibilitaet',
  check: ({ data }) => {
    const fields = fieldsWithCultivation(data.fields);
    const area = fields.reduce((sum, f) => sum + f.areaInHa, 0);
    if (area <= 0) return [];
    const organicN = fields.reduce(
      (sum, f) =>
        sum +
        f.cultivations.reduce(
          (s, c) =>
            s +
            c.fertilizations
              .filter(isOrganic)
              .reduce((n, fert) => n + fert.nKgPerHa, 0) *
              c.areaInHa +
            (c.grazing ?? []).reduce(
              (n, g) => n + (g.nKgPerAnimalDay ?? 0) * g.animals * g.days,
              0,
            ),
          0,
        ),
      0,
    );
    const average = organicN / area;
    if (average <= N170_FARM_AVERAGE) return [];
    return [
      {
        scope: 'betrieb' as const,
        value: average.toFixed(0),
        params: { average: Math.round(average) },
      },
    ];
  },
};

/** DüV §2 Nr. 10: cultivations above the "wesentlich" thresholds must be recorded within 14 days (§10(2)). */
const wesentlichThreshold: Rule<BaseMetadata> = {
  code: 'wesentlich_threshold',
  severity: 'info',
  stage: 'plausibilitaet',
  check: ({ data }) => {
    const count = fieldsWithCultivation(data.fields).reduce(
      (sum, f) =>
        sum +
        f.cultivations.filter((c) => {
          const n = c.fertilizations.reduce((s, fert) => s + fert.nKgPerHa, 0);
          const p2o5 = c.fertilizations.reduce(
            (s, fert) => s + (fert.p2o5KgPerHa ?? 0),
            0,
          );
          return n > WESENTLICH_N_KG_PER_HA || p2o5 > WESENTLICH_P2O5_KG_PER_HA;
        }).length,
      0,
    );
    return count > 0
      ? [{ scope: 'betrieb' as const, value: String(count), params: { count } }]
      : [];
  },
};

const rpOver100: Rule<BaseMetadata> = {
  code: 'rp_over_100',
  severity: 'blocking',
  stage: 'plausibilitaet',
  check: ({ data }) =>
    data.fields.flatMap((f) =>
      f.cultivations
        .filter(
          (c) =>
            c.harvest?.proteinPercent !== null &&
            c.harvest?.proteinPercent !== undefined &&
            c.harvest.proteinPercent > 100,
        )
        .map((c) => ({
          ...cultRef(f, c),
          value: String(c.harvest?.proteinPercent),
        })),
    ),
};

const fertRef = (
  field: ExportField,
  cult: ExportCultivation,
  name: string,
  value: string,
) => ({
  scope: 'fertilization' as const,
  fieldId: field.id,
  fieldName: field.name,
  cultivationId: cult.cultivationId,
  value,
  params: { fertilizer: name, crop: cult.crop },
});

const mineralNutrientOver100: Rule<BaseMetadata> = {
  code: 'mineral_nutrient_over_100_kg_per_dt',
  severity: 'blocking',
  stage: 'plausibilitaet',
  check: ({ data }) =>
    data.fields.flatMap((f) =>
      f.cultivations.flatMap((c) =>
        c.fertilizations
          .filter(
            (fert) =>
              fert.naehrstofftraegerart === 'MINERALDUENGER' &&
              [
                fert.nPerCarrierUnit,
                fert.p2o5PerCarrierUnit,
                fert.k2oPerCarrierUnit,
              ].some((v) => (v ?? 0) > 100),
          )
          .map((fert) =>
            fertRef(f, c, fert.fertilizerName, `${fert.nPerCarrierUnit ?? 0}`),
          ),
      ),
    ),
};

/** Organic contents are compared per tonne: kg/m³ (kg / cbm) × convTtoCbm (m³/t) → kg/t. */
const perTonne = (
  fert: ExportCultivation['fertilizations'][number],
  value: number | null,
) =>
  value === null
    ? 0
    : fert.carrierUnit === 'kg / cbm'
      ? value * (fert.density ?? 1)
      : value;

const organicNutrientOver100: Rule<BaseMetadata> = {
  code: 'organic_nutrient_over_100_kg_per_t',
  severity: 'blocking',
  stage: 'plausibilitaet',
  check: ({ data }) =>
    data.fields.flatMap((f) =>
      f.cultivations.flatMap((c) =>
        c.fertilizations
          .filter(
            (fert) =>
              fert.naehrstofftraegerart === 'WIRTSCHAFTSDUENGER' &&
              [
                fert.nPerCarrierUnit,
                fert.p2o5PerCarrierUnit,
                fert.k2oPerCarrierUnit,
              ].some((v) => perTonne(fert, v) > 100),
          )
          .map((fert) =>
            fertRef(
              f,
              c,
              fert.fertilizerName,
              perTonne(fert, fert.nPerCarrierUnit).toFixed(1),
            ),
          ),
      ),
    ),
};

const mengeNegative: Rule<BaseMetadata> = {
  code: 'menge_negative',
  severity: 'blocking',
  stage: 'plausibilitaet',
  check: ({ data }) =>
    data.fields.flatMap((f) =>
      f.cultivations.flatMap((c) =>
        c.fertilizations
          .filter((fert) => fert.quantity < 0)
          .map((fert) =>
            fertRef(f, c, fert.fertilizerName, `${fert.quantity}`),
          ),
      ),
    ),
};

const mengeZero: Rule<BaseMetadata> = {
  code: 'menge_zero',
  severity: 'warning',
  stage: 'plausibilitaet',
  check: ({ data }) =>
    data.fields.flatMap((f) =>
      f.cultivations.flatMap((c) =>
        c.fertilizations
          .filter((fert) => fert.quantity === 0)
          .map((fert) => fertRef(f, c, fert.fertilizerName, '0')),
      ),
    ),
};

/** Applications the server could not convert (unknown unit or density) — the export would be wrong, so it blocks. */
const nutrientCalculationFailed: Rule<BaseMetadata> = {
  code: 'nutrient_calculation_failed',
  severity: 'blocking',
  stage: 'eingaberoutinen',
  check: ({ data }) =>
    data.fields.flatMap((f) =>
      f.cultivations.flatMap((c) =>
        c.failedFertilizations.map((fert) => ({
          ...fertRef(
            f,
            c,
            fert.fertilizerName,
            `${fert.quantity} ${fert.unit}`,
          ),
          params: {
            fertilizer: fert.fertilizerName,
            crop: c.crop,
            unit: fert.unit,
            reason: fert.reason,
          },
        })),
      ),
    ),
};

const MASS_UNITS = ['kg_ha', 'dt_ha', 't_ha'];

/** 1 t/m³ was assumed: solid manure (documented per t) or an organic product recorded by mass. */
const organicDensityUnknown: Rule<BaseMetadata> = {
  code: 'organic_density_unknown',
  severity: 'info',
  stage: 'plausibilitaet',
  check: ({ data }) => {
    const seen = new Set<string>();
    return data.fields.flatMap((f) =>
      f.cultivations.flatMap((c) =>
        c.fertilizations
          .filter(
            (fert) =>
              fert.naehrstofftraegerart === 'WIRTSCHAFTSDUENGER' &&
              fert.density === null &&
              (fert.isMistDuengung || MASS_UNITS.includes(fert.unit)) &&
              !seen.has(fert.articleFqn) &&
              seen.add(fert.articleFqn),
          )
          .map((fert) => ({
            scope: 'betrieb' as const,
            value: fert.articleFqn,
            params: { fertilizer: fert.fertilizerName },
          })),
      ),
    );
  },
};

const sumNTooHigh: Rule<BaseMetadata> = {
  code: 'sum_n_too_high',
  severity: 'warning',
  stage: 'plausibilitaet',
  check: ({ data }) =>
    data.fields.flatMap((f) =>
      f.cultivations
        .map((c) => ({
          c,
          n: c.fertilizations.reduce((sum, fert) => sum + fert.nKgPerHa, 0),
        }))
        .filter(({ n }) => n > MAX_N_KG_PER_HA)
        .map(({ c, n }) => ({
          ...cultRef(f, c),
          value: n.toFixed(0),
          params: { crop: c.crop, n: Math.round(n) },
        })),
    ),
};

const fieldAreaTooLarge: Rule<BaseMetadata> = {
  code: 'field_area_too_large',
  severity: 'warning',
  stage: 'plausibilitaet',
  check: ({ data }) =>
    data.fields
      .filter((f) => f.areaInHa > MAX_FIELD_SIZE_HA)
      .map((f) => ({
        ...fieldRef(f),
        value: f.areaInHa.toFixed(2),
        params: { area: Math.round(f.areaInHa) },
      })),
};

export const COMMON_RULES: Rule<BaseMetadata>[] = [
  exportEmpty,
  schlagnameMissing,
  schlagnummerMissing,
  schlagnummerNotInteger,
  schlagnummerDuplicate,
  flikTooLong,
  fieldWithoutCultivation,
  fertilizationPreviousDuengejahr,
  fertilizationOutsideDuengejahr,
  fertilizationReportedAsHerbstansaat,
  cultivationOutsideDuengejahr,
  nminMissing,
  soilSampleMissing,
  soilSampleValidUntil,
  soilSampleOlderThan6Years,
  pCapExceeded,
  n170FarmAverageExceeded,
  wesentlichThreshold,
  rpOver100,
  mineralNutrientOver100,
  organicNutrientOver100,
  mengeNegative,
  mengeZero,
  nutrientCalculationFailed,
  organicDensityUnknown,
  sumNTooHigh,
  fieldAreaTooLarge,
];
