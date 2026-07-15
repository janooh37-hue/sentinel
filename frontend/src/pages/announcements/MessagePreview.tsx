/**
 * MessagePreview — live WhatsApp render of the outgoing broadcast.
 * PhonePreview: iPhone-14-proportioned framed phone (Normal view side column).
 * WebChatWindow: WhatsApp Web-style desktop chat surface (Extended view).
 * Colors come from the --wa-* tokens in index.css (light+dark).
 */
import { useTranslation } from 'react-i18next'
import { splitMentionParts } from './mention'

export interface PreviewAttachment { title: string; subtitle?: string }
export interface PreviewProps {
  groupName: string | null
  text: string
  mentionNames: string[]
  attachment: PreviewAttachment | null
}

function Bubble({ text, mentionNames, attachment }: Omit<PreviewProps, 'groupName'>): React.JSX.Element {
  const { t } = useTranslation()
  const parts = splitMentionParts(text, mentionNames)
  return (
    <div
      data-testid="preview-bubble"
      className="ms-auto w-fit max-w-[94%] rounded-lg rounded-ee-sm bg-[var(--wa-bubble)] px-2.5 py-1.5 text-[0.85em] text-[var(--wa-bubble-ink)] shadow-sm"
    >
      {attachment && (
        <div
          data-testid="preview-attachment"
          className="mb-1.5 flex items-center gap-2.5 rounded-md bg-black/5 p-2 dark:bg-white/10"
        >
          <span className="grid h-9 w-7 shrink-0 place-items-center rounded bg-surface text-[0.6em] font-extrabold text-accent">PDF</span>
          <span className="min-w-0">
            <span dir="auto" className="block truncate text-[0.9em] font-semibold">{attachment.title}</span>
            {attachment.subtitle && (
              <span dir="auto" className="block truncate text-[0.8em] text-[var(--wa-meta)]">{attachment.subtitle}</span>
            )}
          </span>
        </div>
      )}
      <span dir="auto" className="whitespace-pre-wrap break-words">
        {text.trim().length === 0 ? (
          <span className="opacity-50">{t('sendToGroup.preview.empty')}</span>
        ) : (
          parts.map((p, i) =>
            p.kind === 'mention' ? (
              <span key={i} className="wa-mention font-semibold text-[var(--wa-mention)]">{p.value}</span>
            ) : (
              <span key={i}>{p.value}</span>
            ),
          )
        )}
      </span>
      <span className="ms-2 inline-flex translate-y-0.5 items-center gap-0.5 text-[0.72em] text-[var(--wa-meta)]" aria-hidden>
        {new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })} ✓✓
      </span>
    </div>
  )
}

function ChatHeader({ groupName, desktop }: { groupName: string | null; desktop?: boolean }): React.JSX.Element {
  const { t } = useTranslation()
  return (
    <div className={
      desktop
        ? 'flex items-center gap-2.5 bg-[var(--wa-web-bar)] px-3.5 py-2.5 text-[var(--wa-web-ink)]'
        : 'flex items-center gap-2.5 bg-[var(--wa-header)] px-3.5 py-2.5 pt-7 text-white'
    }>
      <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-gradient-to-br from-[#25d366] to-[#128c4b] text-[0.75em] font-bold text-white" aria-hidden>
        {(groupName ?? '?').slice(0, 2).toUpperCase()}
      </span>
      <span dir="auto" className="truncate text-[0.85em] font-semibold">
        {groupName ?? t('sendToGroup.preview.noGroup')}
      </span>
    </div>
  )
}

function ChatBody(props: PreviewProps): React.JSX.Element {
  const { t } = useTranslation()
  return (
    <div className="flex min-h-0 flex-1 flex-col justify-end gap-2 overflow-hidden bg-[var(--wa-chat)] p-3">
      <span className="mx-auto rounded-md bg-surface/80 px-2.5 py-0.5 text-[0.68em] font-semibold text-muted-foreground shadow-sm">
        {t('sendToGroup.preview.today')}
      </span>
      <Bubble text={props.text} mentionNames={props.mentionNames} attachment={props.attachment} />
    </div>
  )
}

export function PhonePreview(props: PreviewProps): React.JSX.Element {
  // iPhone 14 screen proportions: 390x844 CSS pt (19.5:9), bezel + notch.
  return (
    <div className="relative mx-auto w-full max-w-[280px] rounded-[34px] bg-[#0b141a] p-2.5 shadow-xl">
      <span className="absolute start-1/2 top-2.5 z-10 h-5 w-[34%] -translate-x-1/2 rtl:translate-x-1/2 rounded-b-xl bg-[#0b141a]" aria-hidden />
      <div className="flex aspect-[390/844] flex-col overflow-hidden rounded-[24px]">
        <ChatHeader groupName={props.groupName} />
        <ChatBody {...props} />
      </div>
    </div>
  )
}

export function WebChatWindow(props: PreviewProps): React.JSX.Element {
  // WhatsApp Web / desktop-style: gray header, wide surface. Height comes from parent.
  return (
    <div className="flex h-full flex-col overflow-hidden rounded-t-xl border border-b-0 border-border">
      <ChatHeader groupName={props.groupName} desktop />
      <div className="[&>div>[data-testid=preview-bubble]]:max-w-[62%] flex min-h-0 flex-1 flex-col">
        <ChatBody {...props} />
      </div>
    </div>
  )
}
