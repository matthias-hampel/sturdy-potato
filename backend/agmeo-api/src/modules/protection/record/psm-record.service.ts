import { Injectable, Logger } from '@nestjs/common';
import type { PsmAttestations, PsmAttestationsInput, PsmIssueTargets, PsmRecordFile, PsmRecordReadiness, PsmRecordResult } from '@agmeo/contracts';
import type { Ctx } from '../../../auth/context.js';
import { badRequest } from '../../../core/errors.js';
import { record } from '../../../core/events.js';
import type { Out } from '../../../core/validation.js';
import { Database, type Trx } from '../../../db/database.js';
import { FilesService } from '../../files/files.service.js';
import { OperationsService } from '../../operations/operations.service.js';
import { ProtectionService } from '../protection.service.js';
import { buildExport, preflight } from './eu-export.js';
import { loadAttestations, loadProtection } from './load.js';
import { buildReadiness, issueTargets } from './readiness.js';
import { FILE_PREFIX, fileName, MIME_TYPES, toCsv, toJson } from './record-file.js';

/**
 * The plant-protection record under §11 PflSchG / EU 2023/564 (ported from agmeo's
 * protection-reports wizard): readiness check, the farm's certificates, the record as CSV or
 * JSON — archived in Files > Exports so an inspection can be shown what was produced and when —
 * and the history of generated records.
 *
 * The record reports RECORDED FIELDS and deviations from the approval as the BVL data has it.
 * It is not a legal assessment and files nothing with an authority.
 */
@Injectable()
export class PsmRecordService {
  private readonly logger = new Logger(PsmRecordService.name);

  constructor(
    private readonly db: Database,
    private readonly operations: OperationsService,
    private readonly protection: ProtectionService,
    private readonly files: FilesService,
  ) {}

  /** The same loader, document and preflight for every view of the record. */
  private async assess(trx: Trx, year: number, now = new Date()) {
    const load = await loadProtection(trx, { operations: this.operations, protection: this.protection }, year);
    const document = buildExport(load, now);
    return { load, document, assessment: preflight(load, document, now) };
  }

  readiness(ctx: Ctx, year: number): Promise<PsmRecordReadiness> {
    return this.db.run(ctx, async (trx) => {
      const { load, document, assessment } = await this.assess(trx, year);
      return {
        year,
        items: buildReadiness(load, document, assessment),
        applications: assessment.applications,
        incomplete: assessment.incomplete,
        planned: assessment.planned,
        ready: assessment.ready,
      };
    });
  }

  /** Every pass of one readiness row — the readiness list itself carries only the first few. */
  issueTargets(ctx: Ctx, year: number, code: string): Promise<PsmIssueTargets> {
    return this.db.run(ctx, async (trx) => {
      const { load, document, assessment } = await this.assess(trx, year);
      return issueTargets(load, document, assessment, code);
    });
  }

  attestations(ctx: Ctx): Promise<PsmAttestations> {
    return this.db.run(
      ctx,
      async (trx) =>
        (await loadAttestations(trx)) ?? {
          certificateNumber: null,
          certificateHolder: null,
          certificateValidUntil: null,
          sprayerInspectionNumber: null,
          sprayerInspectedOn: null,
          updatedAt: null,
        },
    );
  }

  saveAttestations(ctx: Ctx, input: Out<typeof PsmAttestationsInput>): Promise<PsmAttestations> {
    return this.db.run(ctx, async (trx) => {
      const values = {
        certificate_number: input.certificateNumber,
        certificate_holder: input.certificateHolder,
        certificate_valid_until: input.certificateValidUntil,
        sprayer_inspection_number: input.sprayerInspectionNumber,
        sprayer_inspected_on: input.sprayerInspectedOn,
        updated_by: ctx.userId,
      };
      await trx
        .insertInto('psm_attestations')
        .values({ organization_id: ctx.orgId, ...values })
        .onConflict((oc) => oc.column('organization_id').doUpdateSet({ ...values, updated_at: new Date().toISOString() }))
        .execute();
      await record(trx, ctx, { entityType: 'organization', entityId: ctx.orgId, action: 'psm_attestations_updated', changes: { ...input } });
      return (await loadAttestations(trx))!;
    });
  }

  /**
   * Generates the record and archives it under Files > Exports; the download is the archived
   * bytes, not a second file. Gaps block the file unless the farmer asks for the record as it
   * stands (`includeIncomplete`); deviations from the approval never do — they belong in the record.
   */
  async generate(ctx: Ctx, year: number, format: 'csv' | 'json', includeIncomplete: boolean): Promise<PsmRecordResult> {
    const { body, applications, incomplete } = await this.db.run(ctx, async (trx) => {
      const { document, assessment } = await this.assess(trx, year);
      if (assessment.applications === 0) throw badRequest('no_applications', `No documented plant-protection applications in ${year}`);
      if (assessment.incomplete > 0 && !includeIncomplete) {
        throw badRequest('record_incomplete', `${assessment.incomplete} applications miss required fields`, { incomplete: assessment.incomplete });
      }
      await record(trx, ctx, {
        entityType: 'organization',
        entityId: ctx.orgId,
        action: 'psm_record_generated',
        changes: { year, format, applications: assessment.applications, incomplete: assessment.incomplete },
      });
      return { body: format === 'csv' ? toCsv(document) : toJson(document), applications: assessment.applications, incomplete: assessment.incomplete };
    });

    const filename = fileName(year, format);
    const mimeType = MIME_TYPES[format];
    // A storage failure never costs the download, but it is said out loud.
    let fileId: string | null = null;
    try {
      fileId = (await this.files.storeGenerated(ctx, 'exports', filename, mimeType, Buffer.from(body, 'utf8'), year)).id;
    } catch (e) {
      this.logger.error(`Archiving ${filename} failed: ${e instanceof Error ? e.message : String(e)}`);
    }
    this.logger.log(`PSM record ${filename} generated (${applications} applications, ${incomplete} incomplete${fileId ? '' : ', not archived'})`);
    return { filename, mimeType, body, archived: fileId != null, fileId };
  }

  /** Records of the year archived in Files > Exports, newest first. */
  history(ctx: Ctx, year: number): Promise<PsmRecordFile[]> {
    return this.db.run(ctx, async (trx) => {
      const rows = await trx
        .selectFrom('files as f')
        .innerJoin('file_folders as d', 'd.id', 'f.folder_id')
        .select(['f.id', 'f.name', 'f.size_bytes', 'f.created_at'])
        .where('d.system_key', '=', 'exports')
        .where('d.deleted_at', 'is', null)
        .where('f.deleted_at', 'is', null)
        .where('f.year', '=', year)
        .where('f.name', 'like', `${FILE_PREFIX}\\_%`)
        .orderBy('f.created_at', 'desc')
        .orderBy('f.id', 'desc')
        .limit(50)
        .execute();
      return rows.map((r) => ({ id: r.id, name: r.name, sizeBytes: Number(r.size_bytes), createdAt: new Date(r.created_at as unknown as string).toISOString() }));
    });
  }
}
