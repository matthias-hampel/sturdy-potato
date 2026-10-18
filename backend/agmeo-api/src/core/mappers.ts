/** Converts a timestamp column to an ISO-8601 string. */
export function iso(value: Date | string): string;
export function iso(value: Date | string | null | undefined): string | null;
export function iso(value: Date | string | null | undefined): string | null {
  if (value == null) return null;
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

export const round = (value: number, digits = 2) => {
  const f = 10 ** digits;
  return Math.round(value * f) / f;
};

// Calendar date in the farms' default timezone (YYYY-MM-DD).
export const today = (timeZone = 'Europe/Berlin') => new Date().toLocaleDateString('sv-SE', { timeZone });

/** Calendar date (YYYY-MM-DD) of an instant in the given timezone. */
export const dateIn = (instant: Date, timeZone = 'Europe/Berlin') => instant.toLocaleDateString('sv-SE', { timeZone });
