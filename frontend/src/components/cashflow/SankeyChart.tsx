'use client'

import { Sankey, Tooltip, ResponsiveContainer, Layer, Rectangle } from 'recharts'
import type { SankeyPayload } from '@/types/cashflow-sankey'
import type { NodeProps, LinkProps } from 'recharts/types/chart/Sankey'

interface Props {
  payload: SankeyPayload
  onNodeClick: (nodeId: string, label: string) => void
}

function formatCurrency(amount: number): string {
  return amount.toLocaleString('th-TH', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })
}

function CustomNode(
  props: NodeProps & { sankeyNodes: SankeyPayload['nodes']; onNodeClick: (nodeId: string, label: string) => void },
) {
  const { x, y, width, height, index, sankeyNodes, onNodeClick } = props
  const node = sankeyNodes[index]
  if (!node) return null

  const color = node.color ?? '#94a3b8'
  const label = node.name
  const isRightAligned = node.layer === 'category'
  const labelX = isRightAligned ? x + width + 6 : x - 6
  const textAnchor = isRightAligned ? 'start' : 'end'

  return (
    <Layer>
      <Rectangle
        x={x}
        y={y}
        width={width}
        height={height}
        fill={color}
        fillOpacity={0.9}
        stroke={color}
        strokeWidth={1}
        style={{ cursor: 'pointer' }}
        onClick={() => onNodeClick(node.nodeId, label)}
      />
      <text
        x={labelX}
        y={y + height / 2}
        dy="0.35em"
        textAnchor={textAnchor}
        fontSize={11}
        fill="#374151"
        style={{ pointerEvents: 'none', userSelect: 'none' }}
      >
        {label}
      </text>
    </Layer>
  )
}

function CustomLink(
  props: LinkProps & { sankeyNodes: SankeyPayload['nodes'] },
) {
  const {
    sourceX,
    targetX,
    sourceY,
    targetY,
    sourceControlX,
    targetControlX,
    linkWidth,
    payload,
    sankeyNodes,
  } = props

  // Determine source color from our node list via source node name match
  const sourceNode = payload?.source
  let color = '#94a3b8'
  if (sourceNode) {
    // Find our custom node by name to get the color
    const match = sankeyNodes.find(n => n.name === sourceNode.name)
    if (match) color = match.color
  }

  return (
    <path
      d={`
        M${sourceX},${sourceY}
        C${sourceControlX},${sourceY} ${targetControlX},${targetY} ${targetX},${targetY}
      `}
      fill="none"
      stroke={color}
      strokeWidth={linkWidth}
      strokeOpacity={0.35}
      style={{ pointerEvents: 'none' }}
    />
  )
}

export default function SankeyChart({ payload, onNodeClick }: Props) {
  if (!payload || payload.nodes.length === 0) {
    return (
      <div className="flex h-40 items-center justify-center text-sm text-muted-foreground">
        ไม่มีข้อมูลในช่วงเวลาที่เลือก
      </div>
    )
  }

  const chartHeight = Math.max(400, payload.nodes.length * 35)

  const sankeyData = {
    nodes: payload.nodes.map(n => ({ name: n.name })),
    links: payload.links.map(l => ({
      source: l.source,
      target: l.target,
      value: Math.max(l.value, 0.01), // avoid zero-value links crashing layout
    })),
  }

  return (
    <div style={{ width: '100%', height: chartHeight, overflowX: 'auto' }}>
      <ResponsiveContainer width="100%" height={chartHeight}>
        <Sankey
          data={sankeyData}
          nodeWidth={15}
          nodePadding={12}
          sort={false}
          margin={{ top: 10, right: 160, bottom: 10, left: 10 }}
          node={(props: NodeProps) => (
            <CustomNode
              {...props}
              sankeyNodes={payload.nodes}
              onNodeClick={onNodeClick}
            />
          )}
          link={(props: LinkProps) => (
            <CustomLink {...props} sankeyNodes={payload.nodes} />
          )}
        >
          <Tooltip
            formatter={(value: number | undefined, name: string | undefined) => [
              value !== undefined ? `฿${formatCurrency(value)}` : '—',
              name ?? '',
            ]}
          />
        </Sankey>
      </ResponsiveContainer>
    </div>
  )
}
