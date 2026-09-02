/** Today's Umm al-Qura date with the Arabic month name and Western digits,
 * matching the backend's generated DOCX date line. */
export function hijriToday(): string {
  try {
    return new Intl.DateTimeFormat('ar-SA-u-ca-islamic-umalqura', {
      day: 'numeric',
      month: 'long',
      year: 'numeric',
    })
      .format(new Date())
      .replace(/[٠-٩]/g, (digit) => String(digit.charCodeAt(0) - 0x660))
  } catch {
    return ''
  }
}
