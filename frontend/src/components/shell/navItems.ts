import {
  BookText,
  CalendarDays,
  FileText,
  LayoutDashboard,
  Mail,
  Users,
  type LucideIcon,
} from 'lucide-react'

export interface NavItem {
  to: string
  key: string
  Icon: LucideIcon
}

export const NAV_ITEMS: readonly NavItem[] = [
  { to: '/', key: 'nav.dashboard', Icon: LayoutDashboard },
  { to: '/employees', key: 'nav.employees', Icon: Users },
  { to: '/ledger', key: 'nav.ledger', Icon: Mail },
  { to: '/leaves', key: 'nav.leaves', Icon: CalendarDays },
  { to: '/application', key: 'nav.services', Icon: FileText },
  { to: '/books', key: 'nav.records', Icon: BookText },
]
