import { renderMail } from './templates.js';

const params = { orgName: 'Hof <Sonnenfeld>', inviterName: 'Anna Bauer', role: 'agronomist' as const, acceptUrl: 'https://app.example/login?invited=1' };

describe('mail templates', () => {
  it('renders the invitation in German with the app’s role wording', () => {
    const mail = renderMail('invitation', params);
    expect(mail.subject).toBe('Einladung zu „Hof <Sonnenfeld>“ in agmeo');
    expect(mail.text).toContain('als Agronom mitzuarbeiten');
    expect(mail.text).toContain(params.acceptUrl);
  });

  it('escapes HTML', () => {
    const mail = renderMail('invitation', params);
    expect(mail.html).toContain('Hof &#60;Sonnenfeld&#62;');
    expect(mail.html).not.toContain('<Sonnenfeld>');
  });
});

describe('digest templates', () => {
  const row = (name: string, mm: number) => ({ name, areaHa: 12.34, crop: 'Winterweizen', precipMm: mm });
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
    const mail = renderMail('rainDigest', digest);
    expect(mail.subject).toBe('Niederschlagsbericht für Ihre Schläge vom 27. September 2026');
    expect(mail.text).toContain('dass 1 Ihrer 2 Schläge zwischen gestern 6 Uhr und heute 6 Uhr mindestens 1,0 mm Niederschlag');
    expect(mail.text).toContain('Breite · 12,3 ha · Winterweizen · 4,2 mm');
    expect(mail.html).toContain('Acker &#60;1&#62;');
    expect(mail.html).not.toContain('<1>');
    expect(mail.html).toContain('https://app.example/unsubscribe/t');
  });

  it('renders imperial units and the stale note', () => {
    const mail = renderMail('rainDigest', { ...digest, system: 'imperial', thresholdMm: 2.54, staleSince: '2026-09-26T03:00:00Z', most: [{ ...row('Breite', 4.2), crop: null }] });
    expect(mail.text).toContain('mindestens 0,10 in Niederschlag');
    expect(mail.text).toContain('Breite · 30,5 ac · – · 0,17 in');
    expect(mail.text).toContain('Wetterdaten mit Stand 26.09.2026, 05:00.');
  });

  it('renders storage notices', () => {
    const p = { orgName: 'Hof', usedBytes: 4.5e9, limitBytes: 5e9, trashBytes: 3e8, trashFiles: 12, filesUrl: 'https://app.example/f', unsubscribeUrl: 'https://app.example/u' };
    expect(renderMail('storageDigest', p).text).toContain('Ihre Dateien belegen 4,5 GB von 5,0 GB (90 %).');
    expect(renderMail('storageDigest', { ...p, usedBytes: 5e9 }).subject).toBe('Speicherplatz von „Hof“ in agmeo voll');
    const overview = renderMail('storageOverview', { totalBytes: 9e9, trashBytes: 1e9, organizationCount: 3, organizations: [{ name: 'Hof', usedBytes: 4.5e9, limitBytes: 5e9 }] });
    expect(overview.text).toContain('• Hof: 4,5 GB / 5,0 GB (90 %)');
  });
});
