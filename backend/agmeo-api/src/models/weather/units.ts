/**
 * Ported from AGVOLUTION/agmeo src/lib/units/format.ts — only the part of the
 * bound `UnitFormatter` the weather reasons need (`system`, `locale`,
 * `display`, `format`). Conversion factors and default precisions come from
 * `@agmeo/contracts` (the rewrite's shared unit registry); labels are resolved
 * through a translate function with the contracts' `unit.<id>` keys, exactly
 * like the reference resolved its `labelKey`.
 */

import {
  displayUnit,
  toDisplay,
  type Dimension,
  type MeasureContext,
  type MeasurementSystem,
} from '@agmeo/contracts';

export type { Dimension, MeasurementSystem };

/** i18n lookup for a unit label key, e.g. `unit.kmh` → "km/h". */
export type UnitLabelFn = (key: string) => string;

export type FormatMeasureOpts = {
  crop?: MeasureContext['crop'];
  /** Override the unit's default fraction digits. */
  precision?: number;
  /** Minimum fraction digits — for fixed-width table columns ("12.30"). */
  minPrecision?: number;
  /** Append the unit label (default true) → "62.8 bu/ac". */
  withUnit?: boolean;
};

export type UnitFormatter = {
  system: MeasurementSystem;
  /** BCP 47 locale the numbers are formatted in. */
  locale: string;
  /** Canonical metric → display-unit number (unrounded). */
  display(
    canonical: number,
    dimension: Dimension,
    ctx?: MeasureContext,
  ): number;
  format(
    canonical: number,
    dimension: Dimension,
    opts?: FormatMeasureOpts,
  ): string;
};

export function makeUnitFormatter(
  system: MeasurementSystem,
  t: UnitLabelFn,
  locale: string,
): UnitFormatter {
  return {
    system,
    locale,
    display: (canonical, dimension, ctx) =>
      toDisplay(canonical, dimension, system, ctx),
    format: (canonical, dimension, opts = {}) => {
      const ctx = { crop: opts.crop };
      const unit = displayUnit(dimension, system, ctx);
      const value = toDisplay(canonical, dimension, system, ctx);
      const formatted = new Intl.NumberFormat(locale, {
        maximumFractionDigits: opts.precision ?? unit.precision,
        minimumFractionDigits: opts.minPrecision,
      }).format(value);
      if (opts.withUnit === false) return formatted;
      return `${formatted} ${t(`unit.${unit.id}`)}`;
    },
  };
}

/**
 * English unit labels for the server-side spray-reason strings — the reference
 * built these from its fixed-language `en` translation.
 */
export const ENGLISH_UNIT_LABELS: Record<string, string> = {
  'unit.degC': '°C',
  'unit.degF': '°F',
  'unit.mm': 'mm',
  'unit.inch': 'in',
  'unit.kmh': 'km/h',
  'unit.mph': 'mph',
  'unit.mPerS': 'm/s',
};

export const englishUnitLabel: UnitLabelFn = (key) =>
  ENGLISH_UNIT_LABELS[key] ?? key;
