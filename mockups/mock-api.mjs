// Throwaway mock backend for visual smoke of the employee activity redesign.
// Serves just enough of the GSSG API on 127.0.0.1:8765 (the Vite proxy target).
import http from 'node:http'

const employees = [
  { id: 'G-1042', name_en: 'MOHAMMED AL-HARBI', name_ar: 'محمد الحربي', status: 'Active', position: 'Security Guard', position_ar: 'حارس أمن', has_photo: false, pending_status: null, end_date: null },
  { id: 'G-0877', name_en: 'YOUSEF AL-DOSSARI', name_ar: 'يوسف الدوسري', status: 'Active', position: 'Site Supervisor', position_ar: 'مشرف موقع', has_photo: false, pending_status: null, end_date: null },
  { id: 'G-1203', name_en: 'RAKESH KUMAR', name_ar: null, status: 'Active', position: 'Security Guard', position_ar: null, has_photo: false, pending_status: null, end_date: null },
]

const mk = (i, kind, emp, title, ref, hoursAgo, extra = {}) => ({
  kind, source_id: i, target_id: i, employee_id: emp.id, title,
  occurred_at: new Date(Date.now() - hoursAgo * 3600_000).toISOString(),
  employee_name_en: emp.name_en, employee_name_ar: emp.name_ar,
  detail: null, status: null, days: null, direction: null, channel: null,
  reference: ref, ...extra,
})
const activity = [
  mk(1, 'document', employees[0], 'Salary Certificate', 'GSSG-HR-300-114', 3),
  mk(2, 'leave', employees[1], 'Annual leave', 'LV-2026-0311', 5, { days: 21 }),
  mk(3, 'violation', employees[2], 'Late arrival — Gate 4', 'VIO-2026-058', 7),
  mk(4, 'ledger', employees[1], 'Iqama renewal follow-up', 'LDG-26-0842', 20),
  mk(5, 'document', employees[1], 'Clearance Form', 'GSSG-HR-300-009', 26),
  mk(6, 'leave', employees[0], 'Sick leave', 'LV-2026-0308', 29, { days: 3 }),
  mk(7, 'violation', employees[2], 'Uniform non-compliance', 'VIO-2026-055', 49),
  mk(8, 'ledger', employees[0], 'Transfer request — Riyadh HQ', 'LDG-26-0838', 52),
]

const CAPS = ['employees.view','employees.manage','employees.notify','books.view','books.manage','leaves.view','leaves.manage','violations.view','violations.manage','ledger.view','ledger.manage','dashboard.view','expiry.view','documents.generate','documents.view','settings.view','users.manage','system.admin','reports.view','applications.view','announcements.view','scan.view']

http.createServer((req, res) => {
  const url = new URL(req.url, 'http://x')
  const p = url.pathname
  const json = (body, code = 200) => {
    res.writeHead(code, { 'content-type': 'application/json' })
    res.end(JSON.stringify(body))
  }
  if (p === '/api/v1/auth/me') return json({ id: 1, email: 'qa@gssg.local', name: 'QA Admin', role: 'admin', status: 'active', employee_id: null, is_default_manager: false, has_signature: false, failed_attempts: 0, last_login_at: null, created_at: null })
  if (p === '/api/v1/auth/me/capabilities') return json(CAPS)
  if (p === '/api/v1/system/migration-status') return json({ has_db: true, has_data: true, v3_data_dir_detected: null, last_migration: '2026-01-01T00:00:00Z' })
  if (p === '/api/v1/employees/activity') {
    const emp = url.searchParams.get('employee_id')
    const kind = url.searchParams.get('kind')
    let items = activity
    if (emp) items = items.filter((a) => a.employee_id === emp)
    if (kind) items = items.filter((a) => a.kind === kind)
    return json({ items, total: items.length, limit: 25, offset: 0 })
  }
  if (p === '/api/v1/employees/completeness') return json({ incomplete: 0, first_incomplete_id: null, top_missing: [] })
  if (p === '/api/v1/employees') {
    const q = (url.searchParams.get('q') ?? '').toLowerCase()
    const items = q ? employees.filter((e) => e.name_en.toLowerCase().includes(q) || e.id.toLowerCase().includes(q)) : employees
    return json({ items, total: items.length, limit: 8, offset: 0 })
  }
  if (/^\/api\/v1\/employees\/[^/]+\/photo$/.test(p)) return json({ detail: 'no photo' }, 404)
  if (p === '/api/v1/dashboard/summary') return json({ on_leave_today: [], expiring_soon: [], counts: {} })
  if (p === '/api/v1/expiry') return json([])
  if (p.startsWith('/api/')) return json({})
  json({ detail: 'not found' }, 404)
}).listen(8765, '127.0.0.1', () => console.log('mock api on 8765'))
