/**
 * Short English country name for the Arabic country stored on employee records
 * (`employees.nationality` holds only the Arabic country, spelled inconsistently:
 * الإمارات / الامارات, سلطنة عُمان / عمان …). The English email tables print it
 * the way the office writes it: UAE, Oman, KSA, Jordan, Egypt …
 * Unknown values come back unchanged so nothing is silently dropped.
 */

const NATIONALITY_EN: Record<string, string> = {
  الامارات: 'UAE',
  'الامارات العربيه المتحده': 'UAE',
  'دوله الامارات العربيه المتحده': 'UAE',
  عمان: 'Oman',
  'سلطنه عمان': 'Oman',
  السعوديه: 'KSA',
  'المملكه العربيه السعوديه': 'KSA',
  الكويت: 'Kuwait',
  البحرين: 'Bahrain',
  قطر: 'Qatar',
  اليمن: 'Yemen',
  العراق: 'Iraq',
  الاردن: 'Jordan',
  سوريا: 'Syria',
  لبنان: 'Lebanon',
  فلسطين: 'Palestine',
  مصر: 'Egypt',
  السودان: 'Sudan',
  ليبيا: 'Libya',
  تونس: 'Tunisia',
  الجزائر: 'Algeria',
  المغرب: 'Morocco',
  موريتانيا: 'Mauritania',
  الصومال: 'Somalia',
  جيبوتي: 'Djibouti',
  'جزر القمر': 'Comoros',
  اثيوبيا: 'Ethiopia',
  اريتريا: 'Eritrea',
  كينيا: 'Kenya',
  اوغندا: 'Uganda',
  نيجيريا: 'Nigeria',
  نيبال: 'Nepal',
  الهند: 'India',
  باكستان: 'Pakistan',
  بنغلاديش: 'Bangladesh',
  سريلانكا: 'Sri Lanka',
  الفلبين: 'Philippines',
  افغانستان: 'Afghanistan',
  ايران: 'Iran',
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
