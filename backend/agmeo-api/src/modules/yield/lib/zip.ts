import { crc32, deflateRawSync } from 'node:zlib';
import yauzl from 'yauzl';
import type { Readable } from 'node:stream';

/**
 * A zip opened for per-entry reads. Entries are streamed (yauzl), so a large member never has
 * to be inflated in one piece before it is needed; zip64 sizes are read correctly.
 */
export type ZipEntries = {
  names: string[];
  openStream: (name: string) => Promise<Readable>;
  read: (name: string) => Promise<Buffer>;
  close: () => void;
};

export function openZip(buffer: Buffer): Promise<ZipEntries> {
  return new Promise((resolve, reject) => {
    yauzl.fromBuffer(buffer, { lazyEntries: true }, (err, zip) => {
      if (err || !zip) return reject(err ?? new Error('Could not open zip'));
      const entries = new Map<string, yauzl.Entry>();
      zip.on('entry', (entry: yauzl.Entry) => {
        if (!entry.fileName.endsWith('/')) entries.set(entry.fileName, entry);
        zip.readEntry();
      });
      zip.on('error', reject);
      zip.on('end', () => {
        const openStream = (name: string) =>
          new Promise<Readable>((res, rej) => {
            const entry = entries.get(name);
            if (!entry) return rej(new Error(`Zip entry not found: ${name}`));
            zip.openReadStream(entry, (e, stream) => (e || !stream ? rej(e ?? new Error(`Could not open ${name}`)) : res(stream)));
          });
        resolve({
          names: [...entries.keys()],
          openStream,
          read: async (name) => {
            const chunks: Buffer[] = [];
            for await (const chunk of await openStream(name)) chunks.push(chunk as Buffer);
            return Buffer.concat(chunks);
          },
          close: () => zip.close(),
        });
      });
      zip.readEntry();
    });
  });
}

/** A zip of small in-memory files (deflate), synchronously — for generated artefacts and tests. */
export function buildZip(files: Record<string, Buffer | string>): Buffer {
  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let offset = 0;
  for (const [name, content] of Object.entries(files)) {
    const data = Buffer.isBuffer(content) ? content : Buffer.from(content, 'utf8');
    const compressed = deflateRawSync(data);
    const nameBytes = Buffer.from(name, 'utf8');
    const crc = crc32(data);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0x0800, 6); // UTF-8 names
    local.writeUInt16LE(8, 8); // deflate
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(compressed.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(nameBytes.length, 26);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0x0800, 8);
    central.writeUInt16LE(8, 10);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(compressed.length, 20);
    central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(nameBytes.length, 28);
    central.writeUInt32LE(offset, 42);
    locals.push(local, nameBytes, compressed);
    centrals.push(central, nameBytes);
    offset += local.length + nameBytes.length + compressed.length;
  }
  const centralSize = centrals.reduce((s, b) => s + b.length, 0);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(Object.keys(files).length, 8);
  end.writeUInt16LE(Object.keys(files).length, 10);
  end.writeUInt32LE(centralSize, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, ...centrals, end]);
}
