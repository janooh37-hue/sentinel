import { useTranslation } from 'react-i18next'

/** Returned/rejected note: «» in Arabic, “” in English; the note itself is `<bdi>` so a note in the other script reads correctly. */
export function Quote({ text, className }: { text: string; className?: string }): React.JSX.Element {
  const { i18n } = useTranslation()
  const [open, close] = i18n.language.startsWith('ar') ? ['«', '»'] : ['“', '”']
  return (
    <span className={className}>
      {open}
      <bdi>{text}</bdi>
      {close}
    </span>
  )
}
