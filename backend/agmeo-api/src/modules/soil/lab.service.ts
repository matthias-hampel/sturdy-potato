import { Injectable } from '@nestjs/common';
import {
  type LabApplyResult,
  type LabFileRejection,
  type LabPreview,
  type LabPreviewField,
  type SoilLabImport,
  type SoilParameter,
  type ZoneLabExtras,
} from '@agmeo/contracts';
import { sql } from 'kysely';
import type { Ctx } from '../../auth/context.js';
import { badRequest } from '../../core/errors.js';
import { record } from '../../core/events.js';
import { iso, round } from '../../core/mappers.js';
import { Database, type Trx } from '../../db/database.js';
import { FilesService } from '../files/files.service.js';
import { dedupeRows, LabFileError, type LabRow, parseLabFile } from './lab/parse.js';
import { zoneStrings, zoneValues } from './soil-rows.js';

export interface LabUpload {
  name: string;
  data: Buffer;
  mimeType: string;
}

interface CandidateZone {
  zone_id: string;
  zone_label: string;
  probe_nr: number | null;
  properties: Record<string, unknown>;
  property_methods: Record<string, unknown>;
  property_dates: Record<string, unknown>;
  lab_extras: ZoneLabExtras | null;
  zonation_id: string;
  field_id: string;
  field_name: string;
  area_ha: number;
}

const BASIC_PARAMS = ['ph', 'p2o5', 'k2o', 'mgo', 'humus'] as const;

const sameStored = (zone: CandidateZone, row: LabRow) => {
  const stored = zoneValues(zone.properties);
  const methods = zoneStrings(zone.property_methods);
  const extras = zone.lab_extras ?? {};
  const measured = Object.entries(row.values) as [SoilParameter, number][];
  return (
    measured.length > 0 &&
    measured.every(([p, v]) => stored[p] === v) &&
    Object.entries(row.methods).every(([p, m]) => methods[p as SoilParameter] === m) &&
    Object.entries(row.stages).every(([p, s]) => extras.supplyClass?.[p as SoilParameter] === s) &&
    (!row.kalkbedarf || (extras.kalkbedarf?.dtHa === row.kalkbedarf.dtHa && extras.kalkbedarf?.kg === row.kalkbedarf.kg)) &&
    (!row.labNr || extras.labNr === row.labNr)
  );
};

const mergedExtras = (prior: ZoneLabExtras | null, row: LabRow): ZoneLabExtras | null => {
  const hasStages = Object.keys(row.stages).length > 0;
  if (!hasStages && !row.kalkbedarf && !row.labNr) return prior;
  return {
    ...prior,
    ...(hasStages ? { supplyClass: { ...prior?.supplyClass, ...row.stages } } : {}),
    ...(row.kalkbedarf ? { kalkbedarf: row.kalkbedarf } : {}),
    ...(row.labNr ? { labNr: row.labNr } : {}),
  };
};

/**
 * Lab result upload (ported from the reference's UploadLabResultsModal / labResultsUpload.ts):
 * files are parsed, rows matched to the active sampling zones by probe number (the field name
 * breaks ties) or, for returned Probenkarte shapefiles, by location; applying writes the values
 * onto the zones and a soil sample per field (area-weighted mean) for nutrient planning.
 */
@Injectable()
export class SoilLabService {
  constructor(
    private readonly db: Database,
    private readonly files: FilesService,
  ) {}

  private async parse(uploads: LabUpload[]) {
    const parsed: LabRow[] = [];
    const fileNames: string[] = [];
    const failedFileNames: string[] = [];
    const rejectedFiles: { fileName: string; reason: LabFileRejection }[] = [];
    for (const file of uploads) {
      try {
        parsed.push(...(await parseLabFile(file.name, file.data)));
        fileNames.push(file.name);
      } catch (err) {
        if (err instanceof LabFileError) rejectedFiles.push({ fileName: file.name, reason: err.reason });
        else failedFileNames.push(file.name);
      }
    }
    const { rows, duplicates } = dedupeRows(parsed);
    return { rows, duplicates, fileNames, failedFileNames, rejectedFiles };
  }

  private async match(trx: Trx, rows: LabRow[]): Promise<{ fields: LabPreviewField[]; unmatched: LabRow[]; zones: Map<string, CandidateZone> }> {
    const zoneColumns = sql`z.id AS zone_id, z.label AS zone_label, z.probe_nr, z.properties, z.property_methods, z.property_dates, z.lab_extras,
      n.id AS zonation_id, f.id AS field_id, f.name AS field_name, coalesce(g.area_ha, 0)::float8 AS area_ha`;
    const probeNrs = [...new Set(rows.map((r) => r.probeNr).filter((n): n is number => n != null))];
    const byProbe = probeNrs.length
      ? (
          await sql<CandidateZone>`
            SELECT ${zoneColumns}
            FROM soil_zones z JOIN soil_zonations n ON n.id = z.zonation_id JOIN fields f ON f.id = n.field_id
            LEFT JOIN field_current_geometry g ON g.field_id = f.id
            WHERE n.status = 'ready' AND n.superseded_at IS NULL AND z.probe_nr = ANY(${probeNrs}::int[])`.execute(trx)
        ).rows
      : [];
    const located = rows.map((r, i) => ({ r, i })).filter(({ r }) => r.point && (r.probeNr == null || !byProbe.some((z) => z.probe_nr === r.probeNr)));
    const byPoint = new Map<number, CandidateZone>();
    if (located.length) {
      const payload = located.map(({ r, i }) => ({ i, x: r.point![0], y: r.point![1] }));
      const { rows: hits } = await sql<CandidateZone & { i: number }>`
        SELECT DISTINCT ON (p.i) p.i, ${zoneColumns}
        FROM jsonb_to_recordset(${JSON.stringify(payload)}::jsonb) AS p(i int, x float8, y float8)
        JOIN soil_zones z ON ST_DWithin(z.geometry::geography, ST_SetSRID(ST_MakePoint(p.x, p.y), 4326)::geography, 50)
        JOIN soil_zonations n ON n.id = z.zonation_id AND n.status = 'ready' AND n.superseded_at IS NULL
        JOIN fields f ON f.id = n.field_id
        LEFT JOIN field_current_geometry g ON g.field_id = f.id
        ORDER BY p.i, ST_Distance(z.geometry::geography, ST_SetSRID(ST_MakePoint(p.x, p.y), 4326)::geography)`.execute(trx);
      for (const hit of hits) byPoint.set(hit.i, hit);
    }

    const zones = new Map<string, CandidateZone>();
    const fields = new Map<string, LabPreviewField>();
    const unmatched: LabRow[] = [];
    rows.forEach((row, i) => {
      let zone: CandidateZone | null = null;
      let how: 'probe' | 'location' = 'probe';
      if (row.probeNr != null) {
        // Probe numbers are unique within a zonation, not across the organization: a number on
        // several fields only counts when the file's field name pins exactly one of them.
        const candidates = byProbe.filter((z) => z.probe_nr === row.probeNr);
        const hint = row.fieldNameHint?.toLowerCase();
        const hinted = hint ? candidates.filter((c) => c.field_name.toLowerCase().includes(hint)) : [];
        zone = candidates.length === 1 ? candidates[0] : hinted.length === 1 ? hinted[0] : null;
      }
      if (!zone && byPoint.has(i)) {
        zone = byPoint.get(i)!;
        how = 'location';
      }
      if (!zone) {
        unmatched.push(row);
        return;
      }
      zones.set(zone.zone_id, zone);
      const field = fields.get(zone.field_id) ?? {
        fieldId: zone.field_id,
        fieldName: zone.field_name,
        fieldAreaHa: round(Number(zone.area_ha), 4),
        zonationId: zone.zonation_id,
        probes: [],
        params: [],
        alreadyImported: true,
        storedSampleDate: null,
      };
      field.probes.push({ zoneId: zone.zone_id, zoneLabel: zone.zone_label, probeNr: zone.probe_nr, match: how, row });
      field.alreadyImported &&= sameStored(zone, row);
      const dates = zoneStrings(zone.property_dates);
      const stored = Object.keys(row.values)
        .flatMap((p) => (dates[p as SoilParameter] ? [dates[p as SoilParameter]!] : []))
        .sort()
        .at(-1);
      if (stored && stored > (field.storedSampleDate ?? '')) field.storedSampleDate = stored;
      fields.set(zone.field_id, field);
    });
    return {
      fields: [...fields.values()]
        .map((f) => ({
          ...f,
          probes: f.probes.sort((a, b) => (a.probeNr ?? 0) - (b.probeNr ?? 0)),
          params: [...new Set(f.probes.flatMap((p) => Object.keys(p.row.values)))] as SoilParameter[],
        }))
        .sort((a, b) => a.fieldName.localeCompare(b.fieldName)),
      unmatched,
      zones,
    };
  }

  async preview(ctx: Ctx, uploads: LabUpload[]): Promise<LabPreview> {
    const { rows, duplicates, fileNames, failedFileNames, rejectedFiles } = await this.parse(uploads);
    const { fields, unmatched } = await this.db.run(ctx, (trx) => this.match(trx, rows));
    return { fileNames, failedFileNames, rejectedFiles, rowCount: rows.length, duplicateRows: duplicates, fields, unmatched };
  }

  /** Writes the matched rows of the chosen fields (default all) and archives the files. */
  async apply(ctx: Ctx, uploads: LabUpload[], fieldIds: string[] | null): Promise<LabApplyResult> {
    const { rows, fileNames } = await this.parse(uploads);
    const matched = await this.db.run(ctx, (trx) => this.match(trx, rows));
    const chosen = matched.fields.filter((f) => !fieldIds || fieldIds.includes(f.fieldId));
    if (!chosen.length) throw badRequest('no_matches', 'No lab result matches a sampling zone');

    const fileIds: string[] = [];
    const year = new Date().getFullYear();
    for (const file of uploads.filter((u) => fileNames.includes(u.name))) {
      fileIds.push((await this.files.storeGenerated(ctx, 'soilImports', file.name, file.mimeType || 'application/octet-stream', file.data, year)).id);
    }
    const importId = await this.db.run(ctx, async (trx) => {
      const { id } = await trx
        .insertInto('soil_lab_imports')
        .values({ organization_id: ctx.orgId, file_names: fileNames, file_ids: fileIds, created_by: ctx.userId })
        .returning('id')
        .executeTakeFirstOrThrow();
      return id;
    });

    const results: LabApplyResult['results'] = [];
    for (const field of chosen) {
      try {
        const out = await this.db.run(ctx, (trx) => this.applyField(trx, ctx, importId, field, fileNames));
        results.push({ fieldId: field.fieldId, fieldName: field.fieldName, status: 'success', probeCount: field.probes.length, sampleIds: out });
      } catch (err) {
        const raw = err instanceof Error ? err.message : String(err);
        results.push({ fieldId: field.fieldId, fieldName: field.fieldName, status: 'failed', reason: raw.split('\n')[0].slice(0, 200) });
      }
    }
    await this.db.run(ctx, async (trx) => {
      // An import that wrote nothing is not kept.
      const used = await trx.selectFrom('soil_lab_import_zones').select('zone_id').where('import_id', '=', importId).executeTakeFirst();
      if (!used) await trx.deleteFrom('soil_lab_imports').where('id', '=', importId).execute();
      await record(trx, ctx, { entityType: 'soil_lab_import', entityId: importId, action: 'imported', changes: { files: fileNames, fields: results.filter((r) => r.status === 'success').length } });
    });
    return { importId: results.some((r) => r.status === 'success') ? importId : null, fileIds, results };
  }

  private async applyField(trx: Trx, ctx: Ctx, importId: string, field: LabPreviewField, fileNames: string[]): Promise<string[]> {
    // Re-read the zones inside the transaction and fold every row of a zone into one working copy,
    // so a file that repeats a probe number does not drop the earlier row's parameters.
    const owned = await sql<{ id: string; properties: Record<string, unknown>; property_methods: Record<string, unknown>; property_dates: Record<string, unknown>; lab_extras: ZoneLabExtras | null }>`
      SELECT z.id, z.properties, z.property_methods, z.property_dates, z.lab_extras
      FROM soil_zones z JOIN soil_zonations n ON n.id = z.zonation_id
      WHERE z.id = ANY(${field.probes.map((p) => p.zoneId)}::uuid[]) AND n.field_id = ${field.fieldId}::uuid
        AND n.status = 'ready' AND n.superseded_at IS NULL
      FOR UPDATE OF z`.execute(trx);
    if (!owned.rows.length) throw badRequest('zones_changed', 'The zones of this field changed; preview again');
    const working = new Map(
      owned.rows.map((z) => [z.id, { properties: { ...z.properties }, methods: { ...z.property_methods }, dates: { ...z.property_dates }, extras: z.lab_extras }]),
    );
    const written = new Map<string, { values: Record<string, number>; date: string }>();
    for (const probe of field.probes) {
      const acc = working.get(probe.zoneId);
      if (!acc) continue;
      Object.assign(acc.properties, probe.row.values);
      Object.assign(acc.methods, probe.row.methods);
      for (const p of Object.keys(probe.row.values)) acc.dates[p] = probe.row.date;
      acc.extras = mergedExtras(acc.extras, probe.row);
      const entry = written.get(probe.zoneId) ?? { values: {}, date: probe.row.date };
      Object.assign(entry.values, probe.row.values);
      if (probe.row.date > entry.date) entry.date = probe.row.date;
      written.set(probe.zoneId, entry);
    }
    // Values this import overwrites no longer belong to earlier imports of the zone.
    for (const [zoneId, entry] of written) {
      await sql`
        UPDATE soil_lab_import_zones SET values = values - ${Object.keys(entry.values)}::text[]
        WHERE zone_id = ${zoneId}::uuid AND import_id <> ${importId}::uuid`.execute(trx);
    }
    await sql`DELETE FROM soil_lab_import_zones WHERE zone_id = ANY(${[...written.keys()]}::uuid[]) AND values = '{}'::jsonb`.execute(trx);
    // Imports whose values were all overwritten are dropped.
    await sql`DELETE FROM soil_lab_imports i WHERE i.id <> ${importId}::uuid AND NOT EXISTS (SELECT 1 FROM soil_lab_import_zones z WHERE z.import_id = i.id)`.execute(trx);
    for (const [zoneId, entry] of written) {
      await sql`
        INSERT INTO soil_lab_import_zones (organization_id, import_id, zone_id, values, sampled_on)
        VALUES (${ctx.orgId}::uuid, ${importId}::uuid, ${zoneId}::uuid, ${JSON.stringify(entry.values)}::jsonb, ${entry.date}::date)
        ON CONFLICT (import_id, zone_id) DO UPDATE SET values = soil_lab_import_zones.values || excluded.values, sampled_on = excluded.sampled_on`.execute(trx);
    }
    for (const [zoneId, acc] of working) {
      if (!written.has(zoneId)) continue;
      await trx
        .updateTable('soil_zones')
        .set({
          properties: JSON.stringify(acc.properties),
          property_methods: JSON.stringify(acc.methods),
          property_dates: JSON.stringify(acc.dates),
          lab_extras: acc.extras ? JSON.stringify(acc.extras) : null,
        })
        .where('id', '=', zoneId)
        .execute();
    }
    const sampleIds = await this.writeFieldSamples(trx, ctx, importId, field, fileNames);
    await record(trx, ctx, { entityType: 'field', entityId: field.fieldId, action: 'soil_lab_results_imported', changes: { importId, zones: written.size, params: field.params } });
    return sampleIds;
  }

  /**
   * The field's soil sample(s) of this import: area-weighted means over the zonation's zones
   * (zones without a value do not count), as nutrient planning reads them.
   */
  async writeFieldSamples(trx: Trx, ctx: Ctx, importId: string, field: { fieldId: string; zonationId: string }, fileNames: string[]): Promise<string[]> {
    const zones = await trx.selectFrom('soil_zones').select(['area_ha', 'properties', 'property_methods', 'property_dates', 'probe_nr']).where('zonation_id', '=', field.zonationId).execute();
    const mean = (p: SoilParameter): number | null => {
      let sum = 0;
      let area = 0;
      for (const z of zones) {
        const v = zoneValues(z.properties)[p];
        if (v == null) continue;
        sum += v * Number(z.area_ha);
        area += Number(z.area_ha);
      }
      return area > 0 ? sum / area : null;
    };
    const dominant = (p: SoilParameter): string | null => {
      const seen = new Set(zones.map((z) => zoneStrings(z.property_methods)[p]).filter((m): m is string => !!m));
      return seen.size === 1 ? [...seen][0] : null;
    };
    const imported = await trx.selectFrom('soil_lab_import_zones').select(['sampled_on']).where('import_id', '=', importId).execute();
    const sampledOn = imported.map((r) => r.sampled_on).sort().at(-1) ?? new Date().toISOString().slice(0, 10);
    const probes = zones.map((z) => z.probe_nr).filter((n): n is number => n != null).sort((a, b) => a - b);
    const probeText = probes.length ? (probes.length === 1 ? String(probes[0]) : `${probes[0]}–${probes.at(-1)}`) : null;
    const within = (v: number | null, min: number, max: number) => (v != null && v >= min && v <= max ? round(v, 2) : null);

    await trx.deleteFrom('soil_samples').where('lab_import_id', '=', importId).where('field_id', '=', field.fieldId).execute();
    const ids: string[] = [];
    const base = {
      organization_id: ctx.orgId,
      field_id: field.fieldId,
      sampled_on: sampledOn,
      lab: fileNames.join(', ').slice(0, 200) || null,
      sample_number: probeText,
      notes: `${zones.length} zones, area-weighted mean`,
      created_by: ctx.userId,
      lab_import_id: importId,
      soil_zonation_id: field.zonationId,
    };
    const basic = {
      ph: within(mean('ph'), 2, 11),
      p2o5_mg_100g: within(mean('p2o5'), 0, 1000),
      k2o_mg_100g: within(mean('k2o'), 0, 1000),
      mgo_mg_100g: within(mean('mgo'), 0, 1000),
      humus_pct: within(mean('humus'), 0, 100),
    };
    if (BASIC_PARAMS.some((p) => mean(p) != null)) {
      const phMethod = dominant('ph');
      const pMethod = dominant('p2o5');
      const { id } = await trx
        .insertInto('soil_samples')
        .values({
          ...base,
          kind: 'basic',
          depth_cm: 30,
          ...basic,
          ph_method: basic.ph != null ? (phMethod === 'h2o' || phMethod === 'kcl' ? phMethod : 'cacl2') : null,
          p_method: basic.p2o5_mg_100g != null ? (pMethod === 'dl' ? 'dl' : 'cal') : null,
        })
        .returning('id')
        .executeTakeFirstOrThrow();
      ids.push(id);
    }
    const nmin = mean('nmin') ?? (mean('no3') != null || mean('nh4') != null ? (mean('no3') ?? 0) + (mean('nh4') ?? 0) : null);
    if (nmin != null) {
      const { id } = await trx
        .insertInto('soil_samples')
        .values({ ...base, kind: 'nmin', depth_cm: 30, nmin_0_30: within(nmin, 0, 1000) })
        .returning('id')
        .executeTakeFirstOrThrow();
      ids.push(id);
    }
    for (const id of ids) await record(trx, ctx, { entityType: 'field', entityId: field.fieldId, action: 'soil_sample_recorded', changes: { sampleId: id, sampledOn, importId } });
    return ids;
  }

  imports(ctx: Ctx): Promise<SoilLabImport[]> {
    return this.db.run(ctx, async (trx) => {
      const { rows } = await sql<{
        id: string;
        file_names: string[];
        file_ids: string[];
        created_at: Date;
        created_by_name: string | null;
        zone_count: number;
        fields: { id: string; name: string }[] | null;
        sampled_on: string | null;
        files: { id: string; name: string }[] | null;
      }>`
        SELECT i.id, i.file_names, i.file_ids, i.created_at, u.display_name AS created_by_name,
               (SELECT count(*) FROM soil_lab_import_zones iz WHERE iz.import_id = i.id)::int AS zone_count,
               (SELECT max(iz.sampled_on)::text FROM soil_lab_import_zones iz WHERE iz.import_id = i.id) AS sampled_on,
               (SELECT jsonb_agg(DISTINCT jsonb_build_object('id', f.id, 'name', f.name))
                  FROM soil_lab_import_zones iz JOIN soil_zones z ON z.id = iz.zone_id JOIN soil_zonations n ON n.id = z.zonation_id JOIN fields f ON f.id = n.field_id
                  WHERE iz.import_id = i.id) AS fields,
               (SELECT jsonb_agg(jsonb_build_object('id', fl.id, 'name', fl.name)) FROM files fl WHERE fl.id = ANY(i.file_ids) AND fl.deleted_at IS NULL) AS files
        FROM soil_lab_imports i LEFT JOIN users u ON u.id = i.created_by
        ORDER BY i.created_at DESC
        LIMIT 200`.execute(trx);
      return rows.map((r) => ({
        id: r.id,
        fileNames: r.file_names,
        files: r.files ?? [],
        createdAt: iso(r.created_at),
        createdByName: r.created_by_name,
        zoneCount: r.zone_count,
        fields: (r.fields ?? []).sort((a, b) => a.name.localeCompare(b.name)),
        sampledOn: r.sampled_on,
      }));
    });
  }
}

