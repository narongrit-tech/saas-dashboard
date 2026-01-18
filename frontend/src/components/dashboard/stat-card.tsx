import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { LucideIcon } from 'lucide-react'
import { cn } from '@/lib/utils'

interface StatCardProps {
  title: string
  value: string | number
  change?: {
    value: number
    label: string
  }
  icon: LucideIcon
  color?: 'green' | 'red' | 'blue' | 'gray'
}

const colorClasses = {
  green: 'bg-green-50 text-green-600',
  red: 'bg-red-50 text-red-600',
  blue: 'bg-blue-50 text-blue-600',
  gray: 'bg-gray-50 text-gray-600',
}

const changeColorClasses = {
  positive: 'text-green-600 bg-green-50',
  negative: 'text-red-600 bg-red-50',
}

export function StatCard({ title, value, change, icon: Icon, color = 'gray' }: StatCardProps) {
  const isPositive = change && change.value >= 0

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
        <CardTitle className="text-sm font-medium">{title}</CardTitle>
        <div className={cn('rounded-lg p-2', colorClasses[color])}>
          <Icon className="h-4 w-4" />
        </div>
      </CardHeader>
      <CardContent>
        <div className="text-2xl font-bold">{value}</div>
        {change && (
          <div className="mt-2 flex items-center gap-2">
            <span
              className={cn(
                'inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium',
                isPositive ? changeColorClasses.positive : changeColorClasses.negative
              )}
            >
              {isPositive ? '+' : ''}
              {change.value}%
            </span>
            <p className="text-xs text-muted-foreground">{change.label}</p>
          </div>
        )}
      </CardContent>
    </Card>
  )
}
