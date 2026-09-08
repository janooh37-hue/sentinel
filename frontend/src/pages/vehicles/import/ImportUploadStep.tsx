import { useState } from 'react'
import { useMutation } from '@tanstack/react-query'
import { Download, FileSpreadsheet } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { FileUploadZone } from '@/components/ui/file-upload-zone'
import { api } from '@/lib/api'

import { vehicleErrorMessage } from '../vehicleUtils'

interface ImportUploadStepProps {
  busy: boolean
  error: string | null
  onFile: (file: File) => void
}

function saveTemplate(blob: Blob): void {
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = 'vehicle-import-template.xlsx'
  document.body.append(anchor)
  anchor.click()
  anchor.remove()
  setTimeout(() => URL.revokeObjectURL(url), 0)
}

export function ImportUploadStep({
  busy,
  error,
  onFile,
}: ImportUploadStepProps): React.JSX.Element {
  const { t } = useTranslation()
  const [downloadError, setDownloadError] = useState<string | null>(null)
  const download = useMutation({
    mutationFn: () => api.downloadVehicleImportTemplate(),
    onSuccess: (blob) => {
      saveTemplate(blob)
      setDownloadError(null)
      toast.success(t('vehicles.import.templateDownloaded'))
    },
    onError: (err) => {
      const message = vehicleErrorMessage(err, t)
      setDownloadError(message)
      toast.error(message)
    },
  })

  return (
    <div className="mx-auto grid w-full max-w-5xl gap-4 px-4 pb-16 md:grid-cols-[minmax(0,1.4fr)_minmax(17rem,0.6fr)] md:px-6">
      <Card className="overflow-hidden">
        <CardHeader className="items-start bg-surface-raised">
          <div className="flex items-center gap-3">
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-primary-soft text-primary">
              <FileSpreadsheet className="h-5 w-5" aria-hidden />
            </span>
            <div>
              <CardTitle className="text-[1em]">{t('vehicles.import.uploadTitle')}</CardTitle>
              <p className="mt-1 text-[0.78em] text-muted-foreground">
                {t('vehicles.import.uploadDescription')}
              </p>
            </div>
          </div>
        </CardHeader>
        <CardContent className="p-5">
          <FileUploadZone
            accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
            label={t('vehicles.import.chooseFile')}
            hint={t('vehicles.import.uploadHint')}
            busy={busy}
            busyLabel={t('vehicles.import.inspecting')}
            onFile={onFile}
          />
          {error ? (
            <div
              role="alert"
              className="mt-4 rounded-lg border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive"
            >
              <p className="font-semibold">{t('vehicles.import.inspectFailedTitle')}</p>
              <p dir="auto" className="mt-1 text-[0.88em]">{error}</p>
              <button
                type="button"
                className="mt-2 font-semibold underline underline-offset-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                onClick={() => download.mutate()}
                disabled={download.isPending}
              >
                {t('vehicles.import.inspectFailedTemplate')}
              </button>
            </div>
          ) : null}
        </CardContent>
      </Card>

      <Card className="self-start border-primary/20 bg-primary-soft/40">
        <CardHeader>
          <CardTitle>{t('vehicles.import.templateTitle')}</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="mb-4 text-[0.8em] leading-relaxed text-muted-foreground">
            {t('vehicles.import.templateDescription')}
          </p>
          <Button
            type="button"
            className="w-full"
            onClick={() => download.mutate()}
            disabled={download.isPending}
          >
            <Download className="h-4 w-4" aria-hidden />
            {download.isPending
              ? t('vehicles.import.downloadingTemplate')
              : t('vehicles.import.downloadTemplate')}
          </Button>
          {downloadError ? (
            <p role="alert" dir="auto" className="mt-3 text-xs text-destructive">
              {downloadError}
            </p>
          ) : null}
        </CardContent>
      </Card>
    </div>
  )
}
