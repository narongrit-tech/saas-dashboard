// Server component — deterministic color + initials, image-ready

const PALETTE = [
  'bg-blue-500',
  'bg-emerald-500',
  'bg-violet-500',
  'bg-orange-500',
  'bg-cyan-500',
  'bg-rose-500',
  'bg-amber-500',
  'bg-indigo-500',
  'bg-teal-500',
  'bg-pink-500',
  'bg-sky-500',
  'bg-lime-500',
]

function hashIndex(str: string): number {
  let h = 0
  for (let i = 0; i < str.length; i++) {
    h = Math.imul(31, h) + str.charCodeAt(i) | 0
  }
  return Math.abs(h) % PALETTE.length
}

function getInitials(name: string): string {
  // Works for Thai and Latin text
  const cleaned = name.replace(/[^\p{L}\p{N}\s]/gu, ' ').trim()
  const words = cleaned.split(/\s+/).filter(Boolean)
  if (words.length >= 2) return (words[0][0] + words[1][0]).toUpperCase()
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase()
  return '?'
}

interface EntityAvatarProps {
  /** Display name — used for initials + color hashing */
  name: string
  /** Swap in a real image URL later without changing callers */
  imageUrl?: string
  size?: 'sm' | 'md' | 'lg'
}

const SIZE: Record<string, string> = {
  sm: 'w-7 h-7 text-xs rounded',
  md: 'w-9 h-9 text-sm rounded-lg',
  lg: 'w-11 h-11 text-base rounded-lg',
}

export function EntityAvatar({ name, imageUrl, size = 'md' }: EntityAvatarProps) {
  const colorClass = PALETTE[hashIndex(name)]
  const initials = getInitials(name)
  const sizeClass = SIZE[size]

  if (imageUrl) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={imageUrl}
        alt={name}
        className={`${sizeClass} object-cover shrink-0`}
      />
    )
  }

  return (
    <div
      className={`${colorClass} ${sizeClass} flex items-center justify-center text-white font-bold shrink-0 select-none`}
      title={name}
    >
      {initials}
    </div>
  )
}
