/**
 * Minimal ustar reader (reference src/lib/dwd/tar.ts): just enough for DWD RV composite
 * archives, which are flat tars of plain files (no long names, no pax headers, no directories).
 */

export interface TarEntry {
  name: string;
  data: Uint8Array;
}

const isZeroBlock = (block: Uint8Array) => block.every((b) => b === 0);

/** The regular files of an uncompressed tar archive. */
export function listTarEntries(raw: Uint8Array): TarEntry[] {
  const entries: TarEntry[] = [];
  let offset = 0;
  while (offset + 512 <= raw.length) {
    const block = raw.subarray(offset, offset + 512);
    if (isZeroBlock(block)) break; // end-of-archive marker
    const name = Buffer.from(block.subarray(0, 100))
      .toString('latin1')
      .replace(/\0[\s\S]*$/, '');
    const sizeField = Buffer.from(block.subarray(124, 136)).toString('latin1');
    const size = parseInt(sizeField.replace(/[^0-7]/g, '') || '0', 8);
    const typeflag = block[156];
    offset += 512;
    // '0' or NUL = regular file; anything else is skipped (past its data).
    if (typeflag === 0x30 || typeflag === 0) entries.push({ name, data: raw.subarray(offset, offset + size) });
    offset += Math.ceil(size / 512) * 512;
  }
  return entries;
}
