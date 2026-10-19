import type { HarvestRow } from "./writeBack.js";
import { documentedAreaHa, isSingleHarvestEvent, planWriteBack, targetRowForWriteBack } from "./writeBack.js";

const row = (overrides: Partial<HarvestRow> = {}): HarvestRow => ({
  id: "h",
  operationId: "op",
  date: new Date("2026-08-02T00:00:00Z"),
  quantityT: 0,
  areaHa: null,
  ...overrides,
});

describe("isSingleHarvestEvent", () => {
  it("accepts several machines on the same day", () => {
    expect(isSingleHarvestEvent([new Date("2026-08-02T11:57:00Z"), new Date("2026-08-02T15:38:00Z")])).toBe(true);
  });

  it("rejects grassland cuts weeks apart", () => {
    // Documented yields SUM, so writing one merged mean here would replace four cuts with a single number.
    expect(isSingleHarvestEvent([new Date("2026-05-20"), new Date("2026-06-25")])).toBe(false);
  });

  it("treats a single date as one event", () => {
    expect(isSingleHarvestEvent([new Date("2026-08-02")])).toBe(true);
  });
});

describe("documentedAreaHa", () => {
  it("takes the largest harvested area, never the sum", () => {
    // Two combines each report about half the field; summing them would double-count it.
    expect(documentedAreaHa([row({ areaHa: 16 }), row({ areaHa: 14 })], 30)).toBe(16);
  });

  it("falls back to the cultivation area when nothing reports one", () => {
    expect(documentedAreaHa([row(), row()], 30)).toBe(30);
  });

  it("never exceeds the cultivation area", () => {
    expect(documentedAreaHa([row({ areaHa: 44 })], 30)).toBe(30);
  });
});

describe("targetRowForWriteBack", () => {
  it("writes onto the harvest that covered the most ground", () => {
    const big = row({ id: "big", areaHa: 20 });
    const small = row({ id: "small", areaHa: 8 });
    expect(targetRowForWriteBack([small, big])?.id).toBe("big");
  });

  it("breaks ties by the later date", () => {
    const early = row({ id: "early", areaHa: 10, date: new Date("2026-08-01") });
    const late = row({ id: "late", areaHa: 10, date: new Date("2026-08-03") });
    expect(targetRowForWriteBack([early, late])?.id).toBe("late");
  });
});

describe("planWriteBack", () => {
  const base = { cultivationAreaHa: 10, pixelMeanTHa: 8.123, coveredHa: 9.5, hasEventDate: true };

  it("creates a harvest from the map when none is documented", () => {
    expect(planWriteBack({ ...base, rows: [] })).toEqual({ action: "create", quantityT: 77.169, areaHa: 9.5 });
  });

  it("fills a harvest recorded without a quantity", () => {
    expect(planWriteBack({ ...base, rows: [row({ id: "h1", areaHa: 10 })] })).toEqual({ action: "update", harvestId: "h1", quantityT: 81.23, areaHa: 10 });
  });

  it("never overwrites a quantity the farmer documented", () => {
    expect(planWriteBack({ ...base, rows: [row({ quantityT: 75, areaHa: 10 })] })).toEqual({ action: "skip", reason: "already-documented" });
  });

  it("refreshes its own earlier figure when the map is rebuilt", () => {
    const own = row({ id: "mine", quantityT: 70, areaHa: 9.5, yieldRasterId: "old" });
    expect(planWriteBack({ ...base, rows: [own] })).toMatchObject({ action: "update", harvestId: "mine" });
  });

  it("leaves multi-cut and partial maps alone", () => {
    expect(planWriteBack({ ...base, rows: [row({ date: new Date("2026-05-20") }), row({ date: new Date("2026-06-25") })] })).toEqual({ action: "skip", reason: "multi-cut" });
    expect(planWriteBack({ ...base, coveredHa: 3, rows: [row({ areaHa: 10 })] })).toEqual({ action: "skip", reason: "partial-coverage" });
  });

  it("needs a harvest date to create a harvest", () => {
    expect(planWriteBack({ ...base, hasEventDate: false, rows: [] })).toEqual({ action: "skip", reason: "no-date" });
  });
});
