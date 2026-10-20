// Checks the UI catalogue (agmeo is German-only): de-DE.json sorted alphabetically, a `_one`
// form for every {{count}} string, and every literal t('key') in src resolving to a key.
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'

const root = new URL('../src/', import.meta.url).pathname
const de = JSON.parse(readFileSync(join(root, 'i18n/de-DE.json'), 'utf8'))
const problems = []

const keys = Object.keys(de)
if (keys.join('\n') !== [...keys].sort().join('\n')) problems.push('de-DE.json is not sorted alphabetically')
for (const [k, v] of Object.entries(de)) {
  if (typeof v !== 'string' || !v.trim()) problems.push(`empty value for ${k}`)
  else if (v.includes('{{count}}') && !k.endsWith('_one') && !(`${k}_one` in de)) problems.push(`no _one form: ${k}`)
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
    if (!(key in de)) problems.push(`${file.replace(root, 'src/')}: unknown key ${key}`)
  }
}

if (problems.length) {
  console.error(problems.join('\n'))
  console.error(`\n${problems.length} problem(s)`)
  process.exit(1)
}
console.log(`i18n ok: ${keys.length} keys`)
