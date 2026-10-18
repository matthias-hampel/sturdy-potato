import { cleanName, contentDisposition, isSafeInline, mimeFromName, nextAvailableName } from './names.js';

describe('file names', () => {
  it('numbers duplicates before the extension, ignoring case', () => {
    expect(nextAvailableName('Bericht.pdf', [])).toBe('Bericht.pdf');
    expect(nextAvailableName('Bericht.pdf', ['bericht.pdf'])).toBe('Bericht (2).pdf');
    expect(nextAvailableName('Bericht.pdf', ['Bericht.pdf', 'Bericht (2).pdf'])).toBe('Bericht (3).pdf');
    expect(nextAvailableName('Proben.2026', ['Proben.2026'], false)).toBe('Proben.2026 (2)');
    expect(nextAvailableName('.env', ['.env'])).toBe('.env (2)');
  });

  it('removes separators and control characters', () => {
    expect(cleanName('a/b\\c.txt')).toBe('a_b_c.txt');
    expect(cleanName('  \u0007 ')).toBe('file');
    expect(cleanName('x'.repeat(300))).toHaveLength(255);
  });

  it('sends UTF-8 names and only shows images and PDFs inline', () => {
    expect(contentDisposition('Düngung "neu".pdf')).toBe(`attachment; filename="D_ngung _neu_.pdf"; filename*=UTF-8''D%C3%BCngung%20%22neu%22.pdf`);
    expect(isSafeInline('image/png')).toBe(true);
    expect(isSafeInline('application/pdf')).toBe(true);
    expect(isSafeInline('image/svg+xml')).toBe(false);
    expect(isSafeInline('text/html')).toBe(false);
  });

  it('derives missing MIME types from the extension', () => {
    expect(mimeFromName('a.GEOJSON')).toBe('application/geo+json');
    expect(mimeFromName('a.csv', 'application/octet-stream')).toBe('text/csv');
    expect(mimeFromName('a.bin')).toBe('application/octet-stream');
    expect(mimeFromName('a.csv', 'text/plain')).toBe('text/plain');
  });
});
