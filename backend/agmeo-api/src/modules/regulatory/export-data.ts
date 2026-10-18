/**
 * Builds the export library's `ExportData` (one farm, one fertilizer year) from agmeo's records.
 * Contents are converted to the library's conventions: mineral contents in %, organic ones in kg
 * per m³, and `density` as m³ per tonne (the inverse density).
 */
import type { FarmRegulatory, FertilizerType, N170Data } from '@agmeo/contracts';
import { isOrganicFertilizer } from '@agmeo/contracts';
import { sql } from 'kysely';
import type { Trx } from '../../db/database.js';
import {
  CarrierResolutionError,
  cropKeyForCode,
  type EndoOrgMetadata,
  type EnniOrgMetadata,
  type ExportCultivation,
  type ExportData,
  type ExportFertilization,
  type ExportField,
  getDuengejahrWindow,
  type N170Betriebsdaten,
  type NaehrstofftraegerartType,
  resolveCarrier,
} from './harmonie/index.js';

/** Solid organic fertilizers are documented per tonne (Mistdüngung). */
const SOLID: FertilizerType[] = ['cattle_solid_manure', 'pig_solid_manure', 'horse_sheep_manure', 'poultry_manure', 'laying_hen_dry_manure', 'digestate_solid', 'compost'];
/** Organic fertilizers that are not Wirtschaftsdünger. */
const OTHER: FertilizerType[] = ['compost', 'sewage_sludge', 'other_organic'];
/** Article identifiers in the form the library's fertilizer grouping reads (`ORGANIC__SLURRY_CATTLE`). */
const ARTICLE_KEY: Partial<Record<FertilizerType, string>> = {
  cattle_slurry: 'ORGANIC__SLURRY_CATTLE',
  pig_slurry: 'ORGANIC__SLURRY_PIG',
  cattle_liquid_manure: 'ORGANIC__URINE_CATTLE',
  pig_liquid_manure: 'ORGANIC__URINE_PIG',
  cattle_solid_manure: 'ORGANIC__MANURE_CATTLE',
  pig_solid_manure: 'ORGANIC__MANURE_PIG',
  horse_sheep_manure: 'ORGANIC__MANURE_HORSE',
  poultry_manure: 'ORGANIC__MANURE_CHICKEN',
  laying_hen_dry_manure: 'ORGANIC__MANURE_LAYING_HEN',
  digestate_liquid: 'ORGANIC__DIGESTATE_LIQUID',
  digestate_solid: 'ORGANIC__DIGESTATE_SOLID',
  compost: 'ORGANIC__COMPOST',
  sewage_sludge: 'ORGANIC__SEWAGE_SLUDGE',
  other_organic: 'ORGANIC__OTHER',
};
const UNIT: Record<string, string> = { kg: 'kg_ha', t: 't_ha', l: 'l_ha', m3: 'cbm_ha' };

const berlin = (day: string) => new Date(`${day}T12:00:00+01:00`);

export function enniMetadata(farm: FarmRegulatory): EnniOrgMetadata {
  return {
    betriebsnummer: farm.holdingNumber ?? undefined,
    duengejahrbeginn: farm.fertilizerYearStart,
    bodenklimaraum: farm.enni.soilClimateArea ?? undefined,
    nKulisse: farm.enni.nitrateZoneFlag,
    betriebsdatenOverrides: betriebsdaten(farm),
    ansprechpartner: { adresse: address(farm) },
    betriebsstaette: { adresse: address(farm) },
  };
}

export function endoMetadata(farm: FarmRegulatory): EndoOrgMetadata {
  return {
    betriebsnummer: farm.holdingNumber ?? undefined,
    duengejahrbeginn: farm.fertilizerYearStart as EndoOrgMetadata['duengejahrbeginn'],
    naturraum: farm.endo.naturalRegion ?? undefined,
    betriebsdatenOverrides: betriebsdaten(farm),
    ansprechpartner: { adresse: address(farm) },
    betriebsstaette: { adresse: address(farm) },
  };
}

function betriebsdaten(farm: FarmRegulatory) {
  return {
    'andere-duenger-ausgebracht': farm.otherFertilizersApplied,
    'kompost-ausgebracht': farm.compostApplied,
    'duengungs-oder-beweidungseinschraenkungen': farm.restrictions,
    'oekologisch-zertifiziert': farm.organicCertified,
  };
}

function address(farm: FarmRegulatory) {
  const c = farm.contact;
  const clean = Object.fromEntries(Object.entries({ firma: c.firma ?? farm.farmName, vorname: c.vorname, nachname: c.nachname, strasse: c.strasse, plz: c.plz, ort: c.ort, telefonnummer: c.telefonnummer, email: c.email }).filter(([, v]) => v));
  return clean as Record<string, string>;
}

export function n170Betriebsdaten(data: N170Data | null): N170Betriebsdaten | undefined {
  if (!data) return undefined;
  const transfer = (t: N170Data['intake'][number] & { from?: string | null; to?: string | null }) => ({
    duengerBezeichnung: t.name,
    naehrstofftraegerart: 'WIRTSCHAFTSDUENGER' as NaehrstofftraegerartType,
    lieferdatum: t.date,
    beteiligterBetrieb: (t.from ?? t.to ?? '') || 'unbekannt',
    menge: t.quantity,
    gehaltNGesamt: t.nPerUnit,
    gehaltP2o5: t.p2o5PerUnit ?? 0,
  });
  return {
    tierhaltungen: data.livestock.map((l) => ({ tierBezeichnung: l.name, anzahlTiere: l.animals, weidetage: l.grazingDays ?? undefined })),
    organischeDuengerAufnahmen: data.intake.map(transfer),
    organischeDuengerAbgaben: data.delivery.map(transfer),
    hofeigeneBiogasanlage: data.onFarmBiogasPlant,
  };
}

export async function buildExportData(trx: Trx, orgId: string, farm: FarmRegulatory, year: number, n170Data: N170Data | null): Promise<ExportData> {
  const window = getDuengejahrWindow(year, farm.fertilizerYearStart);
  const from = window.start.toISOString().slice(0, 10);
  const to = new Date(window.end.getTime() - 12 * 3600_000).toISOString().slice(0, 10);

  const fieldRows = await trx
    .selectFrom('fields as f')
    .innerJoin('field_current_geometry as g', 'g.field_id', 'f.id')
    .select(['f.id', 'f.name', 'f.identifier', 'f.soil_texture', 'f.nitrate_sensitive_zone', sql<number>`coalesce(g.area_ha, 0)`.as('area_ha')])
    .where('f.farm_id', '=', farm.farmId)
    .where('f.status', '=', 'active')
    .orderBy('f.name')
    .execute();
  const fieldIds = fieldRows.map((f) => f.id);
  if (!fieldIds.length) return { orgId, year, duengejahr: window, federalState: farm.federalState ?? null, integrations: {}, fields: [] };

  const cycles = await trx
    .selectFrom('crop_cycles as cc')
    .innerJoin('crops as c', 'c.id', 'cc.crop_id')
    .innerJoin('growing_seasons as s', 's.id', 'cc.season_id')
    .leftJoin('field_parts as fp', 'fp.id', 'cc.field_part_id')
    .leftJoin('field_current_geometry as g', 'g.field_id', 'cc.field_id')
    .select([
      'cc.id',
      'cc.field_id',
      'cc.role',
      'cc.sowing_date',
      'cc.film_or_fleece',
      'cc.protein_pct',
      'c.code',
      's.harvest_year',
      's.start_date',
      's.end_date',
      sql<number>`coalesce(cc.area_ha, fp.area_ha, g.area_ha, 0)`.as('area_ha'),
    ])
    .where('cc.field_id', 'in', fieldIds)
    .where('s.harvest_year', 'in', [year - 1, year, year + 1])
    .execute();
  const cycleIds = cycles.map((c) => c.id);
  const harvests = cycleIds.length
    ? await trx
        .selectFrom('harvests')
        .select(['crop_cycle_id', sql<number>`sum(quantity_t)`.as('t'), sql<number>`sum(harvested_area_ha)`.as('ha'), sql<string>`max(harvest_date)::text`.as('day')])
        .where('crop_cycle_id', 'in', cycleIds)
        .groupBy('crop_cycle_id')
        .execute()
    : [];
  const sowings = cycleIds.length
    ? await trx
        .selectFrom('operations as o')
        .innerJoin('operation_fields as ofl', 'ofl.operation_id', 'o.id')
        .select(['ofl.crop_cycle_id', sql<string>`min((o.performed_at AT TIME ZONE 'Europe/Berlin')::date)::text`.as('day')])
        .where('o.type', '=', 'sowing')
        .where('o.status', '=', 'completed')
        .where('ofl.crop_cycle_id', 'in', cycleIds)
        .groupBy('ofl.crop_cycle_id')
        .execute()
    : [];
  const lines = cycleIds.length
    ? await trx
        .selectFrom('operations as o')
        .innerJoin('operation_fields as ofl', 'ofl.operation_id', 'o.id')
        .innerJoin('operation_inputs as oi', 'oi.operation_id', 'o.id')
        .innerJoin('products as p', 'p.id', 'oi.product_id')
        .select([
          'ofl.crop_cycle_id',
          'ofl.treated_area_ha',
          'oi.rate_per_ha',
          'p.id as product_id',
          'p.name',
          'p.base_unit',
          'p.n_pct',
          'p.nh4_n_pct',
          'p.p2o5_pct',
          'p.k2o_pct',
          'p.mgo_pct',
          'p.dry_matter_pct',
          'p.density_t_m3',
          'p.fertilizer_type',
          'p.catalogue_entry_id',
          sql<string>`(o.performed_at AT TIME ZONE 'Europe/Berlin')::date::text`.as('day'),
        ])
        .where('o.status', '=', 'completed')
        .where('p.category', '=', 'fertilizer')
        .where('ofl.crop_cycle_id', 'in', cycleIds)
        .execute()
    : [];
  const samples = await trx
    .selectFrom('soil_samples')
    .selectAll()
    .where('field_id', 'in', fieldIds)
    .orderBy('sampled_on', 'desc')
    .execute();
  const needs = cycleIds.length
    ? await trx
        .selectFrom('fertilizer_need_records')
        .distinctOn('crop_cycle_id')
        .select(['crop_cycle_id', 'inputs'])
        .where('crop_cycle_id', 'in', cycleIds)
        .orderBy('crop_cycle_id')
        .orderBy('created_at', 'desc')
        .execute()
    : [];

  const fertilization = (l: (typeof lines)[number], cycleArea: number): ExportFertilization | { failure: string } => {
    const type = l.fertilizer_type as FertilizerType | null;
    const organic = isOrganicFertilizer(type);
    const density = l.density_t_m3 ?? (organic ? 1 : null);
    // Organic contents per m³ of product; mineral contents stay in %.
    const toLib = (pct: number | null) => (pct == null ? null : organic ? pct * 10 * (density ?? 1) : pct);
    const art: NaehrstofftraegerartType = !organic ? 'MINERALDUENGER' : type && OTHER.includes(type) ? 'SONSTIGE' : 'WIRTSCHAFTSDUENGER';
    const mist = !!type && SOLID.includes(type);
    const quantity = cycleArea > 0 ? ((l.rate_per_ha ?? 0) * l.treated_area_ha) / cycleArea : 0;
    const article = {
      n: toLib(l.n_pct),
      nh4: toLib(l.nh4_n_pct),
      p2o5: toLib(l.p2o5_pct),
      k2o: toLib(l.k2o_pct),
      mgo: toLib(l.mgo_pct),
      convTtoCbm: density ? 1 / density : null,
      kgNper100L: !organic && l.base_unit === 'l' && l.n_pct != null && density ? l.n_pct * density : null,
    };
    try {
      if (l.n_pct == null) throw new CarrierResolutionError('no N content');
      const c = resolveCarrier(article, art, mist, UNIT[l.base_unit] ?? l.base_unit, quantity);
      return {
        date: berlin(l.day),
        articleId: l.product_id,
        articleFqn: organic ? (ARTICLE_KEY[type!] ?? 'ORGANIC__OTHER') : `MINERAL__${(type ?? 'other').toUpperCase()}`,
        fertilizerName: l.name,
        quantity,
        unit: UNIT[l.base_unit] ?? l.base_unit,
        fqnPrefix: organic ? 'ORGANIC' : 'MINERAL',
        articleCategory: type,
        isCustomArticle: !l.catalogue_entry_id,
        naehrstofftraegerart: art,
        isMistDuengung: mist,
        nKgPerHa: c.nKgPerHa,
        nh4KgPerHa: c.nh4KgPerHa,
        p2o5KgPerHa: c.p2o5KgPerHa,
        k2oKgPerHa: c.k2oKgPerHa,
        n: article.n,
        nh4: article.nh4,
        p2o5: article.p2o5,
        k: article.k2o == null ? null : article.k2o * 0.8302,
        k2o: article.k2o,
        mgo: article.mgo,
        dryMatterContent: l.dry_matter_pct,
        density: article.convTtoCbm,
        carrierUnit: c.carrierUnit,
        carrierAmountPerHa: c.carrierAmountPerHa,
        nPerCarrierUnit: c.nPerCarrierUnit,
        nh4PerCarrierUnit: c.nh4PerCarrierUnit,
        p2o5PerCarrierUnit: c.p2o5PerCarrierUnit,
        k2oPerCarrierUnit: c.k2oPerCarrierUnit,
        mgoPerCarrierUnit: c.mgoPerCarrierUnit,
      };
    } catch (e) {
      return { failure: e instanceof Error ? e.message : String(e) };
    }
  };

  const fields: ExportField[] = fieldRows.map((f) => {
    const own = cycles.filter((c) => c.field_id === f.id);
    const prevMain = own.find((c) => c.harvest_year === year - 1 && c.role === 'main');
    const prevHarvest = prevMain ? harvests.find((h) => h.crop_cycle_id === prevMain.id) : undefined;
    const exportCycle = (c: (typeof own)[number], herbstansaat: boolean): ExportCultivation | null => {
      const key = cropKeyForCode(c.code);
      const cl = lines.filter((l) => l.crop_cycle_id === c.id);
      const inWindow = cl.filter((l) => l.day >= from && l.day <= to);
      if (herbstansaat && !inWindow.length) return null;
      const dropped = cl.filter((l) => l.day < from || l.day > to).sort((a, b) => a.day.localeCompare(b.day));
      const ferts: ExportFertilization[] = [];
      const failed: ExportCultivation['failedFertilizations'] = [];
      for (const l of inWindow) {
        const r = fertilization(l, c.area_ha);
        if ('failure' in r) failed.push({ articleFqn: l.product_id, fertilizerName: l.name, quantity: l.rate_per_ha ?? 0, unit: UNIT[l.base_unit] ?? l.base_unit, reason: r.failure });
        else ferts.push(r);
      }
      const h = harvests.find((x) => x.crop_cycle_id === c.id);
      const sown = c.sowing_date ?? sowings.find((s) => s.crop_cycle_id === c.id)?.day ?? null;
      const nminSample = samples.find((s) => s.field_id === f.id && s.kind === 'nmin' && s.sampled_on >= c.start_date && s.sampled_on <= c.end_date);
      const need = needs.find((n) => n.crop_cycle_id === c.id)?.inputs as { nmin?: { value: number | null } } | undefined;
      const layers = nminSample
        ? ([
            [0, 30, nminSample.nmin_0_30],
            [30, 60, nminSample.nmin_30_60],
            [60, 90, nminSample.nmin_60_90],
          ] as const)
            .filter(([, , v]) => v != null)
            .map(([a, b, v]) => ({ from: a, to: b, value: Number(v) }))
        : [];
      return {
        cultivationId: c.id,
        cultivationGroupId: c.id,
        crop: key ?? c.code,
        areaInHa: c.area_ha,
        cropRole: c.role === 'catch_crop' ? 'INTERCROP' : c.role === 'undersown' ? 'UNDERSOW' : 'MAIN',
        ...(herbstansaat ? { herbstansaat: true as const } : {}),
        sowingDate: sown ? berlin(sown) : null,
        harvest: !herbstansaat && h && h.ha ? { date: berlin(h.day), yieldDtPerHa: (Number(h.t) / Number(h.ha)) * 10, proteinPercent: c.protein_pct } : null,
        previousCrop: prevMain ? (cropKeyForCode(prevMain.code) ?? prevMain.code) : null,
        previousCropSowingDate: null,
        previousCropYieldDtPerHa: prevHarvest && prevHarvest.ha ? (Number(prevHarvest.t) / Number(prevHarvest.ha)) * 10 : null,
        nmin: herbstansaat
          ? null
          : nminSample && layers.length
            ? { date: berlin(nminSample.sampled_on), kgPerHa: layers.reduce((s, l) => s + l.value, 0), layers, source: 'lab' }
            : need?.nmin?.value != null
              ? { date: null, kgPerHa: need.nmin.value, layers: [], source: 'planning' }
              : null,
        filmOrFleece: c.film_or_fleece,
        droppedFertilizationCount: herbstansaat ? 0 : dropped.length,
        droppedFertilizationDates: herbstansaat ? [] : dropped.map((l) => berlin(l.day)),
        fertilizations: ferts,
        failedFertilizations: failed,
      };
    };
    const cultivations = [
      ...own.filter((c) => c.harvest_year === year).map((c) => exportCycle(c, false)),
      ...own.filter((c) => c.harvest_year === year + 1).map((c) => exportCycle(c, true)),
    ].filter((c): c is ExportCultivation => c != null);
    return {
      id: f.id,
      name: f.name,
      areaInHa: f.area_ha,
      parcelId: null,
      flik: f.identifier,
      soilTypeLufa: f.soil_texture,
      nitrateSensitiveZone: f.nitrate_sensitive_zone,
      soilSamples: samples
        .filter((s) => s.field_id === f.id && s.kind === 'basic')
        .map((s) => ({
          date: berlin(s.sampled_on),
          layerFrom: 0,
          layerTo: s.depth_cm ?? 30,
          method: s.p_method,
          ph: s.ph,
          p2o5: s.p2o5_mg_100g,
          k2o: s.k2o_mg_100g,
          mgo: s.mgo_mg_100g,
          humus: s.humus_pct,
          nt: null,
          soc: null,
        })),
      cultivations,
    };
  });

  const n170 = n170Betriebsdaten(n170Data);
  return {
    orgId,
    year,
    duengejahr: window,
    federalState: farm.federalState ?? null,
    integrations: { enni: enniMetadata(farm), endo: endoMetadata(farm), ...(n170 ? { n170: { [String(year)]: n170 } } : {}) },
    fields,
  };
}
