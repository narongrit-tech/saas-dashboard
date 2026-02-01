/**
 * Attribution Badge Component
 * Shows attribution type + commission for sales orders
 */

import { Badge } from '@/components/ui/badge'
import { OrderAttribution } from '@/types/profit-reports'

interface AttributionBadgeProps {
  attribution: OrderAttribution | null | undefined
  compact?: boolean
}

export function AttributionBadge({ attribution, compact = false }: AttributionBadgeProps) {
  if (!attribution) {
    return (
      <div className="flex flex-col gap-1">
        <Badge variant="outline" className="w-fit">
          ⚪ No Affiliate
        </Badge>
      </div>
    )
  }

  // Determine badge based on attribution_type and commission_type
  const getBadgeContent = () => {
    // Internal affiliate (Owned Channel)
    if (attribution.attribution_type === 'internal_affiliate') {
      return {
        emoji: '🟠',
        label: 'Owned Channel',
        variant: 'default' as const,
        className: 'bg-orange-500 hover:bg-orange-600'
      }
    }

    // External affiliate - check commission_type
    if (attribution.attribution_type === 'external_affiliate') {
      const commType = attribution.commission_type

      if (commType === 'mixed') {
        return {
          emoji: '🟪',
          label: 'Affiliate (Mixed)',
          variant: 'secondary' as const,
          className: 'bg-purple-500 hover:bg-purple-600 text-white'
        }
      } else if (commType === 'shop_ad') {
        return {
          emoji: '🔵',
          label: 'Affiliate (Shop Ad)',
          variant: 'secondary' as const,
          className: 'bg-blue-500 hover:bg-blue-600 text-white'
        }
      } else {
        // organic or default
        return {
          emoji: '🟣',
          label: 'Affiliate (Organic)',
          variant: 'secondary' as const,
          className: 'bg-purple-600 hover:bg-purple-700 text-white'
        }
      }
    }

    // Paid ads
    if (attribution.attribution_type === 'paid_ads') {
      return {
        emoji: '🔵',
        label: 'Paid Ads',
        variant: 'default' as const,
        className: 'bg-blue-600 hover:bg-blue-700'
      }
    }

    // Organic
    return {
      emoji: '🟢',
      label: 'Organic',
      variant: 'outline' as const,
      className: ''
    }
  }

  const badge = getBadgeContent()

  // Calculate total commission
  const totalCommission =
    (attribution.commission_amt_organic || 0) + (attribution.commission_amt_shop_ad || 0)

  return (
    <div className="flex flex-col gap-1">
      <Badge variant={badge.variant} className={`w-fit ${badge.className}`}>
        {badge.emoji} {badge.label}
      </Badge>
      {totalCommission > 0 && !compact && (
        <span className="text-xs text-muted-foreground">Comm: ฿{totalCommission.toLocaleString()}</span>
      )}
    </div>
  )
}

/**
 * Compact version for table cells
 */
export function AttributionBadgeCompact({ attribution }: { attribution: OrderAttribution | null | undefined }) {
  return <AttributionBadge attribution={attribution} compact />
}
