import {
  APPLIED_RATE_CHANNELS,
  channelAttribution,
  MG_M2_TO_KG_HA,
  MG_M2_TO_T_HA,
  ML_M2_TO_L_HA,
  MM_TO_M,
  MM3_M2_TO_L_HA,
  MOISTURE_CHANNEL,
  plausibleMoisturePercent,
  PPM_TO_PERCENT,
  SETPOINT_RATE_CHANNELS,
  WORKING_WIDTH_CHANNEL,
  YIELD_CHANNELS,
} from "./channels.js";

const ALL_CHANNELS = [
  ...YIELD_CHANNELS,
  ...APPLIED_RATE_CHANNELS,
  ...SETPOINT_RATE_CHANNELS,
  MOISTURE_CHANNEL,
  WORKING_WIDTH_CHANNEL,
];

describe("working width DDI", () => {
  // Regression. The constant read 43, described as "Actual Working Width [mm]".
  // Decimal 43 is Default Mass Per Time Application Rate [mg/s]; Actual Working
  // Width is decimal 67, which the ISO tables print as hex 0x0043.
  it("is decimal 67 (hex 0x43), not the decimal literal 43", () => {
    expect(WORKING_WIDTH_CHANNEL.ddi).toBe(67);
    expect(WORKING_WIDTH_CHANNEL.ddi).toBe(0x43);
    expect(WORKING_WIDTH_CHANNEL.ddi).not.toBe(43);
  });

  it("converts millimetres to metres", () => {
    expect(3000 * WORKING_WIDTH_CHANNEL.toCanonical).toBeCloseTo(3, 10);
    expect(WORKING_WIDTH_CHANNEL.canonicalUnit).toBe("m");
  });
});

describe("unit conversions", () => {
  // Derived rather than recalled: 1 mg/m² = 1e-6 kg/m², and a hectare is 1e4 m².
  it("takes mg/m² to t/ha and kg/ha consistently", () => {
    expect(MG_M2_TO_T_HA).toBeCloseTo(1e-5, 12);
    expect(MG_M2_TO_KG_HA).toBeCloseTo(1e-2, 12);
    // A 9 t/ha harvest logs 900 000 mg/m².
    expect(900_000 * MG_M2_TO_T_HA).toBeCloseTo(9, 10);
    // 150 kg/ha of fertiliser logs 15 000 mg/m².
    expect(15_000 * MG_M2_TO_KG_HA).toBeCloseTo(150, 10);
  });

  it("keeps the two volume-rate spellings exactly 1000 apart", () => {
    // DDI 2 is mm³/m², DDI 589 is ml/m², and they share a name in the registry.
    expect(ML_M2_TO_L_HA / MM3_M2_TO_L_HA).toBeCloseTo(1000, 9);
    expect(20_000 * MM3_M2_TO_L_HA).toBeCloseTo(200, 10);
    expect(20 * ML_M2_TO_L_HA).toBeCloseTo(200, 10);
  });

  it("takes ppm to percent and mm to m", () => {
    expect(150_000 * PPM_TO_PERCENT).toBeCloseTo(15, 10);
    expect(1000 * MM_TO_M).toBeCloseTo(1, 10);
  });

  it("labels a value with the DDI it came from", () => {
    expect(channelAttribution(MOISTURE_CHANNEL)).toBe("ISOXML DDI 99 (Crop Moisture)");
  });
});

describe("registry shape", () => {
  it("has no duplicate DDI", () => {
    const ddis = ALL_CHANNELS.map((c) => c.ddi);
    expect(new Set(ddis).size).toBe(ddis.length);
  });

  it("gives every channel a positive, finite conversion", () => {
    for (const channel of ALL_CHANNELS) {
      expect(channel.toCanonical).toBeGreaterThan(0);
      expect(Number.isFinite(channel.toCanonical)).toBe(true);
    }
  });

  it("pairs each actual rate with a setpoint in the same unit", () => {
    for (const applied of APPLIED_RATE_CHANNELS) {
      const setpoint = SETPOINT_RATE_CHANNELS.find((s) => s.unit === applied.unit);
      expect(setpoint?.canonicalUnit).toBe(applied.canonicalUnit);
      expect(setpoint?.toCanonical).toBe(applied.toCanonical);
    }
  });

  it("has 11 as the count setpoint and 12 as the actual", () => {
    expect(SETPOINT_RATE_CHANNELS.map((c) => c.ddi)).toContain(11);
    expect(APPLIED_RATE_CHANNELS.map((c) => c.ddi)).toContain(12);
  });
});

describe("harvest channels", () => {
  it("searches 84 wet before 181 dry", () => {
    expect(YIELD_CHANNELS.map(({ ddi, basis }) => ({ ddi, basis }))).toEqual([
      { ddi: 84, basis: "wet" },
      { ddi: 181, basis: "dry" },
    ]);
  });

  it("keeps both yield channels in t/ha", () => {
    for (const channel of YIELD_CHANNELS) {
      expect(channel.canonicalUnit).toBe("t/ha");
      expect(channel.toCanonical).toBe(MG_M2_TO_T_HA);
    }
  });
});

describe("plausibleMoisturePercent", () => {
  it("keeps a real reading and rejects sensor artefacts", () => {
    expect(plausibleMoisturePercent(14.5)).toBe(14.5);
    expect(plausibleMoisturePercent(0)).toBeUndefined();
    expect(plausibleMoisturePercent(100)).toBeUndefined();
    expect(plausibleMoisturePercent(-3)).toBeUndefined();
    expect(plausibleMoisturePercent(undefined)).toBeUndefined();
  });
});
