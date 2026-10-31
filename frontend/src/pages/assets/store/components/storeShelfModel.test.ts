import { describe, expect, it } from 'vitest'

import type { StoreItemRead } from '@/lib/api'
import { sortForShelf } from './storeShelfModel'

const BASE: StoreItemRead = {
  id: 0, code: 'ST-0000', name_en: '', name_ar: null, category_id: 1,
  category: { id: 1, name_en: 'Pantry', name_ar: 'ضيافة' }, counting_unit_en: 'Carton', counting_unit_ar: 'كرتون',
  contains_qty: null, contains_unit_en: null, contains_unit_ar: null, art_kind: null, art_color: null,
  minimum_level: null, archived_at: null, created_at: '2026-10-29T00:00:00Z', updated_at: null, on_hand: 1, version: '1',
}
const item = (id: number, name_en: string, name_ar: string, art_kind: string | null): StoreItemRead => ({ ...BASE, id, code: `ST-${String(id).padStart(4, '0')}`, name_en, name_ar, art_kind })

const SHELF = [
  item(1, 'Sugar', 'سكر', null),
  item(2, 'Masafi tissues', 'مناديل مسافي', 'tissue'),
  item(3, 'Lipton Yellow Label tea', 'شاي ليبتون العلامة الصفراء', 'box'),
  item(4, 'Coffee cups', 'أكواب قهوة', 'cups'),
  item(5, 'Nescafe Classic', 'نسكافيه كلاسيك', 'jar'),
  item(6, 'Green tea', 'شاي أخضر', 'box'),
  item(7, 'Rainbow milk', 'حليب رينبو', 'tins'),
  item(8, 'Plain carton', 'كرتون عادي', 'carton'),
  item(9, 'Black tea', 'شاي أسود', 'box'),
]

describe('shelf order', () => {
  it('groups by what the item is, then names, with plain cartons last', () => {
    expect(sortForShelf(SHELF, 'en').map(row => row.name_en)).toEqual([
      'Nescafe Classic', 'Black tea', 'Green tea', 'Lipton Yellow Label tea', 'Rainbow milk', 'Coffee cups', 'Masafi tissues', 'Plain carton', 'Sugar',
    ])
  })

  it('orders names within a group by the reader\'s language', () => {
    const tea = sortForShelf(SHELF, 'ar').filter(row => row.art_kind === 'box').map(row => row.name_ar)
    expect(tea).toEqual(['شاي أخضر', 'شاي أسود', 'شاي ليبتون العلامة الصفراء'])
  })
})
