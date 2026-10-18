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

if (problems.length) {
  console.error(problems.join('\n'))
  console.error(`\n${problems.length} problem(s)`)
  process.exit(1)
}
console.log(`i18n ok: ${Object.keys(allEn).length} keys`)
