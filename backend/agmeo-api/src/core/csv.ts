/** One CSV cell. Quotes when needed and prefixes formula-like text so spreadsheets do not execute it. */
export function csvCell(v: string | number | null | undefined): string {
  if (v == null) return '';
  const s = String(v);
  const safe = /^[=+\-@]/.test(s) && typeof v === 'string' ? `'${s}` : s;
  return /[",\r\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}

/** A CSV document with CRLF line endings. */
export const toCsv = (header: string[], rows: (string | number | null | undefined)[][]) =>
  [header, ...rows].map((r) => r.map(csvCell).join(',')).join('\r\n') + '\r\n';
