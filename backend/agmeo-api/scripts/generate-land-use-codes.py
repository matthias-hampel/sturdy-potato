#!/usr/bin/env python3
"""
Generates the INSERT for the land-use codes of the subsidy application (Nutzungscodes, migration
000018) from AGVOLUTION/agmeo's `src/lib/cropCodes.tsx` (destatis harmonised codes, checked against
the Lower Saxony 2024 data set).

    python3 -I scripts/generate-land-use-codes.py <agmeo>/src/lib/cropCodes.tsx > codes.sql
"""
import re
import sys

src = open(sys.argv[1], encoding='utf-8').read()
body = src[src.index('export const cropCodes'):]
body = body[:body.index('};')]
rows = []
for m in re.finditer(r'^\s*"(\d+)":\s*("([A-Za-z]+)"|undefined),?\s*(?://\s*(.*))?$', body, re.M):
    code, _, key, comment = m.groups()
    # A few codes carry no description in the source.
    name = (comment or '').strip() or f'Nutzungscode {code}'
    n = int(code)
    # Landscape features, fallow and set-aside, and codes above 900 bring no harvest.
    productive = not (51 <= n <= 99 or 501 <= n <= 599 or n > 900)
    rows.append((code, name, key, productive))

def q(v):
    if v is None or v == '':
        return 'NULL'
    if isinstance(v, bool):
        return 'true' if v else 'false'
    return "'" + str(v).replace("'", "''") + "'"

print('INSERT INTO land_use_codes (code, name_de, agmeo_crop_key, productive) VALUES')
print(',\n'.join(f'  ({q(c)}, {q(nm)}, {q(k)}, {q(p)})' for c, nm, k, p in rows) + '\nON CONFLICT (code) DO NOTHING;')
