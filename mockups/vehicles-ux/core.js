/*
 * Vehicle Services mockup (direction C, «Counter and paper»): state, fabricated
 * data, real product copy and the form content. views.js decides layout and
 * sets `VIEW = { screen(), overlay(spec) }`.
 *
 * Rules decided with the operator:
 *   1. A form asks in the app language only. No «· AR» / «· EN» pairs and no
 *      field forced in the other language. The Arabic letter asks for its
 *      Arabic wording on the letter step, and only when it is missing.
 *   2. An accident report has no damage-cost input. The report states that
 *      insurance covers the damage and the technician estimates the cost.
 *   3. Insurance details are optional and can be added at any time.
 *   4. A report can be closed without a cost.
 *   5. Numbers use Latin digits, money is whole dirhams with the dirham mark.
 *   6. A new request is the first thing on every page, ahead of its register.
 * All records below are fabricated.
 */
'use strict'

const TODAY = '2026-11-17'
let VIEW
const qs = new URLSearchParams(location.search)
const S = {
  lang: qs.get('lang') === 'en' ? 'en' : 'ar',
  device: qs.get('device') === 'mobile' ? 'mobile' : 'desktop',
  route: ['hub', 'accidents', 'maintenance', 'vehicle', 'fines'].includes(qs.get('screen')) ? qs.get('screen') : 'hub',
  vehicleId: 2, tab: 'accidents', mTab: 'records',
  acFilter: 'all', fineFilter: 'all', site: null, overlay: null,
}

// ── Copy: real locale first, new strings for what this work adds ────────────
const NEW = {
  en: {
    damageCoverLine: 'Covered by insurance. The technician estimates the cost.',
    insuranceTitle: 'Insurance', insuranceOptional: 'Optional. Fill in when available.',
    insuranceNone: 'No insurance details yet', addInsurance: 'Add insurance details', editInsurance: 'Edit insurance details',
    claimNo: 'Claim number', insurer: 'Insurance company', repairGarage: 'Repair garage', claimStatus: 'Claim status',
    cs_not_submitted: 'Not submitted', cs_submitted: 'Submitted', cs_under_repair: 'Under repair', cs_settled: 'Settled',
    payer: 'Cost borne by', payer_insurer: 'Insurance in full', payer_company: 'Excess paid by the company', payer_driver: 'Excess paid by the driver',
    notSet: 'Not set', insuranceSaved: 'Insurance details saved.',
    secIncident: 'Incident', secEvidence: 'Photos', secInsurance: 'Damage and insurance', secLicence: 'Licence and insurance', secNotes: 'Notes',
    driver: 'Driver', photosHint: 'JPG or PNG. Photos are kept with the report.',
    arabicForLetter: 'Arabic text for the official letter',
    arabicForLetterDesc: 'The letter is issued in Arabic. This report was written in English, so add the Arabic wording once here.',
    locationAr: 'Location in Arabic', descriptionAr: 'Description in Arabic',
    paperPending: 'Arabic wording is added when the letter is issued',
    manageFleet: 'Fleet administration', siteName: 'Site name', unchanged: 'This step is unchanged, so it is not part of the mockup.',
    startAccident: 'File an accident report', startMaintenance: 'Log a maintenance job', startFine: 'Record a fine',
    newForVehicle: 'New for this vehicle', vehicle: 'Vehicle',
    allStatuses: 'All', total: 'Total', vehicleSaved: 'Vehicle added.',
    navDashboard: 'Dashboard', navEmployees: 'Employees', navVehicles: 'Vehicles', navBooks: 'Books', navLedger: 'Ledger',
    renewalsEmpty: 'Renewals, photos and certificates are unchanged in this mockup.', liveLetter: 'Official letter, as it will be issued',
    reportNo: 'Report', lastService: 'Last service', reminder: 'A reminder appears when the next service date approaches.',
  },
  ar: {
    damageCoverLine: 'يغطيها التأمين. يقدّر الفني التكلفة.',
    insuranceTitle: 'التأمين', insuranceOptional: 'اختياري. يُستكمل عند توفر البيانات.',
    insuranceNone: 'لم تُضف بيانات التأمين بعد', addInsurance: 'إضافة بيانات التأمين', editInsurance: 'تعديل بيانات التأمين',
    claimNo: 'رقم المطالبة', insurer: 'شركة التأمين', repairGarage: 'ورشة الإصلاح', claimStatus: 'حالة المطالبة',
    cs_not_submitted: 'لم تُقدَّم', cs_submitted: 'مقدَّمة', cs_under_repair: 'قيد الإصلاح', cs_settled: 'مُسوّاة',
    payer: 'الجهة المتحملة للتكلفة', payer_insurer: 'التأمين بالكامل', payer_company: 'نسبة تحمّل على الشركة', payer_driver: 'نسبة تحمّل على السائق',
    notSet: 'غير محدد', insuranceSaved: 'تم حفظ بيانات التأمين.',
    secIncident: 'الحادث', secEvidence: 'الصور', secInsurance: 'الضرر والتأمين', secLicence: 'الترخيص والتأمين', secNotes: 'الملاحظات',
    driver: 'السائق', photosHint: 'بصيغة JPG أو PNG. تُحفظ الصور مع البلاغ.',
    arabicForLetter: 'النص العربي للخطاب الرسمي',
    arabicForLetterDesc: 'يصدر الخطاب باللغة العربية. كُتب هذا البلاغ بالإنجليزية، لذا أضف الصياغة العربية هنا مرة واحدة.',
    locationAr: 'الموقع بالعربية', descriptionAr: 'الوصف بالعربية',
    paperPending: 'تُضاف الصياغة العربية عند إصدار الخطاب',
    manageFleet: 'إدارة الأسطول', siteName: 'اسم الموقع', unchanged: 'هذه الخطوة لم تتغير، لذا ليست ضمن النموذج.',
    startAccident: 'تسجيل بلاغ حادث', startMaintenance: 'تسجيل عملية صيانة', startFine: 'تسجيل مخالفة',
    newForVehicle: 'طلب جديد لهذه المركبة', vehicle: 'المركبة',
    allStatuses: 'الكل', total: 'الإجمالي', vehicleSaved: 'تمت إضافة المركبة.',
    navDashboard: 'لوحة التحكم', navEmployees: 'الموظفون', navVehicles: 'المركبات', navBooks: 'الكتب', navLedger: 'السجل',
    renewalsEmpty: 'التجديدات والصور والشهادات لم تتغير في هذا النموذج.', liveLetter: 'الخطاب الرسمي كما سيصدر',
    reportNo: 'بلاغ', lastService: 'آخر صيانة', reminder: 'يظهر تنبيه عند اقتراب موعد الصيانة القادمة.',
  },
}
const dig = (obj, path) => path.split('.').reduce((o, k) => (o == null ? o : o[k]), obj)
function t(key, vars) {
  const L = window.LOCALE[S.lang]
  let s = NEW[S.lang][key] ?? dig(L.vehicles, key) ?? dig(L, key) ?? key
  if (vars) s = s.replace(/\{\{?(\w+)\}?\}/g, (m, k) => (k in vars ? vars[k] : m))
  return s
}

// ── Fabricated data ─────────────────────────────────────────────────────────
const SITES = [
  { id: 1, ar: 'مشروع الوثبة -2', en: 'Wathba Project - 2' },
  { id: 2, ar: 'الحبس الاحتياطي -2', en: 'Pretrial Detention - 2' },
]
const EMP = [
  { id: 'G7812', ar: 'راشد الكتبي', en: 'Rashed Al Ketbi' }, { id: 'G6157', ar: 'مريم السويدي', en: 'Maryam Al Suwaidi' },
  { id: 'G8921', ar: 'سالم النقبي', en: 'Salem Al Naqbi' }, { id: 'G7346', ar: 'نورة المهيري', en: 'Noura Al Muhairi' },
  { id: 'G5608', ar: 'حمد الشامسي', en: 'Hamad Al Shamsi' },
]
const VEH = [
  { id: 1, plate: '14 \\ 58216', ar: 'تويوتا \\ فورشنر', en: 'Toyota \\ Fortuner', clsAr: 'مركبة خفيفة', clsEn: 'Light vehicle', traffic: '7710002101', site: 1, start: '2026-01-12', expiry: '2027-01-11', ins: '2027-01-11', vin: 'JTDFX62A71K20518', km: 84210, driven: 1840 },
  { id: 2, plate: '07 \\ 64125', ar: 'تويوتا \\ كوستر', en: 'Toyota \\ Coaster', clsAr: 'باص ثقيل', clsEn: 'Heavy bus', traffic: '7710002102', site: 1, start: '2025-10-04', expiry: '2026-10-03', ins: '2026-12-05', vin: 'JTGCS19B52M64107', km: 151960, driven: 2310 },
  { id: 3, plate: '22 \\ 71840', ar: 'تويوتا \\ هايس', en: 'Toyota \\ Hiace', clsAr: 'باص خفيف', clsEn: 'Light bus', traffic: '7710002103', site: 1, start: '2025-12-10', expiry: '2026-12-09', ins: null, vin: 'JTJHS44C86N71829', km: 99120, driven: 1275 },
  { id: 4, plate: '09 \\ 47218', ar: 'فورد \\ ترانزيت', en: 'Ford \\ Transit', clsAr: 'مندوب', clsEn: 'Messenger vehicle', traffic: '7710002104', site: 1, start: '2026-03-20', expiry: '2027-03-19', ins: '2027-03-19', vin: 'WF0TR62K44W75938', km: 38400, driven: 960 },
  { id: 5, plate: '16 \\ 82541', ar: 'نيسان \\ بيك أب', en: 'Nissan \\ Pickup', clsAr: 'بيك أب', clsEn: 'Pickup', traffic: '7710002105', site: 1, start: '2026-09-23', expiry: '2027-09-22', ins: '2027-09-22', vin: 'JN1PK28E64R82513', km: 66740, driven: 1530 },
  { id: 6, plate: '05 \\ 78124', ar: 'ميتسوبيشي \\ باجيرو', en: 'Mitsubishi \\ Pajero', clsAr: 'مركبة خفيفة', clsEn: 'Light vehicle', traffic: '7710002201', site: 2, start: '2025-11-03', expiry: '2026-11-02', ins: '2026-11-02', vin: 'JMBPJ35G18T78146', km: 120980, driven: 1105 },
  { id: 7, plate: '28 \\ 61579', ar: 'تويوتا \\ فورشنر', en: 'Toyota \\ Fortuner', clsAr: 'مركبة خفيفة', clsEn: 'Light vehicle', traffic: '7710002202', site: 2, start: '2026-02-07', expiry: '2027-02-06', ins: '2027-02-06', vin: 'JTDFX47H63U61592', km: 46350, driven: 1420 },
  { id: 8, plate: '12 \\ 43821', ar: 'تويوتا \\ هايس', en: 'Toyota \\ Hiace', clsAr: 'باص خفيف', clsEn: 'Light bus', traffic: '7710002203', site: 2, start: '2026-04-16', expiry: '2027-04-15', ins: '2027-04-15', vin: 'JTJHS58J91V43867', km: 72810, driven: 1990 },
]
const INSURER = { ar: 'درع الخليج للتأمين', en: 'Gulf Shield Insurance' }
const GARAGES = [{ ar: 'ورشة الوثبة للسيارات', en: 'Al Wathba Auto Workshop' }, { ar: 'كراج العاصمة', en: 'Capital Motors Garage' }]
const ACC = [
  { id: 41, veh: 2, date: '2026-11-12', time: '07:40', emp: 'G8921', locAr: 'بوابة الخدمات، مشروع الوثبة', locEn: '', descAr: 'احتكاك جانبي مع حاجز خرساني أثناء الرجوع للخلف، مع تضرر الباب الخلفي الأيمن.', descEn: '', police: 'AD-2026-118204', status: 'open', photos: 3, letter: null, ins: {} },
  { id: 40, veh: 5, date: '2026-11-03', time: '16:15', emp: 'G5608', locAr: '', locEn: 'Staff parking, Wathba Project', descAr: '', descEn: 'Rear bumper struck by a reversing delivery truck while the pickup was parked. No injuries.', police: 'AD-2026-116377', status: 'open', photos: 2, letter: null, ins: { claim: 'CL-55-90412', insurer: INSURER, garage: GARAGES[0], status: 'under_repair', payer: 'insurer' } },
  { id: 38, veh: 7, date: '2026-09-21', time: '11:05', emp: 'G7812', locAr: 'طريق الخدمة أمام المبنى الإداري', locEn: 'Service road by the admin building', descAr: 'اصطدام خفيف من الخلف عند التوقف، مع كسر في المصباح الخلفي الأيسر.', descEn: 'Light rear-end collision at a stop. Left tail lamp broken.', police: 'AD-2026-101856', status: 'closed', photos: 4, letter: 'GSSG-VA-0038', ins: { claim: 'CL-55-88127', insurer: INSURER, garage: GARAGES[1], status: 'settled', payer: 'insurer' } },
  { id: 35, veh: 1, date: '2026-08-09', time: '13:30', emp: null, locAr: 'موقف المركبات الرئيسي', locEn: '', descAr: 'خدش في الباب الأمامي الأيسر وُجد عند استلام المركبة صباحاً.', descEn: '', police: '', status: 'closed', photos: 1, letter: null, ins: {} },
]
const MNT = [
  { id: 1, veh: 1, date: '2026-11-05', type: 'service', km: 84000, cost: 850, garage: GARAGES[0], next: '2027-02-05', receipt: true },
  { id: 2, veh: 2, date: '2026-08-18', type: 'service', km: 151200, cost: 1400, garage: GARAGES[0], next: '2026-11-10', receipt: true },
  { id: 3, veh: 3, date: '2026-09-01', type: 'tires', km: 98300, cost: 2600, garage: GARAGES[1], next: '2026-11-28', receipt: false },
  { id: 4, veh: 6, date: '2026-10-20', type: 'repair', km: 120450, cost: 3150, garage: GARAGES[1], next: null, receipt: true },
  { id: 5, veh: 7, date: '2026-10-02', type: 'service', km: 45800, cost: 780, garage: GARAGES[0], next: '2027-01-02', receipt: true },
  { id: 6, veh: 5, date: '2026-07-14', type: 'other', km: 66120, cost: 320, garage: GARAGES[0], next: null, receipt: false },
]
const FINES = [
  { id: 1, veh: 1, date: '2026-11-08', amount: 400, points: 4, emp: 'G7812', status: 'unpaid' },
  { id: 2, veh: 1, date: '2026-10-22', amount: 300, points: 0, emp: 'G6157', status: 'paid' },
  { id: 3, veh: 2, date: '2026-10-19', amount: 600, points: 6, emp: 'G8921', status: 'unpaid' },
  { id: 4, veh: 2, date: '2026-09-02', amount: 250, points: 0, emp: 'G7346', status: 'paid' },
  { id: 5, veh: 5, date: '2026-11-01', amount: 700, points: 8, emp: 'G5608', status: 'unpaid' },
  { id: 6, veh: 5, date: '2026-08-18', amount: 200, points: 0, emp: null, status: 'unknown' },
  { id: 7, veh: 6, date: '2026-10-05', amount: 500, points: 4, emp: 'G7812', status: 'unpaid' },
  { id: 8, veh: 7, date: '2026-09-25', amount: 350, points: 3, emp: 'G6157', status: 'paid' },
  { id: 9, veh: 8, date: '2026-11-10', amount: 1000, points: 12, emp: 'G7346', status: 'unknown' },
]

// ── Helpers ─────────────────────────────────────────────────────────────────
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c])
/** `localized()` from lib/language.ts: the app language first, the other as fallback. */
const loc = (ar, en) => (S.lang === 'ar' ? ar || en : en || ar) || ''
const tx = (v) => (v && typeof v === 'object' ? loc(v.ar, v.en) : v || '')
const vOf = (id) => VEH.find((v) => v.id === Number(id))
const empName = (id) => { const e = EMP.find((x) => x.id === id); return e ? loc(e.ar, e.en) : t('unassigned') }
const siteName = (id) => { const s = SITES.find((x) => x.id === id); return s ? loc(s.ar, s.en) : '' }
const days = (iso) => Math.round((Date.parse(iso) - Date.parse(TODAY)) / 864e5)
const expiryState = (iso) => (days(iso) < 0 ? 'expired' : days(iso) <= 30 ? 'due' : 'valid')
const dueState = (iso) => (iso == null ? null : days(iso) < 0 ? 'overdue' : days(iso) <= 30 ? 'due' : 'scheduled')
const sum = (list, f) => list.reduce((n, x) => n + f(x), 0)

const P = {
  chevL: '<path d="m15 18-6-6 6-6"/>', chevR: '<path d="m9 18 6-6-6-6"/>', chevD: '<path d="m6 9 6 6 6-6"/>',
  plus: '<path d="M5 12h14M12 5v14"/>', x: '<path d="M18 6 6 18M6 6l12 12"/>',
  check: '<circle cx="12" cy="12" r="10"/><path d="m9 12 2 2 4-4"/>', dot: '<circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="1.5"/>',
  clock: '<circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/>', alert: '<path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z"/><path d="M12 9v4M12 17h.01"/>',
  cal: '<rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/>',
  file: '<path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z"/><path d="M14 2v4a2 2 0 0 0 2 2h4M16 13H8M16 17H8"/>',
  shield: '<path d="M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z"/><path d="m9 12 2 2 4-4"/>',
  search: '<circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/>', trash: '<path d="M3 6h18M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>',
  pencil: '<path d="M21.17 6.81a1 1 0 0 0-3.99-3.99L3.84 16.17a2 2 0 0 0-.5.83l-1.32 4.35a.5.5 0 0 0 .62.62l4.35-1.32a2 2 0 0 0 .83-.5z"/>',
  upload: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M17 8l-5-5-5 5M12 3v12"/>',
  ext: '<path d="M15 3h6v6M10 14 21 3M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/>',
  car: '<path d="M19 17h2c.6 0 1-.4 1-1v-3c0-.9-.7-1.7-1.5-1.9C18.7 10.6 16 10 16 10s-1.3-1.4-2.2-2.3c-.5-.4-1.1-.7-1.8-.7H5c-.6 0-1.1.4-1.4.9l-1.4 2.9A3.7 3.7 0 0 0 2 12v4c0 .6.4 1 1 1h2"/><circle cx="7" cy="17" r="2"/><path d="M9 17h6"/><circle cx="17" cy="17" r="2"/>',
  print: '<path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2M6 9V3h12v6"/><rect x="6" y="14" width="12" height="8" rx="1"/>',
}
const K = {
  ic: (name, cls = '') => `<svg class="${cls}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${P[name]}</svg>`,
  /** Latin digits in both languages, grouped, never a fraction. */
  num: (n) => Math.round(n).toLocaleString('en-US'),
  aed: (n) => `<bdi class="aed"><i aria-hidden="true"></i><span aria-hidden="true">${K.num(n)}</span><span class="sr-only">${K.num(n)} AED</span></bdi>`,
  plate: (p, size = '') => `<span class="plate ${size}">${esc(p)}</span>`,
  date: (iso, time) => `<bdi class="mono ltr">${iso ? esc(iso) + (time ? ' ' + esc(time) : '') : '—'}</bdi>`,
  art: (name) => `<img class="art" src="assets/vehicle-${name}.webp" alt="">`,
  badge(family, status, toggleId) {
    const map = {
      expiry: { valid: ['success', 'check', 'valid'], due: ['warning', 'clock', 'due'], expired: ['danger', 'alert', 'expired'] },
      due: { overdue: ['danger', 'alert', 'overdue'], due: ['warning', 'clock', 'dueSoon'], scheduled: ['info', 'cal', 'scheduled'] },
      accident: { open: ['warning', 'dot', 'openStatus'], closed: ['success', 'check', 'closedStatus'] },
      payment: { paid: ['success', 'check', 'fines.status.paid'], unpaid: ['warning', 'clock', 'fines.status.unpaid'], unknown: ['neutral', 'dot', 'fines.status.unknown'] },
      claim: { not_submitted: ['neutral', 'dot', 'cs_not_submitted'], submitted: ['info', 'clock', 'cs_submitted'], under_repair: ['warning', 'clock', 'cs_under_repair'], settled: ['success', 'check', 'cs_settled'] },
    }
    const [tone, icon, key] = map[family][status]
    const inner = `${K.ic(icon)}${t(key)}`
    if (toggleId == null) return `<span class="badge ${tone}">${inner}</span>`
    const action = t(status === 'open' ? 'markClosed' : 'markOpen')
    return `<button type="button" class="badge ${tone}" data-act="status" data-id="${toggleId}" title="${action}" aria-label="${t(key)} · ${action}" aria-pressed="${status === 'closed'}">${inner}</button>`
  },
  vtype: (v) => loc(v.ar, v.en), vcls: (v) => loc(v.clsAr, v.clsEn),
  summary() {
    const active = FINES.filter((f) => f.status === 'unpaid')
    return {
      vehicles: VEH.length, sites: SITES.length,
      finesCount: active.length, finesAmount: sum(active, (f) => f.amount),
      license: VEH.filter((v) => expiryState(v.expiry) !== 'valid').length,
      openAccidents: ACC.filter((a) => a.status === 'open').length,
      maintDue: MNT.filter((m) => ['overdue', 'due'].includes(dueState(m.next))).length,
    }
  },
  /** The four working services, in the hub's order: live figure, register, and the request each one starts. */
  services() {
    const s = K.summary()
    return [
      { id: 'fines', art: 'fines', title: t('finesService'), n: s.finesCount, unit: t('fines.status.unpaid'), to: 'fines', hot: s.finesCount > 0, make: { label: t('addFine'), act: 'noop' } },
      { id: 'renew', art: 'licence-renewal', title: t('renewService'), n: s.license, unit: t('attention'), to: 'hub', hot: s.license > 0, make: { label: t('renew'), act: 'noop' } },
      { id: 'accidents', art: 'accident', title: t('accidentService'), n: s.openAccidents, unit: t('openStatus'), to: 'accidents', hot: s.openAccidents > 0, make: { label: t('newReport'), act: 'overlay', kind: 'accident' } },
      { id: 'maintenance', art: 'maintenance', title: t('maintenanceService'), n: s.maintDue, unit: t('dueSoon'), to: 'maintenance', hot: s.maintDue > 0, make: { label: t('addMaintenance'), act: 'overlay', kind: 'maintenance' } },
    ]
  },
  /** Renew filters the fleet ledger in place today; that behaviour is unchanged, so it is not mocked. */
  svcAttrs: (x) => (x.id === 'renew' ? 'data-act="noop"' : `data-act="go" data-to="${x.to}"`),
  admin: () => [
    { art: 'register', title: t('addVehicleService'), act: 'overlay', kind: 'vehicle' },
    { art: 'register', title: t('editVehicleService'), act: 'noop' },
    { art: 'sites', title: t('sitesService'), act: 'overlay', kind: 'sites' },
    { art: 'register', title: t('importService'), act: 'noop' },
  ],
  hasIns: (a) => Object.values(a.ins).some(Boolean),
  /** Only what has been recorded: an optional field that is empty is not shown as a gap. */
  insFacts(a) {
    const i = a.ins, rows = []
    if (i.status) rows.push([t('claimStatus'), K.badge('claim', i.status)])
    if (i.claim) rows.push([t('claimNo'), `<bdi class="mono ltr">${esc(i.claim)}</bdi>`])
    if (i.insurer) rows.push([t('insurer'), esc(tx(i.insurer))])
    if (i.garage) rows.push([t('repairGarage'), esc(tx(i.garage))])
    if (i.payer) rows.push([t('payer'), t('payer_' + i.payer)])
    return rows.length ? `<dl class="ins-facts">${rows.map(([k, v]) => `<div><dt>${k}</dt><dd>${v}</dd></div>`).join('')}</dl>` : ''
  },
  cover: () => `<div class="cover">${K.ic('shield')}<div><b>${t('damageCost')}</b><span>${t('damageCoverLine')}</span></div></div>`,
  accLoc: (a) => loc(a.locAr, a.locEn), accDesc: (a) => loc(a.descAr, a.descEn),
  accidents: () => (S.acFilter === 'all' ? ACC : ACC.filter((a) => a.status === S.acFilter)),
  fines: () => (S.fineFilter === 'all' ? FINES : FINES.filter((f) => f.status === S.fineFilter)),
  topnav: () => `<header class="topnav"><img src="assets/gssg-logo.png" alt=""><strong>GSSG Manager</strong><nav aria-label="GSSG Manager">${['Dashboard', 'Employees', 'Vehicles', 'Books', 'Ledger'].map((n) => `<span class="${n === 'Vehicles' ? 'on' : ''}">${t('nav' + n)}</span>`).join('')}</nav></header>`,
  formAlert: () => `<p class="alert" data-alert role="alert" hidden>${t('requiredFields')}</p>`,
  /** `data-*` for an item that carries its own action (a door's request, an administration link). */
  actAttrs: (x) => `data-act="${x.act}"${x.kind ? ` data-kind="${x.kind}"` : ''}${x.id != null ? ` data-id="${x.id}"` : ''}${x.to ? ` data-to="${x.to}"` : ''}`,
  groups: () => SITES.filter((s) => S.site == null || s.id === S.site).map((site) => ({ site, vehicles: VEH.filter((v) => v.site === site.id) })).filter((g) => g.vehicles.length),
  licence: (v) => `<span class="two-line"><strong style="display:flex;flex-wrap:wrap;align-items:center;gap:.4rem">${K.date(v.expiry)}${K.badge('expiry', expiryState(v.expiry))}</strong><small>${t('insuranceExpiry')} · ${v.ins ? K.date(v.ins) : t('insuranceNotRecorded')}</small></span>`,
  vehFines(v) {
    const open = FINES.filter((f) => f.veh === v.id && f.status !== 'paid')
    return open.length ? `<span class="two-line"><strong><bdi class="mono">${open.length}</bdi> · ${K.aed(sum(open, (f) => f.amount))}</strong><small><bdi class="mono">${sum(open, (f) => f.points)}</bdi> ${t('points')}</small></span>` : '<span class="faint">—</span>'
  },
  rowActs: (v) => `${expiryState(v.expiry) !== 'valid' ? `<button type="button" class="btn primary" data-act="noop">${t('renew')}</button>` : ''}<button type="button" class="btn secondary" data-act="go" data-to="vehicle" data-id="${v.id}" aria-label="${t('open')} · ${esc(v.plate)}">${t('open')}</button>`,
  tblFleet: (list) => `<div class="tbl-wrap"><table class="tbl"><thead><tr><th class="opt">${t('mainPhoto')}</th><th>${t('plate')}</th><th>${t('type')}</th><th class="opt">${t('trafficCode')}</th><th>${t('licenseExpiry')}</th><th class="opt">${t('tabFines')}</th><th class="end">${t('action')}</th></tr></thead><tbody>${list.map((v) => `<tr>
    <td class="opt"><span class="thumb">${K.ic('car')}</span></td><td>${K.plate(v.plate)}</td>
    <td><span class="two-line"><strong dir="auto">${esc(K.vtype(v))}</strong><small>${esc(K.vcls(v))}</small></span></td>
    <td class="opt"><bdi class="mono ltr">${v.traffic}</bdi></td><td>${K.licence(v)}</td><td class="opt">${K.vehFines(v)}</td>
    <td><div class="acts">${K.rowActs(v)}</div></td></tr>`).join('')}</tbody></table></div>`,
  due: (m) => (m.next ? `<span style="display:inline-flex;flex-wrap:wrap;align-items:center;gap:.4rem">${K.date(m.next)}${K.badge('due', dueState(m.next))}</span>` : '<span class="faint">—</span>'),
  tblMaint: (rows, withPlate = true) => `<div class="tbl-wrap"><table class="tbl"><thead><tr>${withPlate ? `<th>${t('plate')}</th>` : ''}<th>${t('date')}</th><th>${t('maintenanceType')}</th><th class="opt">${t('odometer')}</th><th>${t('cost')}</th><th class="opt">${t('garage')}</th><th>${t('nextDue')}</th><th class="opt">${t('receipt')}</th></tr></thead><tbody>${rows.map((m) => `<tr>
    ${withPlate ? `<td>${K.plate(vOf(m.veh).plate)}</td>` : ''}<td>${K.date(m.date)}</td><td>${t(m.type)}</td>
    <td class="opt">${m.km ? `<bdi class="mono ltr">${K.num(m.km)}</bdi> ${t('km')}` : '—'}</td><td>${K.aed(m.cost)}</td>
    <td class="opt" dir="auto">${esc(tx(m.garage)) || '—'}</td><td>${K.due(m)}</td>
    <td class="opt">${m.receipt ? `<button type="button" class="link" data-act="noop">${K.ic('file')}${t('open')}</button>` : '<span class="faint">—</span>'}</td></tr>`).join('')}</tbody></table></div>`,
  tblLog: () => `<div class="tbl-wrap"><table class="tbl"><thead><tr><th>${t('plate')}</th><th>${t('type')}</th><th class="opt">${t('openingKm')}</th><th>${t('closingKm')}</th><th>${t('kmDriven')}</th><th class="opt">${t('maintenanceCount')}</th><th>${t('cost')}</th></tr></thead><tbody>${VEH.map((v) => { const jobs = MNT.filter((m) => m.veh === v.id && m.date.startsWith('2026-11')); return `<tr>
    <td>${K.plate(v.plate)}</td><td dir="auto">${esc(K.vtype(v))}</td><td class="opt"><bdi class="mono ltr">${K.num(v.km - v.driven)}</bdi></td><td><bdi class="mono ltr">${K.num(v.km)}</bdi></td>
    <td><bdi class="mono ltr">${K.num(v.driven)}</bdi></td><td class="opt"><bdi class="mono">${jobs.length}</bdi></td><td>${jobs.length ? K.aed(sum(jobs, (m) => m.cost)) : '<span class="faint">—</span>'}</td></tr>` }).join('')}</tbody></table></div>`,
  tblFines: (rows, withPlate = true) => `<div class="tbl-wrap"><table class="tbl"><thead><tr>${withPlate ? `<th>${t('plate')}</th>` : ''}<th>${t('employee')}</th><th class="opt">${t('gNumber')}</th><th>${t('date')}</th><th>${t('amount')}</th><th class="opt">${t('blackPoints')}</th><th>${t('fines.statusColumn')}</th><th class="end">${t('action')}</th></tr></thead><tbody>${rows.map((f) => `<tr>
    ${withPlate ? `<td>${K.plate(vOf(f.veh).plate)}</td>` : ''}<td dir="auto">${esc(empName(f.emp))}</td><td class="opt"><bdi class="mono ltr">${f.emp || '—'}</bdi></td><td>${K.date(f.date)}</td>
    <td>${K.aed(f.amount)}</td><td class="opt"><bdi class="mono">${f.points}</bdi></td><td>${K.badge('payment', f.status)}</td>
    <td><div class="acts">${f.status === 'paid' ? '' : `<button type="button" class="btn secondary" data-act="pay" data-id="${f.id}">${t('fines.recordPayment')}</button>`}</div></td></tr>`).join('')}</tbody></table></div>`,
  fineFilters: () => [['all', t('allStatuses')], ['unpaid', t('fines.status.unpaid')], ['paid', t('fines.status.paid')], ['unknown', t('fines.status.unknown')]].map(([k, l]) => ({ k, l, n: k === 'all' ? FINES.length : FINES.filter((f) => f.status === k).length })),
  /** The vehicle file's overview facts, in the order `OverviewPanel` shows them. */
  facts: (v) => [[t('plate'), K.plate(v.plate)], [t('type'), esc(K.vtype(v))], [t('class'), esc(K.vcls(v))], [t('trafficCode'), `<bdi class="mono ltr">${v.traffic}</bdi>`], [t('licenseStart'), K.date(v.start)],
    [t('licenseExpiry'), `${K.date(v.expiry)} ${K.badge('expiry', expiryState(v.expiry))}`], [t('insuranceExpiry'), v.ins ? `${K.date(v.ins)} ${K.badge('expiry', expiryState(v.ins))}` : `<span class="muted">${t('insuranceNotRecorded')}</span>`],
    [t('vin'), `<bdi class="mono ltr">${v.vin}</bdi>`], [t('site'), esc(siteName(v.site))], [t('odometer'), `<bdi class="mono ltr">${K.num(v.km)}</bdi> ${t('km')}`]],
  vehTabs: (v) => [['fines', t('tabFines'), FINES.filter((f) => f.veh === v.id).length], ['renewals', t('tabRenewals'), 1], ['accidents', t('tabAccidents'), ACC.filter((a) => a.veh === v.id).length], ['maintenance', t('tabMaintenance'), MNT.filter((m) => m.veh === v.id).length], ['photos', t('tabPhotos'), 3], ['certificates', t('tabCertificates'), 2]],
}

// ── Form content (identical in every direction) ─────────────────────────────
const dirAttr = () => `dir="${S.lang === 'ar' ? 'rtl' : 'ltr'}"`
/** A labelled control. The label is tied to the control through the control's `name`. */
function fld(label, control, { req = false, full = false, hint = '' } = {}) {
  const name = control.match(/name="([^"]+)"/)?.[1]
  const tied = name ? control.replace(`name="${name}"`, `name="${name}" id="f-${name}"${req ? ' aria-required="true"' : ''}`) : control
  return `<div class="fld${full ? ' full' : ''}"><label${name ? ` for="f-${name}"` : ''}>${label}${req ? '<span class="req" aria-hidden="true">*</span>' : ''}</label>${tied}${hint ? `<span class="hint">${hint}</span>` : ''}</div>`
}
/** `attrs` may bring its own `class`; an element keeps only its first one. */
const inp = (name, attrs = '') => `<input name="${name}" ${attrs.includes('class=') ? attrs : `class="inp" ${attrs}`}>`
const sel = (name, options, value = '', attrs = '') => `<select class="inp" name="${name}" ${attrs}>${options.map(([v, l]) => `<option value="${esc(v)}"${String(v) === String(value) ? ' selected' : ''}>${esc(l)}</option>`).join('')}</select>`
const vehicleOptions = () => VEH.map((v) => [v.id, `${v.plate} · ${K.vtype(v)}`])
const drop = (label, hint) => `<div class="drop">${K.ic('upload')}<div><strong>${label}</strong>${hint}</div></div>`

function insuranceFields(i = {}) {
  const claim = [['', t('notSet')], ...['not_submitted', 'submitted', 'under_repair', 'settled'].map((k) => [k, t('cs_' + k)])]
  const payer = [['', t('notSet')], ...['insurer', 'company', 'driver'].map((k) => [k, t('payer_' + k)])]
  return `<div class="grid2">
    ${fld(t('claimNo'), inp('claim', `dir="ltr" class="inp mono" value="${esc(i.claim || '')}"`))}
    ${fld(t('claimStatus'), sel('status', claim, i.status))}
    ${fld(t('insurer'), inp('insurer', `dir="auto" value="${esc(tx(i.insurer))}"`))}
    ${fld(t('repairGarage'), inp('garage', `dir="auto" value="${esc(tx(i.garage))}"`))}
    ${fld(t('payer'), sel('payer', payer, i.payer), { full: true })}
  </div>`
}

/** Overlay content for `S.overlay`. A direction wraps `sections` in its own chrome. */
function spec() {
  const o = S.overlay
  if (!o) return null
  /** The vehicle a maintenance record opens on: fixed by the vehicle file, or picked at the counter. */
  const lockedV = (o.kind === 'maintenance' && vOf(o.id ?? o.pre)) || null
  if (o.kind === 'accident') {
    const locked = o.id != null ? vOf(o.id) : null
    return {
      form: 'accident', title: t('newReport'), desc: t('addAccidentDesc'), submit: t('save'), paper: paper(null, true),
      sections: [
        { title: t('secIncident'), html: `<div class="grid2">
          ${locked ? `<div class="fld full"><span class="lbl">${t('selectedVehicle')}</span><div>${K.plate(locked.plate)}</div><input type="hidden" name="veh" value="${locked.id}"></div>` : fld(t('selectedVehicle'), sel('veh', vehicleOptions(), o.pre ?? ''), { req: true, full: true })}
          ${fld(t('date'), inp('date', `type="date" class="inp mono" value="${TODAY}" required`), { req: true })}
          ${fld(t('time'), inp('time', 'type="time" class="inp mono" value="09:30" required'), { req: true })}
          ${fld(t('driver'), sel('emp', [['', t('unassigned')], ...EMP.map((e) => [e.id, `${loc(e.ar, e.en)} · ${e.id}`])]))}
          ${fld(t('policeRef'), inp('police', 'dir="ltr" class="inp mono"'))}
          ${fld(t('location'), inp('location', `${dirAttr()} required`), { req: true, full: true })}
          ${fld(t('description'), `<textarea class="inp" name="description" rows="3" ${dirAttr()} required></textarea>`, { req: true, full: true })}
        </div>` },
        { title: t('secEvidence'), html: drop(t('uploadPhotos'), t('photosHint')) },
        { title: t('secInsurance'), note: t('insuranceOptional'), html: `${K.cover()}
          <button type="button" class="link" data-act="insToggle" aria-expanded="false" style="margin-block-start:.7rem">${K.ic('plus')}${t('addInsurance')}</button>
          <div data-ins hidden style="margin-block-start:.7rem">${insuranceFields()}</div>` },
      ],
    }
  }
  if (o.kind === 'insurance') {
    const a = ACC.find((x) => x.id === o.id), v = vOf(a.veh)
    return {
      form: 'insurance', title: t(K.hasIns(a) ? 'editInsurance' : 'addInsurance'), desc: t('insuranceOptional'), submit: t('save'),
      sections: [{ html: `<div style="display:flex;flex-wrap:wrap;align-items:center;gap:.5rem;margin-block-end:.8rem">${K.plate(v.plate)}<span class="muted" style="font-size:.76rem">${esc(K.vtype(v))} · ${K.date(a.date, a.time)}</span></div>${K.cover()}<div style="margin-block-start:.8rem">${insuranceFields(a.ins)}</div>` }],
    }
  }
  if (o.kind === 'letter') {
    const a = ACC.find((x) => x.id === o.id)
    const missing = !a.locAr || !a.descAr
    return {
      form: 'letter', title: t('accidentTitle'), desc: t('accidentLetterDesc'), submit: t('saveLetter'), paper: paper(a, missing), wide: true,
      sections: missing ? [{ title: t('arabicForLetter'), note: t('arabicForLetterDesc'), html: `<div class="grid2">
        ${fld(t('locationAr'), inp('location', `dir="rtl" lang="ar" required value="${esc(a.locAr)}"`), { req: true, full: true, hint: a.locEn ? `<bdi dir="ltr">${esc(a.locEn)}</bdi>` : '' })}
        ${fld(t('descriptionAr'), `<textarea class="inp" name="description" rows="3" dir="rtl" lang="ar" required>${esc(a.descAr)}</textarea>`, { req: true, full: true, hint: a.descEn ? `<bdi dir="ltr">${esc(a.descEn)}</bdi>` : '' })}
      </div>` }] : [],
    }
  }
  if (o.kind === 'maintenance') {
    const last = lockedV ? MNT.filter((m) => m.veh === lockedV.id).sort((x, y) => y.date.localeCompare(x.date))[0] : null
    return {
      form: 'maintenance', title: t('addMaintenance'), desc: t('addMaintenanceDesc'), submit: t('save'),
      aside: `<h4>${t('lastService')}</h4>${last ? `<dl class="ins-facts"><div><dt>${t('date')}</dt><dd>${K.date(last.date)}</dd></div><div><dt>${t('maintenanceType')}</dt><dd>${t(last.type)}</dd></div><div><dt>${t('odometer')}</dt><dd><bdi class="mono ltr">${K.num(last.km)}</bdi> ${t('km')}</dd></div><div><dt>${t('cost')}</dt><dd>${K.aed(last.cost)}</dd></div></dl>` : `<p class="muted">${t('noPreviousMaintenance')}</p>`}<p class="muted" style="margin-block-start:.8rem">${t('reminder')}</p>`,
      sections: [{ html: `<div class="grid2">
        ${fld(t('selectedVehicle'), sel('veh', vehicleOptions(), lockedV?.id ?? ''), { req: true, full: true })}
        ${fld(t('date'), inp('date', `type="date" class="inp mono" value="${TODAY}" required`), { req: true })}
        ${fld(t('maintenanceType'), sel('type', ['service', 'repair', 'tires', 'other'].map((k) => [k, t(k)])), { req: true })}
        ${fld(`${t('odometer')} (${t('km')})`, inp('km', `inputmode="numeric" dir="ltr" class="inp mono" value="${lockedV?.km ?? ''}"`))}
        ${fld(t('cost'), `<div class="inp-aed" dir="ltr"><i aria-hidden="true"></i>${inp('cost', 'inputmode="numeric" class="inp mono" required pattern="[0-9]+"')}</div>`, { req: true })}
        ${fld(t('garage'), inp('garage', dirAttr()), { full: true })}
        ${fld(t('nextDue'), inp('next', 'type="date" class="inp mono"'), { hint: t('reminderHint') })}
        <div class="fld"><span class="lbl">${t('receipt')}</span>${drop(t('uploadReceipt'), '')}</div>
      </div>` }],
    }
  }
  if (o.kind === 'vehicle') {
    return {
      form: 'vehicle', title: t('addVehicleTitle'), desc: t('addVehicleDesc'), submit: t('save'), wide: true,
      sections: [
        { title: t('sections.identity'), html: `<div class="grid2">
          ${fld(t('plate'), inp('plate', 'dir="ltr" class="inp mono" placeholder="14 \\ 58216" required'), { req: true })}
          ${fld(t('type'), inp('type', `${dirAttr()} required`), { req: true })}
          ${fld(t('class'), sel('cls', [...new Set(VEH.map((v) => K.vcls(v)))].map((c) => [c, c])))}
          ${fld(t('site'), sel('site', SITES.map((s) => [s.id, loc(s.ar, s.en)])), { req: true })}
          ${fld(t('trafficCode'), inp('traffic', 'dir="ltr" class="inp mono"'))}
          ${fld(t('vin'), inp('vin', 'dir="ltr" class="inp mono"'))}
        </div>` },
        { title: t('secLicence'), html: `<div class="grid2">
          ${fld(t('licenseStart'), inp('start', `type="date" class="inp mono" value="${TODAY}" required`), { req: true })}
          ${fld(t('licenseExpiry'), inp('expiry', 'type="date" class="inp mono" value="2027-11-16" required'), { req: true })}
          ${fld(t('insuranceExpiry'), inp('ins', 'type="date" class="inp mono"'))}
        </div>` },
        { title: t('secNotes'), html: `<div class="grid2">
          ${fld(t('accessories'), `<textarea class="inp" name="accessories" rows="2" ${dirAttr()}></textarea>`, { full: true })}
          ${fld(t('generalNotes'), `<textarea class="inp" name="notes" rows="2" ${dirAttr()}></textarea>`, { full: true })}
        </div>` },
      ],
    }
  }
  if (o.kind === 'sites') {
    return {
      form: 'sites', title: t('manageSites'), desc: t('manageSitesDesc'), submit: t('addSite'),
      sections: [{ html: `<ul class="site-list">${SITES.map((s) => `<li>${inp('site' + s.id, `${dirAttr()} value="${esc(loc(s.ar, s.en))}" aria-label="${t('siteName')}"`)}<span class="badge neutral"><bdi class="mono">${VEH.filter((v) => v.site === s.id).length}</bdi> ${t('vehicles')}</span></li>`).join('')}</ul>
        <div style="margin-block-start:.9rem">${fld(t('siteName'), inp('name', `${dirAttr()} required`), { req: true })}</div>` }],
    }
  }
  return null
}

/** The GSSG-VA letter. Always Arabic: it prints `location_ar` / `description_ar`. */
function paper(a, live) {
  const v = a ? vOf(a.veh) : vOf(S.overlay?.id ?? S.overlay?.pre) ?? VEH[0]
  const pending = `<span class="pending">${NEW.ar.paperPending}</span>`
  const arabicEntry = S.overlay?.kind === 'letter' || S.lang === 'ar'
  const cell = (name, value) => (live && arabicEntry ? `<span data-bind="${name}" data-empty="…">${esc(value) || '…'}</span>` : esc(value) || pending)
  const emp = a?.emp ? EMP.find((e) => e.id === a.emp) : null
  return `<div class="paper" dir="rtl" lang="ar" aria-label="${t('liveLetter')}">
    <div class="paper-head"><img src="assets/gssg-logo.png" alt=""><div><strong>${window.LOCALE.ar.vehicles.company}</strong><small>${window.LOCALE.ar.vehicles.companySub}</small></div><bdi class="mono ltr">${a?.letter || 'GSSG-VA'}</bdi></div>
    <h4>${window.LOCALE.ar.vehicles.accidentTitle}</h4>
    <dl>
      <div><dt>رقم اللوحة</dt><dd><bdi class="mono ltr" data-bind-plate>${esc(v.plate.replace('\\', '/'))}</bdi></dd></div>
      <div><dt>نوع المركبة</dt><dd data-bind-type>${esc(v.ar)}</dd></div>
      <div><dt>التاريخ والوقت</dt><dd><bdi class="mono ltr"><span data-bind="date">${a?.date || TODAY}</span> <span data-bind="time">${a?.time || '09:30'}</span></bdi></dd></div>
      <div><dt>السائق</dt><dd data-bind-emp>${emp ? esc(emp.ar) : '—'}</dd></div>
      <div><dt>رقم بلاغ الشرطة</dt><dd><bdi class="mono ltr" data-bind="police" data-empty="—">${esc(a?.police) || '—'}</bdi></dd></div>
      <div><dt>تكلفة الضرر</dt><dd>${NEW.ar.damageCoverLine}</dd></div>
      <div class="wide"><dt>الموقع التفصيلي</dt><dd>${cell('location', a?.locAr)}</dd></div>
    </dl>
    <div class="body">${cell('description', a?.descAr)}</div>
  </div>`
}

// ── Actions ─────────────────────────────────────────────────────────────────
function toast(message) {
  const el = document.getElementById('toast')
  el.querySelector('span').textContent = message
  el.classList.add('show')
  clearTimeout(toast.timer)
  toast.timer = setTimeout(() => el.classList.remove('show'), 2600)
}
const ACTS = {
  go(el) { S.route = el.dataset.to; if (el.dataset.id) S.vehicleId = Number(el.dataset.id); if (el.dataset.tab) S.tab = el.dataset.tab; S.overlay = null; render(true) },
  /** `data-pick`: the request starts on the vehicle chosen at the counter, still editable in the form. */
  overlay(el) {
    const pick = 'pick' in el.dataset ? Number(el.closest('[data-start]').querySelector('select').value) : null
    S.overlay = { kind: el.dataset.kind, id: el.dataset.id ? Number(el.dataset.id) : null, pre: pick }
    render()
  },
  close() { S.overlay = null; render() },
  status(el) { const a = ACC.find((x) => x.id === Number(el.dataset.id)); a.status = a.status === 'open' ? 'closed' : 'open'; toast(t('statusUpdated')); render() },
  acFilter(el) { S.acFilter = S.acFilter === el.dataset.v ? 'all' : el.dataset.v; render() },
  fineFilter(el) { S.fineFilter = el.dataset.v; render() },
  site(el) { S.site = el.dataset.v ? Number(el.dataset.v) : null; render() },
  tab(el) { S.tab = el.dataset.v; render() },
  mtab(el) { S.mTab = el.dataset.v; render() },
  pay(el) { FINES.find((f) => f.id === Number(el.dataset.id)).status = 'paid'; toast(t('fines.recordPayment')); render() },
  noop() { toast(t('unchanged')) },
  insToggle(el) { const box = el.parentElement.querySelector('[data-ins]'); box.hidden = !box.hidden; el.setAttribute('aria-expanded', String(!box.hidden)); if (!box.hidden) box.querySelector('input').focus() },
  lang(el) { S.lang = el.dataset.v; render() },
  device(el) { S.device = el.dataset.v; render() },
}
const readIns = (d) => ({ claim: d.get('claim')?.trim(), insurer: d.get('insurer')?.trim(), garage: d.get('garage')?.trim(), status: d.get('status'), payer: d.get('payer') })
const FORMS = {
  accident(d) {
    const ar = S.lang === 'ar'
    ACC.unshift({ id: Math.max(...ACC.map((a) => a.id)) + 1, veh: Number(d.get('veh')), date: d.get('date'), time: d.get('time'), emp: d.get('emp') || null,
      locAr: ar ? d.get('location') : '', locEn: ar ? '' : d.get('location'), descAr: ar ? d.get('description') : '', descEn: ar ? '' : d.get('description'),
      police: d.get('police'), status: 'open', photos: 0, letter: null, ins: readIns(d) })
    S.acFilter = 'all'
    return t('accidentFiled')
  },
  insurance(d) { ACC.find((a) => a.id === S.overlay.id).ins = readIns(d); return t('insuranceSaved') },
  letter(d) {
    const a = ACC.find((x) => x.id === S.overlay.id)
    if (d.get('location')) { a.locAr = d.get('location'); a.descAr = d.get('description') }
    a.letter = `GSSG-VA-00${a.id}`
    return t('letterSaved')
  },
  maintenance(d) {
    MNT.unshift({ id: MNT.length + 1, veh: Number(d.get('veh')), date: d.get('date'), type: d.get('type'), km: Number(d.get('km')) || null, cost: Number(d.get('cost')), garage: d.get('garage'), next: d.get('next') || null, receipt: false })
    return t('maintenanceLogged')
  },
  vehicle(d) {
    const type = d.get('type'), site = Number(d.get('site'))
    VEH.push({ id: VEH.length + 1, plate: d.get('plate'), ar: type, en: type, clsAr: d.get('cls'), clsEn: d.get('cls'), traffic: d.get('traffic'), site, start: d.get('start'), expiry: d.get('expiry'), ins: d.get('ins') || null, vin: d.get('vin'), km: 0, driven: 0 })
    return t('vehicleSaved')
  },
  sites(d) { const name = d.get('name'); SITES.push({ id: SITES.length + 1, ar: name, en: name }); return t('siteAdded') },
}

document.addEventListener('click', (e) => { const el = e.target.closest('[data-act]'); if (el) ACTS[el.dataset.act]?.(el) })
document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && S.overlay) ACTS.close() })
document.addEventListener('change', (e) => { if (e.target.id === 'screen-pick') ACTS.go({ dataset: { to: e.target.value } }) })
document.addEventListener('submit', (e) => {
  e.preventDefault()
  const form = e.target
  // The app's own alert instead of the browser's bubble (FormAlert in DialogShell).
  const bad = [...form.querySelectorAll('[required]')].filter((el) => !el.value.trim() || !el.checkValidity())
  form.querySelectorAll('[aria-invalid]').forEach((el) => el.removeAttribute('aria-invalid'))
  const alert = form.querySelector('[data-alert]')
  if (bad.length) { bad.forEach((el) => el.setAttribute('aria-invalid', 'true')); alert.hidden = false; bad[0].focus(); return }
  const keep = form.dataset.form === 'sites'
  const message = FORMS[form.dataset.form](new FormData(form))
  if (!keep) S.overlay = null
  toast(message)
  render()
})
/** Variant C fills the official paper while the operator types. */
document.addEventListener('input', (e) => {
  const root = document.getElementById('ov'), name = e.target.name
  if (!name || !root.contains(e.target)) return
  root.querySelectorAll(`[data-bind="${name}"]`).forEach((el) => { el.textContent = e.target.value || el.dataset.empty || '' })
  if (name === 'veh') { const v = vOf(e.target.value); root.querySelectorAll('[data-bind-plate]').forEach((el) => (el.textContent = v.plate.replace('\\', '/'))); root.querySelectorAll('[data-bind-type]').forEach((el) => (el.textContent = v.ar)) }
  if (name === 'emp') root.querySelectorAll('[data-bind-emp]').forEach((el) => (el.textContent = EMP.find((x) => x.id === e.target.value)?.ar || '—'))
})

function render(top = false) {
  const frame = document.getElementById('frame'), app = document.getElementById('app'), ov = document.getElementById('ov')
  const scroller = app.querySelector('.scroll'), y = top || !scroller ? 0 : scroller.scrollTop
  const hadOverlay = ov.childElementCount > 0
  document.documentElement.dataset.device = S.device
  frame.dir = S.lang === 'ar' ? 'rtl' : 'ltr'
  frame.lang = S.lang
  app.innerHTML = K.topnav() + VIEW.screen()
  ov.innerHTML = S.overlay ? VIEW.overlay(spec()) : ''
  const next = app.querySelector('.scroll')
  if (next) next.scrollTop = y
  if (S.overlay && !hadOverlay) ov.querySelector('input:not([type=hidden]), select, textarea')?.focus()
  for (const b of document.querySelectorAll('.mockbar [data-act]')) b.setAttribute('aria-pressed', String(S[b.dataset.act] === b.dataset.v))
  document.getElementById('screen-pick').value = S.route
  history.replaceState(null, '', `?lang=${S.lang}&device=${S.device}&screen=${S.route}`)
}
