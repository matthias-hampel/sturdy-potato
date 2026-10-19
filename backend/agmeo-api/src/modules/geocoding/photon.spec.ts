import { type PhotonFeature, toHit, toHits } from './photon.js';

const feature = (properties: Partial<PhotonFeature['properties']>, coordinates: [number, number] = [9.9044004, 51.4447599]): PhotonFeature => ({
  geometry: { coordinates },
  properties: { osm_type: 'W', osm_id: 1, countrycode: 'DE', state: 'Niedersachsen', ...properties },
});

describe('Photon hits', () => {
  it('addresses a house by street, postcode and town', () => {
    const hit = toHit(feature({ type: 'house', street: 'Lehmkuhlenweg', housenumber: '5', postcode: '37133', city: 'Friedland', district: 'Klein Schneen' }));
    expect(hit).toEqual({
      id: 'W1',
      title: 'Lehmkuhlenweg 5',
      detail: '37133 Friedland, Klein Schneen, Niedersachsen',
      address: 'Lehmkuhlenweg 5, 37133 Friedland',
      location: { lat: 51.44476, lng: 9.9044 },
      kind: 'house',
      countryCode: 'DE',
    });
  });

  it('titles a named house by its name but keeps the postal address', () => {
    const hit = toHit(feature({ type: 'house', name: 'Hofladen Müller', street: 'Dorfstraße', housenumber: '3', postcode: '37133', city: 'Friedland' }));
    expect(hit.title).toBe('Hofladen Müller');
    expect(hit.detail).toBe('Dorfstraße 3, 37133 Friedland, Niedersachsen');
    expect(hit.address).toBe('Dorfstraße 3, 37133 Friedland');
  });

  it('addresses streets and places without a house number', () => {
    expect(toHit(feature({ type: 'street', name: 'Lehmkuhlenweg', postcode: '22589', city: 'Hamburg' })).address).toBe('Lehmkuhlenweg, 22589 Hamburg');
    expect(toHit(feature({ type: 'district', name: 'Klein Schneen', postcode: '37133', city: 'Friedland' })).address).toBe('Klein Schneen, 37133 Friedland');
    expect(toHit(feature({ type: 'city', name: 'Friedland', postcode: '37133', city: 'Friedland' })).address).toBe('37133 Friedland');
    expect(toHit(feature({ type: 'locality', name: 'Bioland-Hofgut', district: 'Klein Schneen', city: 'Friedland' }))).toMatchObject({
      kind: 'place',
      title: 'Bioland-Hofgut',
      address: 'Bioland-Hofgut, Friedland',
    });
  });

  it('drops duplicates of one place', () => {
    const village = { type: 'district', name: 'Klein Schneen', city: 'Friedland', postcode: '37133' };
    const hits = toHits([feature({ ...village, osm_type: 'N', osm_id: 1 }), feature({ ...village, osm_type: 'R', osm_id: 2 })]);
    expect(hits.map((h) => h.id)).toEqual(['N1']);
  });
});
