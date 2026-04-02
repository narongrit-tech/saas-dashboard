import {
  CheckCircle2,
  Clock3,
  ClipboardList,
  Film,
  Link2,
  Search,
  Sparkles,
} from 'lucide-react'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { Textarea } from '@/components/ui/textarea'
import { cn } from '@/lib/utils'

type ContentStatus = 'Pending' | 'Ready' | 'Done' | 'Error'

interface ContentLibraryItem {
  id: number
  url: string
  platform: 'TikTok' | 'Facebook' | 'Instagram' | 'YouTube'
  status: ContentStatus
  assignee: string
  createdAt: string
  note: string
}

const contentLibraryItems: ContentLibraryItem[] = [
  {
    id: 1,
    url: 'https://www.tiktok.com/@luma/video/7617553854787325204',
    platform: 'TikTok',
    status: 'Pending',
    assignee: 'Ning',
    createdAt: '2026-04-02 14:20',
    note: 'New creator test for April launch.',
  },
  {
    id: 2,
    url: 'https://www.tiktok.com/@luma/video/7572031272206290194',
    platform: 'TikTok',
    status: 'Ready',
    assignee: 'Pang',
    createdAt: '2026-04-02 13:55',
    note: 'Ready for worker-side metadata enrichment next phase.',
  },
  {
    id: 3,
    url: 'https://www.instagram.com/reel/DAB12cdEfg7/',
    platform: 'Instagram',
    status: 'Done',
    assignee: 'Yok',
    createdAt: '2026-04-02 13:10',
    note: 'Registered for evergreen content tracking.',
  },
  {
    id: 4,
    url: 'https://www.youtube.com/shorts/6fpwz8H8QfM',
    platform: 'YouTube',
    status: 'Error',
    assignee: 'Toey',
    createdAt: '2026-04-02 12:42',
    note: 'Link needs manual validation before retrying.',
  },
]

function getStatusClasses(status: ContentStatus) {
  switch (status) {
    case 'Pending':
      return 'border-amber-200 bg-amber-50 text-amber-700'
    case 'Ready':
      return 'border-sky-200 bg-sky-50 text-sky-700'
    case 'Done':
      return 'border-emerald-200 bg-emerald-50 text-emerald-700'
    case 'Error':
      return 'border-rose-200 bg-rose-50 text-rose-700'
  }
}

function getSummaryStats(items: ContentLibraryItem[]) {
  return [
    {
      label: 'Registered Links',
      value: items.length,
      icon: Link2,
      iconClassName: 'text-primary',
      panelClassName: 'bg-primary/5',
    },
    {
      label: 'Pending Intake',
      value: items.filter((item) => item.status === 'Pending').length,
      icon: Clock3,
      iconClassName: 'text-amber-600',
      panelClassName: 'bg-amber-50',
    },
    {
      label: 'Ready Next',
      value: items.filter((item) => item.status === 'Ready').length,
      icon: Sparkles,
      iconClassName: 'text-sky-600',
      panelClassName: 'bg-sky-50',
    },
    {
      label: 'Completed',
      value: items.filter((item) => item.status === 'Done').length,
      icon: CheckCircle2,
      iconClassName: 'text-emerald-600',
      panelClassName: 'bg-emerald-50',
    },
  ]
}

function ContentLibraryTableRow({ item }: { item: ContentLibraryItem }) {
  const videoId = item.url.split('/').filter(Boolean).pop() ?? '-'

  return (
    <TableRow>
      <TableCell className="text-muted-foreground">{item.id}</TableCell>
      <TableCell className="min-w-[320px]">
        <div className="space-y-1">
          <div className="truncate font-medium">{item.url}</div>
          <div className="text-xs text-muted-foreground">
            Source ID: {videoId} - Mock queue item for Phase 1 UI.
          </div>
        </div>
      </TableCell>
      <TableCell>{item.platform}</TableCell>
      <TableCell>
        <Badge variant="outline" className={cn('font-medium', getStatusClasses(item.status))}>
          {item.status}
        </Badge>
      </TableCell>
      <TableCell>{item.assignee}</TableCell>
      <TableCell className="text-muted-foreground">{item.createdAt}</TableCell>
      <TableCell className="text-muted-foreground">{item.note}</TableCell>
    </TableRow>
  )
}

export default function ContentLibraryPage() {
  const summaryStats = getSummaryStats(contentLibraryItems)

  return (
    <div className="space-y-6 pb-8">
      <Card className="overflow-hidden border-border/70">
        <CardContent className="grid gap-6 p-6 lg:grid-cols-[minmax(0,1fr),420px] lg:items-start">
          <div className="space-y-4">
            <Badge variant="outline" className="w-fit border-primary/20 bg-primary/5 text-primary">
              Content Ops - Phase 1
            </Badge>
            <div className="space-y-2">
              <p className="text-sm font-medium uppercase tracking-[0.2em] text-muted-foreground">
                Content Ops
              </p>
              <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">
                Content Ops / Content Library
              </h1>
              <p className="max-w-3xl text-sm text-muted-foreground sm:text-base">
                Register content URLs in the dashboard first, then layer in automation, enrichment,
                and attribution flows without changing the route structure later.
              </p>
            </div>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            {summaryStats.map((stat) => {
              const Icon = stat.icon

              return (
                <div
                  key={stat.label}
                  className="rounded-xl border border-border/70 bg-background px-4 py-4"
                >
                  <div className="flex items-center justify-between">
                    <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                      {stat.label}
                    </div>
                    <div
                      className={cn(
                        'flex h-9 w-9 items-center justify-center rounded-lg',
                        stat.panelClassName
                      )}
                    >
                      <Icon className={cn('h-4 w-4', stat.iconClassName)} />
                    </div>
                  </div>
                  <div className="mt-3 text-3xl font-semibold">{stat.value}</div>
                </div>
              )
            })}
          </div>
        </CardContent>
      </Card>

      <div className="grid gap-6 xl:grid-cols-[360px,minmax(0,1fr)]">
        <Card className="border-border/70">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Film className="h-5 w-5 text-primary" />
              Content Intake
            </CardTitle>
            <CardDescription>
              Phase 1 keeps intake lightweight so staff can register URLs immediately while the
              back-end workflow is still being added.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-5">
            <div className="space-y-2">
              <Label htmlFor="platform">Platform</Label>
              <Select defaultValue="tiktok">
                <SelectTrigger id="platform">
                  <SelectValue placeholder="Select a platform" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="tiktok">TikTok</SelectItem>
                  <SelectItem value="facebook">Facebook</SelectItem>
                  <SelectItem value="instagram">Instagram</SelectItem>
                  <SelectItem value="youtube">YouTube</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label htmlFor="content-url">Content URLs</Label>
              <Textarea
                id="content-url"
                className="min-h-[140px] resize-none"
                placeholder="Paste one or more content URLs, one per line."
              />
              <p className="text-xs text-muted-foreground">
                Mock UI only for now. Database writes and server actions will plug into this
                layout next.
              </p>
            </div>

            <div className="grid gap-5 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="assignee">Assignee</Label>
                <Select defaultValue="unassigned">
                  <SelectTrigger id="assignee">
                    <SelectValue placeholder="Select an assignee" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="unassigned">Unassigned</SelectItem>
                    <SelectItem value="ning">Ning</SelectItem>
                    <SelectItem value="pang">Pang</SelectItem>
                    <SelectItem value="yok">Yok</SelectItem>
                    <SelectItem value="toey">Toey</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <Label htmlFor="initial-status">Initial Status</Label>
                <Select defaultValue="pending">
                  <SelectTrigger id="initial-status">
                    <SelectValue placeholder="Select a status" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="pending">Pending</SelectItem>
                    <SelectItem value="ready">Ready</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="note">Notes</Label>
              <Input
                id="note"
                placeholder="Optional context for editors, reviewers, or future automation."
              />
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              <Button type="button">Register Mock URLs</Button>
              <Button type="button" variant="outline">
                Clear Form
              </Button>
            </div>
          </CardContent>
        </Card>

        <div className="space-y-6">
          <Card className="border-border/70">
            <CardHeader className="gap-4 lg:flex-row lg:items-start lg:justify-between">
              <div className="space-y-1.5">
                <CardTitle className="flex items-center gap-2">
                  <ClipboardList className="h-5 w-5 text-primary" />
                  Content Library Queue
                </CardTitle>
                <CardDescription>
                  Static sample queue for the first dashboard-facing screen of the Content Ops
                  module.
                </CardDescription>
              </div>

              <div className="flex w-full flex-col gap-3 sm:max-w-xl sm:flex-row">
                <div className="relative flex-1">
                  <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                  <Input className="pl-9" placeholder="Search URL, source ID, or assignee" />
                </div>
                <Select defaultValue="all">
                  <SelectTrigger className="w-full sm:w-[180px]">
                    <SelectValue placeholder="All statuses" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All statuses</SelectItem>
                    <SelectItem value="pending">Pending</SelectItem>
                    <SelectItem value="ready">Ready</SelectItem>
                    <SelectItem value="done">Done</SelectItem>
                    <SelectItem value="error">Error</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </CardHeader>

            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-14">#</TableHead>
                    <TableHead>Content URL</TableHead>
                    <TableHead className="w-28">Platform</TableHead>
                    <TableHead className="w-28">Status</TableHead>
                    <TableHead className="w-28">Assignee</TableHead>
                    <TableHead className="w-40">Created</TableHead>
                    <TableHead className="min-w-[180px]">Notes</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {contentLibraryItems.map((item) => (
                    <ContentLibraryTableRow key={item.id} item={item} />
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>

          <div className="grid gap-6 lg:grid-cols-2">
            <Card className="border-border/70">
              <CardHeader>
                <CardTitle>Phase Scope</CardTitle>
                <CardDescription>What this first Content Ops release covers.</CardDescription>
              </CardHeader>
              <CardContent className="space-y-3 text-sm text-muted-foreground">
                <div className="rounded-lg border bg-muted/30 px-4 py-3">
                  Capture content URLs inside the SaaS dashboard.
                </div>
                <div className="rounded-lg border bg-muted/30 px-4 py-3">
                  Let operations staff assign ownership and set an initial workflow status.
                </div>
                <div className="rounded-lg border bg-muted/30 px-4 py-3">
                  Give the team one shared queue before server-side automation is wired in.
                </div>
              </CardContent>
            </Card>

            <Card className="border-border/70">
              <CardHeader>
                <CardTitle>Next Phase</CardTitle>
                <CardDescription>Planned extensions within the Content Ops module.</CardDescription>
              </CardHeader>
              <CardContent className="space-y-3 text-sm text-muted-foreground">
                <div className="rounded-lg border bg-muted/30 px-4 py-3">
                  Persist queue items with database-backed server actions.
                </div>
                <div className="rounded-lg border bg-muted/30 px-4 py-3">
                  Add automation outputs such as metadata enrichment and thumbnail capture.
                </div>
                <div className="rounded-lg border bg-muted/30 px-4 py-3">
                  Expand the module with performance, sales attribution, planning, and editors.
                </div>
              </CardContent>
            </Card>
          </div>
        </div>
      </div>
    </div>
  )
}
