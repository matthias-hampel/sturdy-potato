#!/usr/bin/env python3
"""
Generates data/ktbl/ from AGVOLUTION/agmeo:

- actionCostsDataGrouped.json  (src/lib/ktbl, grid data of the V2 estimator), minified
- cross_params.json            (src/lib/ktbl, CROSS formula parameters of the V1 estimator), minified,
                               without the fit quality (`r2`) and the description the estimator never reads
- actions.json                 the KTBL actions the cost data covers, with the reference's operation
                               category, crop applicability and German/English texts from its
                               "articles" i18n namespace (src/i18n/articles/{de-DE,en-US}.json; the
                               action group label is the article text of the FQN prefix, e.g. PLOWING)

Numbers are written with Python's shortest round-trip repr, so every value parses to the same
double as in the source files.

    python3 -I scripts/generate-ktbl-data.py <agmeo> data/ktbl
"""
import json
import os
import re
import sys

src, out = sys.argv[1], sys.argv[2]
ktbl = os.path.join(src, 'src', 'lib', 'ktbl')
load = lambda *p: json.load(open(os.path.join(*p), encoding='utf-8'))
dump = lambda name, data: json.dump(data, open(os.path.join(out, name), 'w', encoding='utf-8'), separators=(',', ':'), ensure_ascii=False)
os.makedirs(out, exist_ok=True)

grouped = load(ktbl, 'actionCostsDataGrouped.json')
dump('actionCostsDataGrouped.json', grouped)

cross = load(ktbl, 'cross_params.json')
dump('cross_params.json', {'entries': {k: {'params': v['params']} for k, v in cross['entries'].items()}})

# FQNs without own KTBL data that the estimator maps onto a neighbouring variant (FQN_ALIAS in lib/ktbl/index.ts).
aliases = ['PLANTING__CRPF24_1000', 'PLANTING__CRPF36_1000']
fqns = sorted(set(grouped['groupedActions']) | set(grouped['universalActions']) | set(aliases))
articles = {a['fqn']: a for a in load(src, 'src', 'lib', 'articles', 'articles.json') if a['actionOrProduct'] == 'action'}
de = load(src, 'src', 'i18n', 'articles', 'de-DE.json')
en = load(src, 'src', 'i18n', 'articles', 'en-US.json')


def applies_to(raw):
    # As the reference's article seed (src/seedData/articleUtils.ts) stores it.
    v = raw.replace('HARVEST GRAIN ROW', 'HARVEST_GRAIN').replace('HARVEST ROW', 'HARVEST GRAIN').replace(' ', '_', 1)
    v = re.sub(r'\bARABLE\b', 'ARABLES', v)
    return re.sub(r'\bSMALL_GRAIN\b', 'SMALL_GRAINS', v)


actions = []
for fqn in fqns:
    a = articles[fqn]
    prefix = fqn.split('__')[0]
    actions.append({
        'fqn': fqn,
        'category': a['operationCategory'].replace('FERTILIZER', 'FERTILIZING'),
        'appliesTo': applies_to(a['appliesTo']),
        'group': {'de': de.get(prefix) or a['categoryGerman'], 'en': en.get(prefix) or a['category']},
        'label': {'de': (de.get(fqn) or a['nameGerman']).strip(), 'en': (en.get(fqn) or a['name']).strip()},
    })
dump('actions.json', actions)
print(f'{len(actions)} actions, {len(grouped["grids"])} grids, {len(cross["entries"])} formula entries', file=sys.stderr)
