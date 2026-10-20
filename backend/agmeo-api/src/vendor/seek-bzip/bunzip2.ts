import Bunzip from './index.js';

/** Decompresses a whole bzip2 buffer (first stream, as the reference). */
export function bunzip2(input: Uint8Array): Uint8Array {
  return (Bunzip as unknown as { decode(input: Uint8Array, output?: null, multistream?: boolean): Uint8Array }).decode(input);
}
