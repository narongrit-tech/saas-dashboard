// Minimal segment layout — required by Next.js App Router for segment-level config.
// NOTE: maxDuration is intentionally omitted. Production runs on Vercel Hobby (60 s
// limit). The allocation loop is kept under 60 s via ORDERS_PER_CHUNK + auto-resume.
// If the project upgrades to Vercel Pro, add: export const maxDuration = 300

export default function InventoryLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>
}
