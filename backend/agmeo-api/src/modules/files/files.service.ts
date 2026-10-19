import { randomUUID } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { unlink } from 'node:fs/promises';
import type { Readable } from 'node:stream';
import { Injectable } from '@nestjs/common';
import type {
  CompressItemsInput,
  CreateFolderInput,
  CreateFolderTreeInput,
  FileItem,
  FileListing,
  FolderItem,
  ItemSelection,
  MoveItemsInput,
  StorageUsage,
  SystemFolder,
  TrashItem,
  UpdateFileInput,
  UpdateFolderInput,
} from '@agmeo/contracts';
import { sql } from 'kysely';
import type { Ctx } from '../../auth/context.js';
import { config } from '../../config.js';
import { badRequest, DomainError, notFound } from '../../core/errors.js';
import { record } from '../../core/events.js';
import { iso } from '../../core/mappers.js';
import type { Out } from '../../core/validation.js';
import { Database, type Trx } from '../../db/database.js';
import { enqueue } from '../../jobs/queue.js';
import { ObjectStorage } from '../../storage/object-storage.js';
import { cleanName, mimeFromName, nextAvailableName, splitExtension } from './names.js';
import { forEachZipEntry, toBuffer, writeZip, ZipLimitError } from './zip.js';

export const PURGE_OBJECTS = 'files.purge_objects';

/** A file received by the upload endpoint (multer disk storage). */
export interface IncomingFile {
  path: string;
  size: number;
  mimetype: string;
  name: string;
}

const SYSTEM_FOLDER_NAMES: Record<SystemFolder, { de: string; en: string; parent?: SystemFolder }> = {
  imports: { de: 'Importe', en: 'Imports' },
  exports: { de: 'Exporte', en: 'Exports' },
  applicationMaps: { de: 'Applikationskarten', en: 'Application maps' },
  reports: { de: 'Berichte', en: 'Reports' },
  soilImports: { de: 'Bodenproben-Importe', en: 'Soil imports' },
  soilExports: { de: 'Bodenproben-Exporte', en: 'Soil exports' },
  yieldMaps: { de: 'Ertragskarten', en: 'Yield maps' },
};

const tooLarge = (used: number, limit: number) =>
  new DomainError(413, 'storage_full', 'Storage limit reached', { usedBytes: used, limitBytes: limit });

@Injectable()
export class FilesService {
  constructor(
    private readonly db: Database,
    private readonly storage: ObjectStorage,
  ) {}

  // -------------------------------------------------------------------------
  // Reading
  // -------------------------------------------------------------------------

  /** Contents of a folder (null = top level), or files matching every word of `search` in all folders. */
  listing(ctx: Ctx, folderId: string | null, search?: string): Promise<FileListing> {
    return this.db.run(ctx, async (trx) => {
      if (folderId) await this.liveFolder(trx, folderId);
      const words = (search ?? '').trim().toLowerCase().split(/\s+/).filter(Boolean);
      let files = this.fileQuery(trx);
      if (words.length) {
        for (const w of words) files = files.where(sql<boolean>`position(${w} in lower(f.name)) > 0`);
      } else {
        files = folderId ? files.where('f.folder_id', '=', folderId) : files.where('f.folder_id', 'is', null);
      }
      const folders = words.length ? [] : await this.folderRows(trx, folderId === null ? null : folderId);
      return { folders, files: (await files.orderBy('f.name').limit(5000).execute()).map(toFileItem) };
    });
  }

  /** Every live folder, flat (breadcrumbs, move dialog). */
  folders(ctx: Ctx): Promise<FolderItem[]> {
    return this.db.run(ctx, (trx) => this.folderRows(trx, undefined));
  }

  file(ctx: Ctx, id: string): Promise<FileItem> {
    return this.db.run(ctx, async (trx) => {
      const row = await this.fileQuery(trx).where('f.id', '=', id).executeTakeFirst();
      if (!row) throw notFound('File');
      return toFileItem(row);
    });
  }

  /** Opens a file's content for download or preview. */
  async content(ctx: Ctx, id: string): Promise<{ file: FileItem; stream: Readable }> {
    const { file, key } = await this.db.run(ctx, async (trx) => {
      const row = await this.fileQuery(trx).select('f.storage_key').where('f.id', '=', id).executeTakeFirst();
      if (!row) throw notFound('File');
      return { file: toFileItem(row), key: row.storage_key };
    });
    return { file, stream: await this.storage.get(key) };
  }

  /** A folder and everything below it as one zip, paths relative to the folder. */
  async folderZip(ctx: Ctx, folderId: string): Promise<{ name: string; stream: Readable }> {
    const { folder, entries } = await this.db.run(ctx, async (trx) => {
      const f = await this.liveFolder(trx, folderId);
      return { folder: f, entries: await this.zipEntries(trx, [], [folderId], true) };
    });
    return { name: `${folder.name}.zip`, stream: writeZip(entries.map((e) => ({ path: e.path, open: () => this.storage.get(e.key) }))) };
  }

  async usage(ctx: Ctx): Promise<StorageUsage> {
    return this.db.run(ctx, (trx) => this.usageIn(trx, ctx.orgId));
  }

  trash(ctx: Ctx): Promise<TrashItem[]> {
    return this.db.run(ctx, async (trx) => {
      // Top-level trash items: those whose parent is not itself in the trash.
      const files = await trx
        .selectFrom('files as f')
        .leftJoin('file_folders as p', 'p.id', 'f.folder_id')
        .select(['f.id', 'f.name', 'f.deleted_at', 'f.size_bytes'])
        .where('f.deleted_at', 'is not', null)
        .where((eb) => eb.or([eb('f.folder_id', 'is', null), eb('p.deleted_at', 'is', null)]))
        .execute();
      const folders = await trx
        .selectFrom('file_folders as d')
        .leftJoin('file_folders as p', 'p.id', 'd.parent_id')
        .select(['d.id', 'd.name', 'd.deleted_at'])
        .select((eb) =>
          eb.fn
            .coalesce(
              eb
                .selectFrom('files as x')
                .select(sql<number>`sum(x.size_bytes)`.as('s'))
                .where(sql<boolean>`x.folder_id IN (${this.subtreeSql(sql.ref('d.id'))})`),
              sql<number>`0`,
            )
            .as('size'),
        )
        .where('d.deleted_at', 'is not', null)
        .where((eb) => eb.or([eb('d.parent_id', 'is', null), eb('p.deleted_at', 'is', null)]))
        .execute();
      const items: TrashItem[] = [
        ...folders.map((r) => ({ kind: 'folder' as const, id: r.id, name: r.name, deletedAt: iso(r.deleted_at)!, sizeBytes: Number(r.size) })),
        ...files.map((r) => ({ kind: 'file' as const, id: r.id, name: r.name, deletedAt: iso(r.deleted_at)!, sizeBytes: Number(r.size_bytes) })),
      ];
      return items.sort((a, b) => b.deletedAt.localeCompare(a.deletedAt));
    });
  }

  // -------------------------------------------------------------------------
  // Folders
  // -------------------------------------------------------------------------

  createFolder(ctx: Ctx, input: Out<typeof CreateFolderInput>): Promise<FolderItem> {
    return this.db.run(ctx, async (trx) => {
      if (input.parentId) await this.liveFolder(trx, input.parentId);
      const name = nextAvailableName(input.name, await this.siblingNames(trx, input.parentId), false);
      const row = await trx
        .insertInto('file_folders')
        .values({ organization_id: ctx.orgId, parent_id: input.parentId, name, created_by: ctx.userId })
        .returning('id')
        .executeTakeFirstOrThrow();
      await record(trx, ctx, { entityType: 'file_folder', entityId: row.id, action: 'created', changes: { name } });
      return (await this.folderRows(trx, undefined, [row.id]))[0];
    });
  }

  /**
   * Recreates a dropped folder structure under `parentId` and returns the folder id for each
   * given path. A top-level folder whose name is taken gets a numbered name; everything
   * below it is new.
   */
  createFolderTree(ctx: Ctx, input: Out<typeof CreateFolderTreeInput>): Promise<Record<string, string>> {
    return this.db.run(ctx, async (trx) => {
      if (input.parentId) await this.liveFolder(trx, input.parentId);
      const ids: Record<string, string> = {};
      const taken = await this.siblingNames(trx, input.parentId);
      const sorted = [...new Set(input.paths.map((p) => p.split('/').filter(Boolean).map((s) => cleanName(s, 'folder')).join('/')))]
        .filter(Boolean)
        .sort((a, b) => a.split('/').length - b.split('/').length);
      for (const path of sorted) {
        const segments = path.split('/');
        if (segments.length > 32) throw badRequest('path_too_deep', 'Folder paths may have at most 32 levels');
        let parent = input.parentId;
        let prefix = '';
        for (const [i, segment] of segments.entries()) {
          prefix = prefix ? `${prefix}/${segment}` : segment;
          if (ids[prefix]) {
            parent = ids[prefix];
            continue;
          }
          const name = i === 0 ? nextAvailableName(segment, taken, false) : segment;
          if (i === 0) taken.push(name);
          const row = await trx
            .insertInto('file_folders')
            .values({ organization_id: ctx.orgId, parent_id: parent, name, created_by: ctx.userId })
            .returning('id')
            .executeTakeFirstOrThrow();
          ids[prefix] = row.id;
          parent = row.id;
        }
      }
      // Map the caller's paths, as given, to their folders.
      const out: Record<string, string> = {};
      for (const p of input.paths) {
        const key = p.split('/').filter(Boolean).map((s) => cleanName(s, 'folder')).join('/');
        if (ids[key]) out[p] = ids[key];
      }
      return out;
    });
  }

  updateFolder(ctx: Ctx, id: string, input: Out<typeof UpdateFolderInput>): Promise<FolderItem> {
    return this.db.run(ctx, async (trx) => {
      const folder = await this.liveFolder(trx, id);
      const parentId = input.parentId === undefined ? folder.parent_id : input.parentId;
      if (input.parentId !== undefined) await this.assertMovable(trx, [id], input.parentId);
      let name = input.name ?? folder.name;
      if (parentId !== folder.parent_id || name !== folder.name) {
        name = nextAvailableName(name, await this.siblingNames(trx, parentId, { excludeFolder: id }), false);
      }
      await trx.updateTable('file_folders').set({ name, parent_id: parentId }).where('id', '=', id).execute();
      await record(trx, ctx, { entityType: 'file_folder', entityId: id, action: 'updated', changes: { name, parentId } });
      return (await this.folderRows(trx, undefined, [id]))[0];
    });
  }

  /** The folder for app-written files of a kind, created (or recreated after deletion) on demand. */
  async systemFolder(trx: Trx, ctx: Ctx, key: SystemFolder, locale: 'de' | 'en' = 'de'): Promise<string> {
    const existing = await trx
      .selectFrom('file_folders')
      .select(['id', 'deleted_at'])
      .where('organization_id', '=', ctx.orgId)
      .where('system_key', '=', key)
      .executeTakeFirst();
    if (existing && !existing.deleted_at) return existing.id;
    // A deleted system folder stays in the trash as an ordinary folder; a new one takes the key.
    if (existing) await trx.updateTable('file_folders').set({ system_key: null }).where('id', '=', existing.id).execute();
    const name = nextAvailableName(SYSTEM_FOLDER_NAMES[key][locale], await this.siblingNames(trx, null), false);
    const row = await trx
      .insertInto('file_folders')
      .values({ organization_id: ctx.orgId, parent_id: null, name, system_key: key })
      .returning('id')
      .executeTakeFirstOrThrow();
    return row.id;
  }

  // -------------------------------------------------------------------------
  // Files
  // -------------------------------------------------------------------------

  /**
   * Stores uploaded files in a folder. The whole batch is checked against the storage
   * allowance first; objects are written before the rows, and removed again if the rows
   * cannot be written.
   */
  async upload(ctx: Ctx, folderId: string | null, year: number | null, incoming: IncomingFile[]): Promise<FileItem[]> {
    try {
      if (!incoming.length) throw badRequest('no_files', 'No files in the upload');
      const total = incoming.reduce((s, f) => s + f.size, 0);
      await this.db.run(ctx, async (trx) => {
        if (folderId) await this.liveFolder(trx, folderId);
        await this.assertCapacity(trx, ctx.orgId, total);
      });
      const keys: string[] = [];
      try {
        for (const f of incoming) {
          const key = this.newKey(ctx.orgId);
          await this.storage.put(key, createReadStream(f.path), mimeFromName(f.name, f.mimetype), f.size);
          keys.push(key);
        }
        return await this.db.run(ctx, async (trx) => {
          await this.assertCapacity(trx, ctx.orgId, total);
          const taken = await this.siblingNames(trx, folderId, { files: true });
          const values = incoming.map((f, i) => {
            const name = nextAvailableName(cleanName(f.name), taken);
            taken.push(name);
            return {
              organization_id: ctx.orgId,
              folder_id: folderId,
              name,
              year,
              mime_type: mimeFromName(f.name, f.mimetype),
              size_bytes: f.size,
              storage_key: keys[i],
              created_by: ctx.userId,
            };
          });
          const rows = await trx.insertInto('files').values(values).returning('id').execute();
          for (const r of rows) await record(trx, ctx, { entityType: 'file', entityId: r.id, action: 'uploaded' });
          return (await this.fileQuery(trx).where('f.id', 'in', rows.map((r) => r.id)).execute()).map(toFileItem);
        });
      } catch (e) {
        await Promise.all(keys.map((k) => this.storage.delete(k).catch(() => undefined)));
        throw e;
      }
    } finally {
      await Promise.all(incoming.map((f) => unlink(f.path).catch(() => undefined)));
    }
  }

  /**
   * Stores a file the app generated (export, report, application map) in a system folder.
   * Not limited by the allowance, but it counts towards usage.
   */
  async storeGenerated(ctx: Ctx, folder: SystemFolder, name: string, mimeType: string, data: Buffer, year: number | null = null): Promise<FileItem> {
    const key = this.newKey(ctx.orgId);
    await this.storage.put(key, data, mimeType, data.length);
    try {
      return await this.db.run(ctx, async (trx) => {
        const folderId = await this.systemFolder(trx, ctx, folder);
        const finalName = nextAvailableName(cleanName(name), await this.siblingNames(trx, folderId, { files: true }));
        const row = await trx
          .insertInto('files')
          .values({ organization_id: ctx.orgId, folder_id: folderId, name: finalName, year, mime_type: mimeType, size_bytes: data.length, storage_key: key, created_by: ctx.userId })
          .returning('id')
          .executeTakeFirstOrThrow();
        return toFileItem(await this.fileQuery(trx).where('f.id', '=', row.id).executeTakeFirstOrThrow());
      });
    } catch (e) {
      await this.storage.delete(key).catch(() => undefined);
      throw e;
    }
  }

  updateFile(ctx: Ctx, id: string, input: Out<typeof UpdateFileInput>): Promise<FileItem> {
    return this.db.run(ctx, async (trx) => {
      const file = await trx.selectFrom('files').selectAll().where('id', '=', id).where('deleted_at', 'is', null).executeTakeFirst();
      if (!file) throw notFound('File');
      const folderId = input.folderId === undefined ? file.folder_id : input.folderId;
      if (folderId && folderId !== file.folder_id) await this.liveFolder(trx, folderId);
      let name = input.name ?? file.name;
      if (folderId !== file.folder_id || name !== file.name) name = nextAvailableName(name, await this.siblingNames(trx, folderId, { files: true, excludeFile: id }));
      await trx
        .updateTable('files')
        .set({ name, folder_id: folderId, year: input.year, description: input.description === '' ? null : input.description })
        .where('id', '=', id)
        .execute();
      await record(trx, ctx, { entityType: 'file', entityId: id, action: 'updated', changes: { name, folderId, year: input.year, description: input.description } });
      return toFileItem(await this.fileQuery(trx).where('f.id', '=', id).executeTakeFirstOrThrow());
    });
  }

  /** Moves files and folders into a folder (null = top level). A folder cannot move into itself or below itself. */
  move(ctx: Ctx, input: Out<typeof MoveItemsInput>): Promise<void> {
    return this.db.run(ctx, async (trx) => {
      if (input.targetFolderId) await this.liveFolder(trx, input.targetFolderId);
      await this.assertMovable(trx, input.folderIds, input.targetFolderId);
      const takenFolders = await this.siblingNames(trx, input.targetFolderId);
      for (const id of input.folderIds) {
        const f = await this.liveFolder(trx, id);
        if (f.parent_id === input.targetFolderId) continue;
        const name = nextAvailableName(f.name, takenFolders, false);
        takenFolders.push(name);
        await trx.updateTable('file_folders').set({ parent_id: input.targetFolderId, name }).where('id', '=', id).execute();
      }
      const takenFiles = await this.siblingNames(trx, input.targetFolderId, { files: true });
      const files = await this.liveFiles(trx, input.fileIds);
      for (const f of files) {
        if (f.folder_id === input.targetFolderId) continue;
        const name = nextAvailableName(f.name, takenFiles);
        takenFiles.push(name);
        await trx.updateTable('files').set({ folder_id: input.targetFolderId, name }).where('id', '=', f.id).execute();
      }
    });
  }

  /** Copies files and folder subtrees into a folder; copies get numbered names where they collide. */
  async copy(ctx: Ctx, input: Out<typeof MoveItemsInput>): Promise<void> {
    const plan = await this.db.run(ctx, async (trx) => {
      if (input.targetFolderId) await this.liveFolder(trx, input.targetFolderId);
      await this.assertMovable(trx, input.folderIds, input.targetFolderId);
      const files = await this.liveFiles(trx, input.fileIds);
      const sub = input.folderIds.length ? await this.subtree(trx, input.folderIds) : { folders: [], files: [] };
      const bytes = [...files, ...sub.files].reduce((s, f) => s + Number(f.size_bytes), 0);
      await this.assertCapacity(trx, ctx.orgId, bytes);
      return { files, sub };
    });
    // Copy the objects first; the rows follow in one transaction.
    const newKeys = new Map<string, string>();
    try {
      for (const f of [...plan.files, ...plan.sub.files]) {
        const key = this.newKey(ctx.orgId);
        await this.storage.put(key, await this.storage.get(f.storage_key), f.mime_type, Number(f.size_bytes));
        newKeys.set(f.id, key);
      }
      await this.db.run(ctx, async (trx) => {
        const folderMap = new Map<string, string>();
        const topTaken = await this.siblingNames(trx, input.targetFolderId);
        // Parents before children: subtree() returns folders in breadth-first order.
        for (const f of plan.sub.folders) {
          const isTop = input.folderIds.includes(f.id);
          const parent = isTop ? input.targetFolderId : folderMap.get(f.parent_id!)!;
          const name = isTop ? nextAvailableName(f.name, topTaken, false) : f.name;
          if (isTop) topTaken.push(name);
          const row = await trx
            .insertInto('file_folders')
            .values({ organization_id: ctx.orgId, parent_id: parent, name, created_by: ctx.userId })
            .returning('id')
            .executeTakeFirstOrThrow();
          folderMap.set(f.id, row.id);
        }
        const topFiles = await this.siblingNames(trx, input.targetFolderId, { files: true });
        const rows = [...plan.files, ...plan.sub.files].map((f) => {
          const inCopiedFolder = plan.sub.files.includes(f);
          const name = inCopiedFolder ? f.name : nextAvailableName(f.name, topFiles);
          if (!inCopiedFolder) topFiles.push(name);
          return {
            organization_id: ctx.orgId,
            folder_id: inCopiedFolder ? folderMap.get(f.folder_id!)! : input.targetFolderId,
            name,
            year: f.year,
            description: f.description,
            mime_type: f.mime_type,
            size_bytes: f.size_bytes,
            storage_key: newKeys.get(f.id)!,
            created_by: ctx.userId,
          };
        });
        if (rows.length) await trx.insertInto('files').values(rows).execute();
      });
    } catch (e) {
      await Promise.all([...newKeys.values()].map((k) => this.storage.delete(k).catch(() => undefined)));
      throw e;
    }
  }

  /** Moves files and folder subtrees to the trash. */
  remove(ctx: Ctx, input: Out<typeof ItemSelection>): Promise<void> {
    return this.db.run(ctx, async (trx) => {
      const now = new Date();
      if (input.fileIds.length) {
        await trx.updateTable('files').set({ deleted_at: now }).where('id', 'in', input.fileIds).where('deleted_at', 'is', null).execute();
      }
      if (input.folderIds.length) {
        const ids = await this.subtreeIds(trx, input.folderIds);
        await trx.updateTable('file_folders').set({ deleted_at: now }).where('id', 'in', ids).where('deleted_at', 'is', null).execute();
        await trx.updateTable('files').set({ deleted_at: now }).where('folder_id', 'in', ids).where('deleted_at', 'is', null).execute();
      }
      await record(trx, ctx, { entityType: 'file_folder', entityId: ctx.orgId, action: 'trashed', changes: { files: input.fileIds.length, folders: input.folderIds.length } });
    });
  }

  /** Restores trash items. Items whose folder is gone return to the top level; names are made unique. */
  restore(ctx: Ctx, input: Out<typeof ItemSelection>): Promise<void> {
    return this.db.run(ctx, async (trx) => {
      for (const id of input.folderIds) {
        const f = await trx.selectFrom('file_folders').selectAll().where('id', '=', id).where('deleted_at', 'is not', null).executeTakeFirst();
        if (!f) continue;
        const parentAlive = f.parent_id
          ? !!(await trx.selectFrom('file_folders').select('id').where('id', '=', f.parent_id).where('deleted_at', 'is', null).executeTakeFirst())
          : false;
        const parent = parentAlive ? f.parent_id : null;
        const name = nextAvailableName(f.name, await this.siblingNames(trx, parent), false);
        const ids = await this.subtreeIds(trx, [id], true);
        await trx.updateTable('file_folders').set({ deleted_at: null }).where('id', 'in', ids).execute();
        await trx.updateTable('file_folders').set({ parent_id: parent, name }).where('id', '=', id).execute();
        await trx.updateTable('files').set({ deleted_at: null }).where('folder_id', 'in', ids).where('deleted_at', 'is not', null).execute();
      }
      for (const id of input.fileIds) {
        const f = await trx.selectFrom('files').selectAll().where('id', '=', id).where('deleted_at', 'is not', null).executeTakeFirst();
        if (!f) continue;
        const folderAlive = f.folder_id
          ? !!(await trx.selectFrom('file_folders').select('id').where('id', '=', f.folder_id).where('deleted_at', 'is', null).executeTakeFirst())
          : false;
        const folder = folderAlive ? f.folder_id : null;
        const name = nextAvailableName(f.name, await this.siblingNames(trx, folder, { files: true }));
        await trx.updateTable('files').set({ deleted_at: null, folder_id: folder, name }).where('id', '=', id).execute();
      }
    });
  }

  /** Deletes everything in the trash for good; the objects are removed by a background job. */
  emptyTrash(ctx: Ctx): Promise<{ deleted: number }> {
    return this.db.run(ctx, async (trx) => {
      const files = await trx.deleteFrom('files').where('deleted_at', 'is not', null).returning('storage_key').execute();
      // Children first is not needed: the parent foreign key cascades.
      await trx.deleteFrom('file_folders').where('deleted_at', 'is not', null).execute();
      for (let i = 0; i < files.length; i += 500) {
        await enqueue(trx, { kind: PURGE_OBJECTS, organizationId: ctx.orgId, payload: { keys: files.slice(i, i + 500).map((f) => f.storage_key) } });
      }
      await record(trx, ctx, { entityType: 'file_folder', entityId: ctx.orgId, action: 'trash_emptied', changes: { files: files.length } });
      return { deleted: files.length };
    });
  }

  /** Packs files and folders into one zip stored in `targetFolderId`. */
  async compress(ctx: Ctx, input: Out<typeof CompressItemsInput> & { name: string }): Promise<FileItem> {
    const entries = await this.db.run(ctx, (trx) => this.zipEntries(trx, input.fileIds, input.folderIds, false));
    if (!entries.length) throw badRequest('nothing_to_compress', 'The selection contains no files');
    if (entries.length > 1000) throw badRequest('too_many_files', 'At most 1000 files can be compressed at once');
    const data = await toBuffer(writeZip(entries.map((e) => ({ path: e.path, open: () => this.storage.get(e.key) }))));
    const key = this.newKey(ctx.orgId);
    await this.storage.put(key, data, 'application/zip', data.length);
    try {
      return await this.db.run(ctx, async (trx) => {
        if (input.targetFolderId) await this.liveFolder(trx, input.targetFolderId);
        await this.assertCapacity(trx, ctx.orgId, data.length);
        const name = nextAvailableName(cleanName(input.name.endsWith('.zip') ? input.name : `${input.name}.zip`), await this.siblingNames(trx, input.targetFolderId, { files: true }));
        const row = await trx
          .insertInto('files')
          .values({ organization_id: ctx.orgId, folder_id: input.targetFolderId, name, year: input.year, mime_type: 'application/zip', size_bytes: data.length, storage_key: key, created_by: ctx.userId })
          .returning('id')
          .executeTakeFirstOrThrow();
        return toFileItem(await this.fileQuery(trx).where('f.id', '=', row.id).executeTakeFirstOrThrow());
      });
    } catch (e) {
      await this.storage.delete(key).catch(() => undefined);
      throw e;
    }
  }

  /** Unpacks a zip into a new sibling folder named after it; the files inherit the zip's year. */
  async extract(ctx: Ctx, id: string): Promise<FolderItem> {
    const zip = await this.db.run(ctx, async (trx) => {
      const f = await trx.selectFrom('files').selectAll().where('id', '=', id).where('deleted_at', 'is', null).executeTakeFirst();
      if (!f) throw notFound('File');
      return f;
    });
    const buffer = await toBuffer(await this.storage.get(zip.storage_key));
    const written: { path: string; key: string; size: number }[] = [];
    try {
      await forEachZipEntry(buffer, async (entry) => {
        const key = this.newKey(ctx.orgId);
        await this.storage.put(key, entry.data, mimeFromName(entry.path), entry.data.length);
        written.push({ path: entry.path, key, size: entry.data.length });
      });
    } catch (e) {
      await Promise.all(written.map((w) => this.storage.delete(w.key).catch(() => undefined)));
      if (e instanceof ZipLimitError) throw new DomainError(413, 'zip_too_large', e.message);
      throw badRequest('invalid_zip', 'The file is not a readable zip archive');
    }
    try {
      return await this.db.run(ctx, async (trx) => {
        await this.assertCapacity(trx, ctx.orgId, written.reduce((s, w) => s + w.size, 0));
        const rootName = nextAvailableName(splitExtension(zip.name)[0], await this.siblingNames(trx, zip.folder_id), false);
        const root = await trx
          .insertInto('file_folders')
          .values({ organization_id: ctx.orgId, parent_id: zip.folder_id, name: rootName, created_by: ctx.userId })
          .returning('id')
          .executeTakeFirstOrThrow();
        const folders = new Map<string, string>([['', root.id]]);
        const ensure = async (dir: string): Promise<string> => {
          const known = folders.get(dir);
          if (known) return known;
          const parentDir = dir.includes('/') ? dir.slice(0, dir.lastIndexOf('/')) : '';
          const parent = await ensure(parentDir);
          const row = await trx
            .insertInto('file_folders')
            .values({ organization_id: ctx.orgId, parent_id: parent, name: cleanName(dir.split('/').pop()!, 'folder'), created_by: ctx.userId })
            .returning('id')
            .executeTakeFirstOrThrow();
          folders.set(dir, row.id);
          return row.id;
        };
        const takenByFolder = new Map<string, string[]>();
        const rows = [];
        for (const w of written) {
          const dir = w.path.includes('/') ? w.path.slice(0, w.path.lastIndexOf('/')) : '';
          const folderId = await ensure(dir);
          const taken = takenByFolder.get(folderId) ?? [];
          const name = nextAvailableName(cleanName(w.path.split('/').pop()!), taken);
          taken.push(name);
          takenByFolder.set(folderId, taken);
          rows.push({ organization_id: ctx.orgId, folder_id: folderId, name, year: zip.year, mime_type: mimeFromName(name), size_bytes: w.size, storage_key: w.key, created_by: ctx.userId });
        }
        for (let i = 0; i < rows.length; i += 500) await trx.insertInto('files').values(rows.slice(i, i + 500)).execute();
        return (await this.folderRows(trx, undefined, [root.id]))[0];
      });
    } catch (e) {
      await Promise.all(written.map((w) => this.storage.delete(w.key).catch(() => undefined)));
      throw e;
    }
  }

  // -------------------------------------------------------------------------
  // Helpers
  // -------------------------------------------------------------------------

  private newKey(orgId: string) {
    return `orgs/${orgId}/files/${randomUUID()}`;
  }

  private fileQuery(trx: Trx) {
    return trx
      .selectFrom('files as f')
      .leftJoin('users as u', 'u.id', 'f.created_by')
      .select(['f.id', 'f.folder_id', 'f.name', 'f.year', 'f.description', 'f.mime_type', 'f.size_bytes', 'f.created_at', 'u.display_name'])
      .where('f.deleted_at', 'is', null);
  }

  /** Live folders: children of `parentId` (null = top level), all when undefined, or the given ids. */
  private async folderRows(trx: Trx, parentId: string | null | undefined, ids?: string[]): Promise<FolderItem[]> {
    let q = trx
      .selectFrom('file_folders as d')
      .select(['d.id', 'd.parent_id', 'd.name', 'd.system_key', 'd.created_at'])
      .select((eb) => [
        eb
          .selectFrom('file_folders as c')
          .select(sql<number>`count(*)`.as('n'))
          .whereRef('c.parent_id', '=', 'd.id')
          .where('c.deleted_at', 'is', null)
          .as('folder_count'),
        eb
          .selectFrom('files as x')
          .select(sql<number>`count(*)`.as('n'))
          .whereRef('x.folder_id', '=', 'd.id')
          .where('x.deleted_at', 'is', null)
          .as('file_count'),
      ])
      .where('d.deleted_at', 'is', null);
    if (ids) q = q.where('d.id', 'in', ids);
    else if (parentId === null) q = q.where('d.parent_id', 'is', null);
    else if (parentId) q = q.where('d.parent_id', '=', parentId);
    const rows = await q.orderBy('d.name').execute();
    return rows.map((r) => ({
      id: r.id,
      parentId: r.parent_id,
      name: r.name,
      systemKey: r.system_key,
      createdAt: iso(r.created_at)!,
      itemCount: Number(r.folder_count ?? 0) + Number(r.file_count ?? 0),
    }));
  }

  private async liveFolder(trx: Trx, id: string) {
    const f = await trx.selectFrom('file_folders').selectAll().where('id', '=', id).where('deleted_at', 'is', null).executeTakeFirst();
    if (!f) throw notFound('Folder');
    return f;
  }

  private liveFiles(trx: Trx, ids: string[]) {
    if (!ids.length) return Promise.resolve([]);
    return trx.selectFrom('files').selectAll().where('id', 'in', ids).where('deleted_at', 'is', null).execute();
  }

  private async siblingNames(trx: Trx, parentId: string | null, opts: { files?: boolean; excludeFile?: string; excludeFolder?: string } = {}): Promise<string[]> {
    if (opts.files) {
      let q = trx.selectFrom('files').select('name').where('deleted_at', 'is', null);
      q = parentId ? q.where('folder_id', '=', parentId) : q.where('folder_id', 'is', null);
      if (opts.excludeFile) q = q.where('id', '<>', opts.excludeFile);
      return (await q.execute()).map((r) => r.name);
    }
    let q = trx.selectFrom('file_folders').select('name').where('deleted_at', 'is', null);
    q = parentId ? q.where('parent_id', '=', parentId) : q.where('parent_id', 'is', null);
    if (opts.excludeFolder) q = q.where('id', '<>', opts.excludeFolder);
    return (await q.execute()).map((r) => r.name);
  }

  private subtreeSql(root: ReturnType<typeof sql.ref>) {
    return sql`WITH RECURSIVE t(id) AS (SELECT ${root}::uuid UNION ALL SELECT c.id FROM file_folders c JOIN t ON c.parent_id = t.id) SELECT id FROM t`;
  }

  /** Ids of the given folders and all folders below them; live ones only unless `includeDeleted`. */
  private async subtreeIds(trx: Trx, roots: string[], includeDeleted = false): Promise<string[]> {
    const { rows } = await sql<{ id: string }>`
      WITH RECURSIVE t(id) AS (
        SELECT id FROM file_folders WHERE id = ANY(${roots}::uuid[])
        UNION ALL
        SELECT c.id FROM file_folders c JOIN t ON c.parent_id = t.id
        WHERE ${includeDeleted ? sql`true` : sql`c.deleted_at IS NULL`}
      ) SELECT id FROM t`.execute(trx);
    return rows.map((r) => r.id);
  }

  /** Live folders below the roots (breadth-first, roots included) and their live files. */
  private async subtree(trx: Trx, roots: string[]) {
    const ids = await this.subtreeIds(trx, roots);
    const folders = await trx.selectFrom('file_folders').selectAll().where('id', 'in', ids).where('deleted_at', 'is', null).execute();
    const depth = new Map<string, number>();
    const byId = new Map(folders.map((f) => [f.id, f]));
    const d = (id: string): number => depth.get(id) ?? (depth.set(id, roots.includes(id) ? 0 : d(byId.get(id)!.parent_id!) + 1), depth.get(id)!);
    folders.sort((a, b) => d(a.id) - d(b.id));
    const files = await trx.selectFrom('files').selectAll().where('folder_id', 'in', ids).where('deleted_at', 'is', null).execute();
    return { folders, files };
  }

  /** Zip entries for a selection: folder contents keep their paths below the folder (with its name unless `relative`). */
  private async zipEntries(trx: Trx, fileIds: string[], folderIds: string[], relative: boolean) {
    const entries: { path: string; key: string }[] = [];
    const used = new Set<string>();
    const add = (path: string, key: string) => {
      const [base, ext] = splitExtension(path);
      let p = path;
      for (let i = 2; used.has(p.toLowerCase()); i++) p = `${base} (${i})${ext}`;
      used.add(p.toLowerCase());
      entries.push({ path: p, key });
    };
    for (const f of await this.liveFiles(trx, fileIds)) add(f.name, f.storage_key);
    if (folderIds.length) {
      for (const root of folderIds) {
        const sub = await this.subtree(trx, [root]);
        const byId = new Map(sub.folders.map((f) => [f.id, f]));
        const pathOf = (id: string): string => {
          const f = byId.get(id)!;
          if (f.id === root) return relative ? '' : f.name;
          const parent = pathOf(f.parent_id!);
          return parent ? `${parent}/${f.name}` : f.name;
        };
        for (const f of sub.files) {
          const dir = pathOf(f.folder_id!);
          add(dir ? `${dir}/${f.name}` : f.name, f.storage_key);
        }
      }
    }
    return entries;
  }

  private async assertMovable(trx: Trx, folderIds: string[], target: string | null) {
    if (!target || !folderIds.length) return;
    const below = await this.subtreeIds(trx, folderIds);
    if (below.includes(target)) throw badRequest('invalid_move', 'A folder cannot be moved into itself or one of its subfolders');
  }

  private async usageIn(trx: Trx, orgId: string): Promise<StorageUsage> {
    const row = await trx
      .selectFrom('files')
      .select([
        sql<number>`coalesce(sum(size_bytes) FILTER (WHERE deleted_at IS NULL), 0)`.as('used'),
        sql<number>`coalesce(sum(size_bytes) FILTER (WHERE deleted_at IS NOT NULL), 0)`.as('trash'),
      ])
      .where('organization_id', '=', orgId)
      .executeTakeFirstOrThrow();
    const org = await trx.selectFrom('organizations').select('storage_limit_bytes').where('id', '=', orgId).executeTakeFirstOrThrow();
    const limit = org.storage_limit_bytes != null ? Number(org.storage_limit_bytes) : config.storage.defaultLimitBytes;
    const used = Number(row.used);
    return { usedBytes: used, trashBytes: Number(row.trash), limitBytes: limit, state: used >= limit ? 'full' : used >= 0.8 * limit ? 'warn' : 'ok' };
  }

  private async assertCapacity(trx: Trx, orgId: string, adding: number) {
    const u = await this.usageIn(trx, orgId);
    if (u.usedBytes + adding > u.limitBytes) throw tooLarge(u.usedBytes, u.limitBytes);
  }
}

type FileRow = {
  id: string;
  folder_id: string | null;
  name: string;
  year: number | null;
  description: string | null;
  mime_type: string;
  size_bytes: number | string;
  created_at: Date;
  display_name: string | null;
};

function toFileItem(r: FileRow): FileItem {
  return {
    id: r.id,
    folderId: r.folder_id,
    name: r.name,
    year: r.year,
    description: r.description,
    mimeType: r.mime_type,
    sizeBytes: Number(r.size_bytes),
    createdAt: iso(r.created_at)!,
    createdByName: r.display_name,
  };
}
