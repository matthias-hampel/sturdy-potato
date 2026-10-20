import { Injectable } from '@nestjs/common';
import type { FieldDocument, LinkDocumentsInput } from '@agmeo/contracts';
import type { Ctx } from '../../auth/context.js';
import { notFound } from '../../core/errors.js';
import { record } from '../../core/events.js';
import { iso } from '../../core/mappers.js';
import type { Out } from '../../core/validation.js';
import { Database, type Trx } from '../../db/database.js';
import { FilesService, type IncomingFile } from '../files/files.service.js';

/** Files attached to a field (agmeo: documents of a cultivation), stored in the "Field documents" folder. */
@Injectable()
export class FieldDocumentsService {
  constructor(
    private readonly db: Database,
    private readonly files: FilesService,
  ) {}

  list(ctx: Ctx, fieldId: string, harvestYear?: number): Promise<FieldDocument[]> {
    return this.db.run(ctx, async (trx) => {
      await this.requireField(trx, fieldId);
      return this.listIn(trx, fieldId, harvestYear);
    });
  }

  /** Uploads files into the field documents folder and attaches them to the field. */
  async upload(ctx: Ctx, fieldId: string, harvestYear: number | null, incoming: IncomingFile[]): Promise<FieldDocument[]> {
    const folderId = await this.db.run(ctx, async (trx) => {
      await this.requireField(trx, fieldId);
      return this.files.systemFolder(trx, ctx, 'fieldDocuments');
    });
    const stored = await this.files.upload(ctx, folderId, harvestYear, incoming);
    return this.link(ctx, fieldId, { fileIds: stored.map((f) => f.id), harvestYear });
  }

  /** Attaches files already in the file store. */
  link(ctx: Ctx, fieldId: string, input: Out<typeof LinkDocumentsInput>): Promise<FieldDocument[]> {
    return this.db.run(ctx, async (trx) => {
      await this.requireField(trx, fieldId);
      const live = await this.files.items(trx, input.fileIds);
      if (live.length !== new Set(input.fileIds).size) throw notFound('File');
      await trx
        .insertInto('field_documents')
        .values(live.map((f) => ({ organization_id: ctx.orgId, field_id: fieldId, file_id: f.id, harvest_year: input.harvestYear ?? null, created_by: ctx.userId })))
        .onConflict((oc) => oc.columns(['field_id', 'file_id']).doUpdateSet({ harvest_year: input.harvestYear ?? null }))
        .execute();
      await record(trx, ctx, { entityType: 'field', entityId: fieldId, action: 'documents_linked', changes: { fileIds: input.fileIds } });
      const linked = new Set(input.fileIds);
      return (await this.listIn(trx, fieldId)).filter((d) => linked.has(d.id));
    });
  }

  /**
   * Detaches a file. A file uploaded here and attached nowhere else goes to the trash with it
   * (the reference deletes the document); one attached elsewhere or filed by hand stays.
   */
  async unlink(ctx: Ctx, fieldId: string, fileId: string): Promise<void> {
    const trash = await this.db.run(ctx, async (trx) => {
      const res = await trx.deleteFrom('field_documents').where('field_id', '=', fieldId).where('file_id', '=', fileId).executeTakeFirst();
      if (!res.numDeletedRows) throw notFound('Document');
      await record(trx, ctx, { entityType: 'field', entityId: fieldId, action: 'document_unlinked', changes: { fileId } });
      const others = await trx.selectFrom('field_documents').select('field_id').where('file_id', '=', fileId).executeTakeFirst();
      if (others) return false;
      const folder = await trx
        .selectFrom('files as f')
        .innerJoin('file_folders as d', 'd.id', 'f.folder_id')
        .select('d.system_key')
        .where('f.id', '=', fileId)
        .executeTakeFirst();
      return folder?.system_key === 'fieldDocuments';
    });
    if (trash) await this.files.remove(ctx, { fileIds: [fileId], folderIds: [] });
  }

  private async listIn(trx: Trx, fieldId: string, harvestYear?: number): Promise<FieldDocument[]> {
    let q = trx.selectFrom('field_documents').select(['file_id', 'harvest_year', 'created_at']).where('field_id', '=', fieldId);
    // A year shows its own documents and those kept for the field as a whole.
    if (harvestYear != null) q = q.where((eb) => eb.or([eb('harvest_year', '=', harvestYear), eb('harvest_year', 'is', null)]));
    const links = await q.execute();
    const byId = new Map((await this.files.items(trx, links.map((l) => l.file_id))).map((f) => [f.id, f]));
    return links
      .filter((l) => byId.has(l.file_id))
      .map((l) => ({ ...byId.get(l.file_id)!, harvestYear: l.harvest_year, linkedAt: iso(l.created_at) }))
      .sort((a, b) => b.linkedAt.localeCompare(a.linkedAt) || a.name.localeCompare(b.name));
  }

  private async requireField(trx: Trx, fieldId: string) {
    const field = await trx.selectFrom('fields').select('id').where('id', '=', fieldId).executeTakeFirst();
    if (!field) throw notFound('Field');
  }
}
