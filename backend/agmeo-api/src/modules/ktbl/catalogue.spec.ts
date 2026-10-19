import { ktblAction, ktblActions, searchKtblActions } from './catalogue.js';
import { cropProfile } from './crops.js';

describe('KTBL action catalogue', () => {
  it('lists every action with cost data, labelled in German and English', () => {
    const all = ktblActions();
    expect(all).toHaveLength(693);
    expect(all.every((a) => a.label.de && a.label.en && a.group.de && a.group.en)).toBe(true);
    expect(ktblAction('PLOWING__RP7_1000')).toEqual({
      fqn: 'PLOWING__RP7_1000',
      operationType: 'tillage',
      category: 'TILLAGE',
      group: { de: 'Pflügen', en: 'Plowing' },
      label: { de: 'Drehpflug (7 Körper, 2.45 m, gezogen), 83 kW', en: 'Reversible plow (7 bodies, 2.45 m, trailed), 83 kW' },
      appliesTo: 'ARABLES',
    });
  });

  it('maps the reference operation categories onto operation types', () => {
    const type = (fqn: string) => ktblAction(fqn)?.operationType;
    expect(type('SPRAYING__PST24_1000')).toBe('crop_protection');
    expect(type('ROLLING__R25_1000')).toBe('other');
    const harvest = searchKtblActions({ operationType: 'harvest' });
    expect(new Set(harvest.map((a) => a.category))).toEqual(new Set(['HARVESTING', 'POSTHARVEST']));
  });

  it('offers per crop what the reference offers (ALL, ARABLES and the crop sowing and harvest categories)', () => {
    const wheat = searchKtblActions({ operationType: 'tillage', appliesTo: cropProfile('winter_wheat', 'cereal').appliesTo });
    expect(wheat.map((a) => a.fqn)).toContain('PLOWING__RP7_1000');
    expect(wheat.map((a) => a.fqn)).not.toContain('SEEDBED_PREPARATION__BF2_1000');
    const beet = searchKtblActions({ operationType: 'tillage', appliesTo: cropProfile('sugar_beet', 'root').appliesTo });
    expect(beet.map((a) => a.fqn)).toContain('SEEDBED_PREPARATION__BF2_1000');
    const meadow = searchKtblActions({ appliesTo: cropProfile('grassland', 'grassland').appliesTo });
    expect(meadow.map((a) => a.fqn)).toContain('ROLLING__R25_1000');
  });

  it('finds actions by words in either language', () => {
    expect(searchKtblActions({ q: 'drehpflug 7 körper' }).map((a) => a.fqn)).toContain('PLOWING__RP7_1000');
    expect(searchKtblActions({ q: 'reversible plow' }).map((a) => a.fqn)).toContain('PLOWING__RP7_1000');
  });
});

describe('cropProfile', () => {
  it('takes the reference crop group, else the crop category group', () => {
    expect(cropProfile('winter_wheat', 'cereal').group).toBe('cereals');
    expect(cropProfile('silage_maize', 'maize')).toMatchObject({ ref: 'silageMaize', group: 'maize' });
    expect(cropProfile('silage_maize', 'maize').appliesTo).toEqual(new Set(['ALL', 'ARABLES', 'ROW_CROPS', 'HARVEST_WHOLE']));
    // Not in the reference's group table: the category decides.
    expect(cropProfile('winter_spelt', 'cereal').group).toBe('cereals');
    expect(cropProfile('my_own_millet', 'cereal')).toMatchObject({ ref: null, group: 'cereals' });
    expect(cropProfile('fallow', 'other')).toMatchObject({ group: null, appliesTo: new Set(['ALL', 'ARABLES']) });
  });
});
