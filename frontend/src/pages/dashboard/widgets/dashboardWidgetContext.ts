import { createContext, useContext } from 'react'
import type { DashboardLayout } from '@/lib/api'

interface DashboardRuntime {
  layout: DashboardLayout
  has: (capability: string) => boolean
  onNavigate: (page: 'books' | 'employees' | 'ledger') => void
  onOpenCoverage: () => void
  box: { w: number; h: number; cols: number }
}
export const DashboardRuntimeContext = createContext<DashboardRuntime | null>(null)

export function useDashboardRuntime(): DashboardRuntime {
  const value = useContext(DashboardRuntimeContext)
  if (!value) throw new Error('Dashboard widget requires its grid context')
  return value
}
