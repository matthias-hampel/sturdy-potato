/**
 * Client for the BVL's public plant-protection API (PSM-API, Oracle ORDS), and the mapping of
 * its tables to agmeo's register: one row per product and one per approved use (AWG).
 */

export const BVL_PSM_URL = 'https://psm-api.bvl.bund.de/ords/psm/api-v1';

type Row = Record<string, unknown>;

export class PsmClient {
  constructor(
    private readonly baseUrl = BVL_PSM_URL,
    private readonly pageSize = 10_000,
  ) {}

  /** Every row of a table, page by page. */
  async all(table: string, params: Record<string, string> = {}): Promise<Row[]> {
    const rows: Row[] = [];
    for (let offset = 0; ; offset += this.pageSize) {
      const url = new URL(`${this.baseUrl}/${table}/`);
      for (const [k, v] of Object.entries({ ...params, limit: String(this.pageSize), offset: String(offset) })) url.searchParams.set(k, v);
      const res = await fetch(url, { headers: { accept: 'application/json' } });
      if (!res.ok) throw new Error(`BVL ${table}: HTTP ${res.status}`);
      const body = (await res.json()) as { items: Row[]; hasMore: boolean };
      rows.push(...body.items);
      if (!body.hasMore) return rows;
    }
  }
}

export interface PsmProductRow {
  kennr: string;
  name: string;
  formulation: string | null;
  first_approved_on: string | null;
  approval_ends_on: string | null;
  sale_until: string | null;
  use_up_until: string | null;
  active_ingredients: { name: string; content: number | null; unit: string | null }[];
}

export interface PsmUseRow {
  awg_id: string;
  kennr: string;
  professional: boolean;
  area: string | null;
  crop_codes: string[];
  excluded_crop_codes: string[];
  target_codes: string[];
  bbch_from: number | null;
  bbch_to: number | null;
  max_applications: number | null;
  min_interval_days: number | null;
  max_interval_days: number | null;
  dose_max: number | null;
  dose_unit: string | null;
  water_min_l_ha: number | null;
  water_max_l_ha: number | null;
  waiting_days: Record<string, number | null>;
}

const str = (v: unknown) => (v == null || v === '' ? null : String(v));
const num = (v: unknown) => (v == null || v === '' || Number.isNaN(Number(v)) ? null : Number(v));
/** ORDS returns dates as UTC instants of midnight Berlin time ("2027-12-30T23:00:00Z" is 31 Dec). */
export const bvlDate = (v: unknown): string | null => {
  const s = str(v);
  if (!s) return null;
  return new Date(s).toLocaleDateString('sv-SE', { timeZone: 'Europe/Berlin' });
};
/** BBCH stages are codes like "13" or "BBCH 13"; anything not numeric is no stage. */
const bbch = (v: unknown) => {
  const m = /(\d{1,2})/.exec(String(v ?? ''));
  return m ? Number(m[1]) : null;
};

const group = <T extends Row>(rows: T[], key: string) => {
  const m = new Map<string, T[]>();
  for (const r of rows) {
    const k = String(r[key]);
    const list = m.get(k);
    if (list) list.push(r);
    else m.set(k, [r]);
  }
  return m;
};

export function mapProducts(current: Row[], expired: Row[], contents: Row[], substances: Row[]): PsmProductRow[] {
  const names = new Map(substances.map((s) => [String(s.wirknr), String(s.wirkstoffname)]));
  const byKennr = group(contents, 'kennr');
  const ingredients = (kennr: string) =>
    (byKennr.get(kennr) ?? []).map((c) => ({
      name: names.get(String(c.wirknr)) ?? String(c.wirknr),
      content: num(c.gehalt_rein_grundstruktur) ?? num(c.gehalt_rein),
      unit: unitOfContent(str(c.gehalt_einheit)),
    }));
  const out = new Map<string, PsmProductRow>();
  for (const m of [...expired, ...current]) {
    const kennr = String(m.kennr);
    out.set(kennr, {
      kennr,
      name: String(m.mittelname),
      formulation: str(m.formulierung_art),
      first_approved_on: bvlDate(m.zul_erstmalig_am),
      approval_ends_on: bvlDate(m.zul_ende),
      sale_until: null,
      use_up_until: bvlDate(m.aufbrauchfrist),
      active_ingredients: ingredients(kennr),
    });
  }
  return [...out.values()];
}

function unitOfContent(code: string | null): string | null {
  // Kodeliste 70 (Gehaltseinheit): the common ones.
  const units: Record<string, string> = { GK: 'g/kg', GL: 'g/l', PR: '%', MK: 'mg/kg', ML: 'mg/l' };
  return code ? (units[code] ?? code) : null;
}

/**
 * Approved uses. Doses come from awg_aufwand (the highest product dose of the use's own unit);
 * the interval unit "T" is days, "W" weeks.
 */
export function mapUses(awg: Row[], kultur: Row[], schadorg: Row[], aufwand: Row[], wartezeit: Row[], kennrs: Set<string>): PsmUseRow[] {
  const crops = group(kultur, 'awg_id');
  const targets = group(schadorg, 'awg_id');
  const doses = group(aufwand, 'awg_id');
  const waits = group(wartezeit, 'awg_id');
  const days = (value: unknown, unit: unknown) => {
    const n = num(value);
    if (n == null) return null;
    return unit === 'W' ? n * 7 : unit === 'T' || unit == null ? n : null;
  };
  const out: PsmUseRow[] = [];
  for (const a of awg) {
    const id = String(a.awg_id);
    const kennr = String(a.kennr);
    if (!kennrs.has(kennr)) continue;
    const k = crops.get(id) ?? [];
    const d = (doses.get(id) ?? []).filter((x) => num(x.m_aufwand) != null);
    const unit = str(a.aufwand_pro_jahr_einheit) ?? str(d[0]?.m_aufwand_einheit);
    const sameUnit = d.filter((x) => x.m_aufwand_einheit === (str(d[0]?.m_aufwand_einheit) ?? unit));
    const water = d.filter((x) => num(x.w_aufwand_von) != null || num(x.w_aufwand_bis) != null);
    const waiting: Record<string, number | null> = {};
    for (const w of waits.get(id) ?? []) waiting[String(w.kultur)] = num(w.gesetzt_wartezeit);
    out.push({
      awg_id: id,
      kennr,
      professional: a.huk !== 'J',
      area: str(a.anwendungsbereich),
      crop_codes: k.filter((x) => x.ausgenommen !== 'J').map((x) => String(x.kultur)),
      excluded_crop_codes: k.filter((x) => x.ausgenommen === 'J').map((x) => String(x.kultur)),
      target_codes: (targets.get(id) ?? []).filter((x) => x.ausgenommen !== 'J').map((x) => String(x.schadorg)),
      bbch_from: bbch(a.stadium_kultur_von),
      bbch_to: bbch(a.stadium_kultur_bis),
      max_applications: num(a.anwendungen_max_je_vegetation),
      min_interval_days: days(a.aw_abstand_von, a.aw_abstand_einheit),
      max_interval_days: days(a.aw_abstand_bis, a.aw_abstand_einheit),
      dose_max: sameUnit.length ? Math.max(...sameUnit.map((x) => num(x.m_aufwand)!)) : null,
      dose_unit: str(d[0]?.m_aufwand_einheit) ?? unit,
      water_min_l_ha: water.length ? Math.min(...water.map((x) => num(x.w_aufwand_von) ?? num(x.w_aufwand_bis)!)) : null,
      water_max_l_ha: water.length ? Math.max(...water.map((x) => num(x.w_aufwand_bis) ?? num(x.w_aufwand_von)!)) : null,
      waiting_days: waiting,
    });
  }
  return out;
}
