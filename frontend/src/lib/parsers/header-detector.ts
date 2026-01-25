/**
 * Bank Statement Header Row Detection
 * Handles files with meta rows (e.g., KBANK format has 3 meta rows before header)
 */

interface HeaderDetectionResult {
  headerRowIndex: number | null
  dataStartRowIndex: number | null
  columns: string[]
  confidence: number // 0-1
}

// Normalized header tokens (English + Thai)
const HEADER_TOKENS = {
  date: ['transaction date', 'date', 'วันที่', 'วันที่ทำรายการ'],
  transaction: ['transaction', 'description', 'รายการ', 'รายละเอียด'],
  withdrawal: ['withdrawal', 'withdraw', 'debit', 'ถอน', 'เบิก'],
  deposit: ['deposit', 'credit', 'ฝาก'],
  channel: ['channel', 'ช่องทาง', 'ประเภท'],
  balance: ['balance', 'ยอดคงเหลือ'],
}

/**
 * Normalize text for comparison (lowercase, trim, remove special chars)
 */
function normalizeText(text: string): string {
  return text
    .toLowerCase()
    .trim()
    .replace(/[()[\]:]/g, '')
    .replace(/\s+/g, ' ')
}

/**
 * Check if a row looks like a header row
 */
function isHeaderRow(row: any[]): { isHeader: boolean; matchCount: number; matchedTokens: string[] } {
  if (!row || row.length === 0) {
    return { isHeader: false, matchCount: 0, matchedTokens: [] }
  }

  // Convert row to normalized strings
  const normalizedRow = row.map((cell) => {
    if (cell === null || cell === undefined) return ''
    return normalizeText(String(cell))
  })

  // Count matches for each token type
  const matchedTokens: string[] = []
  let matchCount = 0

  // Check each token type
  for (const [tokenType, tokens] of Object.entries(HEADER_TOKENS)) {
    const hasMatch = normalizedRow.some((cell) => {
      return tokens.some((token) => cell.includes(token))
    })

    if (hasMatch) {
      matchCount++
      matchedTokens.push(tokenType)
    }
  }

  // Consider it a header if at least 2 token types match
  const isHeader = matchCount >= 2

  return { isHeader, matchCount, matchedTokens }
}

/**
 * Detect header row in a set of rows
 * @param rows - Array of rows (each row is array of cell values)
 * @param maxScanRows - Maximum rows to scan (default 30)
 * @returns Header detection result
 */
export function detectHeaderRow(rows: any[][], maxScanRows = 30): HeaderDetectionResult {
  if (!rows || rows.length === 0) {
    return {
      headerRowIndex: null,
      dataStartRowIndex: null,
      columns: [],
      confidence: 0,
    }
  }

  const scanLimit = Math.min(rows.length, maxScanRows)
  let bestMatch: { index: number; matchCount: number; matchedTokens: string[] } | null = null

  // Scan first N rows
  for (let i = 0; i < scanLimit; i++) {
    const row = rows[i]
    const result = isHeaderRow(row)

    if (result.isHeader) {
      // If this is a better match than previous, use it
      if (!bestMatch || result.matchCount > bestMatch.matchCount) {
        bestMatch = {
          index: i,
          matchCount: result.matchCount,
          matchedTokens: result.matchedTokens,
        }
      }

      // If we found a very strong match (4+ tokens), stop early
      if (result.matchCount >= 4) {
        break
      }
    }
  }

  if (!bestMatch) {
    // No header found, assume first row is header
    return {
      headerRowIndex: 0,
      dataStartRowIndex: 1,
      columns: rows[0]?.map((cell) => String(cell || '').trim()) || [],
      confidence: 0.3,
    }
  }

  // Extract column names from header row
  const headerRow = rows[bestMatch.index]
  const columns = headerRow
    .map((cell) => String(cell || '').trim())
    .filter((col) => col.length > 0)

  // Calculate confidence based on match count
  const confidence = Math.min(bestMatch.matchCount / 5, 1)

  return {
    headerRowIndex: bestMatch.index,
    dataStartRowIndex: bestMatch.index + 1,
    columns,
    confidence,
  }
}

/**
 * Build column mapping suggestions based on header names
 */
export function suggestColumnMapping(columns: string[]): {
  txn_date?: string
  description?: string
  withdrawal?: string
  deposit?: string
  balance?: string
  channel?: string
  reference_id?: string
} {
  const mapping: any = {}
  const normalizedColumns = columns.map((col) => normalizeText(col))

  // Find date column
  const dateIndex = normalizedColumns.findIndex((col) =>
    HEADER_TOKENS.date.some((token) => col.includes(token))
  )
  if (dateIndex !== -1) mapping.txn_date = columns[dateIndex]

  // Find transaction/description column
  // PRIORITY: "Transaction" > "Description" > Other
  // NEVER use "Channel" as description
  const transactionIndex = normalizedColumns.findIndex((col) => {
    // Skip if this is the channel column
    if (HEADER_TOKENS.channel.some((token) => col.includes(token))) return false

    // Prioritize "transaction" first
    if (col === 'transaction' || col.includes('transaction')) return true

    // Then match other description tokens
    return HEADER_TOKENS.transaction.some((token) => col.includes(token))
  })
  if (transactionIndex !== -1) mapping.description = columns[transactionIndex]

  // Find withdrawal column
  const withdrawalIndex = normalizedColumns.findIndex((col) =>
    HEADER_TOKENS.withdrawal.some((token) => col.includes(token))
  )
  if (withdrawalIndex !== -1) mapping.withdrawal = columns[withdrawalIndex]

  // Find deposit column
  const depositIndex = normalizedColumns.findIndex((col) =>
    HEADER_TOKENS.deposit.some((token) => col.includes(token))
  )
  if (depositIndex !== -1) mapping.deposit = columns[depositIndex]

  // Find balance column
  const balanceIndex = normalizedColumns.findIndex((col) =>
    HEADER_TOKENS.balance.some((token) => col.includes(token))
  )
  if (balanceIndex !== -1) mapping.balance = columns[balanceIndex]

  // Find channel column
  const channelIndex = normalizedColumns.findIndex((col) =>
    HEADER_TOKENS.channel.some((token) => col.includes(token))
  )
  if (channelIndex !== -1) mapping.channel = columns[channelIndex]

  return mapping
}
