/**
 * Preset Matching Utilities
 * For Manual Ads Import Wizard
 *
 * Purpose: Match uploaded filenames to saved presets using three-tier matching
 */

import { UserPreset } from '@/types/manual-mapping'

// ============================================================================
// Filename Normalization
// ============================================================================

/**
 * Normalize filename for fuzzy matching
 * Removes dates, IDs, timestamps, and normalizes separators
 *
 * Examples:
 * - "TikTok Ads 2024-12-01.xlsx" -> "tiktok_ads_date.xlsx"
 * - "Campaign Report 20241201_143022.xlsx" -> "campaign_report_id.xlsx"
 * - "Product-Ads-Report-v2.xlsx" -> "product_ads_report_v2.xlsx"
 */
export function normalizeFilename(filename: string): string {
  return filename
    .toLowerCase()
    .replace(/\d{4}-\d{2}-\d{2}/g, 'DATE') // Replace YYYY-MM-DD dates
    .replace(/\d{8}/g, 'DATE') // Replace YYYYMMDD dates
    .replace(/\d{6,}/g, 'ID') // Replace 6+ digit numbers (IDs, timestamps)
    .replace(/[_\s-]+/g, '_') // Normalize separators to underscore
    .trim()
}

/**
 * Extract first segment of filename (before first separator)
 * Used for prefix matching
 *
 * Examples:
 * - "TikTok Ads Report.xlsx" -> "tiktok"
 * - "Product-Campaign-2024.xlsx" -> "product"
 */
export function extractFilenamePrefix(filename: string): string {
  const firstSegment = filename.split(/[_\s-]/)[0]
  return firstSegment?.toLowerCase().trim() || ''
}

// ============================================================================
// Matching Algorithms
// ============================================================================

/**
 * Exact match: Case-insensitive exact filename match
 */
function exactMatch(filename: string, pattern: string): boolean {
  return filename.toLowerCase() === pattern.toLowerCase()
}

/**
 * Fuzzy match: Match normalized filenames (remove dates/IDs/timestamps)
 */
function fuzzyMatch(filename: string, pattern: string): boolean {
  return normalizeFilename(filename) === normalizeFilename(pattern)
}

/**
 * Prefix match: Match first segment (word before first separator)
 */
function prefixMatch(filename: string, pattern: string): boolean {
  const filenamePrefix = extractFilenamePrefix(filename)
  const patternPrefix = extractFilenamePrefix(pattern)
  return (
    filenamePrefix.length >= 4 && // Minimum 4 chars to avoid false positives
    filenamePrefix === patternPrefix
  )
}

// ============================================================================
// Main Matching Function
// ============================================================================

/**
 * Find matching preset using three-tier matching strategy
 *
 * Matching priority:
 * 1. Exact match (case-insensitive)
 * 2. Fuzzy match (normalized, removes dates/IDs)
 * 3. Prefix match (first word segment)
 *
 * @param presets - List of user presets to search
 * @param filename - Uploaded filename to match
 * @returns Matched preset or null
 */
export function findMatchingPreset(
  presets: UserPreset[],
  filename: string
): UserPreset | null {
  if (!filename || presets.length === 0) {
    return null
  }

  // 1. Try exact match first
  let match = presets.find((preset) => exactMatch(filename, preset.filename_pattern))
  if (match) {
    console.log('[Preset Match] Exact match found:', match.filename_pattern)
    return match
  }

  // 2. Try fuzzy match (normalized)
  match = presets.find((preset) => fuzzyMatch(filename, preset.filename_pattern))
  if (match) {
    console.log('[Preset Match] Fuzzy match found:', match.filename_pattern)
    return match
  }

  // 3. Try prefix match (first segment)
  match = presets.find((preset) => prefixMatch(filename, preset.filename_pattern))
  if (match) {
    console.log('[Preset Match] Prefix match found:', match.filename_pattern)
    return match
  }

  console.log('[Preset Match] No match found for:', filename)
  return null
}

// ============================================================================
// Matching Score (for future ranking)
// ============================================================================

/**
 * Calculate matching score (0-100)
 * Higher score = better match
 * Can be used for ranking multiple matches in the future
 */
export function calculateMatchScore(filename: string, pattern: string): number {
  // Exact match = 100 points
  if (exactMatch(filename, pattern)) {
    return 100
  }

  // Fuzzy match = 80 points
  if (fuzzyMatch(filename, pattern)) {
    return 80
  }

  // Prefix match = 60 points
  if (prefixMatch(filename, pattern)) {
    return 60
  }

  // No match = 0 points
  return 0
}

/**
 * Find best matching preset (highest score)
 * Returns null if no match found
 */
export function findBestMatchingPreset(
  presets: UserPreset[],
  filename: string
): UserPreset | null {
  if (!filename || presets.length === 0) {
    return null
  }

  // Calculate scores for all presets
  const scored = presets.map((preset) => ({
    preset,
    score: calculateMatchScore(filename, preset.filename_pattern),
  }))

  // Sort by score (highest first)
  scored.sort((a, b) => b.score - a.score)

  // Return best match if score > 0
  const best = scored[0]
  if (best && best.score > 0) {
    console.log(
      `[Preset Match] Best match: ${best.preset.filename_pattern} (score: ${best.score})`
    )
    return best.preset
  }

  console.log('[Preset Match] No match found for:', filename)
  return null
}
