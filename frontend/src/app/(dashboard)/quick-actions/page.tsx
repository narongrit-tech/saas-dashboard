import Link from 'next/link'
import {
  Video, Radio, ShoppingCart, Users, Receipt, Landmark, ShoppingBag,
  PlusCircle, Building2, CreditCard, UserCheck, PackagePlus, RotateCcw,
  Calculator, RefreshCw, GitCompare, Scale, PackageSearch,
  LayoutDashboard, TrendingUp, FileBarChart, Wallet, Banknote, Package,
  ChevronRight, Zap,
} from 'lucide-react'
import type { LucideIcon } from 'lucide-react'

interface ActionItem {
  icon: LucideIcon
  title: string
  description: string
  href: string
  iconBg: string
  iconColor: string
}

function ActionCard({ icon: Icon, title, description, href, iconBg, iconColor }: ActionItem) {
  return (
    <Link
      href={href}
      className="flex items-center gap-4 p-4 rounded-xl border bg-card hover:bg-accent/5 active:scale-[0.98] active:bg-accent/10 transition-all duration-150 cursor-pointer"
    >
      <div className={`p-3 rounded-xl ${iconBg} flex-shrink-0`}>
        <Icon className={`h-5 w-5 ${iconColor}`} />
      </div>
      <div className="min-w-0 flex-1">
        <p className="font-semibold text-sm text-foreground">{title}</p>
        <p className="text-xs text-muted-foreground mt-0.5 leading-relaxed">{description}</p>
      </div>
      <ChevronRight className="h-4 w-4 text-muted-foreground/40 flex-shrink-0" />
    </Link>
  )
}

function Section({
  title,
  subtitle,
  children,
}: {
  title: string
  subtitle?: string
  children: React.ReactNode
}) {
  return (
    <div className="space-y-2">
      <div className="px-1 pb-0.5">
        <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          {title}
        </p>
        {subtitle && <p className="text-xs text-muted-foreground/70 mt-0.5">{subtitle}</p>}
      </div>
      <div className="space-y-1.5">{children}</div>
    </div>
  )
}

// ─── Action data ─────────────────────────────────────────────────────────────

const importActions: ActionItem[] = [
  {
    icon: Video,
    title: 'Import TikTok Ads',
    description: 'นำเข้าข้อมูลโฆษณา TikTok รายวัน (ad_daily_performance)',
    href: '/ads',
    iconBg: 'bg-violet-50 dark:bg-violet-900/20',
    iconColor: 'text-violet-600 dark:text-violet-400',
  },
  {
    icon: Radio,
    title: 'Import TikTok Live GMV',
    description: 'นำเข้ายอดขายจาก TikTok Live / คำสั่งซื้อ',
    href: '/sales',
    iconBg: 'bg-pink-50 dark:bg-pink-900/20',
    iconColor: 'text-pink-600 dark:text-pink-400',
  },
  {
    icon: ShoppingCart,
    title: 'Import Orders',
    description: 'นำเข้าคำสั่งซื้อ TikTok / Shopee (Sales page)',
    href: '/sales',
    iconBg: 'bg-blue-50 dark:bg-blue-900/20',
    iconColor: 'text-blue-600 dark:text-blue-400',
  },
  {
    icon: Users,
    title: 'Import Affiliate Orders',
    description: 'นำเข้ารายการ Affiliate จาก CSV',
    href: '/affiliates',
    iconBg: 'bg-indigo-50 dark:bg-indigo-900/20',
    iconColor: 'text-indigo-600 dark:text-indigo-400',
  },
  {
    icon: Receipt,
    title: 'Import Expenses',
    description: 'นำเข้าค่าใช้จ่ายจากไฟล์ CSV / Excel',
    href: '/expenses',
    iconBg: 'bg-rose-50 dark:bg-rose-900/20',
    iconColor: 'text-rose-600 dark:text-rose-400',
  },
  {
    icon: Landmark,
    title: 'Import Bank Statement',
    description: 'นำเข้า Statement ธนาคารเพื่อ Reconciliation',
    href: '/bank',
    iconBg: 'bg-slate-50 dark:bg-slate-900/20',
    iconColor: 'text-slate-600 dark:text-slate-400',
  },
  {
    icon: ShoppingBag,
    title: 'Import Shopee Finance',
    description: 'นำเข้า Balance Report / Settlement จาก Shopee',
    href: '/finance/shopee',
    iconBg: 'bg-orange-50 dark:bg-orange-900/20',
    iconColor: 'text-orange-600 dark:text-orange-400',
  },
]

const manualEntryActions: ActionItem[] = [
  {
    icon: PlusCircle,
    title: 'Add Expense',
    description: 'บันทึกค่าใช้จ่ายใหม่ด้วยตนเอง',
    href: '/expenses',
    iconBg: 'bg-rose-50 dark:bg-rose-900/20',
    iconColor: 'text-rose-600 dark:text-rose-400',
  },
  {
    icon: Building2,
    title: 'Add Bank Transaction',
    description: 'เพิ่มรายการธุรกรรมธนาคารด้วยตนเอง',
    href: '/bank',
    iconBg: 'bg-slate-50 dark:bg-slate-900/20',
    iconColor: 'text-slate-600 dark:text-slate-400',
  },
  {
    icon: CreditCard,
    title: 'Add Wallet Transaction',
    description: 'เติมเงิน / ถอนเงินใน Wallet ของแพลตฟอร์ม',
    href: '/wallets',
    iconBg: 'bg-purple-50 dark:bg-purple-900/20',
    iconColor: 'text-purple-600 dark:text-purple-400',
  },
  {
    icon: UserCheck,
    title: 'Add CEO Commission',
    description: 'บันทึก Commission ของ CEO',
    href: '/ceo-commission',
    iconBg: 'bg-amber-50 dark:bg-amber-900/20',
    iconColor: 'text-amber-600 dark:text-amber-400',
  },
  {
    icon: PackagePlus,
    title: 'Adjust Inventory',
    description: 'ปรับยอด Stock / เพิ่ม Opening Balance',
    href: '/inventory',
    iconBg: 'bg-green-50 dark:bg-green-900/20',
    iconColor: 'text-green-600 dark:text-green-400',
  },
  {
    icon: RotateCcw,
    title: 'Add Return / Refund',
    description: 'บันทึกการคืนสินค้าหรือขอคืนเงิน',
    href: '/returns',
    iconBg: 'bg-orange-50 dark:bg-orange-900/20',
    iconColor: 'text-orange-600 dark:text-orange-400',
  },
]

const operationsActions: ActionItem[] = [
  {
    icon: Calculator,
    title: 'Run COGS Allocation',
    description: 'คำนวณต้นทุนสินค้า (COGS) สำหรับช่วงเวลาที่เลือก',
    href: '/inventory',
    iconBg: 'bg-orange-50 dark:bg-orange-900/20',
    iconColor: 'text-orange-600 dark:text-orange-400',
  },
  {
    icon: RefreshCw,
    title: 'Rebuild Profit Summary',
    description: 'สร้างรายงาน P&L ใหม่จากข้อมูลล่าสุด',
    href: '/daily-pl',
    iconBg: 'bg-green-50 dark:bg-green-900/20',
    iconColor: 'text-green-600 dark:text-green-400',
  },
  {
    icon: GitCompare,
    title: 'Reconcile Wallet',
    description: 'ตรวจสอบความถูกต้องของยอด Wallet กับรายจ่าย',
    href: '/reconciliation',
    iconBg: 'bg-blue-50 dark:bg-blue-900/20',
    iconColor: 'text-blue-600 dark:text-blue-400',
  },
  {
    icon: Scale,
    title: 'Run Bank Reconciliation',
    description: 'จับคู่รายการธนาคารกับระบบ',
    href: '/bank-reconciliation',
    iconBg: 'bg-slate-50 dark:bg-slate-900/20',
    iconColor: 'text-slate-600 dark:text-slate-400',
  },
  {
    icon: PackageSearch,
    title: 'Fix Missing SKU',
    description: 'กำหนด SKU สำหรับ Orders ที่ยังไม่มี SKU',
    href: '/inventory',
    iconBg: 'bg-amber-50 dark:bg-amber-900/20',
    iconColor: 'text-amber-600 dark:text-amber-400',
  },
]

const navShortcuts: ActionItem[] = [
  {
    icon: LayoutDashboard,
    title: 'Performance Dashboard',
    description: 'GMV · Ad Spend · COGS · Net Profit',
    href: '/',
    iconBg: 'bg-primary/10',
    iconColor: 'text-primary',
  },
  {
    icon: TrendingUp,
    title: 'Sales Orders',
    description: 'ดูและค้นหาคำสั่งซื้อทั้งหมด',
    href: '/sales',
    iconBg: 'bg-blue-50 dark:bg-blue-900/20',
    iconColor: 'text-blue-600 dark:text-blue-400',
  },
  {
    icon: Receipt,
    title: 'Expenses',
    description: 'ค่าใช้จ่ายและสถานะการจ่ายเงิน',
    href: '/expenses',
    iconBg: 'bg-rose-50 dark:bg-rose-900/20',
    iconColor: 'text-rose-600 dark:text-rose-400',
  },
  {
    icon: Wallet,
    title: 'Marketplace Finance',
    description: 'ยอดรวมและรายการ Wallet ทุกแพลตฟอร์ม',
    href: '/finance/marketplaces',
    iconBg: 'bg-purple-50 dark:bg-purple-900/20',
    iconColor: 'text-purple-600 dark:text-purple-400',
  },
  {
    icon: Landmark,
    title: 'Bank',
    description: 'รายการธุรกรรมธนาคาร',
    href: '/bank',
    iconBg: 'bg-slate-50 dark:bg-slate-900/20',
    iconColor: 'text-slate-600 dark:text-slate-400',
  },
  {
    icon: Package,
    title: 'Inventory',
    description: 'สต็อก · COGS · Bundle · SKU',
    href: '/inventory',
    iconBg: 'bg-green-50 dark:bg-green-900/20',
    iconColor: 'text-green-600 dark:text-green-400',
  },
  {
    icon: Banknote,
    title: 'Cash P&L',
    description: 'กระแสเงินสดรับ-จ่าย',
    href: '/reports/cash-pl',
    iconBg: 'bg-emerald-50 dark:bg-emerald-900/20',
    iconColor: 'text-emerald-600 dark:text-emerald-400',
  },
  {
    icon: FileBarChart,
    title: 'Affiliate Report',
    description: 'รายงาน Affiliate Creator',
    href: '/reports/affiliate',
    iconBg: 'bg-indigo-50 dark:bg-indigo-900/20',
    iconColor: 'text-indigo-600 dark:text-indigo-400',
  },
]

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function QuickActionsPage() {
  return (
    <div className="space-y-6 pb-10">

      {/* Header */}
      <div className="rounded-xl border bg-card px-4 py-4 shadow-sm sm:px-5">
        <div className="flex items-center gap-3">
          <div className="p-2 rounded-lg bg-primary/10">
            <Zap className="h-5 w-5 text-primary" />
          </div>
          <div>
            <h1 className="text-xl font-bold tracking-tight">Quick Actions</h1>
            <p className="text-xs text-muted-foreground mt-0.5">
              ทุก Action ในที่เดียว — นำเข้า · บันทึก · ประมวลผล
            </p>
          </div>
        </div>
      </div>

      {/* Imports */}
      <Section
        title="Imports"
        subtitle="นำเข้าข้อมูลจากไฟล์หรือแพลตฟอร์มภายนอก"
      >
        {importActions.map((a) => (
          <ActionCard key={a.title} {...a} />
        ))}
      </Section>

      {/* Manual Entry */}
      <Section
        title="Manual Entry"
        subtitle="บันทึกรายการด้วยตนเองโดยไม่ต้องนำเข้าไฟล์"
      >
        {manualEntryActions.map((a) => (
          <ActionCard key={a.title} {...a} />
        ))}
      </Section>

      {/* Operations */}
      <Section
        title="Operations"
        subtitle="งานประมวลผลและ Reconciliation"
      >
        {operationsActions.map((a) => (
          <ActionCard key={a.title} {...a} />
        ))}
      </Section>

      {/* Navigation Shortcuts */}
      <Section
        title="Navigation Shortcuts"
        subtitle="ไปยังหน้าหลักได้เร็วขึ้น"
      >
        {navShortcuts.map((a) => (
          <ActionCard key={a.title} {...a} />
        ))}
      </Section>

    </div>
  )
}
