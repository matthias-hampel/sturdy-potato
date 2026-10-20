import { deflateSync, inflateSync } from 'node:zlib';
import { PdfDoc } from '../modules/soil/export/pdf.js';
import { decodePng, imageInfo, pdfImage } from './images.js';

function chunk(type: string, data: Buffer) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  return Buffer.concat([len, Buffer.from(type, 'latin1'), data, Buffer.alloc(4)]);
}

/** A 2×2 RGBA PNG; the second row uses the "up" filter. */
function png(): Buffer {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(2, 0);
  ihdr.writeUInt32BE(2, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  const rows = Buffer.from([
    0, 255, 0, 0, 255, 0, 0, 255, 128,
    2, 0, 255, 0, 0, 0, 0, 0, 0,
  ]);
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(rows)), chunk('IEND', Buffer.alloc(0))]);
}

const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x04, 0x00, 0x00, 0xff, 0xc0, 0x00, 0x11, 0x08, 0x00, 0x20, 0x00, 0x40, 0x03, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]);

describe('logo images', () => {
  it('reads type and size of PNG and JPEG', () => {
    expect(imageInfo(png())).toEqual({ mimeType: 'image/png', width: 2, height: 2 })
    expect(imageInfo(jpeg)).toEqual({ mimeType: 'image/jpeg', width: 64, height: 32 })
    expect(imageInfo(Buffer.from('GIF89a......'))).toBeNull()
  })

  it('unfilters PNG rows', () => {
    const decoded = decodePng(png())!
    expect([...decoded.pixels]).toEqual([255, 0, 0, 255, 0, 0, 255, 128, 255, 255, 0, 255, 0, 0, 255, 128])
  })

  it('splits colour and alpha for the PDF and keeps JPEG data as is', () => {
    const img = pdfImage(png())!
    expect([...inflateSync(img.data)]).toEqual([255, 0, 0, 0, 0, 255, 255, 255, 0, 0, 0, 255])
    expect([...inflateSync(img.alpha!)]).toEqual([255, 128, 255, 128])
    expect(pdfImage(jpeg)).toMatchObject({ filter: 'DCTDecode', colorSpace: 'DeviceRGB', width: 64, height: 32 })
  })

  it('places the logo on the page as an image XObject', () => {
    const pdf = new PdfDoc(undefined, { logo: pdfImage(png()) })
    expect(pdf.logo(800, 20, 100, 30)).toBe(30)
    const out = pdf.toBuffer().toString('latin1')
    expect(out).toContain('/XObject << /Logo')
    expect(out).toContain('/SMask')
    expect(new PdfDoc().logo(800, 20, 100, 30)).toBe(0)
  })
})
