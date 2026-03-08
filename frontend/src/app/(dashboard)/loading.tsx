import { Card, CardContent, CardHeader } from '@/components/ui/card'

function Skeleton({ className }: { className?: string }) {
  return <div className={`animate-pulse rounded bg-muted ${className || ''}`} />
}

function SkeletonCard() {
  return (
    <Card>
      <CardHeader className="pb-1 pt-4 px-4">
        <Skeleton className="h-3 w-20" />
      </CardHeader>
      <CardContent className="pb-4 px-4 pt-1 space-y-2">
        <Skeleton className="h-7 w-28" />
        <Skeleton className="h-3 w-32" />
      </CardContent>
    </Card>
  )
}

export default function DashboardLoading() {
  return (
    <div className="space-y-6 pb-10">
      {/* Header card skeleton */}
      <div className="rounded-xl border bg-card px-4 py-4 shadow-sm sm:px-5 space-y-3">
        <Skeleton className="h-7 w-48" />
        <Skeleton className="h-3 w-64" />
        <Skeleton className="h-9 w-full sm:w-72" />
        <div className="pt-2.5 border-t">
          <Skeleton className="h-6 w-56" />
        </div>
      </div>
      {/* KPI cards skeleton */}
      <div>
        <Skeleton className="h-4 w-40 mb-4" />
        <div className="grid gap-3 grid-cols-2 sm:grid-cols-3 lg:grid-cols-6">
          {Array.from({ length: 6 }).map((_, i) => <SkeletonCard key={i} />)}
        </div>
      </div>
      {/* Chart skeleton */}
      <Card className="shadow-sm">
        <CardHeader className="pb-2 pt-5 px-5">
          <Skeleton className="h-5 w-28" />
          <Skeleton className="h-3 w-56 mt-1" />
        </CardHeader>
        <CardContent className="px-5 pb-5">
          <Skeleton className="h-[300px] w-full" />
        </CardContent>
      </Card>
    </div>
  )
}
