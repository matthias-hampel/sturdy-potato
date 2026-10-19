/**
 * The two certificates a farm has to be able to show beside the record of the individual
 * application: the applicator's Sachkundenachweis and the periodic sprayer inspection.
 *
 * Ported from agmeo `src/lib/protection/attestations.ts`. These are NOT among the record
 * fields, and this module keeps them apart on purpose: counting a missing certificate as a gap
 * of every application would multiply one gap by four hundred and bury the real ones.
 */
import type { PsmAttestations } from '@agmeo/contracts';

type AttestationState = 'ok' | 'missing' | 'expired' | 'overdue' | 'unknown';

export interface AttestationCheck {
  sachkunde: {
    state: AttestationState;
    number: string | null;
    holder: string | null;
    validUntil: string | null;
    /** Days until expiry; negative when it has lapsed. */
    daysLeft: number | null;
  };
  sprayer: {
    state: AttestationState;
    number: string | null;
    lastInspection: string | null;
    /** Whole months since the inspection. */
    monthsSince: number | null;
  };
  /** German sentences ready to be quoted, worst first; empty when both are fine. */
  messages: string[];
  /**
   * The certificate is stored once for the whole farm, while §11 names the APPLICATOR and the
   * Sachkundenachweis belongs to that person. With several applicators the two differ, and the
   * answer has to say so rather than imply a per-person proof that is not there.
   */
  scope: 'farm';
  scopeNote: string;
}

/**
 * The recurring sprayer inspection runs on a three-year cycle in Germany. Reported as a hint,
 * never as a breach: which deadline binds a particular sprayer is for the Kontrollstelle.
 */
export const SPRAYER_CYCLE_MONTHS = 36;

/** Warn before it lapses rather than after — a certificate that expires mid-season is the expensive case. */
export const SACHKUNDE_WARN_DAYS = 90;

const daysUntil = (from: Date, toIso: string): number | null => {
  const target = Date.parse(`${toIso.slice(0, 10)}T00:00:00Z`);
  if (Number.isNaN(target)) return null;
  return Math.round((target - Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), from.getUTCDate())) / 86_400_000);
};

const monthsSince = (fromIso: string, to: Date): number | null => {
  const start = new Date(`${fromIso.slice(0, 10)}T00:00:00Z`);
  if (Number.isNaN(start.getTime())) return null;
  const whole = (to.getUTCFullYear() - start.getUTCFullYear()) * 12 + (to.getUTCMonth() - start.getUTCMonth());
  return to.getUTCDate() < start.getUTCDate() ? whole - 1 : whole;
};

export function checkAttestations(psm: Partial<PsmAttestations> | undefined, today: Date = new Date()): AttestationCheck {
  const messages: string[] = [];

  const certificateNr = psm?.certificateNumber?.trim() || null;
  const holder = psm?.certificateHolder?.trim() || null;
  const expiry = psm?.certificateValidUntil?.trim() || null;
  const daysLeft = expiry ? daysUntil(today, expiry) : null;
  let sachkundeState: AttestationState = 'ok';
  if (!certificateNr) {
    sachkundeState = 'missing';
    messages.push('Es ist keine Sachkundenummer hinterlegt.');
  } else if (daysLeft === null) {
    sachkundeState = 'unknown';
    messages.push(`Zur Sachkundenummer ${certificateNr} ist kein gültiges Ablaufdatum hinterlegt.`);
  } else if (daysLeft < 0) {
    sachkundeState = 'expired';
    messages.push(`Der Sachkundenachweis ${certificateNr} ist seit dem ${expiry} abgelaufen.`);
  } else if (daysLeft <= SACHKUNDE_WARN_DAYS) {
    // Still valid — flagged early because a certificate that lapses mid-season costs a pass.
    messages.push(`Der Sachkundenachweis ${certificateNr} läuft am ${expiry} ab, das sind ${daysLeft} Tage.`);
  }

  const inspectionNr = psm?.sprayerInspectionNumber?.trim() || null;
  const inspectedOn = psm?.sprayerInspectedOn?.trim() || null;
  const since = inspectedOn ? monthsSince(inspectedOn, today) : null;
  let sprayerState: AttestationState = 'ok';
  if (!inspectionNr && !inspectedOn) {
    sprayerState = 'missing';
    messages.push('Zur Spritzenprüfung ist weder Prüfnummer noch Prüfdatum hinterlegt.');
  } else if (since === null) {
    sprayerState = 'unknown';
    messages.push('Zur Spritzenprüfung ist kein gültiges Prüfdatum hinterlegt.');
  } else if (since >= SPRAYER_CYCLE_MONTHS) {
    sprayerState = 'overdue';
    messages.push(`Die letzte Spritzenprüfung liegt ${since} Monate zurück (${inspectedOn}); der übliche Prüfzyklus beträgt ${SPRAYER_CYCLE_MONTHS} Monate.`);
  }

  return {
    scope: 'farm',
    scopeNote:
      'Der Sachkundenachweis ist betriebsweit hinterlegt, nicht je Mitarbeiter. Wo mehrere Personen anwenden, ' +
      'deckt er nur die genannte Person ab — die Nachweise der übrigen Anwender liegen nicht in agmeo.',
    sachkunde: { state: sachkundeState, number: certificateNr, holder, validUntil: expiry, daysLeft },
    sprayer: { state: sprayerState, number: inspectionNr, lastInspection: inspectedOn, monthsSince: since },
    messages,
  };
}
