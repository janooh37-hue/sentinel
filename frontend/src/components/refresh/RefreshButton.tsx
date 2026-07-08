import { useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { refreshAll } from '../../lib/globalRefresh'

export function RefreshButton() {
  const qc = useQueryClient()
  const { t } = useTranslation()
  const [spinning, setSpinning] = useState(false)
  return (
    <button
      type="button"
      aria-label={t('refresh.action')}
      title={`${t('refresh.action')} · ${t('refresh.hotkey')}`}
      className="grid h-[30px] w-[30px] place-items-center rounded-lg border border-transparent text-[color:var(--text-faint,#93a0af)] transition hover:border-[color:var(--line)] hover:text-[color:var(--ink)]"
      onClick={() => {
        setSpinning(true)
        void refreshAll(qc).finally(() => setSpinning(false))
      }}
    >
      <svg
        width="15"
        height="15"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2.2"
        strokeLinecap="round"
        strokeLinejoin="round"
        className={spinning ? 'ptr-rot motion-reduce:!animate-none' : ''}
      >
        <path d="M21 12a9 9 0 1 1-2.64-6.36" />
        <path d="M21 3v6h-6" />
      </svg>
    </button>
  )
}
