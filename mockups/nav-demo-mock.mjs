// Throwaway localhost demo backend for the mobile-nav dock feature.
// Serves just enough of /api/v1 for the shell + dashboard + employees page
// + waiting-signal counts. Run: node mockups/nav-demo-mock.mjs  (port 8765,
// matches vite.config.ts proxy). NOT part of the app; untracked scratch.
import http from 'node:http'

const NOW = '2026-08-15T08:00:00Z'

const user = {
  id: 1,
  email: 'ahmed@gssg.local',
  employee_id: 'G-1001',
  name_en: 'Ahmed Al Mazrouei',
  name_ar: 'أحمد المزروعي',
  position: 'Operations Manager',
  department: 'HQ',
  photo_url: null,
  role: 'admin',
  status: 'active',
  is_admin: true,
  is_manager: true,
  has_signature: false,
}

const caps = [
  'employees.view', 'employees.manage',
  'books.view', 'books.approve', 'books.manage',
  'ledger.view', 'ledger.manage',
  'leaves.view', 'leaves.manage',
  'permits.view',
  'documents.view', 'documents.manage',
  'users.manage', 'system.admin',
]

const awaitingBook = (id, ref, subject, at) => ({
  id, ref, reference: ref, subject, title: subject,
  kind: 'outgoing', direction: 'outgoing',
  approval_state: 'pending', voided_at: null,
  created_at: at, updated_at: at, submitted_at: at,
  created_by: 'Fatima K.', submitter: 'Fatima K.', employee_id: null,
  pdf_available: false, attachments: [],
  category: { id: 1, prefix: 'GS', name_en: 'General Correspondence', name_ar: 'مراسلات عامة' },
  category_id: 1, service_id: 'Report', number: id, year: 2026,
  classification_code: null, notes: null,
})

const routes = {
  'GET /auth/me': user,
  'GET /auth/me/capabilities': caps,
  'GET /system/migration-status': {
    has_db: true, has_data: true, v3_data_dir_detected: null,
    last_migration: '2026-08-01T00:00:00Z',
  },
  'GET /settings': { theme: 'light', font_scale: 1.0, dashboard_layout: null },
  'GET /dashboard/summary': {
    totals: {
      employees_active: 248, on_leave_today: 12, present_today: 236,
      forms_this_month: 36, open_violations_count: 3,
      draft_count: 2, book_draft_count: 1,
    },
    on_leave_today: [], upcoming_leave_ends: [],
    recent_documents: [], recent_ledger: [],
    email_sync: { enabled: false, status: 'ok', last_sync: NOW, unread: 7, error: null },
  },
  'GET /books/awaiting': [
    awaitingBook(3391, 'BK-3391', 'Duty roster amendment — Sector 4', '2026-08-14T09:12:00Z'),
    awaitingBook(3392, 'BK-3392', 'Gate pass renewal batch', '2026-08-14T13:40:00Z'),
    awaitingBook(3393, 'BK-3393', 'HQ circular acknowledgement', '2026-08-15T06:05:00Z'),
    awaitingBook(3394, 'BK-3394', 'Contractor access request', '2026-08-15T07:30:00Z'),
  ],
  'GET /employees': { items: [], total: 0 },
  'GET /expiry': { items: [], total: 0 },
  'GET /books/awaiting-scan': [
    awaitingBook(3384, 'BK-3384', 'Returned record — scan pending', '2026-08-12T10:00:00Z'),
    awaitingBook(3379, 'BK-3379', 'Signed circular — scan pending', '2026-08-11T14:30:00Z'),
  ],
  'GET /ledger/unread-recent': { items: [], total_unread: 7 },
  // Books page (Records tab): facets feed the service rail + status spine,
  // templates feed service display names. Shapes mirror BookFacetsResponse /
  // TemplateListResponse (see serviceFacets.test.tsx fixture).
  'GET /books/facets': {
    total: 20,
    states: { none: 2, pending: 4, awaiting_scan: 2, approved: 12 },
    services: [
      { id: 'Leave Application Form', count: 9, states: { approved: 9 } },
      { id: 'Report', count: 7, states: { pending: 4, approved: 3 } },
      { id: 'other', count: 4, states: { none: 2, awaiting_scan: 2 } },
    ],
  },
  'GET /templates': {
    items: [
      { id: 'Leave Application Form', name_en: 'Leave Application Form', name_ar: 'نموذج طلب إجازة' },
      { id: 'Report', name_en: 'Report', name_ar: 'تقرير' },
    ],
  },
  'GET /books': {
    items: [
      awaitingBook(3391, 'BK-3391', 'Duty roster amendment — Sector 4', '2026-08-14T09:12:00Z'),
      awaitingBook(3392, 'BK-3392', 'Gate pass renewal batch', '2026-08-14T13:40:00Z'),
      awaitingBook(3393, 'BK-3393', 'HQ circular acknowledgement', '2026-08-15T06:05:00Z'),
      awaitingBook(3394, 'BK-3394', 'Contractor access request', '2026-08-15T07:30:00Z'),
    ],
    total: 4,
  },
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://127.0.0.1:8765')
  const path = url.pathname.replace(/^\/api\/v1/, '')
  const key = `${req.method} ${path}`
  let body = routes[key]
  if (body === undefined) {
    // prefix match (query-string variants like /expiry?days=90)
    const hit = Object.keys(routes).find((k) => key.startsWith(k))
    body = hit ? routes[hit] : undefined
  }
  if (body === undefined) {
    if (req.method !== 'GET') body = {}
    else body = path.match(/s$|list|activity|items/) ? [] : {}
    console.log(`[mock] fallback ${key}`)
  } else {
    console.log(`[mock] ${key}`)
  }
  res.writeHead(200, { 'content-type': 'application/json' })
  res.end(JSON.stringify(body))
})

server.listen(8765, '127.0.0.1', () => {
  console.log('nav-demo mock listening on http://127.0.0.1:8765')
})
