/** Splits `report.final.pdf` into `report.final` and `.pdf`; names without an extension keep it empty. */
export function splitExtension(name: string): [string, string] {
  const dot = name.lastIndexOf('.');
  return dot > 0 ? [name.slice(0, dot), name.slice(dot)] : [name, ''];
}

/**
 * `name` if no sibling uses it, else `name (2)`, `name (3)`, … before the extension, as file
 * managers do. Comparison ignores case, so `Bericht.pdf` and `bericht.pdf` do not coexist.
 */
export function nextAvailableName(name: string, taken: Iterable<string>, isFile = true): string {
  const used = new Set([...taken].map((n) => n.toLowerCase()));
  if (!used.has(name.toLowerCase())) return name;
  const [base, ext] = isFile ? splitExtension(name) : [name, ''];
  for (let i = 2; ; i++) {
    const candidate = `${base} (${i})${ext}`;
    if (!used.has(candidate.toLowerCase())) return candidate;
  }
}

/** Replaces characters a stored name may not contain and trims it to a usable length. */
export function cleanName(name: string, fallback = 'file'): string {
  const cleaned = [...name.replace(/[/\\]/g, '_')]
    .filter((c) => c.charCodeAt(0) >= 32)
    .join('')
    .trim()
    .slice(0, 255);
  return cleaned || fallback;
}

/** Content-Disposition value with an ASCII fallback and the UTF-8 name (RFC 6266 / 5987). */
export function contentDisposition(name: string, inline = false): string {
  const ascii = name.replace(/[^\x20-\x7e]/g, '_').replace(/["\\]/g, '_');
  return `${inline ? 'inline' : 'attachment'}; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(name)}`;
}

/** MIME type from the extension, for files that arrive without one (zip entries, drag & drop). */
const MIME_BY_EXT: Record<string, string> = {
  pdf: 'application/pdf',
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  bmp: 'image/bmp',
  tif: 'image/tiff',
  tiff: 'image/tiff',
  csv: 'text/csv',
  tsv: 'text/tab-separated-values',
  txt: 'text/plain',
  md: 'text/markdown',
  json: 'application/json',
  geojson: 'application/geo+json',
  xml: 'application/xml',
  kml: 'application/vnd.google-earth.kml+xml',
  kmz: 'application/vnd.google-earth.kmz',
  zip: 'application/zip',
  shp: 'application/x-esri-shape',
  dbf: 'application/x-dbf',
  shx: 'application/x-shx',
  prj: 'application/x-prj',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  xls: 'application/vnd.ms-excel',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  doc: 'application/msword',
};

export function mimeFromName(name: string, given?: string | null): string {
  if (given && given !== 'application/octet-stream') return given;
  return MIME_BY_EXT[splitExtension(name)[1].slice(1).toLowerCase()] ?? 'application/octet-stream';
}

/** Types the browser may show inline from our origin: raster images and PDF. Everything else downloads. */
export function isSafeInline(mime: string): boolean {
  return (mime.startsWith('image/') && mime !== 'image/svg+xml') || mime === 'application/pdf';
}
