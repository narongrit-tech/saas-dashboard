/**
 * Debug Serialization Helper
 * Find which field causes JSON.stringify to fail
 */

export function debugSerializable(obj: any, label: string = 'payload'): void {
  console.group(`🔍 Debug Serialization: ${label}`)

  try {
    const serialized = JSON.stringify(obj)
    console.log('✅ Serialization SUCCESS')
    console.log('Payload size:', serialized.length, 'bytes')
    console.log('Preview:', serialized.substring(0, 200) + '...')
  } catch (error: any) {
    console.error('❌ Serialization FAILED:', error.message)

    // Binary search to find problematic field
    console.log('🔎 Searching for problematic field...')
    findProblematicField(obj, label)
  }

  console.groupEnd()
}

function findProblematicField(obj: any, path: string = 'root'): void {
  if (obj === null || obj === undefined) {
    return
  }

  // Check if it's a primitive
  const type = typeof obj
  if (type !== 'object') {
    return
  }

  // Check if it's a special object type
  if (obj instanceof Date) {
    console.warn(`⚠️ Found Date at ${path}:`, obj)
    return
  }
  if (obj instanceof Map) {
    console.warn(`⚠️ Found Map at ${path}:`, obj)
    return
  }
  if (obj instanceof Set) {
    console.warn(`⚠️ Found Set at ${path}:`, obj)
    return
  }
  if (obj instanceof Error) {
    console.warn(`⚠️ Found Error at ${path}:`, obj)
    return
  }
  if (ArrayBuffer.isView(obj)) {
    console.warn(`⚠️ Found TypedArray/Buffer at ${path}:`, obj)
    return
  }
  if (obj instanceof ArrayBuffer) {
    console.warn(`⚠️ Found ArrayBuffer at ${path}:`, obj)
    return
  }

  // Check constructor
  const constructor = obj.constructor
  if (constructor && constructor !== Object && constructor !== Array) {
    console.warn(`⚠️ Found class instance at ${path}:`, constructor.name)
  }

  // Recursively check fields (if object or array)
  if (Array.isArray(obj)) {
    obj.forEach((item, index) => {
      try {
        JSON.stringify(item)
      } catch (e) {
        console.error(`❌ Array[${index}] at ${path}[${index}] is not serializable`)
        findProblematicField(item, `${path}[${index}]`)
      }
    })
  } else {
    const keys = Object.keys(obj)
    keys.forEach(key => {
      try {
        JSON.stringify(obj[key])
      } catch (e) {
        console.error(`❌ Field "${key}" at ${path}.${key} is not serializable`)
        findProblematicField(obj[key], `${path}.${key}`)
      }
    })
  }
}

/**
 * Test if value is JSON serializable
 */
export function isSerializable(value: any): boolean {
  try {
    JSON.stringify(value)
    return true
  } catch {
    return false
  }
}
