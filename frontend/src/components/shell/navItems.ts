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
  { to: '/employees', key: 'nav.employees', Icon: Users, cap: 'employees.view' },
  { to: '/ledger', key: 'nav.ledger', Icon: Mail, cap: 'ledger.view' },
  { to: '/leaves', key: 'nav.leaves', Icon: CalendarDays, cap: 'leaves.view' },
  { to: '/application', key: 'nav.services', Icon: FileText, cap: 'documents.generate' },
  { to: '/books', key: 'nav.records', Icon: BookText, cap: 'books.view' },
  // Scan-back is deliberately NOT here: it lives inside Records (its entry
  // point is ScanBackEntry in the Records header), not in the top nav.
  { to: '/permits', key: 'nav.permits', Icon: ShieldCheck, cap: 'permits.view' },
]
