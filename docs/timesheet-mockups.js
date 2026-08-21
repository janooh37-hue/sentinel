/* ============================================================================
   GSSG Manager — Monthly Time Sheet: shared mockup kernel (behaviour + data)
   ----------------------------------------------------------------------------
   One fixture, one grid renderer, one code picker, shared by all four
   direction mockups so a reviewer compares LAYOUT and INTERACTION, never
   incidental differences in data or styling.

   Sample data only — invented names and G-numbers, scaled to 26 rows and 18
   contracted posts so the statistics two-block split is visible on one screen
   (live: 275 rows, 249 posts). Rules reproduced from
   docs/superpowers/specs/2026-08-19-monthly-timesheet-design.md:
     * emitted codes are exactly P, AL, "SL " (trailing space), AB, TR, NG, -
     * day 31 stays blank in 30-day months
     * statistics block 1 is forced to P except NG / -
     * statistics block 2 takes its filler code except NG, - and real AB
     * implied posts = statistics P days / days in month, and must never read
       ABOVE the contracted post count
   ========================================================================= */

const TS = (() => {
  /* ------------------------------------------------------------ 1. codes */
  const CODES = [
    { code: 'P',   slug: 'P',  key: 'p', en: 'Working day',     ar: 'يوم عمل' },
    { code: 'AL',  slug: 'AL', key: 'a', en: 'Annual leave',    ar: 'إجازة سنوية' },
    { code: 'SL ', slug: 'SL', key: 's', en: 'Sick leave',      ar: 'إجازة مرضية' },
    { code: 'AB',  slug: 'AB', key: 'b', en: 'Absence',         ar: 'غياب' },
    { code: 'TR',  slug: 'TR', key: 't', en: 'National service', ar: 'خدمة وطنية' },
    { code: 'NG',  slug: 'NG', key: 'n', en: 'Not yet joined',  ar: 'لم يباشر بعد' },
    { code: '-',   slug: '-',  key: '-', en: 'Off roster',      ar: 'خارج الكشف' },
  ]
  /* The manual red block: days inside the roster but outside the billing
     window — the leaving month where the client's bill starts on the 23rd, so
     1..22 must not read as a manned post. Never derived, only painted by hand,
     and it survives the statistics transform exactly like NG and `-` (forcing
     it to P would put the unbilled days back on the client's invoice).
     Opt-in per direction via state.blockCode so the earlier mockups keep the
     seven emitted codes they were reviewed with. */
  const CODE_BLOCK = { code: 'X', slug: 'X', key: 'x', en: 'Red block — not billed', ar: 'حجب أحمر — غير مفوتر' }

  const allCodes = () => (state.blockCode ? [...CODES, CODE_BLOCK] : CODES)

  const bySlug = Object.fromEntries([...CODES, CODE_BLOCK].map((c) => [c.slug, c]))
  const slugOf = (code) => (code === null || code === undefined ? '' : String(code).trim() || '-')

  const MONTHS_EN = ['January', 'February', 'March', 'April', 'May', 'June', 'July',
    'August', 'September', 'October', 'November', 'December']
  const MONTHS_AR = ['يناير', 'فبراير', 'مارس', 'أبريل', 'مايو', 'يونيو', 'يوليو',
    'أغسطس', 'سبتمبر', 'أكتوبر', 'نوفمبر', 'ديسمبر']
  const DAY_EN = ['S', 'M', 'T', 'W', 'T', 'F', 'S']
  const DAY_AR = ['ح', 'ن', 'ث', 'ر', 'خ', 'ج', 'س']

  /* --------------------------------------------------------- 2. strings */
  const STRINGS = {
    en: {
      'nav.dashboard': 'Dashboard', 'nav.employees': 'Employees', 'nav.ledger': 'Ledger',
      'nav.leaves': 'Leaves', 'nav.services': 'Services', 'nav.records': 'Records',
      'nav.permits': 'Permits', 'nav.timesheet': 'Time sheet',
      eyebrow: 'Monthly deliverables · Site JD 908',
      title: 'Monthly time sheet',
      lede: 'Check the month, correct what the records got wrong, then release the two workbooks.',
      attendance: 'Attendance', statistics: 'Client statistics',
      main: 'All staff', drivers: 'Drivers',
      codes: 'Codes', legend: 'Legend',
      prevMonth: 'Previous month', nextMonth: 'Next month',
      downloadAttendance: 'Download attendance sheet',
      downloadStatistics: 'Download client statistics',
      reopen: 'Reopen month', reopened: 'Month reopened — a new download supersedes the file already sent.',
      closed: 'Closed', open: 'Open',
      closedNote: 'Closed on 01 Jul 2026 by A. Al Mansoori · the grid is frozen as printed.',
      firstDownload: 'The first download closes the month and freezes this grid.',
      posts: 'Contracted posts', impliedPosts: 'Implied posts',
      impliedOk: 'at or below contract — correct',
      impliedDrift: 'above contract — block-2 rows are still P',
      issues: 'Checks', blocking: 'Fix before download', warning: 'Worth a look',
      allClear: 'Every check passed. Both workbooks are ready.',
      resolve: 'Resolve', resolved: 'Resolved',
      note: 'Note (optional)', save: 'Save', cancel: 'Cancel', clear: 'Clear cell',
      undo: 'Undo last change', edited: 'corrections this month',
      row: 'Row', id: 'ID', name: 'Name', nat: 'Nat', desig: 'Designation',
      totalDay: 'Total day', off: 'Off',
      headcount: 'On post', density: 'Sheet zoom',
      search: 'Search name, ID or designation',
      block1: 'Block 1 — contracted posts, billed as manned',
      block2: 'Block 2 — surplus headcount, filler codes',
      notSet: 'not set', unmapped: 'no English mapping',
      day: 'day', paperOrder: 'As printed',
      downloadStarted: 'Preparing the workbook…',
      cellSaved: 'Saved',
    },
    ar: {
      'nav.dashboard': 'لوحة التحكم', 'nav.employees': 'الموظفون', 'nav.ledger': 'السجل',
      'nav.leaves': 'الإجازات', 'nav.services': 'الخدمات', 'nav.records': 'السجلات',
      'nav.permits': 'التصاريح', 'nav.timesheet': 'كشف الحضور',
      eyebrow: 'المخرجات الشهرية · موقع JD 908',
      title: 'كشف الحضور الشهري',
      lede: 'راجع الشهر، صحّح ما أخطأت به السجلات، ثم أصدر الملفين.',
      attendance: 'كشف الحضور', statistics: 'إحصائية العميل',
      main: 'جميع العاملين', drivers: 'السائقون',
      codes: 'الرموز', legend: 'مفتاح الرموز',
      prevMonth: 'الشهر السابق', nextMonth: 'الشهر التالي',
      downloadAttendance: 'تنزيل كشف الحضور',
      downloadStatistics: 'تنزيل إحصائية العميل',
      reopen: 'إعادة فتح الشهر', reopened: 'أُعيد فتح الشهر — أي تنزيل جديد يلغي الملف المُرسل.',
      closed: 'مغلق', open: 'مفتوح',
      closedNote: 'أُغلق في 01 يوليو 2026 بواسطة أ. المنصوري · الشبكة مثبتة كما طُبعت.',
      firstDownload: 'أول تنزيل يغلق الشهر ويثبّت هذه الشبكة.',
      posts: 'النقاط التعاقدية', impliedPosts: 'النقاط المحتسبة',
      impliedOk: 'مطابق أو أقل من التعاقد — صحيح',
      impliedDrift: 'أعلى من التعاقد — صفوف الكتلة 2 ما زالت P',
      issues: 'الفحوصات', blocking: 'يجب إصلاحه قبل التنزيل', warning: 'يستحق المراجعة',
      allClear: 'اجتازت جميع الفحوصات. الملفان جاهزان.',
      resolve: 'معالجة', resolved: 'تمت المعالجة',
      note: 'ملاحظة (اختياري)', save: 'حفظ', cancel: 'إلغاء', clear: 'مسح الخلية',
      undo: 'تراجع عن آخر تغيير', edited: 'تصحيحات هذا الشهر',
      row: 'م', id: 'الرقم', name: 'الاسم', nat: 'الجنسية', desig: 'المسمى',
      totalDay: 'أيام العمل', off: 'راحة',
      headcount: 'على النقاط', density: 'تكبير الشبكة',
      search: 'ابحث بالاسم أو الرقم أو المسمى',
      block1: 'الكتلة 1 — النقاط التعاقدية، تُحتسب مشغولة',
      block2: 'الكتلة 2 — العدد الزائد، رموز تعويضية',
      notSet: 'غير محدد', unmapped: 'لا يوجد مقابل إنجليزي',
      day: 'يوم', paperOrder: 'كما تُطبع',
      downloadStarted: 'جاري تجهيز الملف…',
      cellSaved: 'تم الحفظ',
    },
  }

  /* --------------------------------------------------------- 3. the roster */
  const DESIGNATIONS = {
    1:  { en: 'Prisons Director', ar: 'مدير عام الحراسات الأمنية' },
    3:  { en: 'Project Manager', ar: 'مديرمركز الإصلاح والتأهيل' },
    5:  { en: 'Duty In charge', ar: 'مناوب عام' },
    6:  { en: 'Security Supervisor', ar: 'مشرف' },
    8:  { en: 'assistant security supervisor', ar: 'مساعد مشرف' },
    10: { en: 'Control room Security Guard', ar: 'حارس امن عرفة العمليات' },
    13: { en: 'Escort Security Guard', ar: 'حارس امن تنويم مستشفيات' },
    14: { en: 'Messengers', ar: 'حارس امن الارساليات' },
    15: { en: 'Security Guard', ar: 'حارس امن' },
    16: { en: 'Driver', ar: 'سائق' },
  }

  /* Invented people. ALL-CAPS Latin names because that is how the circulating
     workbooks carry them; the Arabic column is the designation, not the name. */
  const PEOPLE = [
    ['G7001', 'KHALID SAEED AL BLOOSHI', 'U.A.E', 1],
    ['G7014', 'OMAR FAROUK MANSOUR', 'Egypt', 3],
    ['G7022', 'RASHID ABDULLA AL AMERI', 'U.A.E', 5],
    ['G7031', 'IMRAN HUSSAIN QURESHI', 'Pakistan', 6],
    ['G7038', 'DINESH BAHADUR THAPA', 'Nepal', 6],
    ['G7050', 'SAJID ALI KHAN', 'Pakistan', 8],
    ['G7057', 'RAJESH KUMAR SINGH', 'India', 8],
    ['G7063', 'MOHAMED SHAFI KOYA', 'India', 10],
    ['G7071', 'ANWAR HOSSAIN MIAH', 'Bangladesh', 10],
    ['G7078', 'PRAKASH LAL SHRESTHA', 'Nepal', 10],
    ['G7085', 'ASIF MEHMOOD BUTT', 'Pakistan', 10],
    ['G7092', 'NUWAN PERERA SILVA', 'Sri Lanka', 13],
    ['G7099', 'KYAW MIN THU', 'Myanmar', 13],
    ['G7106', 'SUNIL PRASAD SHARMA', 'Nepal', 14],
    ['G7113', 'JAMAL UDDIN AHMED', 'Bangladesh', 14],
    ['G7120', 'VIJAY SEKHAR NAIR', 'India', 14],
    ['G7127', 'HAMZA IQBAL CHAUDHRY', 'Pakistan', 14],
    ['G7134', 'SANTOSH KUMAR YADAV', 'India', 15],
    ['G7141', 'MD RASEL HOWLADER', 'Bangladesh', 15],
    ['G7148', 'BINOD RAJ GURUNG', 'Nepal', 15],
    ['G7155', 'ABDUL WAHAB SHAIKH', 'Pakistan', 15],
    ['G7162', 'THILINA BANDARA WEERA', 'Sri Lanka', 15],
    ['G7169', 'SURESH BABU PILLAI', 'India', 15],
    ['G7176', 'FAISAL AKRAM JAVED', 'Pakistan', 15],
    ['G7183', 'ROBIUL ISLAM SARKER', 'Bangladesh', 15],
    ['G7190', 'KAMAL PRASAD ADHIKARI', 'Nepal', 15],
    /* The drivers file is its own workbook off the same template (spec
       "Deliverables" 3), so rank 16 lives in the fixture and the All staff /
       Drivers control filters the roster instead of emptying it. */
    ['G7204', 'IBRAHIM MUSA GAMAL', 'Egypt', 16],
    ['G7211', 'HARJIT SINGH SANDHU', 'India', 16],
  ]

  /* Roster edges as data, not as painted cells. A joiner's days before he
     started are NG; a leaver's days after he finished are `-`; and — the rule
     the client's invoice depends on — a leaver is absent from every LATER
     month's roster entirely, on both the attendance sheet and the statistics.
     [month, first worked day] / [month, last worked day]. */
  const JOINERS = { G7148: [6, 7], G7176: [7, 10], G7183: [8, 5] }
  const LEAVERS = { G7169: [6, 17], G7141: [7, 17], G7155: [8, 25] }

  /** Employees added from the UI. Re-applied on every build so a new hire
      survives a month step: absent before his joining month, NG-headed in it. */
  const ADDED = []

  /* Scripted leave per month, so every reviewer sees the same interesting
     month: a 12-day annual leave, a short sick leave, a full-month national
     service, and single absences. Roster edges are derived, never scripted. */
  const SCRIPT = {
    6: [
      ['G7057', 'AL', 4, 15], ['G7078', 'SL ', 9, 11], ['G7099', 'TR', 1, 30],
      ['G7127', 'AB', 22, 22], ['G7204', 'AL', 10, 19],
    ],
    7: [
      ['G7057', 'AL', 6, 17], ['G7085', 'SL ', 12, 14], ['G7099', 'TR', 1, 31],
      ['G7127', 'AB', 3, 3], ['G7134', 'AB', 21, 21], ['G7113', 'AL', 24, 31],
      ['G7211', 'SL ', 8, 10],
    ],
    8: [
      ['G7050', 'AL', 2, 13], ['G7092', 'SL ', 5, 7], ['G7099', 'TR', 1, 31],
      ['G7106', 'AB', 14, 14], ['G7204', 'TR', 1, 31],
    ],
  }

  /* Preflight is per sheet: the drivers workbook is clean in every fixture
     month, which is how a reviewer sees the all-clear state. */
  const PREFLIGHT = {
    7: [
      { level: 'stop', sheet: 'main', who: 'G7099', en: 'No designation on file — the row cannot be placed in rank order.', ar: 'لا يوجد مسمى وظيفي — لا يمكن ترتيب الصف حسب الرتبة.' },
      { level: 'stop', sheet: 'main', who: 'G7099', en: 'Nationality "Myanmar" has no English mapping for column D.', ar: 'الجنسية «Myanmar» بلا مقابل إنجليزي للعمود D.' },
      { level: 'warn', sheet: 'main', who: 'G7113', en: 'Leave type Unknown overlaps 24–31 July. Retype it before the client sees AL.', ar: 'نوع إجازة غير معروف يتقاطع مع 24–31 يوليو. صحّح النوع قبل ظهوره كـ AL.' },
      { level: 'warn', sheet: 'main', who: 'G7141', en: 'End date 17 Jul 2026 has passed while the status is still Active.', ar: 'تاريخ الانتهاء 17 يوليو 2026 مضى والحالة ما زالت نشطة.' },
      { level: 'warn', sheet: 'main', who: 'G7169', en: 'Two Annual Leave rows overlap; the union is already applied.', ar: 'صفّا إجازة سنوية متقاطعان؛ تم تطبيق الاتحاد بينهما.' },
    ],
    6: [],
    8: [
      { level: 'warn', sheet: 'main', who: 'G7183', en: 'No date of joining — the roster edge is a guess.', ar: 'لا يوجد تاريخ مباشرة — حد الكشف تقديري.' },
    ],
  }

  /* Contracted posts are per workbook, so the two sheets keep their own value.
     24 of 26 mirrors the live ratio (249 of 275) — which also means the daily
     headcount dips below contract on leave-heavy days, so the drift readout and
     the low-day markers both have something real to show. */
  const POSTS = { main: 24, drivers: 2 }

  /* ------------------------------------------------------------ 4. state */
  const state = {
    year: 2026,
    month: 7,
    sheet: 'main',
    variant: 'attendance',
    postCount: 24,
    /* opt-in: adds the manual red block to the ribbon, the picker and the
       keyboard, and lets it survive the statistics transform */
    blockCode: false,
    /* the employee whose two-month sheet is being extracted, or null */
    selected: null,
    closed: false,
    brush: null,
    lang: 'en',
    theme: 'light',
    density: 'default',
    edits: [],
    resolved: new Set(),
    /* new hires whose NG starting point the operator has confirmed */
    confirmedStarts: new Set(),
  }

  /* One event only: "state changed, repaint". A handler registered for both
     'change' and 'render' must still paint once per change, and a repaint must
     not eat the keyboard focus that painting the grid destroys — so handlers
     live in a Set, emits coalesce into one task, and the focused cell is
     restored afterwards.

     Coalesced with setTimeout, NOT requestAnimationFrame: a hidden or
     background tab never runs rAF callbacks, so a mockup opened in a
     background tab (or driven headlessly for review) would sit on stale DOM
     until it was foregrounded. */
  const handlers = new Set()
  let queued = false
  let focusMark = null

  const on = (_evt, fn) => (handlers.add(fn), fn)

  function flush() {
    queued = false
    handlers.forEach((fn) => fn())
    /* Only reclaim focus the repaint actually dropped — never steal it from a
       note field, the post-count input, or a toolbar button. */
    if (focusMark && document.activeElement === document.body) {
      focusCell(focusMark.row, focusMark.day)
    }
  }

  function emit() {
    if (queued) return
    queued = true
    setTimeout(flush, 0)
  }

  const emitAll = emit

  const daysIn = (year, month) => new Date(year, month, 0).getDate()
  const t = (key) => STRINGS[state.lang][key] ?? STRINGS.en[key] ?? key

  /* `all` is every employee; `rows` is the workbook currently on screen. The
     All staff / Drivers control switches which file you are looking at, so it
     re-derives the view: row numbers restart at 1 and the statistics blocks are
     recomputed against that workbook's own post count. */
  let all = []
  let rows = []

  function derive() {
    rows = all.filter((row) => row.sheet === state.sheet)
    state.postCount = Math.min(POSTS[state.sheet], rows.length)
    rows.forEach((row, i) => {
      row.no = i + 1
      row.block = i < state.postCount ? 1 : 2
      const rank = i - state.postCount
      /* Block-2 filler shape, carried forward month to month in the real app:
         a first group of SL, a bulk of AL, a trailing group of TR.
         August is the month nobody has shaped yet: its first block-2 row is
         still P, which is exactly how the real July file overshot the contract
         by 59 P days. Switch to August + Client statistics to see the implied
         post count read ABOVE contract and the drift chip fire. */
      row.filler =
        row.block === 1
          ? null
          : state.month === 8 && rank === 0
            ? 'P'
            : rank < 2
              ? 'SL '
              : rank < 6
                ? 'AL'
                : 'TR'
    })
  }

  function build() {
    const days = daysIn(state.year, state.month)
    const person = ([id, name, nat, rank]) => ({
      id,
      name,
      nat,
      rank,
      sheet: rank === 16 ? 'drivers' : 'main',
      desig: DESIGNATIONS[rank],
      /* G7099 is the preflight specimen: no designation, unmapped nationality */
      desigMissing: state.month === 7 && id === 'G7099',
      natUnmapped: nat === 'Myanmar',
      codes: Array.from({ length: 31 }, (_, i) => (i < days ? 'P' : null)),
      edited: new Set(),
      notes: {},
    })

    /* A leaver is off the roster from the month after he finished — the whole
       point of the rule: he must not appear on the client's next invoice. */
    all = PEOPLE.filter(([id]) => {
      const left = LEAVERS[id]
      return !left || left[0] >= state.month
    }).map(person)

    ADDED.filter((a) => a.month <= state.month).forEach((a) => {
      all.push({ ...person([a.id, a.name, a.nat, a.rank]), added: true, startMonth: a.month, startDay: a.startDay })
    })

    const index = Object.fromEntries(all.map((r) => [r.id, r]))
    ;(SCRIPT[state.month] || []).forEach(([id, code, from, to]) => {
      const row = index[id]
      if (!row) return
      for (let d = from; d <= Math.min(to, days); d += 1) row.codes[d - 1] = code
    })

    /* Roster edges last: they outrank leave, exactly as the engine does. */
    Object.entries(JOINERS).forEach(([id, [month, first]]) => {
      const row = index[id]
      if (!row || month !== state.month) return
      for (let d = 1; d < first; d += 1) row.codes[d - 1] = 'NG'
      row.joinedDay = first
    })
    all.forEach((row) => {
      if (!row.added || row.startMonth !== state.month) return
      for (let d = 1; d < row.startDay; d += 1) row.codes[d - 1] = 'NG'
      row.joinedDay = row.startDay
    })
    Object.entries(LEAVERS).forEach(([id, [month, last]]) => {
      const row = index[id]
      if (!row || month !== state.month) return
      for (let d = last + 1; d <= days; d += 1) row.codes[d - 1] = '-'
      row.leftDay = last
    })

    /* Printed order: rank, then id. PEOPLE is already in it; an employee added
       from the UI has to be slotted into it rather than appended. */
    all.sort((a, b) => a.rank - b.rank || a.id.localeCompare(b.id))
    derive()
    state.closed = state.month === 6
    state.edits = []
    state.resolved = new Set()
    state.confirmedStarts = new Set()
    document.documentElement.dataset.locked = state.closed ? '1' : '0'
  }

  /* ------------------------------------------------- 5. derived readings */
  const rawCode = (row, day) => row.codes[day - 1]

  /* The statistics transform, spec §"Statistics generation". */
  function codeOf(row, day) {
    const raw = rawCode(row, day)
    if (raw === null) return null
    if (state.variant === 'attendance') return raw
    /* Roster edges and the manual red block outrank the block-1 "always P":
       an unbilled day must never be presented to the client as a manned post. */
    if (raw === 'NG' || raw === '-' || raw === 'X') return raw
    if (row.block === 1) return 'P'
    return raw === 'AB' ? 'AB' : row.filler
  }

  function rowTotals(row) {
    const out = { P: 0, OFF: 0, AB: 0, AL: 0, SL: 0, TR: 0 }
    for (let d = 1; d <= daysIn(state.year, state.month); d += 1) {
      const code = codeOf(row, d)
      if (code === 'P') out.P += 1
      else if (code === 'AB') out.AB += 1
      else if (code === 'AL') out.AL += 1
      else if (code === 'SL ') out.SL += 1
      else if (code === 'TR') out.TR += 1
    }
    return out
  }

  /** Every code counted for one employee-month, keyed by slug. */
  function codeTally(row) {
    const out = Object.fromEntries([...CODES, CODE_BLOCK].map((c) => [c.slug, 0]))
    for (let d = 1; d <= daysIn(state.year, state.month); d += 1) {
      const code = codeOf(row, d)
      if (code === null) continue
      out[slugOf(code)] += 1
    }
    return out
  }

  /** The same tally across the whole workbook on screen. */
  function monthTally(list) {
    const out = Object.fromEntries([...CODES, CODE_BLOCK].map((c) => [c.slug, 0]))
    ;(list || rows).forEach((row) => {
      const one = codeTally(row)
      Object.keys(out).forEach((slug) => (out[slug] += one[slug]))
    })
    return out
  }

  /**
   * Who arrived and who is gone, for the month on screen.
   * `joined` started mid-month (NG head), `leaving` finishes this month
   * (`-` tail), `dropped` finished last month and is therefore absent from
   * this roster altogether — the removal the client's invoice depends on.
   */
  function rosterChanges() {
    const named = (id) => PEOPLE.find((p) => p[0] === id) || ADDED.find((a) => a.id === id)
    const label = (id) => {
      const p = named(id)
      return { id, name: Array.isArray(p) ? p[1] : p?.name ?? id }
    }
    const onSheet = (id) => {
      const p = named(id)
      const rank = Array.isArray(p) ? p[3] : p?.rank
      return (rank === 16 ? 'drivers' : 'main') === state.sheet
    }
    const joined = rows
      .filter((row) => row.joinedDay)
      .map((row) => ({ id: row.id, name: row.name, day: row.joinedDay, confirmed: state.confirmedStarts.has(row.id) }))
    const leaving = rows
      .filter((row) => row.leftDay)
      .map((row) => ({ id: row.id, name: row.name, day: row.leftDay }))
    const dropped = Object.entries(LEAVERS)
      .filter(([id, [month]]) => month === state.month - 1 && onSheet(id))
      .map(([id, [month, day]]) => ({ ...label(id), day, month }))
    return { joined, leaving, dropped }
  }

  /**
   * Add an employee mid-month. The starting point is the flag the operator
   * asked for: every day before it becomes NG, the row is marked as new, and
   * the confirmation is tracked so the notice can be dismissed once.
   */
  function addEmployee({ name, nat = 'India', rank = 15, startDay = 1 }) {
    const id = `G${7300 + ADDED.length + 1}`
    ADDED.push({ id, name: name.trim().toUpperCase(), nat, rank, month: state.month, startDay })
    build()
    state.selected = id
    emitAll()
    return id
  }

  const confirmStart = (id) => (state.confirmedStarts.add(id), emitAll())

  const dayCount = (day) => rows.reduce((n, row) => n + (codeOf(row, day) === 'P' ? 1 : 0), 0)

  function impliedPosts() {
    const days = daysIn(state.year, state.month)
    let present = 0
    for (let d = 1; d <= days; d += 1) present += dayCount(d)
    return present / days
  }

  const checks = (level) =>
    (PREFLIGHT[state.month] || []).filter(
      (i) => i.level === level && i.sheet === state.sheet && !state.resolved.has(i),
    )
  const blocking = () => checks('stop')
  const warnings = () => checks('warn')

  const editCount = () => rows.reduce((n, row) => n + row.edited.size, 0)

  /* ------------------------------------------------------- 6. mutations */
  function setCell(rowId, day, code, note) {
    if (state.closed) return toast(t('closedNote'), 'warn')
    const row = all.find((r) => r.id === rowId)
    if (!row) return
    state.edits.push({ rowId, day, from: row.codes[day - 1], wasEdited: row.edited.has(day) })
    row.codes[day - 1] = code
    row.edited.add(day)
    if (note) row.notes[day] = note
    emitAll()
    return row
  }

  function clearCell(rowId, day) {
    const row = all.find((r) => r.id === rowId)
    if (!row || state.closed) return
    state.edits.push({ rowId, day, from: row.codes[day - 1], wasEdited: row.edited.has(day) })
    row.codes[day - 1] = 'P'
    row.edited.delete(day)
    delete row.notes[day]
    emitAll()
  }

  function undo() {
    const last = state.edits.pop()
    if (!last) return
    const row = all.find((r) => r.id === last.rowId)
    row.codes[last.day - 1] = last.from
    if (!last.wasEdited) row.edited.delete(last.day)
    emitAll()
  }

  function closeMonth() {
    state.closed = true
    document.documentElement.dataset.locked = '1'
    emitAll()
  }

  function reopenMonth() {
    state.closed = false
    document.documentElement.dataset.locked = '0'
    toast(t('reopened'), 'warn')
    emitAll()
  }

  function download(variant) {
    toast(t('downloadStarted'))
    if (!state.closed) setTimeout(closeMonth, 420)
  }

  function setMonth(delta) {
    let month = state.month + delta
    if (month < 6) month = 6
    if (month > 8) month = 8
    if (month === state.month) return
    state.month = month
    build()
    emitAll()
  }

  function setVariant(variant) { state.variant = variant; emitAll() }

  function setSheet(sheet) {
    state.sheet = sheet
    derive()
    emitAll()
  }

  function setPostCount(value) {
    POSTS[state.sheet] = Math.max(0, Math.min(rows.length, Number(value) || 0))
    derive()
    emitAll()
  }

  function armBrush(code) {
    state.brush = state.brush === code ? null : code
    emitAll()
  }

  function resolve(item) { state.resolved.add(item); emitAll() }

  /* ---------------------------------------------------------- 7. toasts */
  function toast(message, tone) {
    let host = document.querySelector('.toasts')
    if (!host) {
      host = document.createElement('div')
      host.className = 'toasts'
      document.body.append(host)
    }
    const el = document.createElement('div')
    el.className = 'toast'
    el.setAttribute('role', 'status')
    el.textContent = message
    if (tone === 'warn') el.style.background = 'var(--accent)'
    host.append(el)
    setTimeout(() => el.remove(), 3200)
  }

  /* ----------------------------------------------------- 8. code picker */
  let openMenu = null
  let pickerOrigin = null

  /**
   * @param {boolean} [restore] return focus to the cell the picker was opened
   *   from. True when the picker is dismissed with Escape or resolved by a
   *   choice — otherwise a keyboard user who cancels lands on document.body.
   *   False for an outside click, which must not fight what the user clicked.
   */
  function closePicker(restore) {
    openMenu?.remove()
    openMenu = null
    if (restore && pickerOrigin) focusCell(pickerOrigin.rowId, pickerOrigin.day)
    pickerOrigin = null
  }

  function openPicker(anchor, rowId, day) {
    closePicker()
    if (state.closed) {
      toast(t('closedNote'), 'warn')
      return
    }
    const row = rows.find((r) => r.id === rowId)
    const menu = document.createElement('div')
    menu.className = 'menu'
    menu.setAttribute('role', 'menu')
    menu.innerHTML = `<div class="head">${row.id} · ${t('day')} <b>${day}</b> — ${
      state.lang === 'ar' ? row.desig?.ar ?? '' : row.name
    }</div>`

    allCodes().forEach((c) => {
      const item = document.createElement('button')
      item.type = 'button'
      item.className = 'item'
      item.setAttribute('role', 'menuitem')
      item.innerHTML =
        `<span class="glyph" data-code="${c.slug}">${c.slug === '-' ? '–' : c.slug}</span>` +
        `<span>${state.lang === 'ar' ? c.ar : c.en}</span><kbd>${c.key}</kbd>`
      item.addEventListener('click', () => {
        if (c.code === 'AB') return askNote(menu, rowId, day)
        setCell(rowId, day, c.code)
        toast(`${row.id} · ${t('day')} ${day} — ${c.slug}`)
        closePicker(true)
      })
      menu.append(item)
    })

    const clear = document.createElement('button')
    clear.type = 'button'
    clear.className = 'item'
    clear.setAttribute('role', 'menuitem')
    clear.innerHTML = `<span class="glyph">⌫</span><span>${t('clear')}</span>`
    clear.addEventListener('click', () => (clearCell(rowId, day), closePicker(true)))
    menu.append(clear)

    document.body.append(menu)
    place(menu, anchor)
    menu.querySelector('button')?.focus()
    pickerOrigin = { rowId, day }
    openMenu = menu
  }

  function askNote(menu, rowId, day) {
    menu.innerHTML =
      `<div class="head"><b>AB</b> · ${rowId} · ${t('day')} ${day}</div>` +
      `<div class="note"><label for="ab-note">${t('note')}</label>` +
      `<input id="ab-note" type="text" aria-label="${t('note')}">` +
      `<div class="row"><button type="button" class="btn btn-primary btn-sm" data-act="save">${t('save')}</button>` +
      `<button type="button" class="btn btn-outline btn-sm" data-act="cancel">${t('cancel')}</button></div></div>`
    const input = menu.querySelector('#ab-note')
    input.focus()
    menu.querySelector('[data-act="save"]').addEventListener('click', () => {
      setCell(rowId, day, 'AB', input.value.trim())
      toast(`${rowId} · ${t('day')} ${day} — AB`)
      closePicker(true)
    })
    menu.querySelector('[data-act="cancel"]').addEventListener('click', () => closePicker(true))
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') menu.querySelector('[data-act="save"]').click()
    })
  }

  function place(menu, anchor) {
    const box = anchor.getBoundingClientRect()
    const size = menu.getBoundingClientRect()
    const rtl = document.documentElement.dir === 'rtl'
    let x = rtl ? box.right - size.width : box.left
    x = Math.max(8, Math.min(x, window.innerWidth - size.width - 8))
    const below = box.bottom + 6
    const y = below + size.height > window.innerHeight - 8 ? box.top - size.height - 6 : below
    menu.style.insetInlineStart = 'auto'
    menu.style.left = `${x}px`
    menu.style.top = `${Math.max(8, y)}px`
  }

  document.addEventListener('mousedown', (e) => {
    /* No focus restore on an outside click: the user is already aiming
       somewhere else and yanking focus back would fight the pointer. */
    if (openMenu && !openMenu.contains(e.target)) closePicker(false)
  })
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && openMenu) closePicker(true)
  })

  /* -------------------------------------------------- 9. grid rendering */
  const dayLabel = (day) => {
    const wd = new Date(state.year, state.month - 1, day).getDay()
    return (state.lang === 'ar' ? DAY_AR : DAY_EN)[wd]
  }

  const aria = (row, day, code) => {
    const meaning = code === null ? '' : bySlug[slugOf(code)]?.[state.lang] ?? ''
    return `${row.id} ${t('day')} ${day} — ${meaning || '—'}`
  }

  /** Build one code cell as a real button, wired for pointer and keyboard. */
  function makeCell(row, day) {
    const code = codeOf(row, day)
    if (code === null) return null
    const slug = slugOf(code)
    const button = document.createElement('button')
    button.type = 'button'
    button.className = 'cell'
    button.dataset.code = slug
    button.dataset.day = String(day)
    button.dataset.row = row.id
    if (row.edited.has(day) && state.variant === 'attendance') button.dataset.edited = '1'
    button.textContent = slug === '-' ? '–' : slug
    button.setAttribute('aria-label', aria(row, day, code))
    if (row.notes[day]) button.title = row.notes[day]
    button.addEventListener('focus', () => {
      focusMark = { row: row.id, day }
    })
    button.addEventListener('click', (e) => {
      if (state.brush && state.variant === 'attendance') {
        paintRange(row, day, e.shiftKey)
        return
      }
      openPicker(button, row.id, day)
    })
    button.addEventListener('keydown', (e) => {
      const hit = allCodes().find((c) => c.key === e.key.toLowerCase())
      if (hit && state.variant === 'attendance') {
        e.preventDefault()
        setCell(row.id, day, hit.code)
        lastPaint = { row: row.id, day }
        return
      }
      const step = { ArrowRight: 1, ArrowLeft: -1 }[e.key]
      if (step) {
        e.preventDefault()
        const dir = document.documentElement.dir === 'rtl' ? -step : step
        focusCell(row.id, day + dir)
      }
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault()
        const i = rows.findIndex((r) => r.id === row.id) + (e.key === 'ArrowDown' ? 1 : -1)
        if (rows[i]) focusCell(rows[i].id, day)
      }
    })
    return button
  }

  /* Shift-click paints from the previous painted day to this one, inclusive —
     the gesture that makes a 12-day annual leave two clicks instead of twelve. */
  let lastPaint = null

  function paintRange(row, day, extend) {
    const from = extend && lastPaint && lastPaint.row === row.id ? lastPaint.day : day
    const [a, b] = from <= day ? [from, day] : [day, from]
    for (let d = a; d <= b; d += 1) setCell(row.id, d, state.brush)
    lastPaint = { row: row.id, day }
    if (b > a) toast(`${row.id} · ${t('day')} ${a}–${b} — ${slugOf(state.brush)}`)
  }

  function cellButton(row, day) {
    const td = document.createElement('td')
    td.className = 'cellcell'
    const button = makeCell(row, day)
    if (!button) {
      td.innerHTML = '<button class="cell" data-code="" tabindex="-1" aria-hidden="true"></button>'
      return td
    }
    td.append(button)
    return td
  }

  function focusCell(rowId, day) {
    document
      .querySelector(`button.cell[data-row="${rowId}"][data-day="${day}"]`)
      ?.focus()
  }

  /**
   * Build the 31-column sheet.
   * @param {HTMLElement} host
   * @param {{rows?:object[], totals?:boolean, footer?:boolean, groups?:boolean,
   *          blocks?:boolean, identity?:boolean}} [opts]
   */
  function renderSheet(host, opts = {}) {
    const o = { totals: true, footer: true, groups: true, blocks: true, identity: true, ...opts }
    const list = o.rows || rows
    const days = daysIn(state.year, state.month)
    const ar = state.lang === 'ar'
    host.textContent = ''

    const table = document.createElement('table')
    table.className = 'sheet'
    const head = document.createElement('thead')
    const hr = document.createElement('tr')
    const th = (cls, html, extra) => {
      const cell = document.createElement('th')
      cell.className = cls
      cell.innerHTML = html
      if (extra) Object.assign(cell.dataset, extra)
      cell.scope = 'col'
      return cell
    }
    if (o.identity) {
      hr.append(th('stick c-no', '#'), th('stick c-id', t('id')), th('stick c-name', t('name')))
      hr.append(th('c-nat', t('nat')), th('c-desig', t('desig')))
    }
    /* Always 31 columns. The workbook's row 5 carries 1..31 in every month and
       leaves column AJ blank in a 30-day month, so the grid keeps the column and
       blanks the cells: the sheet never reflows when the month changes. */
    for (let d = 1; d <= 31; d += 1) {
      hr.append(th('day', `${d}<small>${d <= days ? dayLabel(d) : ''}</small>`, d > days ? { out: '1' } : null))
    }
    if (o.totals) {
      hr.append(th('tot lead', t('totalDay')), th('tot', t('off')))
      ;['AB', 'AL', 'SL␣', 'TR'].forEach((label) => hr.append(th('tot', label)))
    }
    head.append(hr)
    table.append(head)

    const body = document.createElement('tbody')
    let lastRank = null
    let lastBlock = null
    /** Compact "this row has a blocking check" marker for the identity columns. */
    const flag = (why) => {
      const mark = document.createElement('span')
      mark.className = 'flag'
      mark.textContent = '!'
      mark.title = why
      mark.setAttribute('aria-label', why)
      mark.setAttribute('role', 'img')
      return mark
    }

    /* The designation column follows the DELIVERABLE, not the interface: the HR
       attendance sheet prints name_en, the client statistics prints name_ar
       (models.py TimesheetDesignation). So this one column ignores state.lang. */
    const desigText = (row) => (state.variant === 'statistics' ? row.desig.ar : row.desig.en)

    list.forEach((row) => {
      if (o.blocks && state.variant === 'statistics' && row.block !== lastBlock) {
        const first = lastBlock === null
        lastBlock = row.block
        /* Block 2 is preceded by two blank rows on the paper — draw them, they
           are how the client's eye finds the surplus-headcount block. */
        if (!first) {
          const blank = document.createElement('tr')
          blank.className = 'blankgap'
          const cell = document.createElement('td')
          cell.colSpan = 40
          blank.append(cell)
          body.append(blank)
        }
        const gap = document.createElement('tr')
        gap.className = 'group'
        const cell = document.createElement('th')
        cell.colSpan = 40
        cell.textContent = row.block === 1 ? t('block1') : t('block2')
        cell.lang = state.lang
        gap.append(cell)
        body.append(gap)
      } else if (o.groups && state.variant === 'attendance' && row.rank !== lastRank) {
        lastRank = row.rank
        const group = document.createElement('tr')
        group.className = 'group'
        const cell = document.createElement('th')
        cell.colSpan = 40
        cell.textContent = desigText(row)
        /* The heading is the printed designation, so its language follows the
           deliverable: tag it so Latin tracking is not applied to Arabic. */
        cell.lang = state.variant === 'statistics' ? 'ar' : 'en'
        group.append(cell)
        body.append(group)
      }

      const tr = document.createElement('tr')
      tr.dataset.row = row.id
      if (o.identity) {
        const no = document.createElement('td')
        no.className = 'stick c-no'
        no.textContent = row.no
        const id = document.createElement('td')
        id.className = 'stick c-id'
        id.textContent = row.id
        const name = document.createElement('td')
        name.className = 'stick c-name'
        name.innerHTML = `<b>${row.name}</b>`
        name.title = row.name
        const nat = document.createElement('td')
        nat.className = 'c-nat'
        /* A full explanation belongs in the checks list, not in an 82px column:
           the cell carries the value plus a compact flag, and the flag's title
           and aria-label say what is wrong. A chip here would widen the column
           and push the day grid off screen. */
        nat.textContent = row.nat
        nat.title = row.nat
        if (row.natUnmapped) {
          nat.append(flag(t('unmapped')))
          nat.title = `${row.nat} — ${t('unmapped')}`
        }
        const desig = document.createElement('td')
        desig.className = 'c-desig'
        if (row.desigMissing) {
          desig.textContent = '—'
          desig.append(flag(t('notSet')))
          desig.title = t('notSet')
        } else {
          desig.textContent = desigText(row)
          desig.title = `${row.desig.en} · ${row.desig.ar}`
        }
        tr.append(no, id, name, nat, desig)
      }
      for (let d = 1; d <= 31; d += 1) tr.append(cellButton(row, d))
      if (o.totals) {
        const totals = rowTotals(row)
        const cells = [
          ['tot lead', `<b>${totals.P}</b>`],
          ['tot', totals.OFF || ''],
          ['tot', totals.AB || ''],
          ['tot', totals.AL || ''],
          ['tot', totals.SL || ''],
          ['tot', totals.TR || ''],
        ]
        cells.forEach(([cls, html]) => {
          const td = document.createElement('td')
          td.className = cls
          td.innerHTML = html
          tr.append(td)
        })
      }
      body.append(tr)
    })
    table.append(body)

    if (o.footer) {
      const foot = document.createElement('tfoot')
      const fr = document.createElement('tr')
      if (o.identity) {
        const label = document.createElement('th')
        label.className = 'stick c-no'
        label.colSpan = 5
        label.textContent = t('headcount')
        fr.append(label)
      }
      for (let d = 1; d <= 31; d += 1) {
        const td = document.createElement('td')
        if (d > days) {
          fr.append(td)
          continue
        }
        const n = dayCount(d)
        td.textContent = n
        if (n < state.postCount) td.className = 'low'
        td.title = `${t('day')} ${d}: ${n}`
        fr.append(td)
      }
      if (o.totals) {
        for (let i = 0; i < 6; i += 1) {
          const td = document.createElement('td')
          if (i === 0) td.innerHTML = `<b>${rows.reduce((n, r) => n + rowTotals(r).P, 0)}</b>`
          fr.append(td)
        }
      }
      foot.append(fr)
      table.append(foot)
    }

    host.append(table)
  }

  /** One employee's month as a week-grouped strip of day tiles (direction B). */
  function renderStrip(host, row) {
    const days = daysIn(state.year, state.month)
    host.textContent = ''
    for (let d = 1; d <= 31; d += 1) {
      const wrap = document.createElement('div')
      wrap.className = 'tile'
      if (d > days) wrap.dataset.out = '1'
      wrap.innerHTML = `<span class="dnum mono">${d}</span><span class="dname">${
        d <= days ? dayLabel(d) : ''
      }</span>`
      const button = makeCell(row, d)
      if (button) wrap.append(button)
      host.append(wrap)
    }
  }

  /** The code ribbon: legend and brush palette in one control. */
  function renderRibbon(host, opts = {}) {
    host.textContent = ''
    const label = document.createElement('span')
    label.className = 'lbl'
    label.textContent = opts.label ?? t('codes')
    host.append(label)
    allCodes().forEach((c) => {
      const button = document.createElement('button')
      button.type = 'button'
      button.className = 'swatch'
      button.setAttribute('aria-pressed', String(state.brush === c.code))
      button.innerHTML =
        `<span class="glyph" data-code="${c.slug}">${c.slug === '-' ? '–' : c.slug}</span>` +
        `<span>${state.lang === 'ar' ? c.ar : c.en}</span>` +
        (opts.keys === false ? '' : `<kbd>${c.key}</kbd>`)
      button.addEventListener('click', () => armBrush(c.code))
      host.append(button)
    })
  }

  /* ---------------------------------------------------- 10. shared chrome */
  const NAV = ['dashboard', 'employees', 'ledger', 'leaves', 'services', 'records', 'timesheet']

  function renderChrome(host) {
    host.className = 'appbar'
    host.innerHTML =
      `<div class="brand"><span class="crest">GS</span><span>GSSG Manager</span></div>` +
      `<nav>${NAV.map(
        (key) =>
          `<span${key === 'timesheet' ? ' aria-current="page"' : ''}>${t(`nav.${key}`)}</span>`,
      ).join('')}</nav>` +
      `<div class="tools"><span>${state.lang === 'ar' ? 'EN' : 'العربية'}</span>` +
      `<span aria-hidden="true">◐</span><span class="avatar">AM</span></div>`
  }

  const DIRECTIONS = [
    ['a3', 'timesheet-mockup-a3-shell.html', 'A3 · Locked Shell ★'],
    ['a2', 'timesheet-mockup-a2-wide-ledger.html', 'A2 · Wide Ledger'],
    ['a', 'timesheet-mockup-a-paper-ledger.html', 'A · Paper Ledger'],
    ['b', 'timesheet-mockup-b-focus-painter.html', 'B · Focus Painter'],
    ['c', 'timesheet-mockup-c-month-canvas.html', 'C · Month Canvas'],
    ['d', 'timesheet-mockup-d-close-out.html', 'D · Close-out Flow'],
  ]

  function renderReview(host, active, note) {
    host.className = 'review'
    host.innerHTML =
      `<b>Time sheet · direction ${active.toUpperCase()}</b>` +
      DIRECTIONS.map(
        ([key, href, label]) =>
          `<a href="${href}"${key === active ? ' aria-current="page"' : ''}>${label}</a>`,
      ).join('') +
      `<span class="sp"><button type="button" data-act="lang">EN / العربية</button>` +
      `<button type="button" data-act="theme">Light / Dark</button>` +
      `<button type="button" data-act="density">Zoom</button></span>`
    if (note) {
      const span = document.createElement('span')
      span.textContent = note
      span.style.color = '#9ca3af'
      host.querySelector('.sp').before(span)
    }
    host.querySelector('[data-act="lang"]').addEventListener('click', () => setLang(state.lang === 'en' ? 'ar' : 'en'))
    host.querySelector('[data-act="theme"]').addEventListener('click', () => setTheme(state.theme === 'light' ? 'dark' : 'light'))
    host.querySelector('[data-act="density"]').addEventListener('click', () => {
      const order = ['compact', 'default', 'roomy']
      state.density = order[(order.indexOf(state.density) + 1) % order.length]
      document.documentElement.dataset.density = state.density
      emit('render')
    })
  }

  function setLang(lang) {
    state.lang = lang
    document.documentElement.lang = lang
    document.documentElement.dir = lang === 'ar' ? 'rtl' : 'ltr'
    emit('render')
  }

  function setTheme(theme) {
    state.theme = theme
    document.documentElement.dataset.theme = theme
    emit('render')
  }

  function setDensity(density) {
    state.density = density
    document.documentElement.dataset.density = density
    emit('render')
  }

  /** Any month's name, for the two-month employee export (which spans the
      month of departure and the one before it). */
  const monthName = (month, lang) =>
    ((lang ?? state.lang) === 'ar' ? MONTHS_AR : MONTHS_EN)[(((month - 1) % 12) + 12) % 12]

  const monthLabel = () => ({
    en: `${MONTHS_EN[state.month - 1]} ${state.year}`,
    ar: `${MONTHS_AR[state.month - 1]} ${state.year}`,
    stamp: `${String(state.month).padStart(2, '0')} · ${state.year}`,
    days: daysIn(state.year, state.month),
    file: `كشف حضور شهر ${MONTHS_AR[state.month - 1]}.xlsx`,
    fileStats: `الاحصائية شهر ${MONTHS_AR[state.month - 1]}.xlsx`,
  })

  build()

  return {
    CODES, CODE_BLOCK, allCodes, DESIGNATIONS, PEOPLE, state, t, on, emit,
    get rows() { return rows },
    build, codeOf, rawCode, rowTotals, codeTally, monthTally, dayCount, impliedPosts,
    blocking, warnings, editCount,
    setCell, clearCell, undo, closeMonth, reopenMonth, download, setMonth, setVariant, setSheet,
    setPostCount, armBrush, resolve, toast, openPicker, closePicker, focusCell, makeCell,
    rosterChanges, addEmployee, confirmStart,
    renderSheet, renderStrip, renderRibbon, renderChrome, renderReview,
    setLang, setTheme, setDensity, monthLabel, monthName, dayLabel, daysIn, slugOf,
  }
})()

window.TS = TS
