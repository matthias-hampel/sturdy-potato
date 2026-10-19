import type { Role } from '@agmeo/contracts';

/**
 * Transactional e-mail templates in the app's languages. Each template renders a subject, a
 * plain-text body and a minimal HTML body from its parameters; German is the fallback for
 * any locale without its own text.
 */

export type MailLocale = 'de' | 'en';

const ROLE_LABELS: Record<MailLocale, Record<Role, string>> = {
  // Same wording as the web app (enum.role.*).
  de: { owner: 'Inhaber', manager: 'Betriebsleiter', agronomist: 'Agronom', worker: 'Feldarbeiter', accountant: 'Buchhaltung', viewer: 'Lesezugriff' },
  en: { owner: 'owner', manager: 'manager', agronomist: 'agronomist', worker: 'worker', accountant: 'accountant', viewer: 'viewer' },
};

export interface RenderedMail {
  subject: string;
  text: string;
  html: string;
}

export interface RainDigestRow {
  name: string;
  areaHa: number;
  /** Crop name in English and German (null without a crop in the season). */
  crop: { en: string; de: string | null } | null;
  precipMm: number;
}

export interface MailTemplates {
  invitation: { orgName: string; inviterName: string; role: Role; acceptUrl: string };
  rainDigest: {
    orgName: string;
    /** Local day the digest is for (its 06:00 ends the window), YYYY-MM-DD. */
    localDate: string;
    timezone: string;
    system: 'metric' | 'imperial';
    rainedFields: number;
    totalFields: number;
    thresholdMm: number;
    /** Oldest weather update of the listed fields, when it missed the morning refresh. */
    staleSince: string | null;
    least: RainDigestRow[];
    most: RainDigestRow[];
    leastUrl: string;
    mostUrl: string;
    unsubscribeUrl: string;
  };
  storageDigest: {
    orgName: string;
    usedBytes: number;
    limitBytes: number;
    trashBytes: number;
    trashFiles: number;
    filesUrl: string;
    unsubscribeUrl: string;
  };
  storageOverview: {
    totalBytes: number;
    trashBytes: number;
    organizations: { name: string; usedBytes: number; limitBytes: number }[];
    organizationCount: number;
  };
}
export type MailTemplate = keyof MailTemplates;

export function mailLocale(locale: string | null | undefined): MailLocale {
  // German for German (and unknown) accounts; English for every other language until mails are translated.
  return !locale || locale.toLowerCase().startsWith('de') ? 'de' : 'en';
}

const escapeHtml = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

/** Pre-rendered HTML block (everything user-provided in it must already be escaped). */
type Html = { html: string };
const html = (markup: string): Html => ({ html: markup });

/** Wraps paragraphs (escaped text, or HTML blocks) and an optional call-to-action button into the shared HTML layout. */
function layout(paragraphs: (string | Html)[], action?: { label: string; url: string }, footer?: string, footerLink?: { label: string; url: string }): string {
  const body = paragraphs.map((p) => (typeof p === 'string' ? `<p style="margin:0 0 16px">${escapeHtml(p)}</p>` : p.html)).join('');
  const button = action
    ? `<p style="margin:24px 0"><a href="${escapeHtml(action.url)}" style="background:#2f5d1e;color:#fff;padding:10px 18px;border-radius:6px;text-decoration:none;display:inline-block">${escapeHtml(action.label)}</a></p>`
    : '';
  const link = footerLink ? `<a href="${escapeHtml(footerLink.url)}" style="color:#6b7280">${escapeHtml(footerLink.label)}</a><br/>` : '';
  const foot = footer || link ? `<p style="margin:32px 0 0;color:#6b7280;font-size:12px">${link}${escapeHtml(footer ?? '')}</p>` : '';
  return `<!doctype html><html><body style="font-family:system-ui,-apple-system,sans-serif;color:#1f2937;font-size:15px;line-height:1.5;max-width:560px;margin:0 auto;padding:24px"><p style="margin:0 0 24px;font-weight:600;font-size:18px;color:#2f5d1e">agmeo</p>${body}${button}${foot}</body></html>`;
}

const NUMBER_LOCALE: Record<MailLocale, string> = { de: 'de-DE', en: 'en-GB' };
const MM_PER_INCH = 25.4;
const HA_PER_ACRE = 0.40468564224;

function numberFormat(locale: MailLocale, value: number, digits: number) {
  return new Intl.NumberFormat(NUMBER_LOCALE[locale], { minimumFractionDigits: digits, maximumFractionDigits: digits }).format(value);
}
const rain = (l: MailLocale, system: 'metric' | 'imperial', mm: number) => (system === 'imperial' ? `${numberFormat(l, mm / MM_PER_INCH, 2)} in` : `${numberFormat(l, mm, 1)} mm`);
const area = (l: MailLocale, system: 'metric' | 'imperial', ha: number) => (system === 'imperial' ? `${numberFormat(l, ha / HA_PER_ACRE, 1)} ac` : `${numberFormat(l, ha, 1)} ha`);

/** Bytes as GB/MB with one decimal (decimal units, as the files page). */
export function formatBytes(locale: MailLocale, bytes: number): string {
  if (bytes >= 1e9) return `${numberFormat(locale, bytes / 1e9, 1)} GB`;
  if (bytes >= 1e6) return `${numberFormat(locale, bytes / 1e6, 1)} MB`;
  return `${numberFormat(locale, bytes / 1e3, 0)} kB`;
}

const RAIN_TEXT = {
  de: {
    subject: (date: string) => `Niederschlagsbericht für Ihre Schläge vom ${date}`,
    orgLine: (name: string) => `Betrieb: ${name}`,
    intro: (rained: number, total: number, threshold: string) =>
      `Wir haben festgestellt, dass ${rained} Ihrer ${total} Schläge zwischen gestern 6 Uhr und heute 6 Uhr mindestens ${threshold} Niederschlag erhalten haben.`,
    updateNote: 'Die Niederschlagssummen werden einmal täglich in Ihrem agmeo-Konto aktualisiert. Melden Sie sich in Ihrem agmeo-Konto an, um die aktuellsten Schätzungen für alle Ihre Schläge zu sehen.',
    dataAsOf: (at: string) => `Wetterdaten mit Stand ${at}.`,
    leastTitle: 'Wenigster Niederschlag in den letzten 24 Stunden',
    mostTitle: 'Meister Niederschlag in den letzten 24 Stunden',
    ctaLeast: 'Schläge mit dem wenigsten Niederschlag anzeigen',
    ctaMost: 'Schläge mit dem meisten Niederschlag anzeigen',
    field: 'Schlag',
    size: 'Größe',
    crop: 'Kultur',
    precipitation: 'Niederschlag',
    signature: 'Ihr agmeo-Team',
    unsubscribe: 'Täglichen Niederschlagsbericht abbestellen',
    settingsHint: 'Sie können diese Einstellung jederzeit in agmeo unter Einstellungen → Benachrichtigungen ändern.',
  },
  en: {
    subject: (date: string) => `Field rainfall report for ${date}`,
    orgLine: (name: string) => `Farm: ${name}`,
    intro: (rained: number, total: number, threshold: string) =>
      `We detected that ${rained} out of your ${total} fields received at least ${threshold} of rain from 6 AM yesterday to 6 AM today.`,
    updateNote: 'Rain totals are updated once a day in your agmeo account. Please log in to your agmeo account to see the most up-to-date estimates for all your fields.',
    dataAsOf: (at: string) => `Weather data as of ${at}.`,
    leastTitle: 'Least rainfall in the last 24 hours',
    mostTitle: 'Most rainfall in the last 24 hours',
    ctaLeast: 'Show fields with the least rainfall',
    ctaMost: 'Show fields with the most rainfall',
    field: 'Field',
    size: 'Size',
    crop: 'Crop',
    precipitation: 'Rainfall',
    signature: 'Your agmeo team',
    unsubscribe: 'Unsubscribe from the daily rainfall report',
    settingsHint: 'You can change this setting anytime in agmeo under Settings → Notifications.',
  },
};

function rainDigest(l: MailLocale, p: MailTemplates['rainDigest']): RenderedMail {
  const x = RAIN_TEXT[l];
  const date = new Intl.DateTimeFormat(NUMBER_LOCALE[l], { dateStyle: 'long', timeZone: 'UTC' }).format(new Date(`${p.localDate}T12:00:00Z`));
  const subject = x.subject(date);
  const intro = x.intro(p.rainedFields, p.totalFields, rain(l, p.system, p.thresholdMm));
  const stale = p.staleSince
    ? x.dataAsOf(new Intl.DateTimeFormat(NUMBER_LOCALE[l], { dateStyle: 'medium', timeStyle: 'short', timeZone: p.timezone }).format(new Date(p.staleSince)))
    : null;
  const cropOf = (r: RainDigestRow) => (r.crop ? (l === 'de' ? (r.crop.de ?? r.crop.en) : r.crop.en) : '–');
  const textTable = (rows: RainDigestRow[]) => rows.map((r) => `- ${r.name} · ${area(l, p.system, r.areaHa)} · ${cropOf(r)} · ${rain(l, p.system, r.precipMm)}`).join('\n');
  const text = [
    subject,
    x.orgLine(p.orgName),
    '',
    intro,
    x.updateNote,
    ...(stale ? ['', stale] : []),
    '',
    `${x.leastTitle}:`,
    textTable(p.least),
    `${x.ctaLeast}: ${p.leastUrl}`,
    '',
    `${x.mostTitle}:`,
    textTable(p.most),
    `${x.ctaMost}: ${p.mostUrl}`,
    '',
    x.signature,
    '',
    `${x.unsubscribe}: ${p.unsubscribeUrl}`,
    x.settingsHint,
  ].join('\n');
  const CELL = 'padding:6px 8px;border-bottom:1px solid #e5e7eb;vertical-align:top';
  const NUM = `${CELL};text-align:right;white-space:nowrap`;
  const HEAD = 'padding:6px 8px;background:#f3f4f6;text-align:left;font-weight:600';
  const table = (rows: RainDigestRow[]) =>
    html(`<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;margin:8px 0 12px">` +
    `<thead><tr><th style="${HEAD}">${escapeHtml(x.field)}</th><th style="${HEAD};text-align:right">${escapeHtml(x.size)}</th><th style="${HEAD}">${escapeHtml(x.crop)}</th><th style="${HEAD};text-align:right">${escapeHtml(x.precipitation)}</th></tr></thead><tbody>` +
    rows
      .map(
        (r) =>
          `<tr><td style="${CELL}"><strong>${escapeHtml(r.name)}</strong></td><td style="${NUM}">${escapeHtml(area(l, p.system, r.areaHa))}</td><td style="${CELL}">${escapeHtml(cropOf(r))}</td><td style="${NUM}"><strong>${escapeHtml(rain(l, p.system, r.precipMm))}</strong></td></tr>`,
      )
      .join('') +
    `</tbody></table>`);
  const button = (url: string, label: string) =>
    html(`<p style="margin:0 0 16px"><a href="${escapeHtml(url)}" style="background:#2f5d1e;color:#fff;padding:8px 14px;border-radius:6px;text-decoration:none;display:inline-block">${escapeHtml(label)}</a></p>`);
  const body = layout(
    [
      html(`<h1 style="font-size:19px;margin:0 0 4px">${escapeHtml(subject)}</h1>`),
      html(`<p style="margin:0 0 16px;color:#6b7280">${escapeHtml(x.orgLine(p.orgName))}</p>`),
      intro,
      x.updateNote,
      ...(stale ? [html(`<p style="margin:0 0 16px;color:#6b7280">${escapeHtml(stale)}</p>`)] : []),
      html(`<h2 style="font-size:16px;margin:20px 0 4px">${escapeHtml(x.leastTitle)}</h2>`),
      table(p.least),
      button(p.leastUrl, x.ctaLeast),
      html(`<h2 style="font-size:16px;margin:20px 0 4px">${escapeHtml(x.mostTitle)}</h2>`),
      table(p.most),
      button(p.mostUrl, x.ctaMost),
      x.signature,
    ],
    undefined,
    x.settingsHint,
    { label: x.unsubscribe, url: p.unsubscribeUrl },
  );
  return { subject, text, html: body };
}

const STORAGE_TEXT = {
  de: {
    subject: (org: string) => `Speicherplatz von „${org}“ in agmeo fast belegt`,
    subjectFull: (org: string) => `Speicherplatz von „${org}“ in agmeo voll`,
    usage: (used: string, limit: string, pct: string) => `Ihre Dateien belegen ${used} von ${limit} (${pct}).`,
    full: 'Neue Dateien können erst wieder hochgeladen werden, wenn Platz frei ist. Von agmeo erzeugte Dateien (Exporte, Berichte) werden weiterhin abgelegt.',
    trash: (size: string, n: number) => `Im Papierkorb liegen ${n} Dateien mit ${size}. Leeren Sie den Papierkorb, um diesen Platz freizugeben.`,
    action: 'Dateien öffnen',
    unsubscribe: 'Wöchentliche Speicherplatz-Hinweise abbestellen',
    hint: 'Dieser Hinweis kommt montags, solange mehr als 80 % des Speicherplatzes belegt sind.',
  },
  en: {
    subject: (org: string) => `Storage of “${org}” on agmeo is almost full`,
    subjectFull: (org: string) => `Storage of “${org}” on agmeo is full`,
    usage: (used: string, limit: string, pct: string) => `Your files use ${used} of ${limit} (${pct}).`,
    full: 'New files can only be uploaded once space is freed. Files agmeo creates (exports, reports) are still stored.',
    trash: (size: string, n: number) => `The trash holds ${n} files with ${size}. Empty the trash to free this space.`,
    action: 'Open files',
    unsubscribe: 'Unsubscribe from weekly storage notices',
    hint: 'This notice comes on Mondays while more than 80 % of the storage is in use.',
  },
};

function storageDigest(l: MailLocale, p: MailTemplates['storageDigest']): RenderedMail {
  const x = STORAGE_TEXT[l];
  const full = p.usedBytes >= p.limitBytes;
  const pct = `${numberFormat(l, p.limitBytes ? (100 * p.usedBytes) / p.limitBytes : 100, 0)} %`;
  const lines = [x.usage(formatBytes(l, p.usedBytes), formatBytes(l, p.limitBytes), pct), ...(full ? [x.full] : []), ...(p.trashFiles ? [x.trash(formatBytes(l, p.trashBytes), p.trashFiles)] : [])];
  const subject = full ? x.subjectFull(p.orgName) : x.subject(p.orgName);
  return {
    subject,
    text: `${lines.join('\n\n')}\n\n${x.action}: ${p.filesUrl}\n\n${x.unsubscribe}: ${p.unsubscribeUrl}\n${x.hint}\n`,
    html: layout(lines, { label: x.action, url: p.filesUrl }, x.hint, { label: x.unsubscribe, url: p.unsubscribeUrl }),
  };
}

function storageOverview(l: MailLocale, p: MailTemplates['storageOverview']): RenderedMail {
  const de = l === 'de';
  const subject = de ? `agmeo: Speicherübersicht (${formatBytes(l, p.totalBytes)})` : `agmeo: storage overview (${formatBytes(l, p.totalBytes)})`;
  const head = de
    ? `${p.organizationCount} Organisationen belegen ${formatBytes(l, p.totalBytes)}, davon ${formatBytes(l, p.trashBytes)} im Papierkorb.`
    : `${p.organizationCount} organizations use ${formatBytes(l, p.totalBytes)}, ${formatBytes(l, p.trashBytes)} of it in the trash.`;
  const listTitle = de ? 'Organisationen über 80 % ihres Speicherplatzes:' : 'Organizations above 80 % of their allowance:';
  const none = de ? 'Keine Organisation ist über 80 % ihres Speicherplatzes.' : 'No organization is above 80 % of its allowance.';
  const rows = p.organizations.map((o) => `${o.name}: ${formatBytes(l, o.usedBytes)} / ${formatBytes(l, o.limitBytes)} (${numberFormat(l, (100 * o.usedBytes) / (o.limitBytes || 1), 0)} %)`);
  const lines = rows.length ? [head, listTitle, ...rows.map((r) => `• ${r}`)] : [head, none];
  return { subject, text: `${lines.join('\n')}\n`, html: layout(lines) };
}

const renderers: { [K in MailTemplate]: Record<MailLocale, (p: MailTemplates[K]) => RenderedMail> } = {
  invitation: {
    de: (p) => {
      const lines = [
        `${p.inviterName} hat Sie eingeladen, in agmeo im Betrieb „${p.orgName}“ als ${ROLE_LABELS.de[p.role]} mitzuarbeiten.`,
        'Melden Sie sich mit dieser E-Mail-Adresse an oder legen Sie ein Konto an, um die Einladung anzunehmen.',
      ];
      const footer = 'Wenn Sie diese Einladung nicht erwartet haben, können Sie die E-Mail ignorieren.';
      return {
        subject: `Einladung zu „${p.orgName}“ in agmeo`,
        text: `${lines.join('\n\n')}\n\nEinladung annehmen: ${p.acceptUrl}\n\n${footer}\n`,
        html: layout(lines, { label: 'Einladung annehmen', url: p.acceptUrl }, footer),
      };
    },
    en: (p) => {
      const lines = [
        `${p.inviterName} has invited you to work on “${p.orgName}” in agmeo as ${ROLE_LABELS.en[p.role]}.`,
        'Sign in with this e-mail address, or create an account, to accept the invitation.',
      ];
      const footer = 'If you were not expecting this invitation, you can ignore this e-mail.';
      return {
        subject: `Invitation to “${p.orgName}” on agmeo`,
        text: `${lines.join('\n\n')}\n\nAccept the invitation: ${p.acceptUrl}\n\n${footer}\n`,
        html: layout(lines, { label: 'Accept invitation', url: p.acceptUrl }, footer),
      };
    },
  },
  rainDigest: { de: (p) => rainDigest('de', p), en: (p) => rainDigest('en', p) },
  storageDigest: { de: (p) => storageDigest('de', p), en: (p) => storageDigest('en', p) },
  storageOverview: { de: (p) => storageOverview('de', p), en: (p) => storageOverview('en', p) },
};

export function renderMail<K extends MailTemplate>(template: K, locale: MailLocale, params: MailTemplates[K]): RenderedMail {
  const byLocale = renderers[template] as Record<MailLocale, (p: MailTemplates[K]) => RenderedMail> | undefined;
  if (!byLocale) throw new Error(`Unknown mail template ${template}`);
  return (byLocale[locale] ?? byLocale.de)(params);
}
