// Checks the UI catalogues: identical, sorted key sets in de-DE and en-US (plus any
// src/i18n/parts/*.{de,en}.json still waiting to be merged), `_one` forms for {{count}}
// strings, and every literal t('key') in src resolving to a key.
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'

const root = new URL('../src/', import.meta.url).pathname
const load = (p) => JSON.parse(readFileSync(p, 'utf8'))
const de = load(join(root, 'i18n/de-DE.json'))
const en = load(join(root, 'i18n/en-US.json'))
const problems = []
for (const [name, catalogue] of [
  ['de-DE', de],
  ['en-US', en],
]) {
  const keys = Object.keys(catalogue)
  if (keys.join('\n') !== [...keys].sort().join('\n')) problems.push(`${name}.json is not sorted alphabetically`)
}

let partsDe = {}
let partsEn = {}
const parts = join(root, 'i18n/parts')
try {
  for (const f of readdirSync(parts)) {
    if (f.endsWith('.de.json')) partsDe = { ...partsDe, ...load(join(parts, f)) }
    if (f.endsWith('.en.json')) partsEn = { ...partsEn, ...load(join(parts, f)) }
  }
} catch {
  // no parts directory
}
const allDe = { ...de, ...partsDe }
const allEn = { ...en, ...partsEn }
for (const k of Object.keys(allEn)) if (!(k in allDe)) problems.push(`missing in de: ${k}`)
for (const k of Object.keys(allDe)) if (!(k in allEn)) problems.push(`missing in en: ${k}`)
for (const [k, v] of Object.entries(allDe)) {
  if (v.includes('{{count}}') && !k.endsWith('_one') && !(`${k}_one` in allDe)) problems.push(`no _one form: ${k}`)
}

const files = []
const walk = (dir) => {
  for (const f of readdirSync(dir)) {
    const p = join(dir, f)
    if (statSync(p).isDirectory()) walk(p)
    else if (/\.tsx?$/.test(f) && !f.includes('routeTree')) files.push(p)
  }
}
walk(root)
const literal = /\bt\(\s*(['"])([^'"`]+?)\1/g
for (const file of files) {
  for (const m of readFileSync(file, 'utf8').matchAll(literal)) {
    const key = m[2]
    if (!(key in allEn)) problems.push(`${file.replace(root, 'src/')}: unknown key ${key}`)
  }
}

// Further languages (cs-CZ.json, pl-PL.json, ...): every key of de-DE, sorted, with the same
// placeholders and markup tags; plural keys may add the forms their language needs (_few, _many,
// _two, _zero). Keys missing from a catalogue fall back to English at runtime but fail this check.
const PLURAL_FORMS = ['_zero', '_two', '_few', '_many']
const tokens = (v) => [...v.matchAll(/\{\{\s*([\w.]+)[^}]*\}\}|<\/?(\w+)\s*\/?>/g)].map((m) => m[1] ?? `<${m[2]}>`).sort().join(' ')
for (const f of readdirSync(join(root, 'i18n'))) {
  if (!/^[a-z]{2}-[A-Z]{2}\.json$/.test(f) || f === 'de-DE.json' || f === 'en-US.json') continue
  const cat = load(join(root, 'i18n', f))
  const keys = Object.keys(cat)
  if (keys.join('\n') !== [...keys].sort().join('\n')) problems.push(`${f} is not sorted alphabetically`)
  let missing = 0
  for (const k of Object.keys(de)) if (!(k in cat)) missing++
  if (missing) problems.push(`${f}: ${missing} key(s) missing`)
  for (const [k, v] of Object.entries(cat)) {
    if (typeof v !== 'string' || !v.trim()) {
      problems.push(`${f}: empty value for ${k}`)
      continue
    }
    const form = PLURAL_FORMS.find((x) => k.endsWith(x))
    const base = form ? k.slice(0, -form.length) : k
    if (!(base in de)) {
      problems.push(`${f}: unknown key ${k}`)
      continue
    }
    if (form && !de[base].includes('{{count}}')) problems.push(`${f}: ${k} is a plural form of a key without {{count}}`)
    const want = new Set(tokens(de[base]).split(' ').filter(Boolean))
    // `_one` forms may drop {{count}} ("ein Schlag").
    const got = new Set(tokens(v).split(' ').filter(Boolean))
    for (const tok of want) if (!got.has(tok) && !(tok === 'count' && (k.endsWith('_one') || form))) problems.push(`${f}: ${k} lacks ${tok.startsWith('<') ? tok : `{{${tok}}}`}`)
    for (const tok of got) if (!want.has(tok)) problems.push(`${f}: ${k} has unknown ${tok.startsWith('<') ? tok : `{{${tok}}}`}`)
  }
}

if (problems.length) {
  console.error(problems.join('\n'))
  console.error(`\n${problems.length} problem(s)`)
  process.exit(1)
}
console.log(`i18n ok: ${Object.keys(allEn).length} keys`)
