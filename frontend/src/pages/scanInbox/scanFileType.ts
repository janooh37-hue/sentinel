/** True when a scanned filename should render as an embedded PDF (vs an image). */
export function isPdf(filename: string): boolean {
  return /\.pdf$/i.test(filename)
}
