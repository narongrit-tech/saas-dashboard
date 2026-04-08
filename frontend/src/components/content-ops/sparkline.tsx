// Server component — pure SVG, no client JS needed

interface SparklineProps {
  data: number[]
  width?: number
  height?: number
  positiveColor?: string
  negativeColor?: string
}

export function Sparkline({ data, width = 64, height = 22 }: SparklineProps) {
  if (!data || data.length < 2) {
    return (
      <svg width={width} height={height} aria-hidden>
        <line
          x1={0} y1={height / 2}
          x2={width} y2={height / 2}
          stroke="currentColor" strokeWidth={1} strokeOpacity={0.15}
        />
      </svg>
    )
  }

  const max = Math.max(...data)
  const min = Math.min(...data)
  const range = max - min || 1
  const pad = 2

  const points = data
    .map((v, i) => {
      const x = (i / (data.length - 1)) * width
      const y = (height - pad) - ((v - min) / range) * (height - pad * 2) + pad
      return `${x.toFixed(1)},${y.toFixed(1)}`
    })
    .join(' ')

  // Color based on trend direction
  const trend = data[data.length - 1] - data[0]
  const strokeColor = trend > 0 ? '#10b981' : trend < 0 ? '#ef4444' : '#94a3b8'

  return (
    <svg width={width} height={height} aria-hidden style={{ overflow: 'visible' }}>
      <polyline
        points={points}
        fill="none"
        stroke={strokeColor}
        strokeWidth={1.5}
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeOpacity={0.8}
      />
    </svg>
  )
}
