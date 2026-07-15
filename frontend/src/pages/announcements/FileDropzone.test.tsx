import { render, screen, fireEvent } from '@testing-library/react'
import { useRef, useState } from 'react'
import { describe, expect, it } from 'vitest'

import { FileDropzone } from './FileDropzone'

function Harness(): React.JSX.Element {
  const fileRef = useRef<HTMLInputElement>(null)
  const [hasFile, setHasFile] = useState(false)
  const [fileName, setFileName] = useState<string | null>(null)
  const [fileSize, setFileSize] = useState<number | null>(null)
  return (
    <FileDropzone
      fileRef={fileRef}
      hasFile={hasFile}
      fileName={fileName}
      fileSize={fileSize}
      onFileChange={() => {
        const f = fileRef.current?.files?.[0] ?? null
        setHasFile(f !== null)
        setFileName(f?.name ?? null)
        setFileSize(f?.size ?? null)
      }}
      onClear={() => {
        if (fileRef.current) fileRef.current.value = ''
        setHasFile(false)
        setFileName(null)
        setFileSize(null)
      }}
    />
  )
}

describe('FileDropzone', () => {
  it('swaps zone → file card on selection, and back on remove', () => {
    render(<Harness />)
    // empty state: the zone text is visible
    expect(screen.getByText(/sendToGroup.uploadZone.main|choose a file/i)).toBeInTheDocument()
    const input = document.querySelector('input[type="file"]') as HTMLInputElement
    const file = new File(['%PDF'], 'roster.pdf', { type: 'application/pdf' })
    fireEvent.change(input, { target: { files: [file] } })
    // selected state: card with the file name; zone gone
    expect(screen.getByText('roster.pdf')).toBeInTheDocument()
    expect(screen.queryByText(/choose a file/i)).not.toBeInTheDocument()
    // remove restores the zone
    fireEvent.click(screen.getByRole('button', { name: /remove|إزالة/i }))
    expect(screen.getByText(/choose a file/i)).toBeInTheDocument()
  })

  it('highlights on dragover and clears on dragleave', () => {
    render(<Harness />)
    const zone = screen.getByText(/choose a file/i).closest('div') as HTMLElement
    fireEvent.dragOver(zone)
    expect(zone.className).toMatch(/(?:^|\s)border-primary(?:\s|$)/)
    fireEvent.dragLeave(zone)
    expect(zone.className).not.toMatch(/(?:^|\s)border-primary(?:\s|$)/)
  })
})
