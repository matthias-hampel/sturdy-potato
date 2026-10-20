# seek-bzip (vendored)

Pure-JS bzip2 decoder, used only by the DWD radar job (src/modules/radar) to
decompress RADOLAN RY frames and the RV nowcast archives. Ported from the
reference app's copy (AGVOLUTION/agmeo `src/lib/vendor/seek-bzip`).

## Provenance

- **Upstream:** https://github.com/cscott/seek-bzip
- **Version:** 2.0.0
- **npm tarball:** https://registry.npmjs.org/seek-bzip/-/seek-bzip-2.0.0.tgz
- **SHA-1 (matches npm registry):** `f0478ab6acd0ac72345d18dc7525dd84d3c706a2`
- **License:** MIT (preserved in `LICENSE`)

## Modifications

Changes the reference app made to the upstream `lib/` files:

- `index.js`: the `require('../package.json')` for `Bunzip.version` and
  `Bunzip.license` removed.
- `index.js`, `bitreader.js`: `new Buffer(n)` replaced with `Buffer.alloc(n)`
  (all call sites fill the buffer before reading it).

Changes made here, so the files build in this ESM TypeScript package:

- Each file renamed from `.js` to `.ts` with `// @ts-nocheck` as its first line.
- `require("./x")` replaced with `import X from "./x.js"`, and
  `module.exports =` with `export default`.

The code itself is otherwise unchanged. `bunzip2.ts` is the typed entry point.
