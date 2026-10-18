import { Readable } from 'node:stream';
import { ZipArchive } from 'archiver';
import yauzl from 'yauzl';

/** Limits for unpacking archives, as in the reference app. */
export const ZIP_MAX_ENTRIES = 1000;
export const ZIP_MAX_UNCOMPRESSED_BYTES = 512 * 1024 * 1024;

export class ZipLimitError extends Error {}

export interface ZipEntry {
  /** Path inside the archive with `/` separators, e.g. `Proben/2026/a.csv`. */
  path: string;
  data: Buffer;
}

/** Entries that are never extracted: macOS metadata and path traversal. */
function skipped(path: string): boolean {
  const parts = path.split('/');
  return parts.includes('__MACOSX') || parts.includes('..') || parts.at(-1) === '.DS_Store' || path.startsWith('/');
}

/**
 * Calls `onEntry` for each file of a zip archive, one at a time, so only one entry is in
 * memory. Enforces the entry count and the uncompressed size on declared and actual bytes.
 */
export function forEachZipEntry(buffer: Buffer, onEntry: (entry: ZipEntry) => Promise<void>): Promise<number> {
  return new Promise((resolve, reject) => {
    yauzl.fromBuffer(buffer, { lazyEntries: true, decodeStrings: true, validateEntrySizes: true }, (err, zip) => {
      if (err || !zip) return reject(err ?? new Error('Not a zip archive'));
      let total = 0;
      let count = 0;
      zip.on('error', reject);
      zip.on('end', () => resolve(count));
      zip.on('entry', (entry: yauzl.Entry) => {
        const path = entry.fileName.replace(/\\/g, '/');
        if (path.endsWith('/') || skipped(path)) return zip.readEntry();
        if (++count > ZIP_MAX_ENTRIES) return reject(new ZipLimitError(`More than ${ZIP_MAX_ENTRIES} files in the archive`));
        total += entry.uncompressedSize;
        if (total > ZIP_MAX_UNCOMPRESSED_BYTES) return reject(new ZipLimitError('The archive unpacks to more than 512 MiB'));
        zip.openReadStream(entry, (e, stream) => {
          if (e || !stream) return reject(e ?? new Error('Unreadable zip entry'));
          void toBuffer(stream)
            .then((data) => onEntry({ path, data }))
            .then(() => zip.readEntry(), reject);
        });
      });
      zip.readEntry();
    });
  });
}

/** Streams a zip of the given entries; `open` is called lazily for each entry's content. */
export function writeZip(entries: { path: string; open: () => Promise<Readable> }[], level = 6): Readable {
  const archive = new ZipArchive({ zlib: { level } });
  void (async () => {
    try {
      for (const e of entries) archive.append(await e.open(), { name: e.path });
      await archive.finalize();
    } catch (err) {
      archive.destroy(err as Error);
    }
  })();
  return archive;
}

/** Collects a stream into memory (for small archives that are stored, not streamed). */
export async function toBuffer(stream: Readable): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const c of stream) chunks.push(Buffer.isBuffer(c) ? c : Buffer.from(c as Uint8Array));
  return Buffer.concat(chunks);
}
