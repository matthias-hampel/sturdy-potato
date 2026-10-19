import { zoneCountForSpread } from "./zonation.js";

/** Measured on flotow1's own rasters, so the thresholds are checked against real fields. */
const raster = (meanTHa: number, q20THa: number, q80THa: number) => ({ meanTHa, q20THa, q80THa });

describe("zoneCountForSpread", () => {
  it("gives a homogeneous field fewer zones than its area alone would", () => {
    // Gielow vorne: 18.3 ha, spread 23.5 % — the area rule would say five.
    expect(zoneCountForSpread(raster(8.77, 7.75, 9.82), 18.3)).toBe(3);
  });

  it("leaves a heterogeneous field at the machine's cap", () => {
    // Dalli: 33.1 ha, spread 42.8 % — supports six, so the cap decides.
    expect(zoneCountForSpread(raster(7.81, 6.16, 9.5), 33.1)).toBe(5);
  });

  it("never exceeds what a machine can apply on a small field", () => {
    // Strunz's spread supports four, but a 12 ha field caps at four anyway.
    expect(zoneCountForSpread(raster(8.0, 6.99, 9.11), 12.0)).toBe(4);
    // Same spread on 3 ha: the area cap of two wins.
    expect(zoneCountForSpread(raster(8.0, 6.99, 9.11), 3.0)).toBe(2);
  });

  it("never drops below two, and falls back to the area rule without quantiles", () => {
    expect(zoneCountForSpread(raster(8.0, 7.99, 8.01), 40)).toBe(2);
    expect(zoneCountForSpread({ meanTHa: 8, q20THa: null, q80THa: null }, 40)).toBe(5);
    expect(zoneCountForSpread({ meanTHa: null, q20THa: 6, q80THa: 9 }, 40)).toBe(5);
  });
});
