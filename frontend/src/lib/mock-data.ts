import { format, subDays } from 'date-fns'

// Summary Statistics
export interface DashboardStats {
  totalSalesToday: {
    value: number
    change: number
    label: string
  }
  totalExpensesToday: {
    value: number
    change: number
    label: string
  }
  netProfitToday: {
    value: number
    change: number
    label: string
  }
  cashOnHand: {
    value: number
    transactions: number
  }
}

export const dashboardStats: DashboardStats = {
  totalSalesToday: {
    value: 15450,
    change: 12.5,
    label: 'from yesterday',
  },
  totalExpensesToday: {
    value: 8230,
    change: -5.2,
    label: 'from yesterday',
  },
  netProfitToday: {
    value: 7220,
    change: 8.1,
    label: 'margin',
  },
  cashOnHand: {
    value: 125890,
    transactions: 3,
  },
}

// Sales Trend Data
export interface SalesTrendData {
  date: string
  sales: number
}

export const generateSalesTrend = (): SalesTrendData[] => {
  const days = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']
  return days.map((day) => ({
    date: day,
    sales: Math.floor(Math.random() * 8000) + 2000,
  }))
}

export const salesTrendData: SalesTrendData[] = [
  { date: 'Mon', sales: 2400 },
  { date: 'Tue', sales: 1398 },
  { date: 'Wed', sales: 9800 },
  { date: 'Thu', sales: 3908 },
  { date: 'Fri', sales: 4800 },
  { date: 'Sat', sales: 3800 },
  { date: 'Sun', sales: 4300 },
]

// Orders Data
export interface Order {
  id: string
  customer: string
  amount: number
  status: 'completed' | 'pending' | 'processing'
  date: string
}

export const recentOrders: Order[] = [
  {
    id: 'ORD-001',
    customer: 'John Doe',
    amount: 1250.0,
    status: 'completed',
    date: format(new Date(), 'yyyy-MM-dd'),
  },
  {
    id: 'ORD-002',
    customer: 'Jane Smith',
    amount: 850.5,
    status: 'pending',
    date: format(new Date(), 'yyyy-MM-dd'),
  },
  {
    id: 'ORD-003',
    customer: 'Bob Johnson',
    amount: 2100.0,
    status: 'completed',
    date: format(subDays(new Date(), 1), 'yyyy-MM-dd'),
  },
  {
    id: 'ORD-004',
    customer: 'Alice Williams',
    amount: 650.75,
    status: 'processing',
    date: format(subDays(new Date(), 1), 'yyyy-MM-dd'),
  },
  {
    id: 'ORD-005',
    customer: 'Charlie Brown',
    amount: 1450.0,
    status: 'completed',
    date: format(subDays(new Date(), 2), 'yyyy-MM-dd'),
  },
]

// Expenses Data
export interface Expense {
  id: string
  category: string
  description: string
  amount: number
  date: string
}

export const recentExpenses: Expense[] = [
  {
    id: 'EXP-001',
    category: 'Office Supplies',
    description: 'Stationery and printer ink',
    amount: 450.0,
    date: format(new Date(), 'yyyy-MM-dd'),
  },
  {
    id: 'EXP-002',
    category: 'Utilities',
    description: 'Internet and electricity bill',
    amount: 3200.0,
    date: format(new Date(), 'yyyy-MM-dd'),
  },
  {
    id: 'EXP-003',
    category: 'Marketing',
    description: 'Facebook ads campaign',
    amount: 5000.0,
    date: format(subDays(new Date(), 1), 'yyyy-MM-dd'),
  },
]

// Inventory Data
export interface InventoryItem {
  id: string
  name: string
  sku: string
  quantity: number
  unit: string
  costPerUnit: number
  totalValue: number
}

export const inventoryItems: InventoryItem[] = [
  {
    id: 'INV-001',
    name: 'Product A',
    sku: 'SKU-001',
    quantity: 150,
    unit: 'pcs',
    costPerUnit: 250.0,
    totalValue: 37500.0,
  },
  {
    id: 'INV-002',
    name: 'Product B',
    sku: 'SKU-002',
    quantity: 80,
    unit: 'pcs',
    costPerUnit: 450.0,
    totalValue: 36000.0,
  },
  {
    id: 'INV-003',
    name: 'Product C',
    sku: 'SKU-003',
    quantity: 200,
    unit: 'pcs',
    costPerUnit: 150.0,
    totalValue: 30000.0,
  },
]

// Status Colors
export const statusColors = {
  completed: 'bg-green-100 text-green-800',
  pending: 'bg-yellow-100 text-yellow-800',
  processing: 'bg-blue-100 text-blue-800',
} as const

// Format currency
export const formatCurrency = (amount: number): string => {
  return `฿${amount.toLocaleString('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

// Format currency without decimals
export const formatCurrencyShort = (amount: number): string => {
  return `฿${amount.toLocaleString('th-TH')}`
}
