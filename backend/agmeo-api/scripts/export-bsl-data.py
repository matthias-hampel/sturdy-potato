#!/usr/bin/env python3
"""
Exports the Beschreibende Sortenliste (BSL) of the Bundessortenamt from the reference app
(AGVOLUTION/agmeo data/bsl/bsl.db, SQLite) to data/bsl/varieties.json.gz, which the BSL import
(`pnpm sync:bsl`) loads into bsl_varieties.

Usage: python3 -I scripts/export-bsl-data.py <path to agmeo>/data/bsl/bsl.db data/bsl/varieties.json.gz
"""
import sqlite3, json, gzip, sys
db, out = sys.argv[1], sys.argv[2]
c = sqlite3.connect(db)
def vals(table):
    m = {}
    for vid, name, value, num in c.execute(f"select variety_id, property_name, value, value_numeric from {table} order by id"):
        if num is None and (value is None or value.strip() in ('', '-')):
            continue
        v = num if num is not None else value.strip()
        m.setdefault(vid, {}).setdefault(name, v)
    return m
props, qual = vals('properties'), vals('quality')
rows = []
for r in c.execute("""select v.id, v.name, v.kenn_nummer, v.zugelassen_seit, v.zuechter, v.zuechter_nummer, v.status, v.hybrid, v.neu, v.besonderheit,
  s.name, sub.name, sub.nutzung from varieties v join subspecies sub on sub.id = v.subspecies_id join species s on s.id = sub.species_id order by v.id"""):
    vid, name, kenn, since, breeder, bno, status, hybrid, neu, bes, sp, sub, use = r
    rows.append({k: v for k, v in dict(id=vid, name=name, kenn=kenn, since=since, breeder=breeder, breederNo=bno, status=status,
        hybrid=bool(hybrid), new=bool(neu), note=bes, species=sp, subspecies=sub, usage=use,
        properties=props.get(vid, {}), quality=qual.get(vid, {})).items() if v not in (None, {}, False)})
data = {"source": "Beschreibende Sortenliste of the Bundessortenamt, as imported by AGVOLUTION/agmeo (data/bsl/bsl.db, February 2026)", "varieties": rows}
with gzip.open(out, 'wt', encoding='utf-8') as f:
    json.dump(data, f, ensure_ascii=False, separators=(',', ':'))
print(len(rows))
