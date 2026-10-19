/**
 * Market quotes after AGVOLUTION/agmeo src/lib/market-prices (euAgrifoodClient.ts, commodities.ts):
 * weekly cereal and oilseed prices of the EU Agri-food Data Portal, EUR per tonne, per member
 * state. National averages are preferred; otherwise the median of the markets of a week. The
 * Claude web-search fallback of the reference (sugar beet, potatoes) is not ported.
 */
import { Logger } from '@nestjs/common';
import type { MarketCommodity } from '@agmeo/contracts';
import type { Kysely } from 'kysely';
import type { DB } from '../../db/schema.js';
import type { JobHandler } from '../../jobs/runner.js';

export const FETCH_MARKET_PRICES = 'market.prices';

const API_BASE = 'https://api.tech.ec.europa.eu/agrifood/api';
const logger = new Logger('MarketPrices');

/** Countries fetched each week (reference SUPPORTED_MARKET_COUNTRIES). */
export const SUPPORTED_MARKET_COUNTRIES = ['DE', 'FR', 'PL', 'CZ', 'NL', 'IT', 'RO'] as const;

/** EU Agri-food Data Portal product identifiers → commodity (reference EU_PRODUCT_TO_COMMODITY). */
export const EU_PRODUCT_TO_COMMODITY: Record<string, MarketCommodity> = {
  'Breadmaking common wheat': 'WHEAT_BREAD',
  'Feed wheat': 'WHEAT_FEED',
  'Durum wheat': 'WHEAT_DURUM',
  'Feed barley': 'BARLEY_FEED',
  'Malting barley': 'BARLEY_MALTING',
  'Rye of breadmaking quality': 'RYE_BREAD',
  'Feed rye': 'RYE_BREAD',
  'Feed maize': 'MAIZE_GRAIN',
  'Feed oats': 'OATS_FEED',
  Triticale: 'TRITICALE',
  'BLTPAN|PAN': 'WHEAT_BREAD',
  'BLTFOUR|FEED': 'WHEAT_FEED',
  'DUR|PAN': 'WHEAT_DURUM',
  'ORGFOUR|FEED': 'BARLEY_FEED',
  'ORGBRAS|MALT': 'BARLEY_MALTING',
  'SEGPAN|PAN': 'RYE_BREAD',
  'SEGFOUR|FEED': 'RYE_BREAD',
  'MAI|FEED': 'MAIZE_GRAIN',
  'AVO|FEED': 'OATS_FEED',
  'TRI|FEED': 'TRITICALE',
  Rapeseed: 'RAPESEED',
  'Sunflower seed': 'SUNFLOWER',
  'Soya beans': 'SOYBEAN',
  'Feed peas': 'PEAS_FEED',
};

/** Commodities a crop of the rewrite sells as, the usual quality first (reference ARTICLE_TO_COMMODITY). */
export const CROP_COMMODITIES: Record<string, MarketCommodity[]> = {
  winter_wheat: ['WHEAT_BREAD', 'WHEAT_FEED'],
  spring_wheat: ['WHEAT_FEED', 'WHEAT_BREAD'],
  winter_barley: ['BARLEY_FEED', 'BARLEY_MALTING'],
  spring_barley: ['BARLEY_MALTING', 'BARLEY_FEED'],
  winter_rye: ['RYE_BREAD'],
  grain_maize: ['MAIZE_GRAIN'],
  oats: ['OATS_FEED'],
  winter_oats: ['OATS_FEED'],
  triticale: ['TRITICALE'],
  winter_rapeseed: ['RAPESEED'],
  spring_rapeseed: ['RAPESEED'],
  sunflower: ['SUNFLOWER'],
  soybeans: ['SOYBEAN'],
  peas: ['PEAS_FEED'],
};

export interface MarketQuoteRow {
  commodity: MarketCommodity;
  country: string;
  price: number;
  quoteDate: string;
}

/**
 * "€161,50" or "€482.50": the last separator is the decimal point unless exactly three digits
 * follow it (then it is a thousands mark).
 */
export function parseEuPrice(raw: string | undefined): number | null {
  if (!raw) return null;
  const cleaned = raw.replace(/[€\s ]/g, '');
  if (!/^[\d.,]+$/.test(cleaned)) return null;
  const sep = Math.max(cleaned.lastIndexOf(','), cleaned.lastIndexOf('.'));
  const digits = (s: string) => s.replace(/[.,]/g, '');
  const value = sep === -1 || cleaned.length - sep - 1 === 3 ? Number(digits(cleaned)) : Number(`${digits(cleaned.slice(0, sep))}.${cleaned.slice(sep + 1)}`);
  return Number.isFinite(value) && value > 0 ? value : null;
}

/** "05/07/2026" → "2026-07-05"; passes YYYY-MM-DD through. */
export function parseEuDate(raw: string | undefined): string | null {
  if (!raw) return null;
  const dmy = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(raw);
  if (dmy) return `${dmy[3]}-${dmy[2]}-${dmy[1]}`;
  return /^\d{4}-\d{2}-\d{2}$/.test(raw) ? raw : null;
}

/** EU marketing year runs July–June: 2026-08-10 → "2026/2027". */
export function marketingYear(d: Date): string {
  const y = d.getUTCFullYear();
  return d.getUTCMonth() >= 6 ? `${y}/${y + 1}` : `${y - 1}/${y}`;
}

const previousMarketingYear = (d: Date) => {
  const [from] = marketingYear(d).split('/');
  return `${Number(from) - 1}/${from}`;
};

const median = (values: number[]) => {
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
};

type RawQuote = MarketQuoteRow & { national: boolean };

/** One quote per commodity, country and week: the national average, else the median of the markets. */
export function normalizeQuotes(raw: RawQuote[]): MarketQuoteRow[] {
  const groups = new Map<string, RawQuote[]>();
  for (const q of raw) {
    const key = `${q.commodity}|${q.country}|${q.quoteDate}`;
    groups.set(key, [...(groups.get(key) ?? []), q]);
  }
  return [...groups.values()].map((rows) => {
    const national = rows.filter((r) => r.national);
    const pick = national.length ? national : rows;
    return { commodity: pick[0].commodity, country: pick[0].country, quoteDate: pick[0].quoteDate, price: Math.round(median(pick.map((r) => r.price)) * 100) / 100 };
  });
}

type FeedRow = { memberStateCode?: string; endDate?: string; price?: string; productName?: string; marketName?: string; product?: string; market?: string };

export function parseFeedRows(rows: FeedRow[], kind: 'cereal' | 'oilseed'): MarketQuoteRow[] {
  const raw: RawQuote[] = [];
  for (const row of rows) {
    const commodity = EU_PRODUCT_TO_COMMODITY[(kind === 'cereal' ? row.productName : row.product)?.trim() ?? ''];
    const price = parseEuPrice(row.price);
    const quoteDate = parseEuDate(row.endDate);
    if (!commodity || !row.memberStateCode || price === null || quoteDate === null) continue;
    const national = kind === 'cereal' ? row.marketName === 'National Average' : row.market === 'National Average' || !row.market;
    raw.push({ commodity, country: row.memberStateCode, price, quoteDate, national });
  }
  return normalizeQuotes(raw);
}

async function fetchRows(path: string, years: string[]): Promise<FeedRow[]> {
  const url = `${API_BASE}/${path}?memberStateCodes=${SUPPORTED_MARKET_COUNTRIES.join(',')}&marketingYears=${years.map(encodeURIComponent).join(',')}`;
  const res = await fetch(url, { headers: { accept: 'application/json' }, signal: AbortSignal.timeout(60_000) });
  if (!res.ok) throw new Error(`EU agrifood API ${path} failed: ${res.status}`);
  const body = (await res.json()) as unknown;
  // Outages come as HTTP 200 with a status object; the next weekly run recovers.
  if (!Array.isArray(body)) {
    logger.warn(`EU agrifood API ${path} returned no list (treated as no quotes): ${JSON.stringify(body).slice(0, 300)}`);
    return [];
  }
  return body as FeedRow[];
}

/** Weekly: the current and previous marketing year of both feeds, upserted. */
export const fetchMarketPricesHandler =
  (db: Kysely<DB>): JobHandler =>
  async () => {
    const now = new Date();
    const years = [marketingYear(now), previousMarketingYear(now)];
    const [cereals, oilseeds] = await Promise.all([fetchRows('cereal/prices', years), fetchRows('oilseeds/prices', years)]);
    const quotes = [...parseFeedRows(cereals, 'cereal'), ...parseFeedRows(oilseeds, 'oilseed')];
    for (let i = 0; i < quotes.length; i += 500) {
      const chunk = quotes.slice(i, i + 500).map((q) => ({ commodity: q.commodity, country: q.country, quote_date: q.quoteDate, price: q.price, source: 'eu_agrifood', fetched_at: now }));
      await db
        .insertInto('market_quotes')
        .values(chunk)
        .onConflict((oc) => oc.columns(['commodity', 'country', 'quote_date']).doUpdateSet((eb) => ({ price: eb.ref('excluded.price'), fetched_at: eb.ref('excluded.fetched_at') })))
        .execute();
    }
    logger.log(`Stored ${quotes.length} market quotes`);
  };
