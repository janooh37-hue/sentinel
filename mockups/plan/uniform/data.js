'use strict'
// Sample stock for the approval mockup. These are not real quantities.
// Every total on the screen is computed from these rows; nothing is typed in twice.

const LETTERS = ['S', 'M', 'L', 'XL', 'XXL', 'XXXL']
const SHOES = ['38', '39', '40', '41', '42', '43', '44', '45', '46', '47']
const WAIST = ['28', '30', '32', '34', '36', '38', '40', '42', '44']

window.UNIFORM = {
  groups: [
    { id: 'formal', en: 'Formal suit', ar: 'البدلة الرسمية', noteEn: 'Kept as one whole unit', noteAr: 'تُحفظ وحدةً كاملة' },
    { id: 'guard', en: 'Guard uniform', ar: 'زي الحراسة', noteEn: 'Counted piece by piece', noteAr: 'يُحسب قطعةً قطعة' },
  ],
  items: [
    { id: 'suit', group: 'formal', art: 'suit', en: 'Formal suit', ar: 'بدلة رسمية', dEn: 'Navy blazer, navy trousers, white shirt', dAr: 'سترة كحلية وبنطال كحلي وقميص أبيض', sizes: LETTERS, qty: [2, 6, 9, 5, 3, 1] },
    { id: 'formal-shoes', group: 'formal', art: 'shoes', en: 'Formal shoes', ar: 'حذاء رسمي', dEn: 'Black', dAr: 'أسود', sizes: SHOES, qty: [1, 1, 2, 4, 5, 4, 3, 1, 1, 0] },
    { id: 'polo', group: 'guard', art: 'polo', en: 'Polo shirt', ar: 'قميص بولو', dEn: 'Olive, with logo', dAr: 'زيتي، مع الشعار', sizes: LETTERS, qty: [4, 14, 22, 15, 7, 2] },
    { id: 'cargo', group: 'guard', art: 'cargo', en: 'Cargo trousers', ar: 'بنطال كارغو', dEn: 'Khaki', dAr: 'خاكي', sizes: WAIST, qty: [1, 5, 10, 13, 9, 6, 3, 1, 0] },
    { id: 'belt', group: 'guard', art: 'belt', en: 'Belt', ar: 'حزام', dEn: 'Brown, silver buckle', dAr: 'بني بإبزيم فضي', sizes: ['S', 'M', 'L', 'XL'], qty: [6, 18, 16, 8] },
    { id: 'boots', group: 'guard', art: 'boots', en: 'Field boots', ar: 'حذاء ميداني', dEn: 'Tan, lace-up', dAr: 'بيج برباط', sizes: SHOES, qty: [0, 2, 5, 8, 10, 8, 5, 2, 1, 0] },
    { id: 'cap', group: 'guard', art: 'cap', en: 'Cap', ar: 'قبعة', dEn: 'Khaki, with logo', dAr: 'خاكي، مع الشعار', sizes: ['S', 'M', 'L'], qty: [9, 21, 12] },
    { id: 'socks', group: 'guard', art: 'socks', en: 'Socks', ar: 'جوارب', dEn: 'Khaki, pairs', dAr: 'خاكي، أزواج', sizes: ['one'], qty: [64] },
  ],
}

window.UNIFORM.total = item => item.qty.reduce((a, b) => a + b, 0)
window.UNIFORM.pieces = () => window.UNIFORM.items.reduce((a, i) => a + window.UNIFORM.total(i), 0)
window.UNIFORM.suits = () => window.UNIFORM.total(window.UNIFORM.items.find(i => i.id === 'suit'))

for (const item of window.UNIFORM.items) {
  console.assert(item.sizes.length === item.qty.length, `${item.id}: one quantity per size`)
  console.assert(item.qty.every(q => Number.isInteger(q) && q >= 0), `${item.id}: whole, non-negative quantities`)
  console.assert(window.UNIFORM.groups.some(g => g.id === item.group), `${item.id}: known group`)
}
console.assert(
  window.UNIFORM.pieces() === window.UNIFORM.groups.reduce((a, g) => a + window.UNIFORM.items.filter(i => i.group === g.id).reduce((b, i) => b + window.UNIFORM.total(i), 0), 0),
  'group totals sum to total pieces',
)
