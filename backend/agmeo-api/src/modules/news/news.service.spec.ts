import { describe, expect, it } from 'vitest';
import { activeMilestones, deriveCropStageNotes, isoWeek, upcomingEvents, weatherHeadline } from './news.service.js';

describe('news generators', () => {
  it('picks the weather headline like the reference', () => {
    expect(weatherHeadline({ tempMean14: 10, precip14: 45, forecast: [] }).key).toBe('weather.heavyRain');
    expect(weatherHeadline({ tempMean14: 10, precip14: 3, forecast: [] }).key).toBe('weather.drySpell');
    expect(weatherHeadline({ tempMean14: 24, precip14: 20, forecast: [] }).key).toBe('weather.warmSpell');
    expect(weatherHeadline({ tempMean14: 1, precip14: 20, forecast: [] }).key).toBe('weather.coldSpell');
    expect(weatherHeadline({ tempMean14: 10, precip14: 20, forecast: [{ tempMin: 2, tempMax: 12, precip: 3 }, { tempMin: 4, tempMax: 15, precip: 1 }] })).toEqual({
      key: 'weather.forecast',
      params: { min: 2, max: 15, rain: 4 },
    });
    expect(weatherHeadline({ tempMean14: 10, precip14: 20, forecast: [] }).key).toBe('weather.recap');
  });

  it('derives crop stages from recorded dates, else the crop calendar', () => {
    const notes = deriveCropStageNotes(
      [
        { cropCode: 'winter_wheat', cropName: 'Winterweizen', harvestYear: 2027, areaHa: 20, recordedSowing: '2026-10-10', recordedHarvest: null },
        { cropCode: 'winter_rapeseed', cropName: 'Winterraps', harvestYear: 2027, areaHa: 30, recordedSowing: '2026-08-25', recordedHarvest: null },
        { cropCode: null, cropName: 'Unbekannt', harvestYear: 2027, areaHa: 50, recordedSowing: null, recordedHarvest: null },
      ],
      '2026-10-19',
      false,
    );
    expect(notes).toEqual([
      { cropName: 'Winterraps', areaHa: 30, stage: 'growing' },
      { cropName: 'Winterweizen', areaHa: 20, stage: 'sowing' },
    ]);
  });

  it('lists events of the next 60 days and the open report milestones', () => {
    expect(upcomingEvents('2026-10-19').map((e) => e.slug)).toEqual(['eurotier-2026'])
    expect(isoWeek(new Date('2026-10-19T00:00:00Z'))).toBe(43);
    // ENNI 2025 is due 30 June 2026: the window opens on 1 May.
    expect(activeMilestones(new Date('2026-05-20T10:00:00Z'), 'enni').map((m) => [m.key, m.reportYear])).toEqual([
      ['dokumentation', 2026],
      ['meldung', 2025],
    ]);
    expect(activeMilestones(new Date('2026-11-02T10:00:00Z'), 'besyd').map((m) => m.key)).toEqual(['besydSunset']);
    expect(activeMilestones(new Date('2026-02-01T10:00:00Z'), 'st').map((m) => m.key)).toEqual(['dbe']);
  });
});
