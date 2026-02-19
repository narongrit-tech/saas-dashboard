/**
 * csvHeaderScanner.ts
 * Shared CSV utilities for importers that handle files with preamble rows
 * (e.g. Shopee Transaction Report, Shopee Income)
 */

/**
 * Remove BOM and normalize whitespace from a string
 */
export function normalizeText(text: string): string {
  return text
    .replace(/^\uFEFF/, '') // Remove BOM
    .replace(/[\r\n\t]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

/**
 * Scan lines (raw text split by newline) to find the row index that contains
 * ALL of the required header strings.
 *
 * @param lines - Array of raw CSV lines (already split)
 * @param requiredHeaders - Strings that must ALL appear in the header row
 * @param maxScan - Max number of rows to scan (default 300)
 * @returns Index of header row, or -1 if not found
 */
export function findHeaderRow(
  lines: string[],
  requiredHeaders: string[],
  maxScan = 300
): number {
  const limit = Math.min(lines.length, maxScan)
  for (let i = 0; i < limit; i++) {
    const line = lines[i]
    if (requiredHeaders.every((h) => line.includes(h))) {
      return i
    }
  }
  return -1
}

/**
 * Parse a single CSV line into fields, handling:
 * - Quoted fields (may contain commas or newlines)
 * - Escaped quotes ("")
 */
export function parseCSVLine(line: string): string[] {
  const fields: string[] = []
  let i = 0
  let field = ''
  let inQuotes = false

  while (i < line.length) {
    const ch = line[i]

    if (inQuotes) {
      if (ch === '"') {
        if (line[i + 1] === '"') {
          // Escaped quote
          field += '"'
          i += 2
        } else {
          // End of quoted field
          inQuotes = false
          i++
        }
      } else {
        field += ch
        i++
      }
    } else {
      if (ch === '"') {
        inQuotes = true
        i++
      } else if (ch === ',') {
        fields.push(field.trim())
        field = ''
        i++
      } else {
        field += ch
        i++
      }
    }
  }
  fields.push(field.trim())
  return fields
}

/**
 * Parse a CSV text into rows of objects using a header row.
 *
 * @param text - Full CSV file text
 * @param requiredHeaders - Headers that must exist to detect the header row
 * @returns { headerRowIndex, headers, rows } or null if header not found
 */
export function parseCSVWithDynamicHeader(
  text: string,
  requiredHeaders: string[]
): {
  headerRowIndex: number
  headers: string[]
  rows: Record<string, string>[]
} | null {
  // Normalize line endings
  const normalized = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n')
  const lines = normalized.split('\n')

  const headerRowIndex = findHeaderRow(lines, requiredHeaders)
  if (headerRowIndex === -1) {
    return null
  }

  const headers = parseCSVLine(lines[headerRowIndex]).map(normalizeText)

  const rows: Record<string, string>[] = []
  for (let i = headerRowIndex + 1; i < lines.length; i++) {
    const line = lines[i].trim()
    if (!line) continue // Skip empty lines

    const values = parseCSVLine(lines[i])
    const row: Record<string, string> = {}
    headers.forEach((header, idx) => {
      row[header] = (values[idx] ?? '').trim()
    })
    rows.push(row)
  }

  return { headerRowIndex, headers, rows }
}
