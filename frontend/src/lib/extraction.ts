/**
 * OCR extraction API client.
 *
 * Posts a file to POST /api/v1/extractions (multipart) and returns structured
 * field data. Uses the same `same-origin` credentials as the rest of the app
 * (the shared `api` client in api.ts) but goes through the `multipart` path
 * because it uploads a binary file rather than JSON.
 *
 * The backend returns HTTP 503 when Tesseract is not installed on the server.
 */

export interface ExtractedFieldOut {
  key: string
  value: string
  confidence: number
  source_snippet?: string
}

export interface ExtractionResponse {
  id: number
  document_type: string
  document_type_confidence: number
  alternatives: string[]
  fields: ExtractedFieldOut[]
  matched_employee_id: string | null
  match_score: number
  matched_employee_name_en: string | null
  matched_employee_name_ar: string | null
}

export async function extractDocument(file: File): Promise<ExtractionResponse> {
  const body = new FormData()
  body.append('file', file)
  const res = await fetch('/api/v1/extractions', {
    method: 'POST',
    body,
    credentials: 'same-origin',
  })
  if (!res.ok) {
    if (res.status === 503) throw new Error('OCR is not available on the server.')
    throw new Error(`Extraction failed (${res.status})`)
  }
  return (await res.json()) as ExtractionResponse
}
