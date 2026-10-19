import { strToU8, zipSync } from 'fflate'
import { saveBlob } from './api'

/**
 * Minimal Office Open XML (.xlsx) writer: several sheets of strings and numbers, a bold and
 * frozen header row, integer or two-decimal number formats, column widths and an autofilter.
 * Built on fflate (already a dependency) instead of a spreadsheet library.
 */

export type Cell = string | number | null | undefined

export interface Sheet {
  name: string
  header: string[]
  rows: Cell[][]
  /** Number format per column index: 'int' (#,##0) or 'dec2' (#,##0.00). */
  formats?: Record<number, 'int' | 'dec2'>
  autoFilter?: boolean
}

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '')

function colName(i: number): string {
  let n = i + 1
  let s = ''
  while (n > 0) {
    const r = (n - 1) % 26
    s = String.fromCharCode(65 + r) + s
    n = Math.floor((n - 1) / 26)
  }
  return s
}

/** Style ids in styles.xml: 0 normal, 1 bold header, 2 integer, 3 two decimals. */
const STYLE = { header: 1, int: 2, dec2: 3 } as const

function cellXml(ref: string, value: Cell, style?: number): string {
  if (value == null || (typeof value === 'number' && !Number.isFinite(value))) return ''
  const s = style ? ` s="${style}"` : ''
  if (typeof value === 'number') return `<c r="${ref}"${s}><v>${value}</v></c>`
  return `<c r="${ref}"${s} t="inlineStr"><is><t xml:space="preserve">${esc(value)}</t></is></c>`
}

function sheetXml(sheet: Sheet): string {
  const all = [sheet.header, ...sheet.rows]
  const widths = sheet.header.map((h, c) => Math.min(60, Math.max(10, ...all.map((r) => String(r[c] ?? '').length + 2), h.length + 2)))
  const rows = all
    .map((r, ri) => {
      const cells = r
        .map((v, ci) => cellXml(`${colName(ci)}${ri + 1}`, v, ri === 0 ? STYLE.header : sheet.formats?.[ci] ? STYLE[sheet.formats[ci]] : undefined))
        .join('')
      return `<row r="${ri + 1}">${cells}</row>`
    })
    .join('')
  const last = `${colName(Math.max(0, sheet.header.length - 1))}${all.length}`
  return (
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">` +
    `<sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>` +
    `<cols>${widths.map((w, i) => `<col min="${i + 1}" max="${i + 1}" width="${w}" customWidth="1"/>`).join('')}</cols>` +
    `<sheetData>${rows}</sheetData>` +
    (sheet.autoFilter !== false && sheet.rows.length ? `<autoFilter ref="A1:${last}"/>` : '') +
    `</worksheet>`
  )
}

/** Sheet names: at most 31 characters, no []:*?/\ and unique within the workbook. */
function sheetNames(sheets: Sheet[]): string[] {
  const used = new Set<string>()
  return sheets.map((s, i) => {
    let name = s.name.replace(/[[\]:*?/\\]/g, ' ').slice(0, 31).trim() || `Sheet${i + 1}`
    let n = 2
    while (used.has(name.toLowerCase())) name = `${name.slice(0, 28)} ${n++}`
    used.add(name.toLowerCase())
    return name
  })
}

export function workbook(sheets: Sheet[]): Uint8Array {
  const names = sheetNames(sheets)
  const files: Record<string, Uint8Array> = {
    '[Content_Types].xml': strToU8(
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">` +
        `<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/>` +
        `<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>` +
        `<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>` +
        sheets.map((_, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join('') +
        `</Types>`,
    ),
    '_rels/.rels': strToU8(
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
        `<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`,
    ),
    'xl/workbook.xml': strToU8(
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>` +
        names.map((n, i) => `<sheet name="${esc(n)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join('') +
        `</sheets>` +
        // Autofilters need their defined name to be recognised by Excel.
        `<definedNames>${sheets
          .map((s, i) => (s.autoFilter !== false && s.rows.length ? `<definedName name="_xlnm._FilterDatabase" localSheetId="${i}" hidden="1">'${esc(names[i].replace(/'/g, "''"))}'!$A$1:$${colName(Math.max(0, s.header.length - 1))}$${s.rows.length + 1}</definedName>` : ''))
          .join('')}</definedNames></workbook>`.replace('<definedNames></definedNames>', ''),
    ),
    'xl/_rels/workbook.xml.rels': strToU8(
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
        sheets.map((_, i) => `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join('') +
        `<Relationship Id="rId${sheets.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`,
    ),
    'xl/styles.xml': strToU8(
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">` +
        `<fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font></fonts>` +
        `<fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills>` +
        `<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>` +
        `<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>` +
        `<cellXfs count="4"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/>` +
        `<xf numFmtId="3" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/><xf numFmtId="4" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/></cellXfs>` +
        `<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>`,
    ),
  }
  sheets.forEach((s, i) => {
    files[`xl/worksheets/sheet${i + 1}.xml`] = strToU8(sheetXml(s))
  })
  return zipSync(files, { level: 6 })
}

export function downloadXlsx(filename: string, sheets: Sheet[]) {
  const data = workbook(sheets)
  const blob = new Blob([data as BlobPart], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' })
  saveBlob(blob, filename.endsWith('.xlsx') ? filename : `${filename}.xlsx`)
}
