/**
 * Just enough PNG and JPEG handling for organization logos: type and size from the header, and
 * the pixel data a PDF image XObject needs (JPEG as is, PNG decoded into RGB plus an alpha mask).
 */
import { deflateSync, inflateSync } from 'node:zlib';

export interface ImageInfo {
  mimeType: 'image/png' | 'image/jpeg';
  width: number;
  height: number;
}

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

/** Type and pixel size of a PNG or JPEG; null for anything else or a broken header. */
export function imageInfo(buf: Buffer): ImageInfo | null {
  if (buf.length > 24 && buf.subarray(0, 8).equals(PNG_SIGNATURE) && buf.toString('latin1', 12, 16) === 'IHDR') {
    const width = buf.readUInt32BE(16);
    const height = buf.readUInt32BE(20);
    return width > 0 && height > 0 ? { mimeType: 'image/png', width, height } : null;
  }
  if (buf.length > 4 && buf[0] === 0xff && buf[1] === 0xd8) {
    const sof = jpegFrame(buf);
    return sof ? { mimeType: 'image/jpeg', width: sof.width, height: sof.height } : null;
  }
  return null;
}

function jpegFrame(buf: Buffer): { width: number; height: number; components: number } | null {
  let i = 2;
  while (i + 9 < buf.length) {
    if (buf[i] !== 0xff) return null;
    const marker = buf[i + 1];
    if (marker === 0xd8 || (marker >= 0xd0 && marker <= 0xd7) || marker === 0x01) {
      i += 2;
      continue;
    }
    const length = buf.readUInt16BE(i + 2);
    // Start of frame: baseline, extended, progressive (not the DHT/JPG/DAC markers C4, C8, CC).
    if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
      return { height: buf.readUInt16BE(i + 5), width: buf.readUInt16BE(i + 7), components: buf[i + 9] };
    }
    i += 2 + length;
  }
  return null;
}

/** Image data for a PDF XObject. */
export interface PdfImage {
  width: number;
  height: number;
  colorSpace: 'DeviceRGB' | 'DeviceGray' | 'DeviceCMYK';
  filter: 'DCTDecode' | 'FlateDecode';
  data: Buffer;
  /** Deflated 8-bit alpha channel, when the image has transparency. */
  alpha?: Buffer;
}

/** PDF image data of a PNG (8-bit, not interlaced) or JPEG; null when the format is not supported. */
export function pdfImage(buf: Buffer): PdfImage | null {
  const info = imageInfo(buf);
  if (!info) return null;
  if (info.mimeType === 'image/jpeg') {
    const frame = jpegFrame(buf)!;
    const colorSpace = frame.components === 1 ? 'DeviceGray' : frame.components === 4 ? 'DeviceCMYK' : 'DeviceRGB';
    return { width: frame.width, height: frame.height, colorSpace, filter: 'DCTDecode', data: buf };
  }
  const png = decodePng(buf);
  if (!png) return null;
  const { width, height, channels, pixels, palette, transparency } = png;
  const rgb = Buffer.alloc(width * height * 3);
  const alpha = Buffer.alloc(width * height);
  let hasAlpha = false;
  for (let p = 0; p < width * height; p++) {
    let r: number, g: number, b: number, a = 255;
    if (palette) {
      const idx = pixels[p];
      r = palette[idx * 3] ?? 0;
      g = palette[idx * 3 + 1] ?? 0;
      b = palette[idx * 3 + 2] ?? 0;
      a = transparency?.[idx] ?? 255;
    } else if (channels <= 2) {
      r = g = b = pixels[p * channels];
      if (channels === 2) a = pixels[p * 2 + 1];
    } else {
      r = pixels[p * channels];
      g = pixels[p * channels + 1];
      b = pixels[p * channels + 2];
      if (channels === 4) a = pixels[p * 4 + 3];
    }
    rgb[p * 3] = r;
    rgb[p * 3 + 1] = g;
    rgb[p * 3 + 2] = b;
    alpha[p] = a;
    if (a !== 255) hasAlpha = true;
  }
  return { width, height, colorSpace: 'DeviceRGB', filter: 'FlateDecode', data: deflateSync(rgb), alpha: hasAlpha ? deflateSync(alpha) : undefined };
}

interface DecodedPng {
  width: number;
  height: number;
  /** Samples per pixel of `pixels` (1 for palette indices). */
  channels: number;
  pixels: Buffer;
  palette?: Buffer;
  transparency?: Buffer;
}

const CHANNELS: Record<number, number> = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 };

export function decodePng(buf: Buffer): DecodedPng | null {
  if (!buf.subarray(0, 8).equals(PNG_SIGNATURE)) return null;
  let offset = 8;
  let width = 0, height = 0, bitDepth = 0, colorType = 0, interlace = 0;
  let palette: Buffer | undefined;
  let transparency: Buffer | undefined;
  const idat: Buffer[] = [];
  while (offset + 8 <= buf.length) {
    const length = buf.readUInt32BE(offset);
    const type = buf.toString('latin1', offset + 4, offset + 8);
    const data = buf.subarray(offset + 8, offset + 8 + length);
    if (type === 'IHDR') {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      bitDepth = data[8];
      colorType = data[9];
      interlace = data[12];
    } else if (type === 'PLTE') palette = Buffer.from(data);
    else if (type === 'tRNS') transparency = Buffer.from(data);
    else if (type === 'IDAT') idat.push(data);
    else if (type === 'IEND') break;
    offset += 12 + length;
  }
  const channels = CHANNELS[colorType];
  if (!width || !height || bitDepth !== 8 || interlace !== 0 || !channels || (colorType === 3 && !palette)) return null;
  let raw: Buffer;
  try {
    raw = inflateSync(Buffer.concat(idat));
  } catch {
    return null;
  }
  const stride = width * channels;
  if (raw.length < height * (stride + 1)) return null;
  const pixels = Buffer.alloc(height * stride);
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)];
    const line = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1));
    const out = pixels.subarray(y * stride, (y + 1) * stride);
    const prev = y > 0 ? pixels.subarray((y - 1) * stride, y * stride) : null;
    for (let x = 0; x < stride; x++) {
      const left = x >= channels ? out[x - channels] : 0;
      const up = prev ? prev[x] : 0;
      const upLeft = prev && x >= channels ? prev[x - channels] : 0;
      let value = line[x];
      if (filter === 1) value += left;
      else if (filter === 2) value += up;
      else if (filter === 3) value += (left + up) >> 1;
      else if (filter === 4) {
        const p = left + up - upLeft;
        const pa = Math.abs(p - left), pb = Math.abs(p - up), pc = Math.abs(p - upLeft);
        value += pa <= pb && pa <= pc ? left : pb <= pc ? up : upLeft;
      } else if (filter !== 0) return null;
      out[x] = value & 0xff;
    }
  }
  // Grey and RGB images with a tRNS colour key are rare for logos; they are drawn opaque.
  return { width, height, channels, pixels, palette, transparency: colorType === 3 ? transparency : undefined };
}
