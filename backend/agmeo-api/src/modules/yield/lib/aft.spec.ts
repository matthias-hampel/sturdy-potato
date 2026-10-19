import { TestZip as JSZip } from "./testZip.js";

import { extractAftYieldPoints } from "./aft.js";
import { parseYieldPoints } from "./parse.js";

const HEADER =
  "AGRO-MAP.AFT,VERSION 01.03,01,702,Reinshof,Schlag 1,W- Gerste,,,NEIN," +
  ";;Ertrag;;;;;Used Satellites;;;Kornfeuchte W- Gerste;Höhe;,0,101-00,2030;9.50;,";

// [0] lat, [1] lon, [2] t/ha, [3] HHMMSS, [9] date, [10] moisture — the
// column layout of the real Reinshof exports.
const row = (lat: number, lon: number, yld: number, hhmmss: string, moist: string) =>
  `N0${lat.toFixed(5)},E00${lon.toFixed(5)},${yld.toFixed(3)},0${hhmmss},03.3,0,1,4,0,14.07.10,${moist},00000,0000,1.000,`;

// Two passes 12 m apart (no overlap), values around the barley window mean.
const filePart = (startSecond: number, latOffset: number, yld: number) =>
  [
    HEADER,
    ...Array.from({ length: 6 }, (_, i) =>
      row(51.492 + latOffset, 9.929 + i * 0.0002, yld + i * 0.01, String(120000 + startSecond + i), "15.0"),
    ),
  ].join("\r\n") + "\r\n";

describe("AGRO-MAP .aft yield import", () => {
  it("parses a zip of .aft parts, merging members along the harvest timeline", async () => {
    const zip = new JSZip();
    zip.file("10071600.aft", filePart(0, 0, 9.4));
    zip.file("10071601.aft", filePart(30, 0.0001, 9.6));
    const buffer = await zip.generateAsync({ type: "nodebuffer" });

    const parsed = await parseYieldPoints(buffer, "GERSTE");

    expect(parsed.format).toBe("aft");
    expect(parsed.basis).toBe("wet");
    expect(parsed.attribute).toBe("AGRO-MAP AFT yield (W-Gerste, Schlag 1)");
    expect(parsed.totalFeatures).toBe(12);
    expect(parsed.points).toHaveLength(12);
    expect(parsed.quality.plausible).toBe(true);
    expect(parsed.quality.meanRate).toBeCloseTo(9.53, 1);
    expect(parsed.moisture?.mean).toBeCloseTo(15, 1);
  });

  it("parses a bare .aft file without a zip wrapper", async () => {
    const parsed = await parseYieldPoints(Buffer.from(filePart(0, 0, 9.5), "utf-8"), "GERSTE");
    expect(parsed.format).toBe("aft");
    expect(parsed.points).toHaveLength(6);
  });

  it("counts zero-yield rows in totalFeatures but not in points, and drops 0 % moisture", async () => {
    const text =
      [HEADER, row(51.492, 9.929, 0, "120000", "00.0"), row(51.4921, 9.9291, 9.5, "120001", "00.0")].join("\r\n") +
      "\r\n";
    const parsed = await parseYieldPoints(Buffer.from(text, "utf-8"), "GERSTE");
    expect(parsed.totalFeatures).toBe(2);
    expect(parsed.points).toHaveLength(1);
    expect(parsed.points[0].moisture).toBeUndefined();
  });

  it("merges a season-sized export without overflowing the call stack", () => {
    // A real 15 MB Lexion export carries ~716 000 records. Merging them with
    // `push(...records)` spread them as call arguments and threw "Maximum call
    // stack size exceeded"; the row count here is far past that limit.
    const clock = (i: number) => {
      const s = i % 86_400;
      const pad = (n: number) => String(n).padStart(2, "0");
      return `${pad(Math.floor(s / 3600))}${pad(Math.floor((s % 3600) / 60))}${pad(s % 60)}`;
    };
    const rows = Array.from({ length: 200_000 }, (_, i) => row(51.492 + i * 0.000001, 9.929, 8.2, clock(i), "15.0"));
    const extract = extractAftYieldPoints([[HEADER, ...rows].join("\r\n") + "\r\n"]);
    expect(extract.totalRecords).toBe(200_000);
    expect(extract.points).toHaveLength(200_000);
  });

  it("carries the logged harvest time on every point, not the upload date", async () => {
    // The row template is dated 14.07.10. A 2010 archive imported today must
    // carry 2010 timestamps — the track filters and any window derivation read
    // `t`, and matching against the current year would find no cultivation.
    const parsed = await parseYieldPoints(Buffer.from(filePart(0, 0, 9.5), "utf-8"), "GERSTE");
    const years = [...new Set(parsed.points.map((p) => new Date(p.t!).getUTCFullYear()))];
    expect(years).toEqual([2010]);
  });

  it("reports every season of a multi-year archive", () => {
    const seasons = ["14.07.10", "20.07.11", "18.07.11"].map((date, i) =>
      [HEADER, row(51.492 + i * 0.001, 9.929, 9.5, String(120000 + i), "15.0").replace("14.07.10", date)].join("\r\n"),
    );
    const extract = extractAftYieldPoints(seasons);
    expect(extract.times).toHaveLength(3);
    const years = [...new Set(extract.times.map((t) => new Date(t).getUTCFullYear()))].sort((a, b) => a - b);
    expect(years).toEqual([2010, 2011]);
  });

  // AGRO-MAP writes latin1, not UTF-8. These fixtures are encoded as latin1
  // bytes (unlike the ones above, which reach the parser as UTF-8 via
  // Buffer.from(..., "utf-8") / JSZip's string encoding), so they exercise the
  // real on-disk encoding — a UTF-8 decode turns every umlaut into U+FFFD.
  it("decodes latin1 umlauts in a bare .aft header", async () => {
    const text = filePart(0, 0, 9.5).replace("Schlag 1", "Schlag Ölmühle");
    const parsed = await parseYieldPoints(Buffer.from(text, "latin1"), "GERSTE");
    expect(parsed.attribute).toBe("AGRO-MAP AFT yield (W-Gerste, Schlag Ölmühle)");
  });

  it("decodes latin1 umlauts in zipped .aft members", async () => {
    const text = filePart(0, 0, 9.5).replace("Schlag 1", "Schlag Ölmühle");
    const zip = new JSZip();
    zip.file("10071600.aft", Buffer.from(text, "latin1"));
    const buffer = await zip.generateAsync({ type: "nodebuffer" });

    const parsed = await parseYieldPoints(buffer, "GERSTE");
    expect(parsed.attribute).toBe("AGRO-MAP AFT yield (W-Gerste, Schlag Ölmühle)");
  });

  it("rejects an .aft file without positive yield values", async () => {
    const text = [HEADER, row(51.492, 9.929, 0, "120000", "15.0")].join("\r\n") + "\r\n";
    await expect(parseYieldPoints(Buffer.from(text, "utf-8"), "GERSTE")).rejects.toThrow(
      /no positive yield points/,
    );
  });
});
