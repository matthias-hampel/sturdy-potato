import { computeSourceFingerprint } from "./build.js";

const base = {
  pointCount: 120_000,
  bbox4326: [12.9, 53.55, 13.0, 53.56] as [number, number, number, number],
  meanTHa: 8.42,
  basis: "wet",
  format: "mass_per_area",
};

describe("computeSourceFingerprint", () => {
  it("identifies the DATA, so the same harvest delivered twice collides", () => {
    // A JD re-export and a manual upload of the same zip land as two files.
    expect(computeSourceFingerprint(base)).toBe(computeSourceFingerprint({ ...base }));
  });

  it("separates two machines that harvested different parts of the field", () => {
    const other = { ...base, bbox4326: [12.95, 53.55, 13.0, 53.56] as [number, number, number, number] };
    expect(computeSourceFingerprint(other)).not.toBe(computeSourceFingerprint(base));
  });

  it("separates wet from dry and one format from another", () => {
    expect(computeSourceFingerprint({ ...base, basis: "dry" })).not.toBe(computeSourceFingerprint(base));
    expect(computeSourceFingerprint({ ...base, format: "isoxml" })).not.toBe(computeSourceFingerprint(base));
  });

  it("tolerates float noise in the mean and the bbox", () => {
    // Re-parsing the same export must not produce a different fingerprint just
    // because a percentile landed a rounding step away.
    const jittered = {
      ...base,
      meanTHa: 8.4249,
      bbox4326: [12.90001, 53.55001, 13.0, 53.56] as [number, number, number, number],
    };
    expect(computeSourceFingerprint(jittered)).toBe(computeSourceFingerprint(base));
  });

  it("treats a missing mean as its own value rather than throwing", () => {
    expect(computeSourceFingerprint({ ...base, meanTHa: null })).toHaveLength(32);
  });
});
