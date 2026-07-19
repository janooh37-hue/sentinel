/**
 * WordTemplateManager — manage the shared General Book boilerplate library
 * from the General Book form (list + inline rename).
 *
 * Names display WITHOUT the .docx suffix everywhere (an Arabic name glued to
 * a Latin suffix is a bidi mess); the backend re-appends it via
 * safe_template_name.
 */

import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { Pencil } from 'lucide-react'
import { toast } from 'sonner'

import { api, apiErrorMessage } from '@/lib/api'
import {
  DialogRoot,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'

interface Props {
  open: boolean
  onOpenChange: (open: boolean) => void
}

const stripDocx = (name: string): string => name.replace(/\.docx$/i, '')

export function WordTemplateManager({ open, onOpenChange }: Props): React.JSX.Element {
  const { t, i18n } = useTranslation()
  const isAr = i18n.language.startsWith('ar')
  const qc = useQueryClient()
  const [editing, setEditing] = useState<string | null>(null) // full name incl. .docx
  const [newName, setNewName] = useState('')

  const templatesQuery = useQuery({
    queryKey: ['word-templates'],
    queryFn: api.listWordTemplates,
    enabled: open,
  })

  const renameMutation = useMutation({
    mutationFn: ({ oldName, name }: { oldName: string; name: string }) =>
      api.renameWordTemplate(oldName, name),
    onSuccess: () => {
      setEditing(null)
      void qc.invalidateQueries({ queryKey: ['word-templates'] })
    },
    onError: (err) => toast.error(apiErrorMessage(err)),
  })

  return (
    <DialogRoot open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{t('books.word.manageTemplates')}</DialogTitle>
        </DialogHeader>
        <ul className="max-h-[50vh] overflow-y-auto px-4 pb-4">
          {(templatesQuery.data ?? []).map((tpl) => (
            <li
              key={tpl.name}
              className="flex items-center gap-2 border-b border-hairline py-2 last:border-b-0"
            >
              {editing === tpl.name ? (
                <>
                  <input
                    type="text"
                    dir="auto"
                    value={newName}
                    onChange={(e) => setNewName(e.target.value)}
                    aria-label={t('books.word.saveAsTemplateName')}
                    className="min-w-0 flex-1 rounded-lg border border-hairline bg-transparent px-2 py-1.5 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    autoFocus
                  />
                  <button
                    type="button"
                    disabled={renameMutation.isPending || !newName.trim()}
                    onClick={() =>
                      renameMutation.mutate({ oldName: tpl.name, name: newName.trim() })
                    }
                    className="rounded-lg bg-primary px-2.5 py-1.5 text-[0.78em] font-semibold text-primary-foreground hover:bg-primary-hover disabled:opacity-50"
                  >
                    {t('common.save')}
                  </button>
                  <button
                    type="button"
                    onClick={() => setEditing(null)}
                    className="rounded-lg px-2 py-1.5 text-[0.78em] font-semibold text-muted-foreground hover:text-foreground"
                  >
                    {t('common.cancel')}
                  </button>
                </>
              ) : (
                <>
                  <span dir="auto" className="min-w-0 flex-1 truncate text-[0.9em]">
                    {stripDocx(tpl.name)}
                  </span>
                  <span className="shrink-0 text-[0.7em] text-muted-foreground">
                    <bdi dir="ltr">
                      {new Date(tpl.modified_at).toLocaleDateString(isAr ? 'ar-AE' : 'en-GB')}
                    </bdi>
                  </span>
                  <button
                    type="button"
                    onClick={() => {
                      setEditing(tpl.name)
                      setNewName(stripDocx(tpl.name))
                    }}
                    className="inline-flex shrink-0 items-center gap-1 rounded-lg border border-hairline px-2 py-1.5 text-[0.74em] font-semibold text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    <Pencil className="h-3 w-3" aria-hidden />
                    {t('books.word.renameTemplate')}
                  </button>
                </>
              )}
            </li>
          ))}
        </ul>
      </DialogContent>
    </DialogRoot>
  )
}
