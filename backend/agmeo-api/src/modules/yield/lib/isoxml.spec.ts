import { TestZip as JSZip } from "./testZip.js";

import { parseYieldPoints } from "./parse.js";

const TASKDATA_XML = `<?xml version="1.0" encoding="UTF-8"?>
<ISO11783_TaskData VersionMajor="4" VersionMinor="2" ManagementSoftwareManufacturer="agmeo" ManagementSoftwareVersion="1" DataTransferOrigin="1">
<TSK A="TSK1" B="Harvest" G="4"><TLG A="TLG00001"/></TSK>
</ISO11783_TaskData>`;

// PTN A/B empty = lat/lon in binary; DLV 0054 = DDI 84 (Mass Per Area Yield, mg/m²), 0063 = DDI 99 (Crop Moisture, ppm)
const TLG_HEADER_XML = `<?xml version="1.0" encoding="UTF-8"?>
<TIM A="" D="4"><PTN A="" B=""/><DLV A="0054" B="" C="DET-1"/><DLV A="0063" B="" C="DET-1"/></TIM>`;

type BinRecord = { lat: number; lon: number; dlvs: [number, number][] };

function buildBinary(records: BinRecord[]): Buffer {
  const size = records.reduce((sum, r) => sum + 4 + 2 + 4 + 4 + 1 + r.dlvs.length * 5, 0);
  const buffer = Buffer.alloc(size);
  let offset = 0;
  let ms = 36_000_000; // 10:00
  for (const record of records) {
    buffer.writeUInt32LE((ms += 1000), offset);
    offset += 4;
    buffer.writeUInt16LE(16_600, offset); // days since 1980
    offset += 2;
    buffer.writeInt32LE(Math.round(record.lat * 1e7), offset);
    offset += 4;
    buffer.writeInt32LE(Math.round(record.lon * 1e7), offset);
    offset += 4;
    buffer.writeUInt8(record.dlvs.length, offset);
    offset += 1;
    for (const [index, value] of record.dlvs) {
      buffer.writeUInt8(index, offset);
      offset += 1;
      buffer.writeInt32LE(value, offset);
      offset += 4;
    }
  }
  return buffer;
}

async function buildTaskDataZip(records: BinRecord[]): Promise<Buffer> {
  const zip = new JSZip();
  zip.file("TASKDATA/TASKDATA.XML", TASKDATA_XML);
  zip.file("TASKDATA/TLG00001.XML", TLG_HEADER_XML);
  zip.file("TASKDATA/TLG00001.BIN", buildBinary(records));
  return zip.generateAsync({ type: "nodebuffer" });
}

describe("ISOXML TaskData yield extraction", () => {
  it("parses TLG time logs: yield via DDI 84, moisture via DDI 99, forward-filled", async () => {
    const zip = await buildTaskDataZip([
      // 800000 mg/m² = 8 t/ha, 650000 ppm = 65% moisture
      {
        lat: 52.0001,
        lon: 10.0001,
        dlvs: [
          [0, 800_000],
          [1, 650_000],
        ],
      },
      // no DLV updates → forward-filled values at the new position
      { lat: 52.0002, lon: 10.0002, dlvs: [] },
      // yield drops to 4 t/ha
      { lat: 52.0003, lon: 10.0003, dlvs: [[0, 400_000]] },
    ]);

    const parsed = await parseYieldPoints(zip);
    expect(parsed.format).toBe("isoxml");
    expect(parsed.attribute).toContain("DDI 84");
    expect(parsed.basis).toBe("wet");
    expect(parsed.points).toHaveLength(3);
    expect(parsed.points.map((p) => p.value)).toEqual([8, 8, 4]);
    expect(parsed.points[0].moisture).toBeCloseTo(65);
    expect(parsed.points[1].moisture).toBeCloseTo(65);
    expect(parsed.moisture?.mean).toBeCloseTo(65);
    expect(parsed.quality.plausible).toBe(true);
    expect(parsed.quality.window).toEqual([1.5, 120]);
    expect(parsed.quality.cappedPoints).toBe(0);
  });

  it("applies the crop window: caps impossible points and flags the mean", async () => {
    const zip = await buildTaskDataZip([
      { lat: 52.0001, lon: 10.0001, dlvs: [[0, 800_000]] }, // 8 t/ha
      { lat: 52.0002, lon: 10.0002, dlvs: [] }, // forward-filled 8 t/ha
      { lat: 52.0003, lon: 10.0003, dlvs: [[0, 400_000]] }, // 4 t/ha
    ]);

    // Grass seeds: window 0.5-2.5 t/ha, per-point cap 5 t/ha → the two
    // 8 t/ha points drop, the 4 t/ha survivor still flags the mean.
    const parsed = await parseYieldPoints(zip, "GRASS_SEEDS");
    expect(parsed.quality.window).toEqual([0.5, 2.5]);
    expect(parsed.quality.cappedPoints).toBe(2);
    expect(parsed.points.map((p) => p.value)).toEqual([4]);
    expect(parsed.quality.plausible).toBe(false);
    expect(parsed.quality.note).toContain("GRASS_SEEDS");
  });

  it("rejects TaskData without a yield DDI", async () => {
    const zip = new JSZip();
    zip.file("TASKDATA/TASKDATA.XML", TASKDATA_XML);
    zip.file(
      "TASKDATA/TLG00001.XML",
      `<?xml version="1.0" encoding="UTF-8"?><TIM A="" D="4"><PTN A="" B=""/><DLV A="0043" B="" C="DET-1"/></TIM>`,
    );
    zip.file("TASKDATA/TLG00001.BIN", buildBinary([{ lat: 52, lon: 10, dlvs: [[0, 5000]] }]));
    const buffer = await zip.generateAsync({ type: "nodebuffer" });
    await expect(parseYieldPoints(buffer)).rejects.toThrow(/no yield channel/);
  });
});
