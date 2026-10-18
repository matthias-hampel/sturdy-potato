#!/usr/bin/env python3
"""
Generates the INSERT for the shared fertilizer catalogue (migration 000015) from AGVOLUTION/agmeo's
article master `src/lib/articles/articles.json`.

    python3 -I scripts/generate-fertilizer-catalogue.py <agmeo>/src/lib/articles/articles.json > catalogue.sql

agmeo stores mineral contents in % of mass and organic contents in kg per tonne of fresh matter, with
`convTToCbm` meaning m³ per tonne for minerals but tonnes per m³ for organics. Here every content is
% of fresh mass and density is always t/m³ (see ADR-010). Only EU products are taken; US and ZA grades
and pseudo-articles (N previous year, straw, potting soil, …) are left out.
"""
import json
import sys

MINERAL_TYPES = {
    'CAN_AND_OTHERS_N': 'can',
    'UREA': 'urea',
    'UREA_W_INHIBITOR': 'urea_inhibitor',
    'UREA_W_INHIBITOR_BLUE': 'urea_inhibitor',
    'UREA_W_INHIBITOR_BLUE_LIQUID': 'urea_inhibitor',
    'AHL': 'uan',
    'NP': 'np',
    'NPK': 'npk',
    'no_n': 'pk',
}
ORGANIC_TYPES = {
    'cattleSlurry': 'cattle_slurry',
    'pigSlurry': 'pig_slurry',
    'cattleLiquidManure': 'cattle_liquid_manure',
    'pigLiquidManure': 'pig_liquid_manure',
    'cattleSolidManure': 'cattle_solid_manure',
    'pigSolidManure': 'pig_solid_manure',
    'horseManure': 'horse_sheep_manure',
    'chickenSolidManure': 'poultry_manure',
    'turkeySolidManure': 'poultry_manure',
    'digestateLiquid': 'digestate_liquid',
}
SKIP_NAMES = ('N previous year', 'Black-and-white peat', 'green manure', 'green section', 'straws', 'unharvested')


def organic_type(r):
    if r['category'] in ORGANIC_TYPES:
        return ORGANIC_TYPES[r['category']]
    name = r['name'].lower()
    if r['category'] == 'cattle slurry and digested manure':
        return 'cattle_slurry' if 'liquid' in name else 'cattle_solid_manure'
    if 'sewage sludge' in name:
        return 'sewage_sludge'
    if 'fermentation residues' in name:
        return 'digestate_solid'
    if 'compost' in name:
        return 'compost'
    return 'other_organic'


def num(v):
    return None if v is None or v == '' else float(v)


def q(v):
    if v is None:
        return 'NULL'
    if isinstance(v, float):
        return repr(round(v, 4))
    return "'" + str(v).replace("'", "''") + "'"


def main(path):
    rows = json.load(open(path, encoding='utf-8'))
    out = []
    for r in rows:
        if r.get('actionOrProduct') != 'product' or r.get('operationCategory') != 'FERTILIZER':
            continue
        if r.get('countries') not in ('EU', None) or '(US)' in r['name'] or any(s in r['name'] for s in SKIP_NAMES):
            continue
        organic = r.get('organic') == 'TRUE'
        liquid = r.get('state') == 'liquid'
        conv = num(r.get('convTToCbm'))
        if organic:
            ftype = organic_type(r)
            factor = 0.1  # kg/t -> %
            density = conv
            unit = 'm3' if liquid else 't'
            dm = num(r.get('dryMatterContent'))
            suffix = f' ({dm:g} % TS)' if dm is not None else ''
        else:
            ftype = MINERAL_TYPES.get(r['category'], 'uan' if r['fqn'].startswith('MINERAL__NTS') else 'other_mineral')
            factor = 1.0
            density = (1 / conv) if conv else None
            unit = 'l' if liquid else 'kg'
            suffix = ''
        price = num(r.get('price'))
        if price is not None and price > 0:
            pu = r.get('priceUnit')
            if unit == 'kg':
                price = price / 1000 if pu == 'euro_t' else price
            elif unit == 'l':
                price = price if pu == 'euro_l' else None
            elif unit in ('t', 'm3'):
                price = price if pu == 'euro_t' else None
        else:
            price = None
        pct = lambda k: None if num(r.get(k)) is None else num(r.get(k)) * factor
        lime = num(r.get('limeEffectPer100kg'))
        name_de = (r.get('nameGerman') or r['name']).strip() + suffix
        name_en = r['name'].strip() + suffix
        out.append('  (' + ', '.join(q(v) for v in [
            r['fqn'], name_de, name_en, ftype, 'liquid' if liquid else 'solid', unit,
            pct('n'), pct('nh4'), pct('p2o5'), pct('k2o'), pct('mgo'), lime,
            num(r.get('dryMatterContent')), density, price,
        ]) + ')')
    print('INSERT INTO fertilizer_catalogue (source_key, name_de, name_en, fertilizer_type, state, suggested_unit,')
    print('  n_pct, nh4_n_pct, p2o5_pct, k2o_pct, mgo_pct, cao_pct, dry_matter_pct, density_t_m3, indicative_price) VALUES')
    print(',\n'.join(out) + ';')


if __name__ == '__main__':
    main(sys.argv[1])
