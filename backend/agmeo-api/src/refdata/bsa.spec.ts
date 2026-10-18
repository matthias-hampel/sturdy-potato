import { parseSpecies, parseVarieties } from './bsa.js';

// Trimmed copy of the BSA "Nationale Sorteninformationen" markup (October 2026).
const page = `
<table id="artliste_auswahl" class="table"><thead><tr><th>Kbst</th><th>botanische Bezeichnung</th><th>deutsche Bezeichnung</th></tr></thead>
<tbody>
  <tr class="auswahlZeile" tabindex="0"><td style="width: 110px;">WW</td><td style="width: 310px;">Triticum aestivum L. subsp. aestivum</td><td>Winterweichweizen</td></tr>
  <tr class="auswahlZeile" tabindex="0"><td style="width: 110px;">GL</td><td style="width: 310px;">Arrhenatherum elatius (L.) P. Beauv. ex J. Presl. &amp; C. Presl</td><td>Glatthafer</td></tr>
</tbody></table>
<table id="schutzTabelle" role="table" class="table">
  <thead><tr><th>Kbst</th><th>Knr</th><th>Sorten- <br> bezeichnung</th><th>vorl.</th><th>a</th><th>b</th><th>c</th><th>d</th><th>e</th><th>f</th><th>g</th><th>h</th><th>i</th><th>j</th></tr></thead>
  <tbody>
    <tr>
      <td tabindex="-1">WW</td><td>1</td><td>Ackermanns Bayernkönig</td><td>Ackermanns Bayernkö</td>
      <td data-sort="1953-11-30">30.11.1953</td><td ></td><td data-sort="1960-12-31">31.12.1960</td>
      <td data-sort="2019-10-17">17.10.2019</td><td data-sort="2020-02-18">18.02.2020</td><td ></td>
      <td class="weitereInfos"><a data-kbst="WW" data-knr=" 1"><i class="fa-solid"></i></a></td><td>8905</td><td></td><td></td>
    </tr>
    <tr>
      <td tabindex="-1">WW</td><td>3768</td><td>Butaro</td><td>SW 07&#039;12</td>
      <td></td><td></td><td></td>
      <td>01.09.2006</td><td data-sort="2009-03-17">17.03.2009</td><td data-sort="2025-12-31">31.12.2025</td>
      <td class="weitereInfos"></td><td>129</td><td></td><td></td>
    </tr>
  </tbody>
</table>
<table id="erhaltungsTabelle"><tbody>
  <tr><td>WW</td><td>1</td><td>Ackermanns Bayernkönig</td><td></td><td></td><td></td><td></td><td>8905</td><td></td><td>Deutschland</td></tr>
</tbody></table>
<table id="auslaufTabelle"><tbody>
  <tr><td>WW</td><td>3768</td><td>Butaro</td><td data-sort="2026-12-31">31.12.2026</td><td data-sort="2028-06-30">30.06.2028</td><td></td></tr>
</tbody></table>`;

describe('BSA variety database parsing', () => {
  it('reads the species list and decodes entities', () => {
    expect(parseSpecies(page)).toEqual([
      { code: 'WW', botanicalName: 'Triticum aestivum L. subsp. aestivum', nameDe: 'Winterweichweizen' },
      { code: 'GL', botanicalName: 'Arrhenatherum elatius (L.) P. Beauv. ex J. Presl. & C. Presl', nameDe: 'Glatthafer' },
    ]);
  });

  it('reads varieties with their protection and approval dates', () => {
    const [bayernkoenig, butaro] = parseVarieties(page, 'WW');
    expect(bayernkoenig).toEqual({
      speciesCode: 'WW',
      registrationNumber: 1,
      name: 'Ackermanns Bayernkönig',
      provisionalName: 'Ackermanns Bayernkö',
      protectionAppliedOn: '1953-11-30',
      protectionGrantedOn: null,
      protectionEndedOn: '1960-12-31',
      approvalAppliedOn: '2019-10-17',
      approvalGrantedOn: '2020-02-18',
      approvalEndedOn: null,
      marketableUntil: null,
      conservationRegion: 'Deutschland',
    });
    expect(butaro).toMatchObject({
      registrationNumber: 3768,
      provisionalName: "SW 07'12",
      // German date text without a sort key.
      approvalAppliedOn: '2006-09-01',
      approvalEndedOn: '2025-12-31',
      marketableUntil: '2028-06-30',
      conservationRegion: null,
    });
  });

  it('ignores rows of other species and pages without results', () => {
    expect(parseVarieties(page, 'M')).toEqual([]);
    expect(parseVarieties('<html></html>', 'WW')).toEqual([]);
  });
});
