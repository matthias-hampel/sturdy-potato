import { analogSimilarity } from "./zoneYields.js";

const ROW = { year: 2026, soilTypeLUFA: "sL", management: "m-1", varietyId: "v-1" };

describe("analogSimilarity", () => {
  it("scores a full match 1 and weights the dimensions 0.4/0.25/0.15/0.2", () => {
    const target = { year: 2026, soilTypeLUFA: "sL", management: "m-1", varietyId: "v-1" };
    expect(analogSimilarity(target, ROW)).toBeCloseTo(1);
    expect(analogSimilarity(target, { ...ROW, soilTypeLUFA: "T" })).toBeCloseTo(0.6);
    expect(analogSimilarity(target, { ...ROW, management: "m-2" })).toBeCloseTo(0.75);
  });

  it("ranks by variety when the target names one — the #2331 route dropped this term", () => {
    const target = { year: 2026, soilTypeLUFA: "sL", management: "m-1", varietyId: "v-1" };
    const sameVariety = analogSimilarity(target, ROW);
    const otherVariety = analogSimilarity(target, { ...ROW, varietyId: "v-2" });
    expect(sameVariety).toBeGreaterThan(otherVariety);
    expect(sameVariety - otherVariety).toBeCloseTo(0.15);
  });

  it("does not penalize when a target dimension is unknown", () => {
    const target = { year: 2026, soilTypeLUFA: null, management: null, varietyId: null };
    expect(analogSimilarity(target, ROW)).toBeCloseTo(1);
    expect(analogSimilarity(target, { ...ROW, soilTypeLUFA: "T", varietyId: "v-9" })).toBeCloseTo(1);
  });

  it("fades a season out over the 6-year horizon instead of cutting it off", () => {
    const target = { year: 2026, soilTypeLUFA: "sL", management: "m-1", varietyId: "v-1" };
    expect(analogSimilarity(target, { ...ROW, year: 2023 })).toBeCloseTo(0.9); // 3y: recency 0.5
    expect(analogSimilarity(target, { ...ROW, year: 2019 })).toBeCloseTo(0.8); // 7y: recency 0
    expect(analogSimilarity(target, { ...ROW, year: 2010 })).toBeCloseTo(0.8); // never negative
  });
});
