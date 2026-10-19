import { bbchToBd, getCropGsParams } from './bbchModel.js';
import { calibrateBbch, runBbchModel } from './bbchSnapshot.js';

const addDays = (d: string, n: number) => new Date(Date.parse(`${d}T12:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
/** Mild autumn into spring, enough to carry winter wheat through tillering into stem elongation. */
function weather(from: string, days: number) {
  const out: Record<string, { tempMin: number; tempMax: number }> = {};
  for (let i = 0; i < days; i++) {
    const t = 9 + 7 * Math.cos(((i - 280) / 365) * 2 * Math.PI);
    out[addDays(from, i)] = { tempMin: t - 4, tempMax: t + 4 };
  }
  return out;
}

const sowing = '2025-10-10';
const today = '2026-04-20';
const w = weather('2025-09-01', 300);

describe('BBCH snapshot', () => {
  const run = runBbchModel({ weather: w, crop: 'winterWheat', latitude: 51.5, sowingDate: sowing, today })!;

  it('runs from sowing to seven days past today', () => {
    expect(run.dates[0]).toBe(sowing);
    expect(run.dates[run.dates.length - 1]).toBe(addDays(today, 7));
    expect(run.bbch[run.bbch.length - 1]).toBeGreaterThan(20);
  });

  it('has no run without sowing, before sowing, or for crops without parameters', () => {
    expect(runBbchModel({ weather: w, crop: 'winterWheat', latitude: 51.5, sowingDate: null, today })).toBeNull();
    expect(runBbchModel({ weather: w, crop: 'winterWheat', latitude: 51.5, sowingDate: '2026-05-01', today })).toBeNull();
    expect(runBbchModel({ weather: w, crop: null, latitude: 51.5, sowingDate: sowing, today })).toBeNull();
  });

  it('equals the model without calibrations', () => {
    const s = calibrateBbch(run, 'winterWheat', [], today);
    expect(s.bbchOffset).toBeNull();
    expect(s.bbchByDate).toEqual(s.modelBbchByDate);
    expect(s.currentBbch).toBe(s.modelBbchByDate[today]);
  });

  it('meets the observed stage on the observation day and keeps the offset after it', () => {
    const day = '2026-04-01';
    const observed = Math.min(run.bbch[run.dates.indexOf(day)] + 6, 99);
    const gs = getCropGsParams('winterWheat')!
    const anchor = { bdOffset: bbchToBd(observed, gs.gs, gs.isCanola) - run.cumulativeBd[run.dates.indexOf(day)] };
    expect(anchor.bdOffset).toBeGreaterThan(0);
    const s = calibrateBbch(run, 'winterWheat', [{ observedBbch: observed, bdOffset: anchor.bdOffset }], today);
    expect(s.bbchByDate[day]).toBe(observed);
    expect(s.bbchOffset).toBeCloseTo(anchor.bdOffset, 10);
    expect(s.currentBbch!).toBeGreaterThanOrEqual(s.modelBbchByDate[today]);
    // The offset ramps in from zero at sowing: early stages move far less than late ones.
    const early = s.bbchByDate[addDays(sowing, 3)] - s.modelBbchByDate[addDays(sowing, 3)];
    expect(early).toBeLessThan(s.bbchByDate[day] - s.modelBbchByDate[day]);
  });

});
