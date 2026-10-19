import { unzip } from 'but-unzip'

/** One file of an upload, with ZIP archives (also nested ones) expanded. */
export interface SourceFile {
  /** The uploaded file's name, then the path inside the archive: `a.zip/TASKDATA/TASKDATA.XML`. */
  path: string
  name: string
  data: Uint8Array
}

export const extension = (f: { name: string }) => f.name.slice(f.name.lastIndexOf('.') + 1).toLowerCase()
export const stem = (f: { path: string }) => f.path.slice(0, f.path.lastIndexOf('.')).toLowerCase()
/** The uploaded file a source file came from. */
export const upload = (f: { path: string }) => f.path.split('/')[0]
export const decode =(data: Uint8Array, encoding = 'utf-8') => new TextDecoder(encoding).decode(data)

async function expand(path: string, data: Uint8Array, depth: number): Promise<SourceFile[]> {
  const name = path.split('/').pop() ?? path
  if (!name.toLowerCase().endsWith('.zip') || depth > 2) return [{ path, name, data }]
  const out: SourceFile[] = []
  for (const item of unzip(data)) {
    if (item.filename.endsWith('/') || item.filename.includes('__MACOSX') || item.filename.split('/').pop()!.startsWith('._')) continue
    // Archives often share inner paths (every ISO-XML export has TASKDATA/TASKDATA.XML), so keep them apart.
    out.push(...(await expand(`${path}/${item.filename}`, await item.read(), depth + 1)))
  }
  return out
}

/** Reads the chosen files; ZIP archives are unpacked so the parsers see the files inside. */
export async function collectFiles(files: File[]): Promise<SourceFile[]> {
  const out: SourceFile[] = []
  for (const f of files) out.push(...(await expand(f.name, new Uint8Array(await f.arrayBuffer()), 0)))
  return out
}
