import {
  BookText,
  CalendarDays,
  FileText,
  LayoutDashboard,
  Mail,
  ShieldCheck,
  Users,
  type LucideIcon,
} from 'lucide-react'

export interface NavItem {
  to: string
  key: string
  Icon: LucideIcon
  /** Optional capability gate. When set, only users with this capability see the item. */
  cap?: string
}

export const NAV_ITEMS: readonly NavItem[] = [
  { to: '/', key: 'nav.dashboard', Icon: LayoutDashboard },
  { to: '/employees', key: 'nav.employees', Icon: Users },
  { to: '/ledger', key: 'nav.ledger', Icon: Mail },
  { to: '/leaves', key: 'nav.leaves', Icon: CalendarDays },
  { to: '/application', key: 'nav.services', Icon: FileText },
  { to: '/books', key: 'nav.records', Icon: BookText },
  { to: '/permits', key: 'nav.permits', Icon: ShieldCheck, cap: 'permits.view' },
]
