/**
 * Client for the Bundessortenamt's public variety database ("Nationale Sorteninformationen").
 *
 * The BSA publishes no API or bulk download. Its query app renders the full result for one
 * species as HTML tables, so we post the same form a browser does and parse the tables.
 */

export const BSA_SORTENINFO_URL = 'https://www.bundessortenamt.de/apps11/web/bsa_sorteninfo/public/de';

export interface BsaSpecies {
  code: string;
  nameDe: string;
  botanicalName: string;
}

export interface BsaVariety {
  speciesCode: string;
  registrationNumber: number;
  name: string;
  provisionalName: string | null;
  protectionAppliedOn: string | null;
  protectionGrantedOn: string | null;
  protectionEndedOn: string | null;
  approvalAppliedOn: string | null;
  approvalGrantedOn: string | null;
  approvalEndedOn: string | null;
  marketableUntil: string | null;
  conservationRegion: string | null;
}

interface Cell {
  text: string;
  sort: string | null;
}

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };

function decode(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e: string) => {
    if (e[0] === '#') return String.fromCodePoint(e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : Number(e.slice(1)));
    return ENTITIES[e.toLowerCase()] ?? m;
  });
}

function text(html: string): string {
  return decode(html.replace(/<[^>]*>/g, ' ')).replace(/\s+/g, ' ').trim();
}

/** Body rows of the table with the given id, as cells. Header rows (th only) are skipped. */
export function tableRows(html: string, id: string): Cell[][] {
  const start = html.search(new RegExp(`<table\\b[^>]*\\bid="${id}"`));
  if (start < 0) return [];
  const end = html.indexOf('</table>', start);
  const table = html.slice(start, end < 0 ? undefined : end);
  const rows: Cell[][] = [];
  for (const [, tr] of table.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/g)) {
    const cells = [...tr.matchAll(/<td\b([^>]*)>([\s\S]*?)<\/td>/g)].map(([, attrs, inner]) => ({
      text: text(inner),
      sort: /data-sort="([^"]*)"/.exec(attrs)?.[1] ?? null,
    }));
    if (cells.length) rows.push(cells);
  }
  return rows;
}

/** ISO date of a cell: the table's ISO sort key if present, else the German dd.mm.yyyy text. */
function date(cell: Cell | undefined): string | null {
  if (!cell) return null;
  if (cell.sort && /^\d{4}-\d{2}-\d{2}$/.test(cell.sort)) return cell.sort;
  const m = /^(\d{2})\.(\d{2})\.(\d{4})$/.exec(cell.text);
  return m ? `${m[3]}-${m[2]}-${m[1]}` : null;
}

const orNull = (s: string | undefined) => (s ? s : null);

/** The species selection list on the query page. */
export function parseSpecies(html: string): BsaSpecies[] {
  return tableRows(html, 'artliste_auswahl')
    .filter((c) => c.length >= 3 && c[0].text)
    .map((c) => ({ code: c[0].text, botanicalName: c[1].text, nameDe: c[2].text }));
}

/**
 * All varieties of one species from a result page. The "schutzTabelle" lists every variety with
 * its protection and approval dates; run-off periods and conservation varieties are merged in
 * from their own tables.
 */
export function parseVarieties(html: string, speciesCode: string): BsaVariety[] {
  const key = (c: Cell[]) => Number(c[1]?.text);
  const marketable = new Map(tableRows(html, 'auslaufTabelle').map((c) => [key(c), date(c[4])]));
  const conservation = new Map(tableRows(html, 'erhaltungsTabelle').map((c) => [key(c), orNull(c[9]?.text)]));
  const varieties = new Map<number, BsaVariety>();
  for (const c of tableRows(html, 'schutzTabelle')) {
    const registrationNumber = key(c);
    if (c[0]?.text !== speciesCode || !Number.isInteger(registrationNumber) || !c[2]?.text) continue;
    varieties.set(registrationNumber, {
      speciesCode,
      registrationNumber,
      name: c[2].text,
      provisionalName: orNull(c[3]?.text),
      protectionAppliedOn: date(c[4]),
      protectionGrantedOn: date(c[5]),
      protectionEndedOn: date(c[6]),
      approvalAppliedOn: date(c[7]),
      approvalGrantedOn: date(c[8]),
      approvalEndedOn: date(c[9]),
      marketableUntil: marketable.get(registrationNumber) ?? null,
      conservationRegion: conservation.get(registrationNumber) ?? null,
    });
  }
  return [...varieties.values()];
}

/** Minimal cookie-keeping session; the query form is CSRF protected (Laravel). */
export class BsaClient {
  private cookies = new Map<string, string>();
  private token: string | null = null;
  private startPage: string | null = null;

  constructor(
    private readonly baseUrl = BSA_SORTENINFO_URL,
    private readonly userAgent = 'agmeo variety sync (+https://agvolution.com)',
  ) {}

  private async request(body?: URLSearchParams): Promise<string> {
    const res = await fetch(this.baseUrl, {
      method: body ? 'POST' : 'GET',
      body,
      redirect: 'follow',
      headers: {
        'user-agent': this.userAgent,
        cookie: [...this.cookies].map(([k, v]) => `${k}=${v}`).join('; '),
        ...(body ? { 'content-type': 'application/x-www-form-urlencoded' } : {}),
      },
      signal: AbortSignal.timeout(120_000),
    });
    for (const c of res.headers.getSetCookie()) {
      const [pair] = c.split(';');
      const i = pair.indexOf('=');
      this.cookies.set(pair.slice(0, i).trim(), pair.slice(i + 1).trim());
    }
    if (!res.ok) throw new Error(`BSA responded ${res.status} ${res.statusText}`);
    return res.text();
  }

  private async open(): Promise<string> {
    if (!this.startPage) {
      this.startPage = await this.request();
      this.token = /name="_token" value="([^"]+)"/.exec(this.startPage)?.[1] ?? null;
      if (!this.token) throw new Error('BSA query page has no form token; the page layout may have changed');
    }
    return this.startPage;
  }

  async species(): Promise<BsaSpecies[]> {
    return parseSpecies(await this.open());
  }

  async varieties(species: BsaSpecies): Promise<BsaVariety[]> {
    await this.open();
    const html = await this.request(
      new URLSearchParams({
        _token: this.token!,
        kennbuchstabe: species.code,
        deutsche_bezeichnung: species.nameDe,
        botanische_bezeichnung: species.botanicalName,
        vf_typ: 'ALL',
        vf_status: 'ALL',
        zeit_von: '',
        zeit_bis: '',
        sbez: '',
        znr: '',
        zbez: '',
      }),
    );
    if (!html.includes('id="schutzTabelle"')) throw new Error(`BSA returned no result table for ${species.code}`);
    return parseVarieties(html, species.code);
  }
}
