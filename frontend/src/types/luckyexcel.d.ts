// LuckyExcel ships no types — minimal ambient declaration for what we use.
// `transformExcelToLuckyByUrl` fetches + parses an .xlsx entirely in-browser and
// hands back luckysheet-format sheets (compatible with Fortune-sheet's `data`).
declare module 'luckyexcel' {
  interface LuckyExport {
    sheets?: unknown[]
    info?: unknown
  }
  type Cb = (exportJson: LuckyExport, luckysheetfile?: unknown) => void
  export function transformExcelToLuckyByUrl(
    url: string,
    name: string,
    callback: Cb,
  ): void
  export function transformExcelToLucky(file: File | Blob, callback: Cb): void
}
