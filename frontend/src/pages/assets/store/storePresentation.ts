import { isArabic } from '@/lib/language'
import { formatContains } from './storeUtils'

export interface StorePresentationItem {
  name_en?: string
  name_ar?: string | null
  item_name_en?: string
  item_name_ar?: string | null
  code?: string
  item_code?: string
  short_name_en?: string | null
  short_name_ar?: string | null
  pack_description_en?: string | null
  pack_description_ar?: string | null
  brand_label?: string | null
  generic_label_en?: string | null
  generic_label_ar?: string | null
  art_kind?: string | null
  art_color?: string | null
  category_id?: number | null
  counting_unit_en?: string
  counting_unit_ar?: string
  contains_qty?: number | null
  contains_unit_en?: string | null
  contains_unit_ar?: string | null
}

export function storeDisplayName(item: StorePresentationItem, language = 'en'): string {
  return isArabic(language)
    ? item.short_name_ar?.trim() || item.name_ar?.trim() || item.item_name_ar?.trim() || item.short_name_en?.trim() || item.name_en || item.item_name_en || ''
    : item.short_name_en?.trim() || item.name_en || item.item_name_en || ''
}

export function storePackDescription(item: StorePresentationItem, language: string): string | null {
  const description = isArabic(language) ? item.pack_description_ar?.trim() : item.pack_description_en?.trim()
  if (description) return description
  return formatContains({
    counting_unit_en: item.counting_unit_en ?? '',
    counting_unit_ar: item.counting_unit_ar ?? '',
    contains_qty: item.contains_qty ?? null,
    contains_unit_en: item.contains_unit_en ?? null,
    contains_unit_ar: item.contains_unit_ar ?? null,
  }, language)
}
