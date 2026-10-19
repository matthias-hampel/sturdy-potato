import { Injectable } from '@nestjs/common';
import { DEFAULT_RESULT_COLS, SOIL_PARAM_META, type SoilExportInput, type SoilExportResult, type SoilParameter, type SoilTexture } from '@agmeo/contracts';
import type { Feature, FeatureCollection, MultiPolygon } from 'geojson';
import { sql } from 'kysely';
import type { Ctx } from '../../auth/context.js';
import { badRequest } from '../../core/errors.js';
import { record } from '../../core/events.js';
import { today } from '../../core/mappers.js';
import type { Out } from '../../core/validation.js';
import { Database, type Trx } from '../../db/database.js';
import { FilesService } from '../files/files.service.js';
import { type DbfField, polygonShapefile, type ShapeRecord } from '../vra/export/shapefile.js';
import { zip } from '../vra/export/zip.js';
import { resultsPdf, type SheetField, zonationPdf } from './export/sheets.js';
import { CONTOUR_FIELDS, contourRows, SAMPLE_CARD_FIELDS, sampleCardRows, tgisShapefile } from './export/tgis.js';
import { type ZoneRow, zoneOut, zonesOf } from './soil-rows.js';
import { SoilZonationService } from './zonation.service.js';

interface ExportField {
  id: string;
  name: string;
  parcel: string | null;
  soil_texture: string | null;
  area_ha: number;
  geometry: MultiPolygon;
  zonation_id: string | null;
  zonation_created_at: Date | null;
}

/** Plain labels for PDF tables (the PDF fonts have no subscript digits). */
const PARAM_LABELS: Partial<Record<SoilParameter, { de: string; en: string }>> = {
  ph: { de: 'pH', en: 'pH' },
  p2o5: { de: 'P2O5', en: 'P2O5' },
  k2o: { de: 'K2O', en: 'K2O' },
  mgo: { de: 'MgO', en: 'MgO' },
  humus: { de: 'Humus', en: 'Humus' },
  nmin: { de: 'Nmin', en: 'Nmin' },
  soc: { de: 'SOC', en: 'SOC' },
  clay: { de: 'Ton', en: 'Clay' },
  silt: { de: 'Schluff', en: 'Silt' },
  sand: { de: 'Sand', en: 'Sand' },
  b: { de: 'Bor', en: 'Boron' },
  cu: { de: 'Kupfer', en: 'Copper' },
  mn: { de: 'Mangan', en: 'Manganese' },
  zn: { de: 'Zink', en: 'Zinc' },
  s: { de: 'Schwefel', en: 'Sulfur' },
};

const safeName = (s: string) =>
  s
    .normalize('NFKD')
    .replace(/[^\w\- ]+/g, '')
    .trim()
    .replace(/\s+/g, '_')
    .slice(0, 33) || 'agmeo';

/**
 * Exports of the soil planner (ported from the reference's ExportZonationsModal): the lab's
 * sample card (PROBEKARTE + CONTOUR shapefiles), zonation and results PDFs, GeoJSON and a zone
 * shapefile. Every export is archived in the "Soil exports" system folder.
 */
@Injectable()
export class SoilExportService {
  constructor(
    private readonly db: Database,
    private readonly files: FilesService,
    private readonly zonations: SoilZonationService,
  ) {}

  async export(ctx: Ctx, input: Out<typeof SoilExportInput>): Promise<SoilExportResult> {
    const built = await this.db.run(ctx, async (trx) => {
      let probeNumbers = 0;
      if (input.format === 'sampleCard') {
        // The numbers on the card are what the lab echoes back: stamp them on the zones first.
        const withZones = await this.loadFields(trx, input.fieldIds);
        const zoned = withZones.filter((f) => f.zonation_id).map((f) => f.id);
        probeNumbers = (await this.zonations.stampProbeNumbers(trx, ctx, zoned, input.startProbeNr ?? null)).length;
      }
      const fields = await this.loadFields(trx, input.fieldIds);
      const zoned = fields.filter((f) => f.zonation_id);
      const zones = await zonesOf(
        trx,
        zoned.map((f) => f.zonation_id!),
      );
      const org = await trx.selectFrom('organizations').select('name').where('id', '=', ctx.orgId).executeTakeFirstOrThrow();
      if (!zoned.length && input.format !== 'zonationPdf') throw badRequest('no_zonation', 'None of the fields has a zone map');
      const date = today();
      const base = safeName(`${org.name}`);
      const byField = (f: ExportField) => zones.filter((z) => z.zonation_id === f.zonation_id);
      let name: string;
      let mime: string;
      let data: Buffer;

      switch (input.format) {
        case 'sampleCard': {
          const cardBase = safeName(input.customerNumber ? `${input.customerNumber}_${org.name}` : org.name).slice(0, 33);
          const cardFields = zoned.map((f) => ({
            fieldId: f.id,
            fieldName: f.name,
            parcel: f.parcel,
            areaHa: f.area_ha,
            bodenart: f.soil_texture,
            geometry: f.geometry,
            zones: byField(f).map((z) => ({ zoneId: z.id, areaHa: Number(z.area_ha), probeNr: z.probe_nr ?? 0, geometry: z.geojson })),
          }));
          const card = sampleCardRows(cardFields, input.customerNumber ?? '', date.split('-').reverse().join('.'));
          const contour = contourRows(cardFields, Number(date.slice(0, 4)));
          data = zip([
            { name: `${cardBase}_PROBEKARTE.zip`, data: zip(tgisShapefile(card, SAMPLE_CARD_FIELDS, `${cardBase}_PROBEKARTE`)) },
            { name: `${cardBase}_CONTOUR.zip`, data: zip(tgisShapefile(contour, CONTOUR_FIELDS, `${cardBase}_CONTOUR`)) },
          ]);
          name = `${cardBase}_Probenkarte_${date}.zip`;
          mime = 'application/zip';
          break;
        }
        case 'zonationPdf':
        case 'resultsPdf': {
          const sheet = (f: ExportField): SheetField => ({
            name: f.name,
            areaHa: f.area_ha,
            soilType: f.soil_texture,
            geometry: f.geometry,
            zones: byField(f).map((z) => this.sheetZone(z, f.soil_texture as SoilTexture | null)),
          });
          const opts = { locale: input.locale, orgName: org.name, date };
          if (input.format === 'zonationPdf') {
            data = zonationPdf(
              zoned.map(sheet),
              fields.filter((f) => !f.zonation_id).map((f) => ({ ...sheet(f), zones: [] })),
              opts,
            );
            name = `${base}_Zonierungskarte_${date}.pdf`;
          } else {
            const params = (input.params?.length ? input.params : DEFAULT_RESULT_COLS) as SoilParameter[];
            data = resultsPdf(zoned.map(sheet), params, { ...opts, paramLabel: (p) => PARAM_LABELS[p]?.[input.locale] ?? p.toUpperCase() });
            name = `${base}_Bodenergebnisse_${date}.pdf`;
          }
          mime = 'application/pdf';
          break;
        }
        case 'geojson': {
          data = Buffer.from(JSON.stringify(this.featureCollection(zoned, byField), null, 2), 'utf8');
          name = `${base}_Bodenzonenkarten_${date}.geojson`;
          mime = 'application/geo+json';
          break;
        }
        case 'shapefile': {
          const { fields: dbf, records } = this.zoneShapes(zoned, byField);
          const shp = polygonShapefile(dbf, records);
          const stem = `${base}_Bodenzonenkarten`;
          data = zip([
            { name: `${stem}.shp`, data: shp.shp },
            { name: `${stem}.shx`, data: shp.shx },
            { name: `${stem}.dbf`, data: shp.dbf },
            { name: `${stem}.prj`, data: shp.prj },
            { name: `${stem}.cpg`, data: shp.cpg },
          ]);
          name = `${stem}_${date}.zip`;
          mime = 'application/zip';
          break;
        }
      }
      await record(trx, ctx, { entityType: 'soil_export', entityId: ctx.orgId, action: 'exported', changes: { format: input.format, fields: zoned.length, probeNumbers } });
      return { name, mime, data, skipped: fields.filter((f) => !f.zonation_id).map((f) => f.id), probeNumbers };
    });
    const file = await this.files.storeGenerated(ctx, 'soilExports', built.name, built.mime, built.data, new Date().getFullYear());
    return { file, skippedFieldIds: built.skipped, probeNumbers: built.probeNumbers };
  }

  private sheetZone(z: ZoneRow, texture: SoilTexture | null) {
    const zone = zoneOut(z, texture);
    return {
      label: zone.label,
      color: zone.color,
      areaHa: zone.areaHa,
      probeNr: zone.probeNr,
      geometry: zone.geometry,
      point: zone.samplePoint,
      values: zone.values,
      classes: { ph: zone.classes.ph, p2o5: zone.classes.p, k2o: zone.classes.k, mgo: zone.classes.mg },
      sampledOn: Object.values(zone.dates).sort().at(-1) ?? null,
    };
  }

  /** One feature per zone with its values and `<param>_method` tags (as the reference export). */
  featureCollection(fields: ExportField[], zonesOfField: (f: ExportField) => ZoneRow[]): FeatureCollection {
    const features: Feature[] = [];
    for (const f of fields) {
      for (const z of zonesOfField(f)) {
        const zone = zoneOut(z, f.soil_texture as SoilTexture | null);
        features.push({
          type: 'Feature',
          geometry: zone.geometry,
          properties: {
            id: zone.label,
            fieldName: f.name,
            fieldId: f.id,
            areaHa: zone.areaHa,
            classIndex: zone.zoneNo,
            color: zone.color,
            probeNr: zone.probeNr,
            bodenart: f.soil_texture,
            ...zone.values,
            ...Object.fromEntries(Object.entries(zone.methods).map(([k, m]) => [`${k}_method`, m])),
          },
        });
      }
    }
    return { type: 'FeatureCollection', features };
  }

  private zoneShapes(fields: ExportField[], zonesOfField: (f: ExportField) => ZoneRow[]): { fields: DbfField[]; records: ShapeRecord[] } {
    const zones = fields.flatMap((f) => zonesOfField(f).map((z) => ({ f, zone: zoneOut(z, f.soil_texture as SoilTexture | null) })));
    const params = (Object.keys(SOIL_PARAM_META) as SoilParameter[]).filter((p) => zones.some((z) => z.zone.values[p] != null));
    const dbf: DbfField[] = [
      { name: 'ZONE', type: 'C', length: 80, decimals: 0 },
      { name: 'FIELD', type: 'C', length: 100, decimals: 0 },
      { name: 'FIELD_ID', type: 'C', length: 36, decimals: 0 },
      { name: 'ZONE_NO', length: 4, decimals: 0 },
      { name: 'PROBE_NR', length: 10, decimals: 0 },
      { name: 'AREA_HA', length: 12, decimals: 4 },
      { name: 'COLOR', type: 'C', length: 7, decimals: 0 },
      { name: 'BODENART', type: 'C', length: 10, decimals: 0 },
      ...params.map((p) => ({ name: p.toUpperCase().slice(0, 10), length: 14, decimals: Math.max(SOIL_PARAM_META[p].decimals, 2) })),
    ];
    const records: ShapeRecord[] = zones.map(({ f, zone }) => ({
      geometry: zone.geometry,
      values: {
        ZONE: zone.label,
        FIELD: f.name,
        FIELD_ID: f.id,
        ZONE_NO: zone.zoneNo,
        PROBE_NR: zone.probeNr,
        AREA_HA: zone.areaHa,
        COLOR: zone.color,
        BODENART: f.soil_texture,
        ...Object.fromEntries(params.map((p) => [p.toUpperCase().slice(0, 10), zone.values[p] ?? null])),
      },
    }));
    return { fields: dbf, records };
  }

  private async loadFields(trx: Trx, fieldIds: string[]): Promise<ExportField[]> {
    const { rows } = await sql<ExportField>`
      SELECT f.id, f.name, coalesce(f.parcel_number, f.identifier) AS parcel, f.soil_texture, g.area_ha::float8 AS area_ha,
             ST_AsGeoJSON(g.geometry, 7)::json AS geometry, n.id AS zonation_id, n.created_at AS zonation_created_at
      FROM fields f
      JOIN field_current_geometry g ON g.field_id = f.id
      LEFT JOIN soil_zonations n ON n.field_id = f.id AND n.status = 'ready' AND n.superseded_at IS NULL
      WHERE f.id = ANY(${fieldIds}::uuid[])
      ORDER BY f.name, f.id`.execute(trx);
    return rows.map((r) => ({ ...r, area_ha: Number(r.area_ha) }));
  }
}
