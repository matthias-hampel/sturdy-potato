import { mailLocale, renderMail } from './templates.js';

const params = { orgName: 'Hof <Sonnenfeld>', inviterName: 'Anna Bauer', role: 'agronomist' as const, acceptUrl: 'https://app.example/login?invited=1' };

describe('mail templates', () => {
  it('renders the invitation in German with the app’s role wording', () => {
    const mail = renderMail('invitation', 'de', params);
    expect(mail.subject).toBe('Einladung zu „Hof <Sonnenfeld>“ in agmeo');
    expect(mail.text).toContain('als Agronom mitzuarbeiten');
    expect(mail.text).toContain(params.acceptUrl);
  });

  it('renders English and escapes HTML', () => {
    const mail = renderMail('invitation', 'en', params);
    expect(mail.text).toContain('as agronomist');
    expect(mail.html).toContain('Hof &#60;Sonnenfeld&#62;');
    expect(mail.html).not.toContain('<Sonnenfeld>');
  });

  it('falls back to German for unknown or missing locales', () => {
    expect(mailLocale('en-GB')).toBe('en');
    expect(mailLocale('fr')).toBe('de');
    expect(mailLocale(null)).toBe('de');
  });
});
