import { useTranslation } from 'react-i18next'
import { useQuery } from '@tanstack/react-query'

import { BookWordActions } from '@/components/books/BookWordActions'
import { api } from '@/lib/api'
import { useCapabilities } from '@/lib/useCapabilities'
import { useIsMobile } from '@/lib/useIsMobile'

export function PermitDocumentVersions({ bookId }: { bookId: number }): React.JSX.Element | null {
  const { t } = useTranslation()
  const { has } = useCapabilities()
  const isMobile = useIsMobile()
  const { data: book, isLoading } = useQuery({
    queryKey: ['books', 'permit', bookId],
    queryFn: () => api.getBook(bookId),
  })

  if (isLoading) return <p className="text-xs text-muted-foreground">{t('common.loading')}</p>
  if (!book) return null

  const versions = [...(book.versions ?? [])].sort((a, b) => b.version_no - a.version_no)
  const linkClass =
    'rounded-sm text-xs font-medium text-primary underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring'

  const headingId = `permit-document-versions-${bookId}-title`

  return (
    <section aria-labelledby={headingId} className="flex flex-col gap-3">
      <h3 id={headingId} className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        {t('permits.documentVersions.title')}
      </h3>
      {has('books.manage') && <BookWordActions book={book} isMobile={isMobile} />}
      <ol className="flex flex-col divide-y divide-border rounded-lg border border-border">
        {versions.map((version) => {
          const signed = Boolean(version.signed_pdf_url)
          const pdfUrl = version.signed_pdf_url ?? version.pdf_url
          return (
            <li key={version.id} className="flex items-center justify-between gap-3 px-3 py-2">
              <span className="font-mono text-xs">v{version.version_no}</span>
              <span className="flex items-center gap-2">
                {!signed && version.docx_url && (
                  <a className={linkClass} href={version.docx_url}>
                    {t('permits.documentVersions.docx')}
                  </a>
                )}
                {pdfUrl && (
                  <a
                    className={linkClass}
                    href={pdfUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    {t('permits.documentVersions.pdf')}
                  </a>
                )}
              </span>
            </li>
          )
        })}
      </ol>
    </section>
  )
}
