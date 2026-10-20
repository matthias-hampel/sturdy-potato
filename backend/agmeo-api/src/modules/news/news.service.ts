/**
 * News feed after AGVOLUTION/agmeo src/lib/news (orchestrator, generators/weather, tasks, events,
 * fertilizerReports, cropStage, eventsData, fertilizerReportDates). The reference stores generated
 * texts per language; here the items are computed per request as text templates with parameters,
 * which the client renders in the viewer's language and unit system. Staff announcements are out
 * of scope.
 */
import { Injectable } from '@nestjs/common';
import type { FederalExportFormat, NewsItem } from '@agmeo/contracts';
import { sql } from 'kysely';
import type { Ctx } from '../../auth/context.js';
import { Database, type Trx } from '../../db/database.js';
import { modelCrop } from '../../models/crops.js';
import { getDefaultHarvestDate, getDefaultSowingDate } from '../../models/phenology/cropCalendar.js';
import { RegulatoryService } from '../regulatory/regulatory.service.js';
import { berlinDate, getReportDeadline } from '../regulatory/region.js';

const DAY = 86_400_000;
const isoDay = (d: Date) => d.toISOString().slice(0, 10);
const addDays = (date: string, n: number) => isoDay(new Date(Date.parse(`${date}T00:00:00Z`) + n * DAY));

// ---------------------------------------------------------------------------
// Weather (reference generators/weather.ts)
// ---------------------------------------------------------------------------

const WET_14D_MM = 40;
const DRY_14D_MM = 5;
const HOT_14D_C = 22;
const COLD_14D_C = 3;

/** ISO week number (Monday start). */
export function isoWeek(d: Date): number {
  const t = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const day = t.getUTCDay() || 7;
  t.setUTCDate(t.getUTCDate() + 4 - day);
  const yearStart = Date.UTC(t.getUTCFullYear(), 0, 1);
  return Math.ceil(((t.getTime() - yearStart) / DAY + 1) / 7);
}

export interface WeatherStats {
  tempMean14: number;
  precip14: number;
  forecast: { tempMax: number; tempMin: number; precip: number }[];
}

/** Headline choice of the reference: wet, dry, warm, cold, else the forecast, else the recap. */
export function weatherHeadline(s: WeatherStats): NewsItem['headline'] {
  if (s.precip14 >= WET_14D_MM) return { key: 'weather.heavyRain', params: { rain: s.precip14 } };
  if (s.precip14 <= DRY_14D_MM) return { key: 'weather.drySpell', params: { rain: s.precip14 } };
  if (s.tempMean14 >= HOT_14D_C) return { key: 'weather.warmSpell', params: { temp: s.tempMean14 } };
  if (s.tempMean14 <= COLD_14D_C) return { key: 'weather.coldSpell', params: { temp: s.tempMean14 } };
  if (s.forecast.length) {
    return {
      key: 'weather.forecast',
      params: { min: Math.min(...s.forecast.map((d) => d.tempMin)), max: Math.max(...s.forecast.map((d) => d.tempMax)), rain: s.forecast.reduce((a, d) => a + d.precip, 0) },
    };
  }
  return { key: 'weather.recap', params: { temp: s.tempMean14, rain: s.precip14 } };
}

// ---------------------------------------------------------------------------
// Crop stages (reference cropStage.ts)
// ---------------------------------------------------------------------------

export type CropStage = 'sowing' | 'growing' | 'harvest';
export interface CropSeason {
  cropCode: string | null;
  cropName: string;
  harvestYear: number;
  areaHa: number;
  recordedSowing: string | null;
  recordedHarvest: string | null;
}

const SOWING_DAYS_AHEAD = 21;
const SOWING_DAYS_BEHIND = 14;
const HARVEST_DAYS_AHEAD = 21;
const HARVEST_DAYS_BEHIND = 7;
const MAX_NOTES = 3;

const shiftMonths = (iso: string, months: number) => {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCMonth(d.getUTCMonth() + months);
  return isoDay(d);
};
const daysBetween = (from: string, to: string) => Math.round((Date.parse(to) - Date.parse(from)) / DAY);

function stageOn(today: string, sowing: string, harvest: string): CropStage | null {
  if (harvest <= sowing) return null;
  const sinceSowing = daysBetween(sowing, today);
  const untilHarvest = daysBetween(today, harvest);
  if (sinceSowing < -SOWING_DAYS_AHEAD) return null;
  if (sinceSowing <= SOWING_DAYS_BEHIND) return 'sowing';
  if (untilHarvest > HARVEST_DAYS_AHEAD) return 'growing';
  if (untilHarvest >= -HARVEST_DAYS_BEHIND) return 'harvest';
  return null;
}

/** At most three notes, largest area first, for crops being sown, standing or about to be harvested. */
export function deriveCropStageNotes(seasons: CropSeason[], today: string, southernHemisphere: boolean) {
  const notes: { cropName: string; areaHa: number; stage: CropStage }[] = [];
  for (const s of seasons) {
    const crop = modelCrop(s.cropCode);
    let sowing = crop ? getDefaultSowingDate(crop, s.harvestYear) : null;
    let harvest = crop ? getDefaultHarvestDate(crop, s.harvestYear) : null;
    if (southernHemisphere && sowing && harvest) {
      const shift = Number(harvest.slice(5, 7)) <= 6 ? 6 : -6;
      sowing = shiftMonths(sowing, shift);
      harvest = shiftMonths(harvest, shift);
    }
    sowing = s.recordedSowing || sowing;
    harvest = s.recordedHarvest || harvest;
    if (!sowing || !harvest) continue;
    const stage = stageOn(today, sowing, harvest);
    if (stage) notes.push({ cropName: s.cropName, areaHa: s.areaHa, stage });
  }
  return notes.sort((a, b) => b.areaHa - a.areaHa).slice(0, MAX_NOTES);
}

// ---------------------------------------------------------------------------
// Events (reference eventsData.ts)
// ---------------------------------------------------------------------------

export interface SeedEvent {
  slug: string;
  title: string;
  startDate: string;
  endDate?: string;
  location: string;
  url?: string;
}

const EVENTS: SeedEvent[] = [
  { slug: 'dlg-feldtage-2026', title: 'DLG-Feldtage 2026', startDate: '2026-06-16', endDate: '2026-06-18', location: 'Bernburg (Sachsen-Anhalt)', url: 'https://www.dlg-feldtage.de' },
  { slug: 'tag-des-offenen-hofes-2026', title: 'Tag des offenen Hofes', startDate: '2026-06-13', endDate: '2026-06-14', location: 'bundesweit' },
  { slug: 'norla-2026', title: 'Norla Rendsburg', startDate: '2026-09-03', endDate: '2026-09-06', location: 'Rendsburg (SH)', url: 'https://www.norla-messe.de' },
  { slug: 'eurotier-2026', title: 'EuroTier 2026', startDate: '2026-11-10', endDate: '2026-11-13', location: 'Hannover', url: 'https://www.eurotier.com' },
  { slug: 'dlg-unternehmertage-2026', title: 'DLG-Unternehmertage 2026', startDate: '2026-09-01', endDate: '2026-09-02', location: 'Würzburg' },
  { slug: 'biofach-2027', title: 'BIOFACH 2027', startDate: '2027-02-16', endDate: '2027-02-19', location: 'Nürnberg', url: 'https://www.biofach.de' },
  { slug: 'agritechnica-2027', title: 'Agritechnica 2027', startDate: '2027-11-14', endDate: '2027-11-20', location: 'Hannover', url: 'https://www.agritechnica.com' },
  { slug: 'gruene-woche-2027', title: 'Internationale Grüne Woche 2027', startDate: '2027-01-15', endDate: '2027-01-24', location: 'Berlin', url: 'https://www.gruenewoche.de' },
];
const EVENTS_DAYS_AHEAD = 60;

export function upcomingEvents(today: string, daysAhead = EVENTS_DAYS_AHEAD): SeedEvent[] {
  const horizon = addDays(today, daysAhead);
  return EVENTS.filter((e) => e.startDate >= today && e.startDate <= horizon).sort((a, b) => a.startDate.localeCompare(b.startDate));
}

// ---------------------------------------------------------------------------
// Fertilizer-report milestones (reference fertilizerReportDates.ts)
// ---------------------------------------------------------------------------

export type MilestoneKey = 'dbe' | 'meldung' | 'dokumentation' | 'besydSunset';
export interface ActiveMilestone {
  key: MilestoneKey;
  reportYear: number;
  start: Date;
  end: Date;
  deadline: Date | null;
  formatSpecific: boolean;
  basePriority: number;
  urgentPriority?: number;
  daysLeft: number;
}

const BESYD_SUNSET_YEAR = 2026;
const lastDayOfFebruary = (year: number) => new Date(Date.UTC(year, 2, 0)).getUTCDate();
const berlinYearMonth = (d: Date) => {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone: 'Europe/Berlin', year: 'numeric', month: 'numeric' }).formatToParts(d).map((x) => [x.type, x.value]));
  return { year: Number(p.year), month: Number(p.month) };
};

export function activeMilestones(runDate: Date, format: FederalExportFormat): ActiveMilestone[] {
  const { year } = berlinYearMonth(runDate);
  const candidates: Omit<ActiveMilestone, 'daysLeft'>[] = [
    { key: 'dbe', reportYear: year, start: berlinDate(year, 1, 15), end: berlinDate(year, 2, lastDayOfFebruary(year), true), deadline: null, formatSpecific: false, basePriority: 5 },
    { key: 'dokumentation', reportYear: year, start: berlinDate(year, 4, 1), end: berlinDate(year, 5, 31, true), deadline: null, formatSpecific: false, basePriority: 3 },
  ];
  const deadline = getReportDeadline(format, year - 1);
  if (deadline) {
    const { month } = berlinYearMonth(deadline);
    candidates.push({ key: 'meldung', reportYear: year - 1, start: berlinDate(year, month - 1, 1), end: deadline, deadline, formatSpecific: true, basePriority: 6, urgentPriority: 8 });
  }
  if (format === 'besyd' && year === BESYD_SUNSET_YEAR) {
    candidates.push({ key: 'besydSunset', reportYear: year, start: berlinDate(year, 10, 1), end: berlinDate(year, 12, 31, true), deadline: null, formatSpecific: true, basePriority: 5 });
  }
  return candidates
    .filter((m) => runDate >= m.start && runDate <= m.end)
    .map((m) => ({ ...m, daysLeft: Math.ceil((m.end.getTime() - runDate.getTime()) / DAY) }));
}

const FORMAT_NAME: Record<FederalExportFormat, string> = { enni: 'ENNI', endo: 'ENDO-SH', st: 'LLG Sachsen-Anhalt', besyd: 'webBESyD' };

// ---------------------------------------------------------------------------
// Feed
// ---------------------------------------------------------------------------

@Injectable()
export class NewsService {
  constructor(
    private readonly db: Database,
    private readonly regulatory: RegulatoryService,
  ) {}

  async feed(ctx: Ctx, now = new Date()): Promise<NewsItem[]> {
    const today = isoDay(now);
    const items = await this.db.run(ctx, async (trx) => [...(await this.weather(trx, now, today)), ...(await this.tasks(trx, today))]);
    items.push(...this.events(now, today));
    items.push(...(await this.advisory(ctx, now)));
    // Newest first, then by priority (reference feed.ts ordering), at most twenty.
    return items.sort((a, b) => b.validFrom.localeCompare(a.validFrom) || b.priority - a.priority).slice(0, 20);
  }

  private async weather(trx: Trx, now: Date, today: string): Promise<NewsItem[]> {
    // The cell of the largest active field (reference: the largest cultivation's weather).
    const { rows } = await sql<{ lat: string; lng: string; latitude: number }>`
      SELECT c.lat, c.lng, ST_Y(ST_PointOnSurface(g.geometry)) AS latitude
      FROM fields f JOIN field_current_geometry g ON g.field_id = f.id
      CROSS JOIN LATERAL app.weather_cell(ST_PointOnSurface(g.geometry)) c
      WHERE f.status = 'active' ORDER BY g.area_ha DESC LIMIT 1`.execute(trx);
    if (!rows[0]) return [];
    const lat = Number(rows[0].lat);
    const lng = Number(rows[0].lng);
    const days = await trx
      .selectFrom('weather_daily')
      .select(['date', 'temp_min', 'temp_max', 'temp_mean', 'precipitation'])
      .where('lat', '=', lat)
      .where('lng', '=', lng)
      .where('date', '>=', addDays(today, -14))
      .where('date', '<=', addDays(today, 6))
      .orderBy('date')
      .execute();
    const past = days.filter((d) => d.date < today && d.temp_mean != null);
    const forecast = days.filter((d) => d.date >= today && d.temp_min != null && d.temp_max != null).map((d) => ({ tempMax: d.temp_max!, tempMin: d.temp_min!, precip: d.precipitation ?? 0 }));
    if (!past.length && !forecast.length) return [];
    const stats: WeatherStats = {
      tempMean14: past.length ? past.reduce((s, d) => s + d.temp_mean!, 0) / past.length : 0,
      precip14: past.reduce((s, d) => s + (d.precipitation ?? 0), 0),
      forecast,
    };
    const seasons = await this.cropSeasons(trx, today);
    const notes = deriveCropStageNotes(seasons, today, rows[0].latitude < 0);
    const body: NewsItem['body'] = [{ key: 'weather.bodyLast14', params: { rain: stats.precip14, temp: stats.tempMean14 } }];
    if (forecast.length) {
      body.push({
        key: 'weather.bodyForecast7',
        params: { min: Math.min(...forecast.map((d) => d.tempMin)), max: Math.max(...forecast.map((d) => d.tempMax)), rain: forecast.reduce((a, d) => a + d.precip, 0) },
      });
    }
    for (const n of notes) body.push({ key: `weather.stage.${n.stage}`, params: { crop: n.cropName, area: n.areaHa } });
    const week = isoWeek(now);
    return [
      {
        id: `weather:${now.getUTCFullYear()}-W${String(week).padStart(2, '0')}`,
        category: 'weather',
        headline: weatherHeadline(stats),
        body,
        priority: 7,
        validFrom: `${today}T00:00:00.000Z`,
        validUntil: new Date(now.getTime() + 7 * DAY).toISOString(),
        cta: null,
      },
    ];
  }

  /** Crops of the seasons running today with recorded sowing and harvest (reference cropSeasons.ts). */
  private async cropSeasons(trx: Trx, today: string): Promise<CropSeason[]> {
    const { rows } = await sql<{ code: string | null; name: string; harvest_year: number; area_ha: number; sowing: string | null; harvest: string | null }>`
      SELECT c.code, coalesce(c.name_de, c.name) AS name, s.harvest_year,
             sum(coalesce(cc.area_ha, fp.area_ha, g.area_ha, 0)) AS area_ha,
             min((SELECT min(coalesce((o.performed_at AT TIME ZONE 'Europe/Berlin')::date, o.planned_on))::text FROM operations o JOIN operation_fields ofl ON ofl.operation_id = o.id
                   WHERE ofl.crop_cycle_id = cc.id AND o.type = 'sowing' AND o.status <> 'cancelled')) AS sowing,
             max((SELECT max(h.harvest_date)::text FROM harvests h WHERE h.crop_cycle_id = cc.id)) AS harvest
      FROM crop_cycles cc
      JOIN growing_seasons s ON s.id = cc.season_id AND s.start_date <= ${today}::date AND s.end_date >= ${today}::date
      JOIN crops c ON c.id = cc.crop_id
      LEFT JOIN field_parts fp ON fp.id = cc.field_part_id
      LEFT JOIN field_current_geometry g ON g.field_id = cc.field_id
      WHERE cc.role = 'main'
      GROUP BY c.code, c.name_de, c.name, s.harvest_year`.execute(trx);
    return rows.map((r) => ({ cropCode: r.code, cropName: r.name, harvestYear: r.harvest_year, areaHa: Number(r.area_ha), recordedSowing: r.sowing, recordedHarvest: r.harvest }));
  }

  /** Planned operations from a week ago to two weeks ahead (reference generators/tasks.ts). */
  private async tasks(trx: Trx, today: string): Promise<NewsItem[]> {
    const { rows } = await sql<{ id: string; type: string; day: string; field_name: string | null }>`
      SELECT o.id, o.type, coalesce(o.due_on, o.planned_on)::text AS day,
             (SELECT f.name FROM operation_fields ofl JOIN fields f ON f.id = ofl.field_id WHERE ofl.operation_id = o.id ORDER BY f.name LIMIT 1) AS field_name
      FROM operations o
      WHERE o.status IN ('planned', 'in_progress')
        AND coalesce(o.due_on, o.planned_on) BETWEEN ${addDays(today, -7)}::date AND ${addDays(today, 14)}::date
      ORDER BY coalesce(o.due_on, o.planned_on), o.created_at`.execute(trx);
    if (!rows.length) return [];
    const overdue = rows.filter((r) => r.day < today).length;
    const todayCount = rows.filter((r) => r.day === today).length;
    const nextWeek = rows.filter((r) => r.day > today && daysBetween(today, r.day) <= 7).length;
    return [
      {
        id: `tasks:${today}`,
        category: 'tasks',
        headline: overdue || todayCount || nextWeek
          ? { key: 'tasks.headline', params: { overdue, dueToday: todayCount, next7: nextWeek } }
          : { key: 'tasks.headlineNone', params: {} },
        body: [
          { key: 'tasks.body', params: { count: rows.length } },
          ...rows.slice(0, 3).map((r) => ({ key: 'tasks.line', params: { field: r.field_name ?? '', type: r.type } })),
        ],
        priority: overdue ? 9 : 6,
        validFrom: `${today}T00:00:00.000Z`,
        validUntil: `${addDays(today, 1)}T00:00:00.000Z`,
        cta: { to: 'tasks', labelKey: 'tasks.cta' },
      },
    ];
  }

  private events(now: Date, today: string): NewsItem[] {
    const upcoming = upcomingEvents(today);
    if (!upcoming.length) return [];
    const next = upcoming[0];
    const last = upcoming[upcoming.length - 1];
    const daysUntilNext = daysBetween(today, next.startDate);
    return [
      {
        id: `events:${now.getUTCFullYear()}-W${String(isoWeek(now)).padStart(2, '0')}`,
        category: 'events',
        headline: upcoming.length === 1 ? { key: 'events.single', params: { title: next.title, days: daysUntilNext } } : { key: 'events.multiple', params: { count: upcoming.length, days: EVENTS_DAYS_AHEAD } },
        body: upcoming.map((e) => ({ key: 'events.line', params: { start: e.startDate, end: e.endDate ?? e.startDate, title: e.title, location: e.location, url: e.url ?? '' } })),
        priority: daysUntilNext <= 14 ? 6 : 4,
        validFrom: `${today}T00:00:00.000Z`,
        validUntil: `${last.endDate ?? last.startDate}T23:59:59.000Z`,
        cta: null,
      },
    ];
  }

  /** Fertilizer-report reminders for the state of the farm with the most fields (reference generators/fertilizerReports.ts). */
  private async advisory(ctx: Ctx, now: Date): Promise<NewsItem[]> {
    const farm = await this.db.run(ctx, (trx) =>
      trx
        .selectFrom('farms as fa')
        .leftJoin('fields as f', (j) => j.onRef('f.farm_id', '=', 'fa.id').on('f.status', '=', 'active'))
        .select('fa.id')
        .groupBy('fa.id')
        .orderBy(sql`count(f.id)`, 'desc')
        .limit(1)
        .executeTakeFirst(),
    );
    if (!farm) return [];
    const region = await this.regulatory.region(ctx, farm.id);
    const formats = region.formats.map((f) => f.format as FederalExportFormat);
    return formats.flatMap((format, index) =>
      activeMilestones(now, format)
        // Org-wide milestones (DBE, documentation) go out once, under the state's first format.
        .filter((m) => index === 0 || m.formatSpecific)
        .map((m): NewsItem => {
          const params = { format: FORMAT_NAME[format], year: m.reportYear, date: m.deadline ? m.deadline.toISOString() : '' };
          const urgent = m.urgentPriority !== undefined && m.daysLeft <= 14;
          return {
            id: `fertilizerReports:${format}:${m.key}:${m.reportYear}`,
            category: 'advisory',
            headline: { key: `advisory.${m.key}.headline`, params },
            body: [{ key: `advisory.${m.key}.body`, params }],
            priority: urgent ? m.urgentPriority! : m.basePriority,
            validFrom: m.start.toISOString(),
            validUntil: m.end.toISOString(),
            cta: { to: 'fertilizer-reports', params: { format, year: m.reportYear }, labelKey: 'advisory.cta' },
          };
        }),
    );
  }
}
