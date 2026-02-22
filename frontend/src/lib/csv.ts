/**
 * CSV utility — formula-safe field serialization.
 *
 * Formula injection defense (OWASP CSV Injection):
 *   Fields starting with = + - @ \t \r \n are prefixed with a single quote
 *   so Excel / Google Sheets treat them as text rather than as formulas.
 *
 * Standard CSV escaping (RFC 4180):
 *   Fields containing , " \n \r are wrapped in double-quotes.
 *   Double-quotes inside a quoted field are escaped as "".
 */

/** Characters that trigger formula execution in spreadsheet applications. */
const FORMULA_TRIGGER = /^[=+\-@\t\r\n]/

/**
 * Serializes a single value to a formula-safe, RFC-4180-compatible CSV field.
 *
 * Examples:
 *   sanitizeCSVField('=HYPERLINK("x","y")') → '"\'=HYPERLINK(""x"",""y"")"'
 *   sanitizeCSVField('hello,world')          → '"hello,world"'
 *   sanitizeCSVField('say "hi"')             → '"say ""hi"""'
 *   sanitizeCSVField(123.45)                 → '123.45'
 *   sanitizeCSVField(null)                   → ''
 */
export function sanitizeCSVField(val: unknown): string {
  if (val === null || val === undefined) return ''
  const str = String(val)

  // Prefix formula-triggering characters with a single quote.
  const safe = FORMULA_TRIGGER.test(str) ? `'${str}` : str

  // Wrap in double-quotes when a prefix was added or when the value
  // contains characters that require quoting per RFC 4180.
  if (
    safe !== str ||
    safe.includes(',') ||
    safe.includes('"') ||
    safe.includes('\n') ||
    safe.includes('\r')
  ) {
    return `"${safe.replace(/"/g, '""')}"`
  }

  return safe
}

/**
 * Serializes an array of values into a single CSV row (no trailing newline).
 *
 * Example:
 *   toCSVRow(['Date', 'Amount', '=EVIL']) → 'Date,Amount,"\'=EVIL"'
 */
export function toCSVRow(vals: unknown[]): string {
  return vals.map(sanitizeCSVField).join(',')
}
