import { zip } from '../modules/vra/export/zip.js';
import { aggregateVarieties, parseRegistrations, parseSpeciesOptions, readSheet, type EuRegistration } from './eupvp.js';

// Trimmed copy of the EU Plant Variety Portal search form (October 2026).
const page = `
<select id="filterForm:sel_filter_species_input" name="filterForm:sel_filter_species_input" multiple="multiple" size="2">
  <option value="83">HLNTS_ANN: Helianthus annuus L. (AGR)</option>
  <option value="121">PISUM_SAT: Pisum sativum L. (AGR)</option>
  <option value="122">PISUM_SAT: Pisum sativum L. (VEG)</option>
  <option value="139">SOLAN_LHA: hybrids between Solanum lycopersicum L. and Solanum habrochaites S. Knapp &amp; D.M. Spooner (VEG)</option>
  <option value="178">ZEAAA_MAY_GMA: Zea mays L. subsp. mays (Maize Group) (AGR)</option>
</select>
<select id="filterForm:sel_filter_varStatus_input" name="filterForm:sel_filter_varStatus_input" multiple="multiple"><option value="20">Registered</option></select>`;

/** An export workbook as the portal writes it: inline strings, dates as Excel serial numbers. */
function workbook(rows: (string | number | null)[][]): Buffer {
  const col = (i: number) => (i >= 26 ? String.fromCharCode(64 + Math.floor(i / 26)) : '') + String.fromCharCode(65 + (i % 26));
  const cell = (v: string | number | null, ref: string) =>
    v === null ? `<c r="${ref}"></c>` : typeof v === 'number' ? `<c r="${ref}" s="2" t="n"><v>${v}.0</v></c>` : `<c r="${ref}" t="inlineStr"><is><t>${v.replace(/&/g, '&amp;')}</t></is></c>`;
  const sheet = `<?xml version="1.0" encoding="UTF-8"?><worksheet><sheetData>${rows
    .map((r, i) => `<row r="${i + 1}">${r.map((v, j) => cell(v, `${col(j)}${i + 1}`)).join('')}</row>`)
    .join('\n')}</sheetData></worksheet>`;
  return zip([
    { name: 'xl/sharedStrings.xml', data: Buffer.from('<sst count="0" uniqueCount="0"/>') },
    { name: 'xl/worksheets/sheet1.xml', data: Buffer.from(sheet) },
  ]);
}

// 45658 = 2025-01-01, 46934 = 2028-06-30.
const header = ['Country / Org.', 'Register Type', 'UPOV Species Code', 'Variety Denomination', 'Variety Status', 'Registration Date', 'End Date', 'Market Extension Date', 'GMO', 'Conservation Variety', 'Amateur Variety'];
const sheet = [
  header,
  ['FR', 'NLI', 'ZEAAA_MAY_GMA', 'DKC2972', 'Registered', 45658, null, '', 'N', 'N', ''],
  ['IT', 'NLI', 'ZEAAA_MAY_GMA', 'Bacardi & Co', 'Registered', 43000, null, '', 'N', 'N', ''],
];

const reg = (r: Partial<EuRegistration>): EuRegistration => ({
  country: 'FR',
  speciesCode: 'ZEAAA_MAY_GMA',
  name: 'X',
  status: 'Registered',
  registeredOn: null,
  endedOn: null,
  marketableUntil: null,
  gmo: false,
  conservation: false,
  amateur: false,
  ...r,
});

describe('EU Plant Variety Portal parsing', () => {
  it('lists the agricultural species of the search form', () => {
    expect(parseSpeciesOptions(page)).toEqual([
      { id: '83', code: 'HLNTS_ANN', botanicalName: 'Helianthus annuus L.' },
      { id: '121', code: 'PISUM_SAT', botanicalName: 'Pisum sativum L.' },
      { id: '178', code: 'ZEAAA_MAY_GMA', botanicalName: 'Zea mays L. subsp. mays (Maize Group)' },
    ]);
  });

  it('reads the export workbook by column header', () => {
    const rows = readSheet(workbook(sheet));
    expect(rows[1]).toEqual(['FR', 'NLI', 'ZEAAA_MAY_GMA', 'DKC2972', 'Registered', '45658.0', '', '', 'N', 'N', '']);
    expect(parseRegistrations(rows)).toEqual([
      reg({ country: 'FR', name: 'DKC2972', registeredOn: '2025-01-01' }),
      reg({ country: 'IT', name: 'Bacardi & Co', registeredOn: '2017-09-22' }),
    ]);
  });

  it('fails loudly when the export layout changes', () => {
    expect(() => parseRegistrations([header.filter((h) => h !== 'Market Extension Date')])).toThrow(/Market Extension Date/);
  });

  it('merges national registrations into varieties that may be marketed in Germany', () => {
    const varieties = aggregateVarieties(
      [
        reg({ country: 'IT', name: 'DKC 2972', registeredOn: '2019-02-01' }),
        reg({ country: 'FR', name: 'DKC2972', registeredOn: '2020-03-01' }),
        reg({ country: 'CZ', name: 'DKC2972', registeredOn: '2018-05-01' }),
        // Ended registrations count through their marketing extension only.
        reg({ country: 'HU', name: 'DKC2972', status: 'Surrendered', endedOn: '2025-03-12', marketableUntil: '2028-06-30' }),
        reg({ country: 'HU', name: 'Ouvea', status: 'Terminated', endedOn: '2025-12-31', marketableUntil: '2028-06-30' }),
        reg({ country: 'RO', name: 'Ouvea', status: 'Expired', endedOn: '2024-06-06', marketableUntil: '2027-06-30' }),
        reg({ country: 'ES', name: 'Gone', status: 'Surrendered', endedOn: '2023-01-01' }),
        // Not in the Common Catalogue, or not to be marketed in Germany.
        reg({ country: 'CH', name: 'Swiss' }),
        reg({ country: 'QZ', name: 'Protected only' }),
        reg({ country: 'ES', name: 'MON 810 hybrid', gmo: true }),
        reg({ country: 'AT', name: 'Landmais', conservation: true }),
        reg({ country: 'FR', name: 'Other species', speciesCode: 'HLNTS_ANN' }),
      ],
      'ZEAAA_MAY_GMA',
    );
    expect(varieties).toEqual([
      { speciesCode: 'ZEAAA_MAY_GMA', name: 'DKC2972', countries: ['CZ', 'FR', 'IT'], registeredOn: '2018-05-01', marketableUntil: '2028-06-30' },
      { speciesCode: 'ZEAAA_MAY_GMA', name: 'Ouvea', countries: [], registeredOn: null, marketableUntil: '2028-06-30' },
    ]);
  });
});
