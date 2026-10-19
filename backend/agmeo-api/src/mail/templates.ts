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

export interface MailTemplates {
  invitation: { orgName: string; inviterName: string; role: Role; acceptUrl: string };
}
export type MailTemplate = keyof MailTemplates;

export function mailLocale(locale: string | null | undefined): MailLocale {
  // German for German (and unknown) accounts; English for every other language until mails are translated.
  return !locale || locale.toLowerCase().startsWith('de') ? 'de' : 'en';
}

const escapeHtml = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

/** Wraps paragraphs and an optional call-to-action button into the shared HTML layout. */
function layout(paragraphs: string[], action?: { label: string; url: string }, footer?: string): string {
  const body = paragraphs.map((p) => `<p style="margin:0 0 16px">${escapeHtml(p)}</p>`).join('');
  const button = action
    ? `<p style="margin:24px 0"><a href="${escapeHtml(action.url)}" style="background:#2f5d1e;color:#fff;padding:10px 18px;border-radius:6px;text-decoration:none;display:inline-block">${escapeHtml(action.label)}</a></p>`
    : '';
  const foot = footer ? `<p style="margin:32px 0 0;color:#6b7280;font-size:12px">${escapeHtml(footer)}</p>` : '';
  return `<!doctype html><html><body style="font-family:system-ui,-apple-system,sans-serif;color:#1f2937;font-size:15px;line-height:1.5;max-width:560px;margin:0 auto;padding:24px"><p style="margin:0 0 24px;font-weight:600;font-size:18px;color:#2f5d1e">agmeo</p>${body}${button}${foot}</body></html>`;
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
};

export function renderMail<K extends MailTemplate>(template: K, locale: MailLocale, params: MailTemplates[K]): RenderedMail {
  const byLocale = renderers[template] as Record<MailLocale, (p: MailTemplates[K]) => RenderedMail> | undefined;
  if (!byLocale) throw new Error(`Unknown mail template ${template}`);
  return (byLocale[locale] ?? byLocale.de)(params);
}
