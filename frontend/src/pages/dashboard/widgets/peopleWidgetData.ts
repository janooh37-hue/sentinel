import { useQuery } from '@tanstack/react-query'
import { api } from '@/lib/api'
import { pickEmployeeName } from '@/lib/employeeName'

export function usePeopleSummary() {
  return useQuery({ queryKey: ['dashboard'], queryFn: api.getDashboardSummary, staleTime: 60_000 })
}

export function summaryEmployeeName(item: { employee_name_en: string; employee_name_ar: string | null }, language: string): string {
  return pickEmployeeName({ name_en: item.employee_name_en, name_ar: item.employee_name_ar }, language)
}
