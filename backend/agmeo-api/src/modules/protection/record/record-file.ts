/**
 * The plant-protection record as files a farmer can hand over.
 *
 * Ported from agmeo `src/lib/protection/recordFile.ts`. EU 2023/564 demands a machine-readable
 * record from 01.01.2027 and names no schema, and Germany has fixed none. So there are two
 * deliverables, and they say what they are: the JSON is agmeo's own schema (`EXPORT_SCHEMA`),
 * machine-readable in the sense of the regulation but accepted by no authority's upload today;
 * the CSV is the same record in the shape an inspector or adviser opens in a spreadsheet.
 * Neither is a filing.
 *
 * The CSV is one row per PRODUCT, so a tank mix of three partners is three rows sharing an
 * operation id. Semicolon-separated with a byte-order mark: that is what a German Excel opens as
 * columns without an import dialog.
 */
import type { ExportApplication, ProtectionExport } from './eu-export.js';

/**
 * Column order follows the record fields, then what the approval adds. The hectare is written
 * out: the area unit of the German record is fixed by the regulation, not by a display setting.
 */
const COLUMNS = [
  'Vorgang',
  'Datum',
  'Uhrzeit',
  'Art der Verwendung',
  'Schlag',
  'FLIK',
  'Fläche ha',
  'Kultur',
  'EPPO-Code',
  'BBCH',
  'Mittel',
  'Zulassungsnummer',
  'Anwendungsgebiet',
  'Anwendungsgebiet-ID',
  'Aufwandmenge',
  'Einheit',
  'Gesamtmenge',
  'Gesamtmenge Einheit',
  'Wartezeit Tage',
  'Frühester Erntetermin',
  'Anwender',
  'Fehlende Pflichtangaben',
] as const;

/** The schema's usage-type codes as the German record names them. */
const USAGE_TYPE_LABELS: Record<string, string> = {
  FREILAND: 'Freiland',
  GEWAECHSHAUS: 'Gewächshaus',
  LAGER: 'Vorratsschutz',
  OEFFENTLICHE_FLAECHE: 'Öffentliche Fläche',
  BEIZUNG: 'Saatgutbehandlung',
  PFLANZGUT: 'Pflanzgutbehandlung',
};

const SEPARATOR = ';';
const BOM = '﻿';

/** A number as a German spreadsheet reads it — comma decimal, no thousands mark. */
const decimal = (value: number | null): string => (value === null ? '' : String(value).replace('.', ','));

const cell = (value: string | null | undefined): string => {
  if (value === null || value === undefined) return '';
  return /[";\n\r]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
};

function rowsFor(application: ExportApplication): string[][] {
  const head = [
    application.operationId,
    application.applicationDate ?? '',
    application.timeOfDay ?? '',
    application.usageType ? (USAGE_TYPE_LABELS[application.usageType] ?? application.usageType) : '',
    application.field.name ?? '',
    application.field.flik ?? '',
    decimal(application.field.areaHa),
    application.crop.name ?? '',
    application.crop.eppoCode ?? '',
    decimal(application.growthStageBbch),
  ];
  const foot = [application.applicator ?? '', application.missingFields.join(', ')];
  // A pass without a product is still a documented application — one row with the product
  // columns empty, so it is counted and its gaps are visible.
  const products =
    application.products.length === 0
      ? [['', '', '', '', '', '', '', '', '', '']]
      : application.products.map((p) => [
          p.articleId ?? '',
          p.kennr ?? '',
          p.targetOrganism ?? '',
          p.awgId ?? '',
          decimal(p.dose),
          p.doseUnit ?? '',
          decimal(p.absoluteAmount),
          p.absoluteAmountUnit ?? '',
          decimal(p.preHarvestIntervalDays),
          p.earliestHarvestDate ?? '',
        ]);
  return products.map((m) => [...head, ...m, ...foot]);
}

/** The record as CSV; the certificates go into a comment block above the header. */
export function toCsv(document: ProtectionExport): string {
  const { sachkunde, sprayerInspection } = document.farm;
  const attestations = [
    `# Pflanzenschutz-Aufzeichnung ${document.year} — erzeugt ${document.generatedAt}`,
    `# Schema ${document.schema} v${document.schemaVersion}`,
    `# Sachkundenachweis: ${sachkunde.number ?? 'nicht hinterlegt'}` +
      (sachkunde.holder ? ` (${sachkunde.holder})` : '') +
      (sachkunde.validUntil ? `, gültig bis ${sachkunde.validUntil}` : ''),
    `# Spritzenprüfung: ${sprayerInspection.number ?? 'nicht hinterlegt'}` + (sprayerInspection.lastInspection ? `, geprüft ${sprayerInspection.lastInspection}` : ''),
  ];
  const body = document.applications.flatMap(rowsFor).map((row) => row.map(cell).join(SEPARATOR));
  return `${BOM}${[...attestations, COLUMNS.join(SEPARATOR), ...body].join('\r\n')}\r\n`;
}

/** The record as the JSON document itself, indented so a person can read it too. */
export const toJson = (document: ProtectionExport): string => JSON.stringify(document, null, 2);

/** Prefix of every record file, so the archive can find them again. */
export const FILE_PREFIX = 'Pflanzenschutz';

/** `Pflanzenschutz_2026.csv` — the year in the name, because the folder will hold several. */
export const fileName = (year: number, format: 'csv' | 'json'): string => `${FILE_PREFIX}_${year}.${format}`;

export const MIME_TYPES = { csv: 'text/csv', json: 'application/json' } as const;
