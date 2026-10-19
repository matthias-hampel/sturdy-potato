import { z } from 'zod';

/** Folders the app writes into; the user can rename, move or delete them like any folder. */
export const SYSTEM_FOLDERS = ['imports', 'exports', 'applicationMaps', 'reports', 'soilImports', 'soilExports', 'yieldMaps', 'fieldDocuments'] as const;
export type SystemFolder = (typeof SYSTEM_FOLDERS)[number];

export interface FileItem {
  id: string;
  folderId: string | null;
  name: string;
  year: number | null;
  description: string | null;
  mimeType: string;
  sizeBytes: number;
  createdAt: string;
  createdByName: string | null;
}

export interface FolderItem {
  id: string;
  parentId: string | null;
  name: string;
  systemKey: string | null;
  createdAt: string;
  /** Direct children (folders and files), not in the trash. */
  itemCount: number;
}

export interface FileListing {
  folders: FolderItem[];
  files: FileItem[];
}

export interface TrashItem {
  kind: 'file' | 'folder';
  id: string;
  name: string;
  deletedAt: string;
  sizeBytes: number;
}

export interface StorageUsage {
  usedBytes: number;
  trashBytes: number;
  limitBytes: number;
  /** ok below 80 %, warn from 80 %, full at or above the limit (uploads are refused). */
  state: 'ok' | 'warn' | 'full';
}

const itemName = z
  .string()
  .trim()
  .min(1)
  .max(255)
  .refine((s) => !/[/\\]/.test(s), 'Must not contain / or \\');

export const CreateFolderInput = z.object({ name: itemName, parentId: z.uuid().nullable().default(null) });
export type CreateFolderInput = z.infer<typeof CreateFolderInput>;

/** Recreates a dropped folder structure: relative paths such as `Proben/2026` under `parentId`. */
export const CreateFolderTreeInput = z.object({
  parentId: z.uuid().nullable().default(null),
  paths: z.array(z.string().min(1).max(2000)).min(1).max(1000),
});
export type CreateFolderTreeInput = z.infer<typeof CreateFolderTreeInput>;

export const UpdateFolderInput = z.object({ name: itemName.optional(), parentId: z.uuid().nullable().optional() });
export type UpdateFolderInput = z.infer<typeof UpdateFolderInput>;

export const UpdateFileInput = z.object({
  name: itemName.optional(),
  year: z.int().min(1900).max(2200).nullable().optional(),
  description: z.string().trim().max(2000).nullable().optional(),
  folderId: z.uuid().nullable().optional(),
});
export type UpdateFileInput = z.infer<typeof UpdateFileInput>;

const ids = z.array(z.uuid()).max(1000).default([]);
export const ItemSelection = z.object({ fileIds: ids, folderIds: ids });
export type ItemSelection = z.infer<typeof ItemSelection>;

export const MoveItemsInput = ItemSelection.extend({ targetFolderId: z.uuid().nullable() });
export type MoveItemsInput = z.infer<typeof MoveItemsInput>;

export const CompressItemsInput = ItemSelection.extend({ targetFolderId: z.uuid().nullable(), year: z.int().min(1900).max(2200).nullable().default(null) });
export type CompressItemsInput = z.infer<typeof CompressItemsInput>;

/** Files that open in the built-in viewers. */
export function fileKind(name: string): 'geo' | 'table' | 'image' | 'pdf' | 'zip' | 'other' {
  const ext = name.toLowerCase().split('.').pop() ?? '';
  if (['shp', 'geojson', 'kml', 'kmz'].includes(ext)) return 'geo';
  if (['csv', 'tsv', 'xlsx'].includes(ext)) return 'table';
  if (['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp'].includes(ext)) return 'image';
  if (ext === 'pdf') return 'pdf';
  if (ext === 'zip') return 'zip';
  return 'other';
}

export const LinkDocumentsInput = z.object({
  fileIds: z.array(z.uuid()).min(1).max(100),
  harvestYear: z.number().int().min(1900).max(2200).nullish(),
});
export type LinkDocumentsInput = z.input<typeof LinkDocumentsInput>;

/** A file attached to a field, optionally for one harvest year. */
export interface FieldDocument extends FileItem {
  harvestYear: number | null;
  linkedAt: string;
}
