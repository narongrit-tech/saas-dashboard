import { redirect } from 'next/navigation'

export const dynamic = 'force-dynamic'

export default function StudioAnalyticsPage() {
  redirect('/content-ops/video-master')
}
