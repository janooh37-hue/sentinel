'use strict'
// Sample data for the approval mockup. Names, G numbers, quantities and dates are invented.
// Every total and list on the screen is computed from these rows; nothing is typed in twice.

const LETTERS = ['S', 'M', 'L', 'XL', 'XXL', 'XXXL']
const SHOES = ['38', '39', '40', '41', '42', '43', '44', '45', '46', '47']
const WAIST = ['28', '30', '32', '34', '36', '38', '40', '42', '44']

window.UNIFORM = {
  today: '2026-11-03',
  currentUser: 'G2741',

  employees: [
    { id: 'G2741', en: 'Khalid Saif Al Ketbi', ar: 'خالد سيف الكتبي', posEn: 'Store keeper', posAr: 'أمين المخزن' },
    { id: 'G3082', en: 'Saeed Rashid Al Mazrouei', ar: 'سعيد راشد المزروعي', posEn: 'Shift supervisor', posAr: 'مشرف مناوبة' },
    { id: 'G3105', en: 'Hamad Ali Al Nuaimi', ar: 'حمد علي النعيمي', posEn: 'Security guard', posAr: 'حارس أمن' },
    { id: 'G3117', en: 'Mohammed Juma Al Dhaheri', ar: 'محمد جمعة الظاهري', posEn: 'Security guard', posAr: 'حارس أمن' },
    { id: 'G3124', en: 'Obaid Salem Al Kaabi', ar: 'عبيد سالم الكعبي', posEn: 'Security guard', posAr: 'حارس أمن' },
    { id: 'G3139', en: 'Yousef Ahmed Al Hosani', ar: 'يوسف أحمد الحوسني', posEn: 'Operations officer', posAr: 'ضابط عمليات' },
    { id: 'G3141', en: 'Rashid Hamdan Al Shamsi', ar: 'راشد حمدان الشامسي', posEn: 'Security guard', posAr: 'حارس أمن' },
    { id: 'G3156', en: 'Abdulla Matar Al Suwaidi', ar: 'عبدالله مطر السويدي', posEn: 'Security guard', posAr: 'حارس أمن' },
    { id: 'G3160', en: 'Faisal Khamis Al Mansoori', ar: 'فيصل خميس المنصوري', posEn: 'Shift supervisor', posAr: 'مشرف مناوبة' },
    { id: 'G3172', en: 'Imran Shafiq Khan', ar: 'عمران شفيق خان', posEn: 'Security guard', posAr: 'حارس أمن' },
    { id: 'G3188', en: 'Sultan Nasser Al Ali', ar: 'سلطان ناصر العلي', posEn: 'Administrative officer', posAr: 'موظف إداري' },
    { id: 'G3194', en: 'Ali Hassan Al Blooshi', ar: 'علي حسن البلوشي', posEn: 'Security guard', posAr: 'حارس أمن' },
    { id: 'G3201', en: 'Majid Saif Al Falasi', ar: 'ماجد سيف الفلاسي', posEn: 'Security guard', posAr: 'حارس أمن' },
    { id: 'G3215', en: 'Ahmed Obaid Al Zaabi', ar: 'أحمد عبيد الزعابي', posEn: 'Operations officer', posAr: 'ضابط عمليات' },
    { id: 'G3222', en: 'Tariq Mahmoud Saleh', ar: 'طارق محمود صالح', posEn: 'Security guard', posAr: 'حارس أمن' },
  ],

  groups: [
    { id: 'formal', en: 'Formal', ar: 'رسمي', noteEn: 'Suits are tracked by the employee who holds them', noteAr: 'تُتابع البدلات حسب الموظف الذي يحملها' },
    { id: 'guard', en: 'Guard uniform', ar: 'زي الحراسة', noteEn: 'Counted piece by piece', noteAr: 'يُحسب قطعةً قطعة' },
  ],

  // tracking: 'holders' = no shelf count, listed by the G number holding it; 'stock' = counted by size.
  // defaultQty: what the hand-out form proposes once a size is chosen.
  items: [
    { id: 'suit', group: 'formal', art: 'suit', tracking: 'holders', defaultQty: 2, en: 'Formal suit', ar: 'بدلة رسمية', dEn: 'Navy blazer, navy trousers, white shirt', dAr: 'سترة كحلية وبنطال كحلي وقميص أبيض', sizes: LETTERS },
    { id: 'polo', group: 'guard', art: 'polo', tracking: 'stock', defaultQty: 2, en: 'Polo shirt', ar: 'قميص بولو', dEn: 'Olive, with logo', dAr: 'زيتي، مع الشعار', sizes: LETTERS, qty: [4, 14, 22, 15, 7, 2] },
    { id: 'cargo', group: 'guard', art: 'cargo', tracking: 'stock', defaultQty: 2, en: 'Cargo trousers', ar: 'بنطال كارغو', dEn: 'Khaki', dAr: 'خاكي', sizes: WAIST, qty: [1, 5, 10, 13, 9, 6, 3, 1, 0] },
    { id: 'belt', group: 'guard', art: 'belt', tracking: 'stock', defaultQty: 1, en: 'Belt', ar: 'حزام', dEn: 'Brown, silver buckle', dAr: 'بني بإبزيم فضي', sizes: ['one'], qty: [48] },
    { id: 'boots', group: 'guard', art: 'boots', tracking: 'stock', defaultQty: 2, en: 'Field boots', ar: 'حذاء ميداني', dEn: 'Tan, lace-up', dAr: 'بيج برباط', sizes: SHOES, qty: [0, 2, 5, 8, 10, 8, 5, 2, 1, 0] },
    { id: 'cap', group: 'guard', art: 'cap', tracking: 'stock', defaultQty: 1, en: 'Cap', ar: 'قبعة', dEn: 'Khaki, with logo', dAr: 'خاكي، مع الشعار', sizes: ['one'], qty: [42] },
    { id: 'socks', group: 'guard', art: 'socks', tracking: 'stock', defaultQty: 2, en: 'Socks', ar: 'جوارب', dEn: 'Khaki, pairs', dAr: 'خاكي، أزواج', sizes: ['one'], qty: [64] },
  ],

  // Hand-out records, newest first. givenBy is the signed-in account that saved the record.
  records: [
    { id: 'R-0012', date: '2026-11-02', employee: 'G3222', givenBy: 'G2741', lines: [{ item: 'polo', size: 'L', qty: 2 }, { item: 'cargo', size: '34', qty: 2 }, { item: 'belt', size: 'one', qty: 1 }, { item: 'boots', size: '42', qty: 2 }, { item: 'cap', size: 'one', qty: 1 }, { item: 'socks', size: 'one', qty: 2 }] },
    { id: 'R-0011', date: '2026-10-30', employee: 'G3105', givenBy: 'G2741', lines: [{ item: 'cap', size: 'one', qty: 1 }] },
    { id: 'R-0010', date: '2026-10-29', employee: 'G3215', givenBy: 'G2741', lines: [{ item: 'suit', size: 'L', qty: 2 }] },
    { id: 'R-0009', date: '2026-10-21', employee: 'G3201', givenBy: 'G2741', lines: [{ item: 'polo', size: 'M', qty: 2 }, { item: 'cargo', size: '32', qty: 2 }, { item: 'belt', size: 'one', qty: 1 }, { item: 'boots', size: '41', qty: 2 }, { item: 'cap', size: 'one', qty: 1 }, { item: 'socks', size: 'one', qty: 2 }] },
    { id: 'R-0008', date: '2026-10-14', employee: 'G3188', givenBy: 'G2741', lines: [{ item: 'suit', size: 'M', qty: 2 }] },
    { id: 'R-0007', date: '2026-10-07', employee: 'G3124', givenBy: 'G3160', lines: [{ item: 'polo', size: 'S', qty: 2 }, { item: 'cargo', size: '30', qty: 2 }, { item: 'belt', size: 'one', qty: 1 }, { item: 'boots', size: '40', qty: 2 }, { item: 'cap', size: 'one', qty: 1 }, { item: 'socks', size: 'one', qty: 2 }] },
    { id: 'R-0006', date: '2026-10-02', employee: 'G3172', givenBy: 'G3160', lines: [{ item: 'polo', size: 'XL', qty: 2 }, { item: 'cargo', size: '36', qty: 2 }, { item: 'belt', size: 'one', qty: 1 }, { item: 'boots', size: '44', qty: 2 }, { item: 'cap', size: 'one', qty: 1 }, { item: 'socks', size: 'one', qty: 2 }] },
    { id: 'R-0005', date: '2026-09-24', employee: 'G3160', givenBy: 'G2741', lines: [{ item: 'suit', size: 'XL', qty: 2 }] },
    { id: 'R-0004', date: '2026-09-14', employee: 'G3117', givenBy: 'G2741', lines: [{ item: 'polo', size: 'M', qty: 2 }, { item: 'cargo', size: '32', qty: 2 }, { item: 'belt', size: 'one', qty: 1 }, { item: 'boots', size: '40', qty: 2 }, { item: 'cap', size: 'one', qty: 1 }, { item: 'socks', size: 'one', qty: 2 }] },
    { id: 'R-0003', date: '2026-09-14', employee: 'G3105', givenBy: 'G2741', lines: [{ item: 'polo', size: 'L', qty: 2 }, { item: 'cargo', size: '34', qty: 2 }, { item: 'belt', size: 'one', qty: 1 }, { item: 'boots', size: '42', qty: 2 }, { item: 'cap', size: 'one', qty: 1 }, { item: 'socks', size: 'one', qty: 2 }] },
    { id: 'R-0002', date: '2026-08-30', employee: 'G3139', givenBy: 'G2741', lines: [{ item: 'suit', size: 'M', qty: 2 }] },
    { id: 'R-0001', date: '2026-08-30', employee: 'G3082', givenBy: 'G2741', lines: [{ item: 'suit', size: 'L', qty: 2 }] },
  ],
  returns: [
    { id: 'T-0004', date: '2026-11-02', employee: 'G3201', receivedBy: 'G2741', lines: [{ item: 'polo', size: 'M', qty: 1 }] },
    { id: 'T-0003', date: '2026-11-01', employee: 'G3188', receivedBy: 'G2741', lines: [{ item: 'suit', size: 'M', qty: 2 }] },
    { id: 'T-0002', date: '2026-10-28', employee: 'G3124', receivedBy: 'G2741', lines: [{ item: 'boots', size: '40', qty: 1 }] },
    { id: 'T-0001', date: '2026-10-20', employee: 'G3172', receivedBy: 'G3160', lines: [{ item: 'cargo', size: '36', qty: 1 }, { item: 'socks', size: 'one', qty: 2 }] },
  ],
}

{ // block scope: the page script has its own `U`
const U = window.UNIFORM
U.item = id => U.items.find(i => i.id === id)
U.employee = id => U.employees.find(e => e.id === id)
U.total = item => item.qty.reduce((a, b) => a + b, 0)
U.shelfPieces = () => U.items.filter(i => i.tracking === 'stock').reduce((a, i) => a + U.total(i), 0)
U.lineCount = record => record.lines.reduce((a, l) => a + l.qty, 0)

// Current holdings aggregate every hand-out minus every return, by piece and size.
U.holdings = employee => {
  const held = new Map()
  for (const [records, sign] of [[U.records, 1], [U.returns, -1]]) {
    for (const r of records.filter(r => r.employee === employee)) for (const l of r.lines) {
      const key = `${l.item}:${l.size}`
      const row = held.get(key) ?? { item: l.item, size: l.size, qty: 0 }
      row.qty += sign * l.qty
      held.set(key, row)
    }
  }
  return [...held.values()].filter(l => l.qty > 0)
}
U.holders = () => U.employees.flatMap(e => {
  const suits = U.holdings(e.id).filter(l => l.item === 'suit')
  return suits.length ? [{ employee: e.id, sizes: suits.map(l => l.size), qty: suits.reduce((n, l) => n + l.qty, 0) }] : []
}).sort((a, b) => a.employee.localeCompare(b.employee))

// One row per person who has received anything, newest hand-out first.
U.recipients = () => {
  const people = new Map()
  for (const r of U.records) {
    const p = people.get(r.employee) ?? { employee: r.employee, records: [] }
    p.records.push(r)
    people.set(r.employee, p)
  }
  return [...people.values()]
}

for (const item of U.items) {
  console.assert(item.tracking === 'holders' || item.sizes.length === item.qty.length, `${item.id}: one quantity per size`)
  console.assert(item.tracking === 'holders' || item.qty.every(q => Number.isInteger(q) && q >= 0), `${item.id}: whole, non-negative quantities`)
  console.assert(Number.isInteger(item.defaultQty) && item.defaultQty > 0, `${item.id}: default quantity`)
}
for (const r of U.records) {
  console.assert(U.employee(r.employee) && U.employee(r.givenBy), `${r.id}: known employee and giver`)
  for (const l of r.lines) console.assert(U.item(l.item)?.sizes.includes(l.size) && l.qty > 0, `${r.id}: valid ${l.item} line`)
}
console.assert(U.records.every((r, k) => k === 0 || U.records[k - 1].date >= r.date), 'records are newest first')
console.assert(U.returns.every((r, k) => k === 0 || U.returns[k - 1].date >= r.date), 'returns are newest first')
// Shelf quantities above are the pre-return snapshot. Apply the sample returns once.
const shelfBeforeReturns = U.shelfPieces()
let restocked = 0
const ledger = new Map()
for (const r of [...U.records.map(r => ({ ...r, sign: 1 })), ...U.returns.map(r => ({ ...r, sign: -1 }))].sort((a, b) => a.date.localeCompare(b.date) || b.sign - a.sign)) {
  console.assert(U.employee(r.employee) && U.employee(r.givenBy || r.receivedBy), `${r.id}: known accounts`)
  for (const l of r.lines) {
    console.assert(U.item(l.item)?.sizes.includes(l.size) && Number.isInteger(l.qty) && l.qty > 0, `${r.id}: valid line`)
    const key = `${r.employee}:${l.item}:${l.size}`
    const next = (ledger.get(key) || 0) + r.sign * l.qty
    console.assert(next >= 0, `${r.id}: cannot return more than held`)
    ledger.set(key, next)
    if (r.sign < 0 && U.item(l.item).tracking === 'stock') {
      const item = U.item(l.item)
      item.qty[item.sizes.indexOf(l.size)] += l.qty
      restocked += l.qty
    }
  }
}
console.assert(U.shelfPieces() === shelfBeforeReturns + restocked, 'shelf snapshot plus returned stock reconciles')
console.assert(U.holdings('G3222').find(l => l.item === 'polo' && l.size === 'L')?.qty === 2, 'return example holds two L polos')
console.assert(U.holders().length === 4, 'fully returned suit is not a holder')
}
