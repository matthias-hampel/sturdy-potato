/**
 * Client for the EU Plant Variety Portal (EUPVP), which lists the EU Common Catalogue of
 * agricultural plant species. © European Union; reused under CC BY 4.0.
 *
 * The portal has no API. Its search (a JSF form) offers an "Export Search Results" button that
 * returns every national registration of the result as an XLSX sheet, so we post the search
 * form a browser does, then the export button, and read the sheet.
 */
import { inflateRawSync } from 'node:zlib';
import { varietyKey } from '@agmeo/contracts';

export const EUPVP_URL = 'https://ec.europa.eu/food/plant-variety-portal/index.xhtml';

/** EU member states, plus Northern Ireland (XI) where EU seed law applies. EUPVP writes Greece as EL. */
const EU_COUNTRIES = new Set('AT BE BG HR CY CZ DK EE FI FR DE EL HU IE IT LV LT LU MT NL PL PT RO SK SI ES SE XI'.split(' '));

export interface EuSpecies {
  /** Form value of the species in the search. */
  id: string;
  /** UPOV code, e.g. ZEAAA_MAY_GMA. */
  code: string;
  botanicalName: string;
}

/** One national registration of a variety. */
export interface EuRegistration {
  country: string;
  speciesCode: string;
  name: string;
  status: string;
  registeredOn: string | null;
  endedOn: string | null;
  /** End of the marketing extension after the registration ended. */
  marketableUntil: string | null;
  gmo: boolean;
  conservation: boolean;
  amateur: boolean;
}

export interface EuVariety {
  speciesCode: string;
  name: string;
  countries: string[];
  registeredOn: string | null;
  marketableUntil: string | null;
}

// --- XLSX -------------------------------------------------------------------------------------

/** One file of a zip archive, located through the central directory (entries use data descriptors). */
export function unzipEntry(zip: Buffer, name: string): Buffer | null {
  const end = zip.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  if (end < 0) throw new Error('Not a zip archive');
  const count = zip.readUInt16LE(end + 10);
  let at = zip.readUInt32LE(end + 16);
  for (let i = 0; i < count; i++) {
    const method = zip.readUInt16LE(at + 10);
    const size = zip.readUInt32LE(at + 20);
    const nameLength = zip.readUInt16LE(at + 28);
    const extraLength = zip.readUInt16LE(at + 30);
    const commentLength = zip.readUInt16LE(at + 32);
    const local = zip.readUInt32LE(at + 42);
    if (zip.toString('utf8', at + 46, at + 46 + nameLength) === name) {
      const start = local + 30 + zip.readUInt16LE(local + 26) + zip.readUInt16LE(local + 28);
      const data = zip.subarray(start, start + size);
      return method === 0 ? data : inflateRawSync(data);
    }
    at += 46 + nameLength + extraLength + commentLength;
  }
  return null;
}

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };

function decode(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e: string) => {
    if (e[0] === '#') return String.fromCodePoint(e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : Number(e.slice(1)));
    return ENTITIES[e.toLowerCase()] ?? m;
  });
}

const texts = (xml: string) => decode([...xml.matchAll(/<t\b[^>]*>([\s\S]*?)<\/t>/g)].map((t) => t[1]).join(''));

function columnIndex(ref: string): number {
  let n = 0;
  for (const ch of ref) n = n * 26 + ch.charCodeAt(0) - 64;
  return n - 1;
}

/** Cell texts of the first worksheet, by row and column. Numbers (and dates) stay as written. */
export function readSheet(xlsx: Buffer): string[][] {
  const shared = [...(unzipEntry(xlsx, 'xl/sharedStrings.xml')?.toString('utf8') ?? '').matchAll(/<si>([\s\S]*?)<\/si>/g)].map(([, si]) => texts(si));
  const sheet = unzipEntry(xlsx, 'xl/worksheets/sheet1.xml');
  if (!sheet) throw new Error('Workbook has no first worksheet');
  const rows: string[][] = [];
  for (const [, row] of sheet.toString('utf8').matchAll(/<row\b[^>]*>([\s\S]*?)<\/row>/g)) {
    const cells: string[] = [];
    for (const [, ref, attrs, inner = ''] of row.matchAll(/<c r="([A-Z]+)\d+"([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
      const type = /\bt="(\w+)"/.exec(attrs)?.[1];
      const v = /<v>([\s\S]*?)<\/v>/.exec(inner)?.[1] ?? '';
      cells[columnIndex(ref)] = (type === 'inlineStr' ? texts(inner) : type === 's' ? (shared[Number(v)] ?? '') : decode(v)).trim();
    }
    rows.push(Array.from(cells, (c) => c ?? ''));
  }
  return rows;
}

// --- Parsing ----------------------------------------------------------------------------------

/** ISO date of an Excel date serial (days since 1899-12-30), as the export writes dates. */
function date(serial: string | undefined): string | null {
  const days = Number(serial);
  if (!serial || !Number.isFinite(days) || days <= 0) return null;
  return new Date(Date.UTC(1899, 11, 30) + Math.floor(days) * 86_400_000).toISOString().slice(0, 10);
}

/** Agricultural species of the search form's species list ("ZEAAA_MAY_GMA: Zea mays L. ... (AGR)"). */
export function parseSpeciesOptions(html: string): EuSpecies[] {
  const select = /<select\b[^>]*name="filterForm:sel_filter_species_input"[^>]*>([\s\S]*?)<\/select>/.exec(html)?.[1] ?? '';
  return [...select.matchAll(/<option value="(\d+)"[^>]*>([^<]*)<\/option>/g)].flatMap(([, id, label]) => {
    const m = /^(\S+): (.*) \(AGR\)$/.exec(decode(label).trim());
    return m ? [{ id, code: m[1], botanicalName: m[2] }] : [];
  });
}

/** Registrations from the export sheet, located by column header. */
export function parseRegistrations(rows: string[][]): EuRegistration[] {
  const [header = [], ...body] = rows;
  const col = (name: string) => {
    const i = header.indexOf(name);
    if (i < 0) throw new Error(`EUPVP export has no column "${name}"; the export layout may have changed`);
    return i;
  };
  const c = {
    country: col('Country / Org.'),
    species: col('UPOV Species Code'),
    name: col('Variety Denomination'),
    status: col('Variety Status'),
    registered: col('Registration Date'),
    ended: col('End Date'),
    extension: col('Market Extension Date'),
    gmo: col('GMO'),
    conservation: col('Conservation Variety'),
    amateur: col('Amateur Variety'),
  };
  return body
    .filter((r) => r[c.name] && r[c.country])
    .map((r) => ({
      country: r[c.country],
      speciesCode: r[c.species],
      name: r[c.name],
      status: r[c.status],
      registeredOn: date(r[c.registered]),
      endedOn: date(r[c.ended]),
      marketableUntil: date(r[c.extension]),
      gmo: r[c.gmo] === 'Y',
      conservation: r[c.conservation] === 'Y',
      amateur: r[c.amateur] === 'Y',
    }));
}

/**
 * Varieties whose seed may be marketed in Germany, one per name (see varietyKey): registered in a
 * member state, or with ended registrations whose marketing extension is known. Left out are
 * registrations outside the EU (Switzerland, Norway, CPVO), GMO varieties (their cultivation is
 * banned in Germany), and conservation and amateur varieties, which may only be marketed in their
 * region of origin or in small packages.
 */
export function aggregateVarieties(registrations: EuRegistration[], speciesCode: string): EuVariety[] {
  const byName = new Map<string, { spellings: Map<string, number>; variety: EuVariety }>();
  for (const r of registrations) {
    if (r.speciesCode !== speciesCode || !EU_COUNTRIES.has(r.country) || r.gmo || r.conservation || r.amateur) continue;
    const registered = r.status === 'Registered';
    if (!registered && !r.marketableUntil) continue;
    const key = varietyKey(r.name);
    let entry = byName.get(key);
    if (!entry) {
      entry = { spellings: new Map(), variety: { speciesCode, name: r.name, countries: [], registeredOn: null, marketableUntil: null } };
      byName.set(key, entry);
    }
    const v = entry.variety;
    entry.spellings.set(r.name, (entry.spellings.get(r.name) ?? 0) + 1);
    if (registered) {
      if (!v.countries.includes(r.country)) v.countries.push(r.country);
      if (r.registeredOn && (!v.registeredOn || r.registeredOn < v.registeredOn)) v.registeredOn = r.registeredOn;
    } else if (!v.marketableUntil || r.marketableUntil! > v.marketableUntil) {
      v.marketableUntil = r.marketableUntil;
    }
  }
  return [...byName.values()].map(({ spellings, variety }) => ({
    ...variety,
    // The spelling most countries use (the first one seen on a tie).
    name: [...spellings].reduce((best, s) => (s[1] > best[1] ? s : best))[0],
    countries: variety.countries.sort(),
  }));
}

// --- Client -----------------------------------------------------------------------------------

/** Registration statuses of the search form. */
const STATUS = { registered: '20', ended: ['18', '21', '22', '23'] }; // withdrawn, surrendered, terminated, expired

/**
 * The portal's JSF session travels in the form's action URL (its cookie is scoped to another
 * path), the view state in a hidden field; each export starts from a fresh page.
 */
export class EupvpClient {
  private startPage: string | null = null;

  constructor(
    private readonly url = EUPVP_URL,
    private readonly userAgent = 'agmeo variety sync (+https://agvolution.com)',
  ) {}

  private async request(url: string, body?: [string, string][]): Promise<Response> {
    const res = await fetch(url, {
      method: body ? 'POST' : 'GET',
      body: body ? new URLSearchParams(body) : undefined,
      headers: { 'user-agent': this.userAgent, ...(body ? { 'content-type': 'application/x-www-form-urlencoded' } : {}) },
      signal: AbortSignal.timeout(300_000),
    });
    if (!res.ok) throw new Error(`EUPVP responded ${res.status} ${res.statusText}`);
    return res;
  }

  private form(html: string, id: string): { action: string; viewState: string } {
    const action = new RegExp(`<form id="${id}"[^>]*action="([^"]+)"`).exec(html)?.[1];
    const viewState = /name="javax\.faces\.ViewState"[^>]*value="([^"]+)"/.exec(html)?.[1];
    if (!action || !viewState) throw new Error(`EUPVP page has no ${id}; the page layout may have changed`);
    return { action: new URL(decode(action), this.url).href, viewState };
  }

  async species(): Promise<EuSpecies[]> {
    this.startPage ??= await (await this.request(this.url)).text();
    return parseSpeciesOptions(this.startPage);
  }

  /** National registrations of one species: current ones, and those ended since the given ISO date. */
  async registrations(species: EuSpecies, endedSince: string): Promise<EuRegistration[]> {
    const current = await this.export(species, [['filterForm:sel_filter_varStatus_input', STATUS.registered]]);
    const [y, m, d] = endedSince.split('-');
    const ended = await this.export(species, [
      ...STATUS.ended.map((s): [string, string] => ['filterForm:sel_filter_varStatus_input', s]),
      ['filterForm:var_end_date_from_input', `${d}/${m}/${y}`],
    ]);
    return [...current, ...ended];
  }

  private async export(species: EuSpecies, filters: [string, string][]): Promise<EuRegistration[]> {
    const filter = this.form(await (await this.request(this.url)).text(), 'filterForm');
    const results = await (
      await this.request(filter.action, [
        ['filterForm', 'filterForm'],
        ['filterForm:sel_filter_species_input', species.id],
        ...filters,
        ['filterForm:btn_search', ''],
        ['javax.faces.ViewState', filter.viewState],
      ])
    ).text();
    const search = this.form(results, 'searchForm');
    const res = await this.request(search.action, [
      ['searchForm', 'searchForm'],
      ['searchForm:result_datatable:btn_download_search_hidden', 'Search'],
      ['javax.faces.ViewState', search.viewState],
    ]);
    const xlsx = Buffer.from(await res.arrayBuffer());
    if (xlsx.length < 4 || xlsx.readUInt32LE(0) !== 0x04034b50) throw new Error(`EUPVP returned no export for ${species.code}`);
    return parseRegistrations(readSheet(xlsx));
  }
}
