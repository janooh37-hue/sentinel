/**
 * English nationality for the Arabic country names stored on employee records
 * (`employees.nationality` holds the Arabic country, spelled inconsistently:
 * الإمارات / الامارات, سلطنة عُمان / عمان …). Used by the English email tables.
 * Unknown values come back unchanged so nothing is silently dropped.
 */

const NATIONALITY_EN: Record<string, string> = {
  الامارات: 'Emirati',
  'الامارات العربيه المتحده': 'Emirati',
  'دوله الامارات العربيه المتحده': 'Emirati',
  عمان: 'Omani',
  'سلطنه عمان': 'Omani',
  السعوديه: 'Saudi',
  'المملكه العربيه السعوديه': 'Saudi',
  الكويت: 'Kuwaiti',
  البحرين: 'Bahraini',
  قطر: 'Qatari',
  اليمن: 'Yemeni',
  العراق: 'Iraqi',
  الاردن: 'Jordanian',
  سوريا: 'Syrian',
  لبنان: 'Lebanese',
  فلسطين: 'Palestinian',
  مصر: 'Egyptian',
  السودان: 'Sudanese',
  ليبيا: 'Libyan',
  تونس: 'Tunisian',
  الجزائر: 'Algerian',
  المغرب: 'Moroccan',
  موريتانيا: 'Mauritanian',
  الصومال: 'Somali',
  جيبوتي: 'Djiboutian',
  'جزر القمر': 'Comorian',
  اثيوبيا: 'Ethiopian',
  اريتريا: 'Eritrean',
  كينيا: 'Kenyan',
  اوغندا: 'Ugandan',
  نيجيريا: 'Nigerian',
  نيبال: 'Nepalese',
  الهند: 'Indian',
  باكستان: 'Pakistani',
  بنغلاديش: 'Bangladeshi',
  سريلانكا: 'Sri Lankan',
  الفلبين: 'Filipino',
  افغانستان: 'Afghan',
  ايران: 'Iranian',
}

/** Fold the spelling variants: harakat, hamza-carrying alefs, alef maqsura, ta marbuta. */
function normalizeArabic(value: string): string {
  return value
    .replace(/[\u064B-\u0652\u0640]/g, '')
    .replace(/[أإآ]/g, 'ا')
    .replace(/ى/g, 'ي')
    .replace(/ة/g, 'ه')
    .replace(/\s+/g, ' ')
    .trim()
}

export function nationalityEn(stored: string | undefined): string {
  if (!stored) return ''
  return NATIONALITY_EN[normalizeArabic(stored)] ?? stored
}
