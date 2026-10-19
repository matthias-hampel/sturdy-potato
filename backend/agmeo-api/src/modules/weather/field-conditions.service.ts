/**
 * Field conditions from the stored weather and the ported models (src/models): the four condition
 * bars, hourly spray levels, GDD/BBCH since sowing, the FAO-56 water balance with the irrigation
 * recommendation, and trafficability for a machine — what the reference's cultivation timeseries,
 * irrigation and trafficability actions combine per field.
 */
import { Injectable } from '@nestjs/common';
import type { FieldConditions, FieldTrafficability, SoilTexture } from '@agmeo/contracts';
import { sql } from 'kysely';
import type { Ctx } from '../../auth/context.js';
import { badRequest, notFound } from '../../core/errors.js';
import { Database, type Trx } from '../../db/database.js';
import { computeFieldConditionBars, computeFieldWaterBalance, computePhenology } from '../../models/index.js';
import { evaluateFieldsForMachine } from '../../models/trafficability/index.js';
import { projectFieldTrafficability } from '../../models/trafficability/rows.js';
import type { SlimWeatherTimeseries, WeatherDay, WeatherHourlyTimeseries } from '../../models/types.js';
import { computeHourlySpray } from '../../models/weather/conditions.js';
import { hourlyInstantsMs } from '../../models/weather/hourlyWindow.js';

/**
 * Representative topsoil fractions (%) of the LUFA soil classes, for fields without a measured
 * texture: mid-points of the matching KA5 Bodenarten.
 */
const TEXTURE_OF_CLASS: Record<SoilTexture, { clay: number; silt: number; sand: number }> = {
  S: { clay: 3, silt: 7, sand: 90 },
  lS: { clay: 8, silt: 22, sand: 70 },
  sU: { clay: 5, silt: 60, sand: 35 },
  ssL: { clay: 12, silt: 25, sand: 63 },
  lU: { clay: 12, silt: 70, sand: 18 },
  sL: { clay: 20, silt: 35, sand: 45 },
  uL: { clay: 20, silt: 60, sand: 20 },
  L: { clay: 25, silt: 40, sand: 35 },
  utL: { clay: 33, silt: 55, sand: 12 },
  tL: { clay: 40, silt: 35, sand: 25 },
  T: { clay: 55, silt: 30, sand: 15 },
};

interface Context {
  fieldId: string;
  lat: number;
  lng: number;
  latitude: number;
  timezone: string | null;
  utcOffsetSeconds: number | null;
  soilTexture: SoilTexture | null;
  humusPct: number | null;
  cycle: { id: string; cropCode: string | null; cropName: string; harvestYear: number; sowingDate: string | null; sowingSource: 'booked' | 'planned' | null } | null;
}

const addDays = (d: string, n: number) => new Date(Date.parse(`${d}T12:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);

@Injectable()
export class FieldConditionsService {
  constructor(private readonly db: Database) {}

  conditions(ctx: Ctx, fieldId: string): Promise<FieldConditions> {
    return this.db.run(ctx, async (trx) => {
      const c = await this.context(trx, fieldId);
      const today = new Date().toISOString().slice(0, 10);
      const harvestYear = c.cycle?.harvestYear ?? Number(today.slice(0, 4));
      const { daily, hourly, refreshedAt } = await this.weather(trx, c, addDays(`${harvestYear - 1}-12-01`, -365));
      const texture = c.soilTexture ? { ...TEXTURE_OF_CLASS[c.soilTexture], soc: c.humusPct != null ? c.humusPct / 1.72 : null, bd: null } : null;

      const waterInput = Object.fromEntries(
        Object.entries(daily).map(([d, w]) => [
          d,
          { tempMin: w.tempMin, tempMax: w.tempMax, tempMean: w.tempMean, precipitation: w.precipitation, et0: w.et0, windSpeedMean: w.windSpeedMean, humidityMean: w.humidityMean, dewPointMean: w.dewPointMean },
        ]),
      );
      const water = Object.keys(daily).length
        ? computeFieldWaterBalance({
            cropCode: c.cycle?.cropCode ?? null,
            latitude: c.latitude,
            year: harvestYear,
            sowingDate: c.cycle?.sowingDate ?? null,
            weather: waterInput,
            fieldTexture: texture,
            withTopsoilBalance: true,
            today,
          })
        : null;
      const bars = computeFieldConditionBars({
        cropCode: c.cycle?.cropCode ?? null,
        weather: daily,
        weatherHourly: hourly ?? undefined,
        soilTexture: c.soilTexture,
        sowingDate: c.cycle?.sowingDate ?? null,
        waterBalance: water?.rootZone.days ?? null,
        awcMm: water?.rootZone.awcMm ?? null,
      });
      const phen = c.cycle
        ? computePhenology({ cropCode: c.cycle.cropCode, weather: daily, sowingDate: c.cycle.sowingDate, harvestYear, latitude: c.latitude, today })
        : null;

      // Hourly spray levels for the next 48 hours.
      const sprayHours: FieldConditions['sprayHours'] = [];
      if (hourly) {
        const instants = hourlyInstantsMs(hourly);
        const from = Date.now() - 3_600_000;
        for (let i = 0; i < hourly.time.length && sprayHours.length < 48; i++) {
          if (instants[i] < from) continue;
          const s = computeHourlySpray(hourly, i);
          sprayHours.push({ time: new Date(instants[i]).toISOString(), level: s.level, reasons: s.reasons.map((r) => ({ key: r.key, value: r.value ?? null })) });
        }
      }

      const rz = water?.rootZone;
      return {
        fieldId,
        refreshedAt,
        cropCycle: c.cycle ? { id: c.cycle.id, cropName: c.cycle.cropName, sowingDate: c.cycle.sowingDate, sowingSource: c.cycle.sowingSource } : null,
        soil: { texture: c.soilTexture, textureSource: c.soilTexture ? 'soil_class' : null },
        bars: {
          spraying: bars.spraying.map((d) => ({ date: d.date, value: d.value, reasons: d.reasons ?? [] })),
          sowing: bars.sowing.map((d) => ({ date: d.date, value: d.value, reasons: d.reasons ?? [] })),
          weatherRisk: bars.weatherRisk.map((d) => ({ date: d.date, value: d.value, reasons: d.reasons ?? [] })),
          trafficability: bars.trafficability?.map((d) => ({ date: d.date, value: d.value, reasons: d.reasons ?? [] })) ?? null,
        },
        sprayHours,
        phenology: phen
          ? { sowingDate: phen.sowingDate, gdd: phen.gdd, currentBbch: phen.currentBbch, bbchSource: phen.bbchSource, bbchByDate: phen.dailyBbch ? Object.fromEntries(phen.dailyBbch) : null }
          : null,
        waterBalance: rz
          ? {
              soilTypeKa5: rz.soilTypeKa5,
              awcMm: rz.awcMm,
              rootDepthM: rz.rootDepthM,
              currentDeficitMm: rz.currentDeficit,
              deficitLevel: rz.deficitLevel,
              totalPrecipitationMm: rz.totalPrecipitation,
              totalEtaMm: rz.totalEta,
              recommendation: rz.recommendation as unknown as Record<string, unknown>,
              days: (rz.days ?? []).map((d) => ({ date: d.date, swcMm: d.swc, deficitMm: d.deficit, etaMm: d.eta, precipitationMm: d.precipitation, forecast: !!d.forecast })),
            }
          : null,
      };
    });
  }

  /** Soil compaction index of a machine on the field, today and for the next seven days. */
  trafficability(ctx: Ctx, fieldId: string, opts: { equipmentId: string; frontKpa?: number; rearKpa?: number }): Promise<FieldTrafficability> {
    return this.db.run(ctx, async (trx) => {
      const c = await this.context(trx, fieldId);
      const machine = await trx.selectFrom('equipment').selectAll().where('id', '=', opts.equipmentId).executeTakeFirst();
      if (!machine) throw notFound('Machine');
      if (machine.class !== 'machine') throw badRequest('not_a_machine', 'Choose a machine, not an implement');
      if (!c.soilTexture) throw badRequest('no_soil_texture', 'Set the field’s soil class to compute trafficability');
      const today = new Date().toISOString().slice(0, 10);
      const harvestYear = c.cycle?.harvestYear ?? Number(today.slice(0, 4));
      const { daily } = await this.weather(trx, c, addDays(`${harvestYear - 1}-12-01`, -365));
      const water = computeFieldWaterBalance({
        cropCode: c.cycle?.cropCode ?? null,
        latitude: c.latitude,
        year: harvestYear,
        sowingDate: c.cycle?.sowingDate ?? null,
        weather: daily,
        fieldTexture: { ...TEXTURE_OF_CLASS[c.soilTexture], soc: c.humusPct != null ? c.humusPct / 1.72 : null, bd: null },
        withTopsoilBalance: true,
        today,
      });
      const delta = projectFieldTrafficability(water.topsoil?.days, water.topsoil?.soilTypeKa5 ?? null, today);
      if (!delta) throw badRequest('no_water_balance', 'Not enough stored weather for the soil water balance yet');
      const tyre = (t: unknown) => (t ? { widthM: (t as { widthM?: number }).widthM ?? null, recommendedPressureKpa: (t as { recommendedPressureKpa?: number }).recommendedPressureKpa ?? null } : null);
      const m = { operatingMassKg: machine.operating_mass_kg, frontAxleFraction: machine.front_axle_fraction, frontTyre: tyre(machine.front_tyre), rearTyre: tyre(machine.rear_tyre) };
      const frontKpa = opts.frontKpa ?? m.frontTyre?.recommendedPressureKpa ?? 160;
      const rearKpa = opts.rearKpa ?? m.rearTyre?.recommendedPressureKpa ?? 160;
      const days = [{ date: today, offset: 0 }, ...delta.forecast.map((f, i) => ({ date: f.date, offset: i + 1 }))];
      return {
        fieldId,
        equipmentId: machine.id,
        ka5: delta.ka5,
        frontKpa,
        rearKpa,
        sciReady: machine.front_tyre != null && machine.rear_tyre != null && machine.operating_mass_kg != null && machine.front_axle_fraction != null,
        days: days.map(({ date, offset }) => {
          const [r] = evaluateFieldsForMachine({ fields: [delta], machine: m, frontInflationKpa: frontKpa, rearInflationKpa: rearKpa, dayOffset: offset });
          const res = r.result as unknown as { pf: number | null; precompressionKpa: number | null; stressAtDepthKpa: number | null; sci: number | null; band: string | null };
          return { date, pf: res.pf, precompressionKpa: res.precompressionKpa, stressAtDepthKpa: res.stressAtDepthKpa, sci: res.sci, band: res.band };
        }),
      };
    });
  }

  private async context(trx: Trx, fieldId: string): Promise<Context> {
    const { rows } = await sql<{ lat: string; lng: string; latitude: number; soil_texture: string | null; timezone: string | null; utc_offset_seconds: number | null }>`
      SELECT c.lat, c.lng, ST_Y(ST_PointOnSurface(g.geometry)) AS latitude, f.soil_texture, wc.timezone, wc.utc_offset_seconds
      FROM fields f JOIN field_current_geometry g ON g.field_id = f.id
      CROSS JOIN LATERAL app.weather_cell(ST_PointOnSurface(g.geometry)) c
      LEFT JOIN weather_cells wc ON wc.lat = c.lat AND wc.lng = c.lng
      WHERE f.id = ${fieldId}`.execute(trx);
    const f = rows[0];
    if (!f) throw notFound('Field');
    // The field's current main crop: the season running today, else the next one.
    const { rows: cycles } = await sql<{ id: string; code: string | null; name: string; harvest_year: number; sowing_date: string | null; booked: string | null }>`
      SELECT cc.id, c.code, coalesce(c.name_de, c.name) AS name, s.harvest_year, cc.sowing_date,
             (SELECT min((o.performed_at AT TIME ZONE 'Europe/Berlin')::date)::text FROM operations o JOIN operation_fields ofl ON ofl.operation_id = o.id
               WHERE ofl.crop_cycle_id = cc.id AND o.type = 'sowing' AND o.status = 'completed') AS booked
      FROM crop_cycles cc JOIN growing_seasons s ON s.id = cc.season_id JOIN crops c ON c.id = cc.crop_id
      WHERE cc.field_id = ${fieldId} AND cc.role = 'main' AND s.end_date >= current_date
      ORDER BY s.start_date LIMIT 1`.execute(trx);
    const humus = await trx
      .selectFrom('soil_samples')
      .select('humus_pct')
      .where('field_id', '=', fieldId)
      .where('humus_pct', 'is not', null)
      .orderBy('sampled_on', 'desc')
      .limit(1)
      .executeTakeFirst();
    const cy = cycles[0];
    return {
      fieldId,
      lat: Number(f.lat),
      lng: Number(f.lng),
      latitude: f.latitude,
      timezone: f.timezone,
      utcOffsetSeconds: f.utc_offset_seconds,
      soilTexture: f.soil_texture as SoilTexture | null,
      humusPct: humus?.humus_pct ?? null,
      cycle: cy
        ? { id: cy.id, cropCode: cy.code, cropName: cy.name, harvestYear: cy.harvest_year, sowingDate: cy.booked ?? cy.sowing_date, sowingSource: cy.booked ? 'booked' : cy.sowing_date ? 'planned' : null }
        : null,
    };
  }

  /** Daily series (model shape, keyed by date) from `from` on and the stored hourly window. */
  private async weather(trx: Trx, c: Context, from: string): Promise<{ daily: SlimWeatherTimeseries & Record<string, WeatherDay>; hourly: WeatherHourlyTimeseries | null; refreshedAt: string | null }> {
    const [days, hours, cell] = await Promise.all([
      trx.selectFrom('weather_daily').selectAll().where('lat', '=', c.lat).where('lng', '=', c.lng).where('date', '>=', from).orderBy('date').execute(),
      trx.selectFrom('weather_hourly').selectAll().where('lat', '=', c.lat).where('lng', '=', c.lng).orderBy('time').execute(),
      trx.selectFrom('weather_cells').select('refreshed_at').where('lat', '=', c.lat).where('lng', '=', c.lng).executeTakeFirst(),
    ]);
    const n = (v: number | null) => v ?? 0;
    const daily: Record<string, WeatherDay> = {};
    for (const d of days) {
      if (d.temp_min == null || d.temp_max == null) continue;
      daily[d.date] = {
        tempMin: d.temp_min,
        tempMax: d.temp_max,
        tempMean: d.temp_mean ?? (d.temp_min + d.temp_max) / 2,
        precipitation: n(d.precipitation),
        humidityMin: n(d.humidity_min),
        humidityMax: n(d.humidity_max),
        humidityMean: n(d.humidity_mean),
        dewPointMin: n(d.dew_point_min),
        dewPointMax: n(d.dew_point_max),
        dewPointMean: n(d.dew_point_mean),
        windSpeedMax: n(d.wind_speed_max),
        windSpeedMean: n(d.wind_speed_mean),
        windGustsMax: n(d.wind_gusts_max),
        windGustsMean: n(d.wind_gusts_mean),
        et0: n(d.et0),
        soilTemp0to7cm: n(d.soil_temp_0_7),
        soilTemp7to28cm: n(d.soil_temp_7_28),
        soilMoisture0to7cm: n(d.soil_moisture_0_7),
        soilMoisture7to28cm: n(d.soil_moisture_7_28),
      };
    }
    let hourly: WeatherHourlyTimeseries | null = null;
    if (hours.length && c.utcOffsetSeconds != null) {
      // Wall-clock times with one offset per series, as Open-Meteo returns them.
      const offset = c.utcOffsetSeconds;
      hourly = {
        time: hours.map((h) => new Date(new Date(h.time).getTime() + offset * 1000).toISOString().slice(0, 16)),
        timezone: c.timezone ?? undefined,
        utcOffsetSeconds: offset,
        temp: hours.map((h) => n(h.temp)),
        humidity: hours.map((h) => n(h.humidity)),
        precipitation: hours.map((h) => n(h.precipitation)),
        windSpeed: hours.map((h) => n(h.wind_speed)),
        windGusts: hours.map((h) => n(h.wind_gusts)),
      };
    }
    return { daily, hourly, refreshedAt: cell?.refreshed_at ? new Date(cell.refreshed_at).toISOString() : null };
  }
}
