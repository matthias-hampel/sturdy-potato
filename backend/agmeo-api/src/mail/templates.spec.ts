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

  it('writes German to German and unknown accounts and English to every other language', () => {
    expect(mailLocale('en-GB')).toBe('en');
    expect(mailLocale('fr')).toBe('en');
    expect(mailLocale('de-AT')).toBe('de');
    expect(mailLocale(null)).toBe('de');
  });
});

describe('digest templates', () => {
  const row = (name: string, mm: number) => ({ name, areaHa: 12.34, crop: { en: 'Winter wheat', de: 'Winterweizen' }, precipMm: mm });
  const digest = {
    orgName: 'Hof <A>',
    localDate: '2026-09-27',
    timezone: 'Europe/Berlin',
    system: 'metric' as const,
    rainedFields: 1,
    totalFields: 2,
    thresholdMm: 1,
    staleSince: null,
    least: [row('Acker <1>', 0)],
    most: [row('Breite', 4.2)],
    leastUrl: 'https://app.example/o/1/fields',
    mostUrl: 'https://app.example/o/1/fields',
    unsubscribeUrl: 'https://app.example/unsubscribe/t',
  };

  it('renders the rain digest in German with the reference wording', () => {
    const mail = renderMail('rainDigest', 'de', digest);
    expect(mail.subject).toBe('Niederschlagsbericht für Ihre Schläge vom 27. September 2026');
    expect(mail.text).toContain('dass 1 Ihrer 2 Schläge zwischen gestern 6 Uhr und heute 6 Uhr mindestens 1,0 mm Niederschlag');
    expect(mail.text).toContain('Breite · 12,3 ha · Winterweizen · 4,2 mm');
    expect(mail.html).toContain('Acker &#60;1&#62;');
    expect(mail.html).not.toContain('<1>');
    expect(mail.html).toContain('https://app.example/unsubscribe/t');
  });

  it('renders imperial units and the stale note in English', () => {
    const mail = renderMail('rainDigest', 'en', { ...digest, system: 'imperial', thresholdMm: 2.54, staleSince: '2026-09-26T03:00:00Z' });
    expect(mail.subject).toBe('Field rainfall report for 27 September 2026');
    expect(mail.text).toContain('at least 0.10 in of rain');
    expect(mail.text).toContain('Breite · 30.5 ac · Winter wheat · 0.17 in');
    expect(mail.text).toContain('Weather data as of 26 Sept 2026, 05:00.');
  });

  it('renders storage notices', () => {
    const p = { orgName: 'Hof', usedBytes: 4.5e9, limitBytes: 5e9, trashBytes: 3e8, trashFiles: 12, filesUrl: 'https://app.example/f', unsubscribeUrl: 'https://app.example/u' };
    expect(renderMail('storageDigest', 'de', p).text).toContain('Ihre Dateien belegen 4,5 GB von 5,0 GB (90 %).');
    expect(renderMail('storageDigest', 'en', { ...p, usedBytes: 5e9 }).subject).toBe('Storage of “Hof” on agmeo is full');
    const overview = renderMail('storageOverview', 'de', { totalBytes: 9e9, trashBytes: 1e9, organizationCount: 3, organizations: [{ name: 'Hof', usedBytes: 4.5e9, limitBytes: 5e9 }] });
    expect(overview.text).toContain('• Hof: 4,5 GB / 5,0 GB (90 %)');
  });
});
