#!/usr/bin/env python3
"""
Generates the INSERT for the Nmin reference values (Nmin-Richtwerte, migration 000016) from
AGVOLUTION/agmeo's `src/lib/nmin/richtwerte.json` (scraped from the federal states' publications by
AGVOLUTION/Nmin-data-scraping).

    python3 -I scripts/generate-nmin-reference.py <agmeo>/src/lib/nmin/richtwerte.json > nmin.sql
"""
import json
import sys


def q(v):
    if v is None:
        return 'NULL'
    if isinstance(v, (int, float)):
        return repr(v)
    return "'" + str(v).replace("'", "''") + "'"


rows = json.load(open(sys.argv[1], encoding='utf-8'))['rows']
print('INSERT INTO nmin_reference_values (state, region, crop, previous_crop, soil, n0_30, n30_60, n60_90, total, depth, samples, week, year, source) VALUES')
print(',\n'.join('  (' + ', '.join(q(v) for v in [
    r['state'], r.get('region'), r['crop'], r.get('previousCrop'), r.get('soil'), r.get('n0_30'), r.get('n30_60'), r.get('n60_90'),
    r['total'], r.get('depth') or '0-90', r.get('samples'), r.get('week'), r['year'], r['source'],
]) + ')' for r in rows) + ';')
