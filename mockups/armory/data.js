'use strict'

// The workbook supplies the item list. All serials and quantities are invented.
// People, site assignments, shifts, licence numbers and movements are demonstration data.
{
  const D = window.ARMORY = {
    now: '2026-11-26T14:20:00+04:00',
    today: '2026-11-26',
    timeZone: 'Asia/Dubai',
    graceMinutes: 30,
    licenceWindow: 30,
    batchWindow: 60,
    currentUser: 'G4433',
    shifts: [
      { id: 'day', start: '06:00', end: '18:00' },
      { id: 'night', start: '18:00', end: '06:00' },
    ],
    safes: [
      { id: 'S1', en: 'Al Watbha HQ safe', ar: 'خزنة مقر الوثبة', site: { en: 'Al Watbha HQ', ar: 'مقر الوثبة' } },
      { id: 'S2', en: 'North Gate safe', ar: 'خزنة البوابة الشمالية', site: { en: 'North Gate', ar: 'البوابة الشمالية' } },
    ],
    groups: [
      { id: 'firearms', en: 'Firearms', ar: 'الأسلحة النارية' },
      { id: 'accessories', en: 'Weapon accessories', ar: 'ملحقات الأسلحة' },
      { id: 'ammo', en: 'Ammunition', ar: 'الذخيرة' },
      { id: 'nonlethal', en: 'Non-lethal', ar: 'أسلحة غير قاتلة' },
      { id: 'restraints', en: 'Restraints', ar: 'القيود' },
      { id: 'riot', en: 'Riot gear', ar: 'معدات مكافحة الشغب' },
      { id: 'comms', en: 'Comms and detection', ar: 'الاتصالات والتفتيش' },
    ],
  }
  const slots = (S1, S2) => ({ S1, S2 })
  const generated = (prefix, n, first = 1) => Array.from({ length: n }, (_, index) => prefix + String(first + index).padStart(4, '0'))
  const tagged = (serials, inHQ) => serials.map((id, index) => ({ id, safe: index < inHQ ? 'S1' : 'S2' }))
  const rifleSerials = generated('SR-', 12, 101)
  const pistolSerials = generated('CP-', 12, 201)
  const radioSerials = tagged(generated('TT-', 35), 22)
  const quantity = (id, group, en, ar, art, S1, S2) => ({
    id, group, en, ar, art, tracking: 'quantity', opening: S1 === null ? null : slots(S1, S2),
  })
  const serial = (id, group, en, ar, art, serials, unrecorded = slots(0, 0)) => ({ id, group, en, ar, art, tracking: 'serial', serials, unrecorded })
  const expiry = (id, en, ar, art, batches) => ({ id, group: 'nonlethal', en, ar, art, tracking: 'quantity', batches })
  D.items = [
    serial('rifle', 'firearms', 'Sultan rifle', 'بندقية سلطان', 'rifle', tagged(rifleSerials, 6)),
    serial('pistol', 'firearms', 'Caracal pistol', 'مسدس كراكال', 'pistol', tagged(pistolSerials, 6)),
    quantity('rifle-mag', 'accessories', 'Sultan rifle magazine', 'مخزن بندقية سلطان', 'magazine', 16, 10),
    quantity('rifle-rod', 'accessories', 'Rifle cleaning rod', 'حربة تنظيف بندقية', 'rod', 7, 4),
    quantity('rifle-tool', 'accessories', 'Sultan rifle tool', 'مفتاح بندقية سلطان', 'tool', 12, 7),
    quantity('sling', 'accessories', 'Sultan rifle sling', 'حمالة بندقية سلطان', 'sling', 8, 5),
    quantity('scabbard', 'accessories', 'Sultan rifle scabbard', 'غمد بندقية سلطان', 'scabbard', null),
    quantity('foregrip', 'accessories', 'Fore grip', 'مقبض أمامي', 'grip', 11, 8),
    quantity('adapter', 'accessories', 'Firing adapter', 'محول إطلاق', 'adapter', 7, 5),
    quantity('pistol-mag', 'accessories', 'Caracal pistol magazine', 'مخزن مسدس كراكال', 'magazine', 21, 13),
    quantity('pistol-case', 'accessories', 'Caracal pistol case', 'شنطة مسدس كراكال', 'case', 10, 7),
    quantity('pistol-rod', 'accessories', 'Pistol cleaning rod', 'حربة تنظيف مسدس', 'rod', 8, 4),
    quantity('pistol-tool', 'accessories', 'Caracal pistol tool', 'مفتاح مسدس كراكال', 'tool', 10, 8),
    quantity('right-holster', 'accessories', 'Right holster', 'غمد مسدس يمين', 'holster', 8, 5),
    quantity('left-holster', 'accessories', 'Left holster', 'غمد مسدس شمال', 'holster', 5, 3),
    quantity('rifle-rounds', 'ammo', 'Sultan rifle rounds', 'عتاد بندقية سلطان', 'rounds', 540, 360),
    quantity('pistol-rounds', 'ammo', 'Caracal pistol rounds', 'عتاد مسدس كراكال', 'rounds', 240, 160),
    serial('taser', 'nonlethal', 'Taser', 'مسدس كهربائي', 'taser', tagged(generated('TZ-', 26), 16)),
    expiry('spray', 'Tear-gas spray', 'بخاخ مسيل للدموع', 'spray', [
      { id: 'TG-2703', expiry: '2027-03', stock: slots(13, 9) },
      { id: 'TG-2612', expiry: '2026-12-31', stock: slots(6, 4) },
    ]),
    expiry('cartridge', 'Taser cartridge', 'خرطوشة مسدس كهربائي', 'cartridge', [
      { id: 'TC-2708', expiry: '2027-08', stock: slots(21, 13) },
      { id: 'TC-2611', expiry: '2026-11-15', stock: slots(9, 6) },
    ]),
    quantity('cuffs', 'restraints', 'Steel handcuffs', 'قيد يدوي حديد', 'cuffs', 26, 17),
    quantity('leg-irons', 'restraints', 'Steel leg irons', 'قيد رجل حديد', 'leg-irons', null),
    quantity('plastic', 'restraints', 'Plastic restraints', 'قيود بلاستيكية', 'plastic', 455, 305),
    quantity('leg-key', 'restraints', 'Leg-iron key', 'مفتاح قيد رجل', 'key', null),
    quantity('cuff-key', 'restraints', 'Handcuff key', 'مفتاح قيد يدوي', 'key', 49, 38),
    quantity('baton', 'riot', 'Riot baton', 'عصا شغب', 'baton', 8, 5),
    quantity('helmet', 'riot', 'Riot helmet', 'خوذة شغب', 'helmet', null),
    quantity('shield', 'riot', 'Riot shield', 'ترس شغب', 'shield', null),
    serial('riot-suit', 'riot', 'Riot gear suit', 'بدلة مكافحة الشغب', 'riot-suit', [], null),
    serial('radio', 'comms', 'TETRA radio', 'جهاز تترا', 'radio', radioSerials),
    serial('wand', 'comms', 'Hand wand', 'عصا تفتيش كهربائية', 'wand', [], slots(16, 11)),
    serial('bodycam', 'comms', 'Body camera', 'كاميرا صدرية محمولة', 'bodycam', [], slots(21, 15)),
  ]

  D.guards = [
    ['G4401', 'Khalid Al Mazrouei', 'خالد المزروعي', 1, 'S1', 'S-24801'],
    ['G4402', 'Hamad Al Nuaimi', 'حمد النعيمي', 2, 'S2', 'S-24813'],
    ['G4403', 'Omar Al Mansoori', 'عمر المنصوري', 3, null, 'S-24827'],
    ['G4404', 'Yousef Al Kaabi', 'يوسف الكعبي', 4, 'S1'],
    ['G4405', 'Saeed Al Dhaheri', 'سعيد الظاهري', 5, null, 'S-24842'],
    ['G4406', 'Rashid Al Ketbi', 'راشد الكتبي', 6, 'S1'],
    ['G4407', 'Nasser Al Muhairi', 'ناصر المهيري', 7, 'S2'],
    ['G4408', 'Salem Al Shehhi', 'سالم الشحي', 8, 'S1'],
    ['G4409', 'Majed Al Hammadi', 'ماجد الحمادي', 9, 'S2'],
    ['G4410', 'Faisal Al Suwaidi', 'فيصل السويدي', 2, 'S2', 'S-24810', null, '2026-11-10'],
    ['G4411', 'Ahmed Al Marri', 'أحمد المري', 3, 'S1'],
    ['G4412', 'Tariq Al Shamsi', 'طارق الشامسي', 5, 'S1'],
    ['G4413', 'Walid Al Neyadi', 'وليد النيادي', 8, 'S2'],
    ['G4414', 'Jamal Al Rumaithi', 'جمال الرميثي', 9, null],
    ['G4415', 'Saif Al Ameri', 'سيف العامري', 1, null, null, 'resigned'],
    ['G4416', 'Ali Al Rumaithi', 'علي الرميثي', 2, null, null, 'resigned'],
    ['G4417', 'Adel Al Zaabi', 'عادل الزعابي', 4, null, null, 'terminated'],
    ['G4418', 'Mohammed Al Qubaisi', 'محمد القبيسي', 6, null, null, 'terminated'],
    ['G4419', 'Yahya Al Balushi', 'يحيى البلوشي', 7, null, null, 'transferred'],
    ['G4431', 'Marwan Al Tamimi', 'مروان التميمي', null, null],
    ['G4432', 'Fahad Al Harthi', 'فهد الحارثي', null, null],
    ['G4433', 'Ibrahim Al Hosani', 'إبراهيم الحوسني', null, null],
  ].map(([id, en, ar, course, duty, number, former, expiry = '2026-12-16']) => ({ id, en, ar, course, duty, licence: number ? { number, expiry } : null, former }))
  D.reviewer = { id: 'G4434', en: 'Abdullah Al Hameli', ar: 'عبدالله الهاملي' }
  D.armorer = D.currentUser

  D.kits = {
    rifle: { weapon: 'rifle', quantities: [['rifle-mag', 2], ['sling', 1], ['rifle-rounds', 30]] },
    pistol: { weapon: 'pistol', quantities: [['pistol-mag', 2], ['right-holster', 1], ['pistol-rounds', 12]] },
    equipment: { quantities: [] },
  }
  D.extras = ['radio', 'bodycam', 'taser', 'cuffs']
  D.reasons = ['training', 'incident', 'lostReason', 'other']
  D.dutyReasons = ['cover', 'escort', 'training', 'other']
  D.outcomes = ['foundOutcome', 'trainingOutcome', 'lostOutcome', 'recordingError']
  D.serialStates = ['inSafe', 'signedOut', 'inCustody', 'inRepair', 'missingSerial', 'lost', 'writtenOff']
  D.exceptions = new Map([
    ['SR-0106', { state: 'inRepair', since: '2026-11-20', note: { en: 'Trigger check', ar: 'فحص الزناد' } }],
    ['CP-0205', { state: 'writtenOff', since: '2026-09-14', note: { en: 'Damaged beyond repair', ar: 'تلف يتعذّر إصلاحه' } }],
  ])
  D.stateChanges = []
  D.stockEvents = []

  const at = (date, time) => `${date}T${time}:00+04:00`
  const kitLines = (kind, serial) => [{ item: D.kits[kind].weapon, serial }, ...D.kits[kind].quantities.map(([item, qty]) => ({ item, qty }))]
  const sampleIssue = (id, kind, serial, safe, guard, date, shift, licenceWarning = false) => {
    const window = D.shifts.find(s => s.id === shift)
    return {
      id, safe, guard, licenceWarning, actor: D.currentUser, lines: kitLines(kind, serial),
      issuedAt: at(date, window.start), due: at(shift === 'night' ? D.today : date, window.end),
    }
  }
  D.issues = [
    sampleIssue('SO-0001', 'rifle', 'SR-0101', 'S1', 'G4401', D.today, 'day'),
    sampleIssue('SO-0002', 'rifle', 'SR-0107', 'S2', 'G4402', D.today, 'day'),
    sampleIssue('SO-0003', 'pistol', 'CP-0202', 'S1', 'G4404', D.today, 'day', true),
    sampleIssue('SO-0004', 'rifle', 'SR-0110', 'S2', 'G4403', '2026-11-25', 'night'),
    sampleIssue('SO-0005', 'pistol', 'CP-0211', 'S2', 'G4405', '2026-11-25', 'night'),
    sampleIssue('SO-0006', 'rifle', 'SR-0103', 'S1', 'G4406', '2026-11-25', 'night', true),
    sampleIssue('SO-0007', 'rifle', 'SR-0109', 'S2', 'G4407', '2026-11-25', 'night', true),
  ]
  D.units = line => line.qty ?? 1
  D.isAmmo = item => D.item(item).group === 'ammo'
  const sampleReturn = (id, issue, time, exception = null) => ({
    id, issue: issue.id, at: at(D.today, time), actor: D.currentUser,
    lines: issue.lines.map((line, index) => ({ index, qty: D.units(line) - (D.items.find(i => i.id === line.item).group === 'ammo' ? exception?.spent ?? 0 : 0) })),
    ...(exception && { ammo: [{ index: issue.lines.findIndex(line => line.item.endsWith('-rounds')), ...exception }] }),
  })
  D.returns = [
    sampleReturn('SI-0001', D.issues[5], '06:10'),
    sampleReturn('SI-0002', D.issues[6], '06:25', { spent: 2, reason: 'training', reference: 'TR-1125', witness: 'G4413' }),
  ]
  D.custodies = [
    { id: 'CU-0001', safe: 'S2', kind: 'person', holder: 'G4410', since: '2026-09-12', issuedAt: at('2026-09-12', '10:30'), ended: '2026-09-29', endedAt: at('2026-09-29', '15:00'), endedBy: D.currentUser, actor: D.currentUser, lines: [{ item: 'cuffs', qty: 2 }] },
    { id: 'CU-0002', safe: 'S2', kind: 'site', holder: 'S2', since: '2026-10-01', issuedAt: at('2026-10-01', '09:00'), actor: D.currentUser, lines: radioSerials.filter(radio => radio.safe === 'S2').slice(0, 5).map(({ id: serial }) => ({ item: 'radio', serial })) },
    { id: 'CU-0003', safe: 'S2', kind: 'person', holder: 'G4410', holderRole: 'siteSupervisor', licenceNumber: D.guards.find(g => g.id === 'G4410').licence.number, since: '2026-10-05', issuedAt: at('2026-10-05', '09:15'), actor: D.currentUser, lines: kitLines('pistol', 'CP-0212') },
    { id: 'CU-0004', safe: 'S1', kind: 'person', holder: 'G4415', since: '2026-10-22', issuedAt: at('2026-10-22', '12:10'), actor: D.currentUser, lines: [{ item: 'radio', serial: 'TT-0001' }] },
  ]
  D.checks = [{ id: 'SC-0001', safe: 'S1', date: D.today, shift: 'day', at: at(D.today, '06:05'), actor: D.currentUser, witness: 'G4408' }]
  D.counts = [{ id: 'MC-0001', safes: ['S1', 'S2'], at: '2026-11-01T08:30:00+04:00', actor: D.currentUser, witness: 'G4431' }]
  const expectedSlings = Object.values(D.items.find(item => item.id === 'sling').opening).reduce((total, qty) => total + qty, 0)
  D.variances = [{
    id: 'D-0002', kind: 'monthly', source: 'MC-0001', item: 'sling',
    expected: expectedSlings, found: expectedSlings - 1,
    at: D.counts[0].at, actor: D.counts[0].actor, witness: D.counts[0].witness,
    decision: { outcome: 'foundOutcome', witness: 'G4432', actor: D.reviewer.id, at: '2026-11-01T11:10:00+04:00', note: { en: 'Sling found in the vehicle.', ar: 'عُثر على الحمالة في المركبة.' } },
  }]
  D.decisions = new Map()

  D.item = id => D.items.find(i => i.id === id)
  D.guard = id => D.guards.find(g => g.id === id) || (D.reviewer.id === id ? D.reviewer : undefined)
  D.safe = id => D.safes.find(s => s.id === id)
  D.totalLines = lines => lines.reduce((n, line) => n + D.units(line), 0)
  D.activeGuards = () => D.guards.filter(g => g.course && !g.former)
  D.witnesses = (excluded = []) => [...D.guards, D.reviewer].filter(g => !g.former && g.id !== D.currentUser && !excluded.includes(g.id))
  D.number = (prefix, rows) => `${prefix}-${String(rows.length + 1).padStart(4, '0')}`
  D.instant = (date, time) => at(date, time)
  D.shiftNow = () => {
    const hm = D.now.slice(11, 16)
    const [day, night] = D.shifts
    return hm >= day.start && hm < day.end ? day : night
  }
  D.shiftEnd = () => {
    const shift = D.shiftNow()
    const date = D.now.slice(11, 16) < shift.end ? D.today : new Date(Date.parse(D.today) + 86_400_000).toISOString().slice(0, 10)
    return { date, time: shift.end }
  }
  const offsetDay = (date, days) => new Date(Date.parse(date) + days * 86_400_000).toISOString().slice(0, 10)
  D.daysAgo = days => offsetDay(D.today, -days)
  D.nextShiftEnd = () => {
    const end = D.shiftEnd()
    const shift = D.shifts.find(s => s.start === end.time)
    return at(offsetDay(end.date, Number(shift.end <= shift.start)), shift.end)
  }
  D.overdueMinutes = record => Math.floor((Date.parse(D.now) - Date.parse(record.due)) / 60_000)
  // Historic round trips are closed before the live snapshot. They provide audit
  // evidence without reapplying balances already represented by the opening rows.
  D.archive = Array.from({ length: 12 }, (_, n) => {
    const north = n % 2 === 0, rifle = n % 3 !== 0 || n === 7
    const safe = north ? 'S2' : 'S1', date = D.daysAgo(13 - n)
    const serial = n === 7 ? 'SR-0110' : (rifle ? rifleSerials : pistolSerials)[north ? 8 : 2]
    const guard = n === 7 ? 'G4403' : north ? 'G4402' : 'G4401'
    const lines = kitLines(rifle ? 'rifle' : 'pistol', serial)
    const common = { safe: n === 7 ? 'S2' : safe, guard, actor: D.armorer, lines }
    return [
      { ...common, id: `H-${n + 1}-1`, at: at(date, '06:00'), action: 'signout' },
      { ...common, id: `H-${n + 1}-2`, at: at(date, '18:03'), action: 'signin' },
    ]
  }).flat()
  for (const [serial, item, action, time, witness] of [
    ['SR-0106', 'rifle', 'sendRepair', '10:15', 'G4408'],
    ['CP-0205', 'pistol', 'writeOff', '09:00', 'G4408'],
  ]) {
    const { since, note } = D.exceptions.get(serial)
    D.archive.push({ id: `H-${action}`, at: at(since, time), safe: 'S1', actor: D.armorer, witness, action, note, lines: [{ item, serial }] })
  }
  for (let day = 1; day <= 6; day++) for (const safe of D.safes) for (const shift of D.shifts) {
    const date = D.daysAgo(day), missed = day === 3 && safe.id === 'S2' && shift.id === 'night'
    D.checks.push({ id: D.number('SC', D.checks), safe: safe.id, date, shift: shift.id,
      at: missed ? null : at(date, shift.id === 'day' ? '06:05' : '18:05'), actor: missed ? null : D.armorer,
      witness: missed ? null : safe.id === 'S1' ? 'G4408' : 'G4413', missed })
  }
  const daysTo = date => (Date.parse(date) - Date.parse(D.today)) / 86_400_000
  D.licenceStatus = guard => {
    if (!guard?.licence?.expiry || !guard.licence.number) return { kind: 'missing' }
    const days = daysTo(guard.licence.expiry)
    return { kind: days < 0 ? 'expired' : days <= D.licenceWindow ? 'expiring' : 'valid', days }
  }
  D.batchStatus = batch => {
    const end = batch.expiry.length === 7 ? new Date(Date.UTC(Number(batch.expiry.slice(0, 4)), Number(batch.expiry.slice(5, 7)), 0)).toISOString().slice(0, 10) : batch.expiry
    const days = daysTo(end)
    return { kind: days < 0 ? 'expired' : days <= D.batchWindow ? 'expiring' : 'valid', days }
  }
  const stockLines = (item, safe, action) => D.stockEvents
    .filter(record => record.safe === safe && record.action === action)
    .flatMap(record => record.lines.filter(line => line.item === item.id))
  D.received = (item, safe) => item.tracking === 'serial'
    ? item.serials.filter(s => s.safe === safe && s.received).length
    : D.totalLines(stockLines(item, safe, 'stockReceived'))
  D.batches = () => {
    const allocated = [...D.out(), ...D.openCustody()]
    return D.items.flatMap(item => (item.batches || []).map(batch => {
      const stock = Object.fromEntries(D.safes.map(({ id }) => {
        const received = D.totalLines(stockLines(item, id, 'stockReceived').filter(l => l.batch === batch.id))
        const away = D.totalLines(allocated.filter(r => r.safe === id).flatMap(r => r.remaining)
          .filter(l => l.item === item.id && l.batch === batch.id))
        const remaining = batch.stock[id] + received - away
        console.assert(remaining >= 0, 'batch stock never becomes negative', item.id, batch.id, id)
        return [id, remaining]
      }))
      return { item, ...batch, stock, total: Object.values(stock).reduce((n, qty) => n + qty, 0), status: D.batchStatus(batch).kind }
    }))
  }
  D.unrecorded = item => item.unrecorded ? Object.values(item.unrecorded).reduce((n, qty) => n + (qty || 0), 0) : 0
  D.opening = (item, safe) => {
    if (item.tracking === 'serial') {
      const pending = item.unrecorded?.[safe]
      return pending == null ? null : pending + item.serials.filter(s => s.safe === safe && !s.received).length
    }
    return item.opening ? item.opening[safe] : item.batches?.reduce((n, batch) => n + batch.stock[safe], 0) ?? null
  }
  D.postStock = (item, safe, entry, { opening = false, date = D.today, reference, witness, source } = {}) => {
    const action = opening ? 'openingStock' : 'stockReceived'
    const at = D.instant(date, D.now.slice(11, 16))
    const lines = []
    if (item.tracking === 'serial') {
      for (const serial of entry.serials) {
        item.serials.push({ id: serial, safe, since: at, received: !opening })
        lines.push({ item: item.id, serial })
      }
      if (entry.pending > 0) lines.push({ item: item.id, qty: entry.pending })
      if (opening && (entry.pending != null || entry.serials.length)) item.unrecorded[safe] = entry.pending ?? 0
    } else if (item.batches) {
      for (const { id, expiry, qty } of entry.batches) {
        let batch = item.batches.find(b => b.id === id)
        if (!batch) {
          batch = { id, expiry, stock: slots(0, 0) }
          item.batches.push(batch)
        }
        if (opening) batch.stock[safe] += qty
        lines.push({ item: item.id, batch: id, qty })
      }
      if (opening && (entry.countedEmpty || entry.batches.length)) item.opening[safe] = D.totalLines(lines)
    } else {
      if (opening) item.opening[safe] = entry.qty
      if (entry.qty > 0) lines.push({ item: item.id, qty: entry.qty })
    }
    if (lines.length) D.stockEvents.push({ id: D.number('IN', D.stockEvents), at, safe, action, actor: D.currentUser, reference, witness, source, lines })
  }
  D.addCatalogueItem = (fields, openings, details) => {
    const item = {
      ...fields, id: D.number('IT', D.items),
      ...(fields.tracking === 'serial' ? { serials: [], unrecorded: slots(null, null) }
        : { opening: slots(null, null), ...(fields.batches && { batches: [] }) }),
    }
    D.items.push(item)
    for (const [safe, entry] of openings) D.postStock(item, safe, entry, { ...details, opening: true })
    return item
  }
  D.remaining = issue => issue.lines.flatMap((line, index) => {
    let qty = D.units(line)
    for (const receipt of D.returns) {
      if ((receipt.issue || receipt.custody) !== issue.id) continue
      qty -= receipt.lines.find(l => l.index === index)?.qty ?? 0
      qty -= receipt.ammo?.find(l => l.index === index)?.spent ?? 0
    }
    console.assert(qty >= 0, 'sign-in never exceeds issue', issue.id, index)
    return qty > 0 ? [{ ...line, qty, index }] : []
  })
  D.overdue = issue => Date.parse(D.now) > Date.parse(issue.due) + D.graceMinutes * 60_000
  D.out = () => D.issues.map(issue => ({ ...issue, remaining: D.remaining(issue) })).filter(issue => issue.remaining.length).sort((a, b) => Number(D.overdue(b)) - Number(D.overdue(a)) || a.due.localeCompare(b.due) || a.safe.localeCompare(b.safe))
  D.recordFor = receipt => receipt.custody ? D.custodies.find(c => c.id === receipt.custody) : D.issues.find(r => r.id === receipt.issue)
  D.backToday = () => D.returns.filter(receipt => receipt.issue && receipt.at.startsWith(D.today)).sort((a, b) => b.at.localeCompare(a.at))
  D.openCustody = () => D.custodies.filter(custody => !custody.ended).map(c => ({ ...c, remaining: D.remaining(c) }))
  D.holdings = guard => [
    ...D.out().filter(issue => issue.guard === guard).map(r => ({ kind: 'shift', lines: r.remaining, overdue: D.overdue(r) })),
    ...D.openCustody().filter(c => c.kind === 'person' && c.holder === guard || c.supervisor === guard).map(c => ({ kind: 'custody', lines: c.remaining })),
  ]
  D.heldFirearm = guard => {
    for (const group of D.holdings(guard)) {
      const line = group.lines.find(l => D.item(l.item).group === 'firearms')
      if (line) return { ...line, ...group }
    }
    return null
  }
  D.changedKit = r => {
    const kind = r.lines.find(l => D.item(l.item).group === 'firearms')?.item
    if (!kind) return false
    const lines = r.lines.filter(l => l.item !== kind)
    const standard = D.kits[kind]?.quantities || []
    return lines.length !== standard.length || !standard.every(([id, qty]) => lines.some(l => l.item === id && D.units(l) === qty))
  }
  D.serialLedger = item => {
    const taken = new Map()
    const occupy = (id, value) => {
      console.assert(!taken.has(id), 'serial occupies one state only', id)
      taken.set(id, value)
    }
    for (const issue of D.out()) for (const line of issue.remaining) if (line.serial) occupy(line.serial, { state: 'signedOut', holder: D.guard(issue.guard), since: issue.issuedAt })
    for (const custody of D.openCustody()) for (const line of custody.remaining) if (line.serial) occupy(line.serial, { state: 'inCustody', holder: custody.kind === 'person' ? D.guard(custody.holder) : D.safe(custody.holder).site, since: custody.since })
    for (const [serial, exception] of D.exceptions) occupy(serial, exception)
    const lastReturn = new Map()
    for (const receipt of D.returns) {
      const issue = D.recordFor(receipt)
      for (const returned of receipt.lines) {
        const line = issue.lines[returned.index]
        if (line.serial && (lastReturn.get(line.serial) ?? '') < receipt.at) lastReturn.set(line.serial, receipt.at)
      }
    }
    for (const custody of D.custodies.filter(c => c.ended)) {
      for (const line of custody.lines) if (line.serial && (lastReturn.get(line.serial) ?? '') < custody.ended) lastReturn.set(line.serial, custody.ended)
    }
    return item.serials.map(s => ({ ...s, ...(taken.get(s.id) || { state: 'inSafe', since: [lastReturn.get(s.id), s.since].filter(Boolean).sort().at(-1) || '2026-11-01' }) }))
  }
  D.rollup = item => {
    const states = item.tracking === 'serial' ? D.serialLedger(item) : []
    const issued = D.out(), held = D.openCustody().map(r => ({ ...r, lines: r.remaining }))
    const unitsAt = (lines, safe) => lines.filter(x => x.safe === safe).flatMap(x => x.lines).filter(l => l.item === item.id).reduce((n, line) => n + D.units(line), 0)
    const bySafe = Object.fromEntries(D.safes.map(({ id }) => {
      const opening = D.opening(item, id)
      const received = D.received(item, id), basis = opening === null ? null : opening + received
      const onShift = unitsAt(issued.map(r => ({ safe: r.safe, lines: r.remaining })), id)
      const custody = unitsAt(held, id)
      const repair = item.tracking === 'serial' ? states.filter(s => s.safe === id && s.state === 'inRepair').length : null
      const unavailable = states.filter(s => s.safe === id && ['missingSerial', 'lost', 'writtenOff'].includes(s.state)).length
      const writtenOff = states.filter(s => s.safe === id && s.state === 'writtenOff').length
      const differences = D.isAmmo(item.id) ? D.discrepancies().filter(v => v.safe === id && v.item === item.id) : []
      const awaiting = differences.filter(v => v.kind === 'ammunition' && !v.decision).reduce((n, v) => n + v.spent, 0)
      const expended = differences.reduce((n, v) => n + (v.kind === 'ammunition'
        ? v.decision?.outcome === 'foundOutcome' ? 0 : v.spent
        : v.decision?.roundsApplied ?? 0), 0)
      const occupied = onShift + custody + (repair ?? 0) + unavailable + expended
      const inSafe = basis === null ? null : item.tracking === 'serial'
        ? states.filter(s => s.safe === id && s.state === 'inSafe').length + item.unrecorded[id]
        : basis - occupied
      console.assert(basis === null || (inSafe >= 0 && inSafe + occupied === basis), 'stock reconciles by safe', item.id, id)
      return [id, { opening, received, inSafe, onShift, custody, repair, unavailable, writtenOff, expended, awaiting, total: basis === null ? null : basis - expended - writtenOff }]
    }))
    const sum = key => ['opening', 'inSafe', 'total'].includes(key) && Object.values(bySafe).some(part => part[key] === null)
      || Object.values(bySafe).every(part => part[key] === null) ? null : Object.values(bySafe).reduce((n, part) => n + (part[key] ?? 0), 0)
    return { bySafe, opening: sum('opening'), received: sum('received'), inSafe: sum('inSafe'), onShift: sum('onShift'),
      custody: sum('custody'), repair: sum('repair'), unavailable: sum('unavailable'), writtenOff: sum('writtenOff'),
      expended: sum('expended'), awaiting: sum('awaiting'), total: sum('total'), states }
  }
  D.available = (item, safe) => D.serialLedger(D.item(item)).filter(s => s.safe === safe && s.state === 'inSafe')
  D.checkFor = safe => D.checks.find(c => c.safe === safe && c.date === D.today && c.shift === D.shiftNow().id)
  D.firearms = () => D.items.filter(i => i.group === 'firearms').flatMap(item => D.serialLedger(item).map(serial => ({ ...serial, item: item.id })))
  D.setSerialState = (item, id, next, { safe, actor, witness, note, action = next, to = '' } = {}) => {
    const serial = item.serials.find(s => s.id === id)
    const origin = serial.safe
    if (safe) serial.safe = safe
    if (next === 'inSafe') {
      D.exceptions.delete(id)
      serial.since = D.now
    } else {
      D.exceptions.set(id, { state: next, since: D.now, note })
    }
    D.stateChanges.push({
      id: D.number('ST', D.stateChanges), action, at: D.now, safe: origin, ...(to && { to }), actor, witness, note, lines: [{ serial: id, item: item.id }],
    })
  }
  D.discrepancies = () => [
    ...D.returns.flatMap(receipt => (receipt.ammo || []).map(ammo => {
      const issue = D.recordFor(receipt), line = issue.lines[ammo.index], id = `${receipt.id}-${ammo.index + 1}`
      const returned = receipt.lines.find(r => r.index === ammo.index)?.qty ?? 0
      return { id, kind: 'ammunition', source: receipt.id, safe: issue.safe, item: line.item, guard: issue.guard || (issue.kind === 'person' ? issue.holder : issue.supervisor),
        actor: receipt.actor, expected: returned + ammo.spent, found: returned, at: receipt.at, ...ammo, decision: D.decisions.get(id) }
    })), ...D.variances,
  ].sort((a, b) => Number(Boolean(a.decision)) - Number(Boolean(b.decision)) || b.at.localeCompare(a.at))
  D.log = () => {
    const returnedLines = receipt => receipt.lines.map(r => {
      const line = D.recordFor(receipt).lines[r.index]
      return { ...line, qty: r.qty }
    })
    return [
      ...D.archive, ...D.stateChanges, ...D.stockEvents,
      ...D.issues.map(r => ({ ...r, at: r.issuedAt, action: 'signout' })),
      ...D.returns.map(r => {
        const source = D.recordFor(r)
        return { ...r, safe: source.safe, guard: source.guard || (source.kind === 'person' ? source.holder : source.supervisor),
          site: source.kind === 'site' ? source.holder : null, lines: returnedLines(r), witness: r.witness || r.ammo?.[0]?.witness,
          action: r.custody ? 'endCustody' : 'signin', shortfall: Boolean(r.ammo?.length), repair: r.lines.some(l => l.repair) }
      }),
      ...D.custodies.flatMap(r => {
        const common = { ...r, guard: r.kind === 'person' ? r.holder : r.supervisor, site: r.kind === 'site' ? r.holder : null }
        return [{ ...common, at: r.issuedAt, action: 'handover' }, ...(r.ended && !D.returns.some(receipt => receipt.custody === r.id) ?
          [{ ...common, at: r.endedAt, action: 'endCustody', actor: r.endedBy }] : [])]
      }),
      ...D.discrepancies().filter(v => v.decision).map(v => ({ ...v.decision, id: v.id, safe: v.safe, guard: v.guard, action: 'review',
        lines: v.serials?.length ? v.serials.map(serial => ({ item: v.item, serial })) : [{ item: v.item, qty: Math.max(1, Math.abs(v.expected - v.found)) }] })),
    ].sort((a, b) => b.at.localeCompare(a.at) || b.id.localeCompare(a.id))
  }
  D.alerts = () => {
    const out = D.out(), batches = D.batches().filter(b => b.total > 0), guards = D.activeGuards().map(D.licenceStatus)
    return {
      out, overdue: out.filter(D.overdue), missingFirearms: D.firearms().filter(s => s.state === 'missingSerial'),
      needsDecision: D.discrepancies().filter(d => !d.decision), missingChecks: D.safes.filter(s => !D.checkFor(s.id)),
      expiredBatches: batches.filter(b => b.status === 'expired'), expiringBatches: batches.filter(b => b.status === 'expiring'),
      expiringLicences: guards.filter(g => g.kind === 'expiring'), missingLicences: guards.filter(g => g.kind === 'missing'), expiredLicences: guards.filter(g => g.kind === 'expired'),
    }
  }

  D.assertLedger = () => {
    const serials = D.items.flatMap(item => (item.serials || []).map(s => s.id.toUpperCase()))
    console.assert(serials.length === new Set(serials).size, 'serial identifiers are unique across the ledger')
    for (const movement of D.stockEvents) {
      console.assert(D.safe(movement.safe) && movement.lines.every(line => D.item(line.item) && D.units(line) > 0), 'stock posts positive units to a known safe', movement.id)
      if (movement.lines.some(line => ['firearms', 'ammo'].includes(D.item(line.item).group))) {
        console.assert(movement.reference && movement.witness && movement.witness !== movement.actor, 'controlled stock posts have a reference and a separate witness', movement.id)
      }
    }
    for (const record of [...D.issues, ...D.custodies]) for (const line of record.lines) {
      const item = D.item(line.item)
      console.assert(D.safe(record.safe) && item && Number.isInteger(D.units(line)) && D.units(line) > 0, 'movement has valid safe, item and units', record.id, line)
      console.assert(item.tracking === 'serial' ? item.serials.some(s => s.id === line.serial) && D.units(line) === 1 : !line.serial, 'serial movement references one known serial', record.id, line)
    }
    for (const record of [...D.out(), ...D.openCustody()]) for (const line of record.remaining) {
      if (line.serial) console.assert(D.item(line.item).serials.some(s => s.id === line.serial && s.safe === record.safe), 'open movement stays linked to the original safe', record.id)
    }
    for (const item of D.items) {
      const ledger = D.rollup(item)
      if (item.tracking === 'serial') {
        console.assert(ledger.states.length === item.serials.length && ledger.states.every(s => D.serialStates.includes(s.state)), 'every listed serial has one permitted state', item.id)
        console.assert(!ledger.states.some(s => s.state === 'inSafe' && s.holder), 'safe serials have no holder', item.id)
      }
      if (D.isAmmo(item.id)) for (const safe of D.safes) {
        const r = ledger.bySafe[safe.id]
        console.assert(r.opening === null || r.inSafe + r.onShift + r.custody + r.expended === r.opening + r.received, 'ammunition invariant per type and safe', item.id, safe.id)
      }
    }
  }
  D.assertLedger()
  const alerts = D.alerts()
  console.assert(alerts.out.length === 5 && alerts.overdue.length === 2 && alerts.overdue.every(r => r.id === 'SO-0004' || r.id === 'SO-0005'), 'five out now, two overdue from the clock')
  console.assert(!D.overdue({ due: at(D.today, '13:50') }) && D.overdue({ due: at(D.today, '13:49') }), 'exactly 30 minutes is inside the grace period')
  console.assert(D.backToday().length === 2 && alerts.needsDecision.length === 1, 'two returns, one needs a decision')
  console.assert(alerts.missingChecks.length === 1 && alerts.missingChecks[0].id === 'S2', 'North Gate is missing its shift check')
  console.assert(alerts.expiredBatches.length === 1 && alerts.expiringBatches.length === 1, 'one expired batch and one expiring batch in stock')
  console.assert(alerts.expiringLicences.length === 4 && alerts.expiringLicences.every(l => l.days === 20) && alerts.missingLicences.length === 9 && alerts.expiredLicences.length === 1, 'four licences expire in 20 days, nine missing, one expired')
  console.assert(!alerts.missingFirearms.length && D.rollup(D.item('pistol')).writtenOff === 1, 'one written-off pistol and no seed missing firearms')
  console.assert(D.openCustody().length === 3 && D.holdings('G4415').length === 1, 'former guard still holds custody')
  console.assert(D.safes.every(({ id }, index) => D.activeGuards().filter(g => g.duty === id).length === 6 - index), 'six qualified guards on duty at HQ and five at North Gate')
  console.assert(D.guards.filter(g => g.former).length === 5 && D.guards.filter(g => !g.course).length === 3, 'five former guards and three staff without a course')
}
