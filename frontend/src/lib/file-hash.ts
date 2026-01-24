/**
 * File Hash Utilities
 * Calculate SHA256 hash for file deduplication
 */

/**
 * Calculate SHA256 hash of ArrayBuffer using Web Crypto API
 * Returns hex string
 */
export async function calculateFileHash(buffer: ArrayBuffer): Promise<string> {
  const hashBuffer = await crypto.subtle.digest('SHA-256', buffer)
  const hashArray = Array.from(new Uint8Array(hashBuffer))
  const hashHex = hashArray.map(b => b.toString(16).padStart(2, '0')).join('')
  return hashHex
}

/**
 * Sanitize data to plain objects (JSON-safe)
 * Removes Date objects, Map, Set, etc.
 */
export function toPlain<T>(data: T): T {
  return JSON.parse(JSON.stringify(data))
}
