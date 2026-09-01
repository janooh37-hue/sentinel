import { useEffect, useId, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useIsMutating, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  AlertTriangle,
  Check,
  ChevronDown,
  Eye,
  EyeOff,
  LockKeyhole,
  Search,
  ShieldCheck,
} from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { Link, useSearchParams } from 'react-router-dom'
import { toast } from 'sonner'

import { AdvancedPermissionsPanel } from '@/components/access/AdvancedPermissionsPanel'
import { ServiceArtwork, type ServiceArtworkId } from '@/components/ui/service-artwork'
import { EmptyState } from '@/components/ui/empty-state'
import { Skeleton } from '@/components/ui/skeleton'
import {
  api,
  type AdminUserRead,
  type BookCategoryRead,
  type PermissionEffect,
  type PermissionRequestRead,
  type TemplateMeta,
  type UserPermissionRead,
} from '@/lib/api'
import { QUICK_ACTION_IDS, type QuickActionId } from '@/lib/dashboardLayout'
import { cn } from '@/lib/utils'
import { artworkForTemplate, emojiForTemplate } from '@/pages/application/formEmoji'

type BlueprintKind = 'page' | 'service' | 'category'

/**
 * A service is gated by a pair of capabilities: `books.service.<id>` decides
 * whether it can be created, `books.servicerecords.<id>` whether its records
 * stay readable. The three states are the only combinations worth offering.
 */
type ServiceAccessState = 'full' | 'records' | 'hidden'

const SERVICE_STATE_ORDER: readonly ServiceAccessState[] = ['full', 'records', 'hidden']

const SERVICE_STATE_KEY: Record<ServiceAccessState, string> = {
  full: 'svcFull',
  records: 'svcRecordsOnly',
  hidden: 'svcHidden',
}

// Selection is never hue-only: the active segment fills solid (luminance shift
// + AA-safe foreground) and carries a check glyph, per PRODUCT.md's WCAG rule.
const SERVICE_STATE_TONE: Record<ServiceAccessState, string> = {
  full: 'border-primary bg-primary text-primary-foreground',
  records: 'border-warning bg-warning text-warning-foreground',
  // text-background, not white: white on the dark accent (#ef4858) is ~3.7:1.
  hidden: 'border-accent bg-accent text-background',
}

// One legend explains all three states; every radiogroup describes itself with
// it, so screen-reader users reach the explanation from the control.
const SERVICE_LEGEND_ID = 'permissions-service-legend'

const SERVICE_CAPTION_KEY: Record<ServiceAccessState, string> = {
  full: 'svcFullCaption',
  records: 'svcRecordsOnlyCaption',
  hidden: 'svcHiddenCaption',
}

interface PageBlueprintItem {
  key: string
  capability: string | null
  locked?: boolean
}

interface BlueprintItem {
  id: string
  capability: string | null
  label: string
  kind: BlueprintKind
  locked?: boolean
  glyph?: string
  artwork?: ServiceArtworkId
}

interface Beam {
  x1: number
  y1: number
  x2: number
  y2: number
}

const PAGE_BLUEPRINT: readonly PageBlueprintItem[] = [
  { key: 'nav.dashboard', capability: null, locked: true },
  { key: 'nav.employees', capability: 'employees.view' },
  { key: 'nav.ledger', capability: 'ledger.view' },
  { key: 'nav.leaves', capability: 'leaves.view' },
  { key: 'nav.services', capability: 'documents.generate' },
  { key: 'nav.records', capability: 'books.view' },
  { key: 'nav.permits', capability: 'permits.view' },
  { key: 'access.permissions.pages.settings', capability: 'settings.view' },
  { key: 'access.permissions.pages.expiry', capability: 'expiry.view' },
]

const MIRROR_MOBILE_QUERY = '(max-width: 759px)'

const RECORD_CAPABILITIES_REQUIRING_VIEW = [
  'books.create',
  'books.edit',
  'books.approve',
  'books.submit',
  'books.delete',
  'books.override_state',
  'documents.generate',
] as const

function userLabel(user: AdminUserRead): string {
  return (user.display_name || user.name_en || user.email.split('@')[0]) ?? user.email
}

function initialsOf(user: AdminUserRead): string {
  const parts = userLabel(user).trim().split(/\s+/).filter(Boolean)
  return (parts[0]?.[0] ?? user.email[0] ?? '?') + (parts[1]?.[0] ?? '')
}

function roleTone(role: AdminUserRead['role']): string {
  if (role === 'admin') return 'bg-accent-soft text-accent'
  if (role === 'manager') return 'bg-info-soft text-info'
  return 'bg-surface-tinted text-muted-foreground'
}

function useMirrorMobile(): boolean {
  const [mobile, setMobile] = useState(
    () => typeof window !== 'undefined' && window.matchMedia(MIRROR_MOBILE_QUERY).matches,
  )
  useEffect(() => {
    const media = window.matchMedia(MIRROR_MOBILE_QUERY)
    const update = (): void => setMobile(media.matches)
    media.addEventListener('change', update)
    return () => media.removeEventListener('change', update)
  }, [])
  return mobile
}

function updatePermissionOptimistically(
  current: UserPermissionRead,
  capability: string,
  effect: PermissionEffect | null,
): UserPermissionRead {
  const effective = new Set(current.effective)
  const overrides = { ...current.overrides }
  if (effect === 'deny') {
    effective.delete(capability)
    overrides[capability] = 'deny'
  } else if (effect === 'grant') {
    effective.add(capability)
    overrides[capability] = 'grant'
  } else {
    delete overrides[capability]
    if (current.role_defaults.includes(capability)) effective.add(capability)
    else effective.delete(capability)
  }
  return { ...current, effective: [...effective], overrides }
}

function BlueprintButton({
  item,
  denied,
  saving,
  onFocus,
  onToggle,
}: {
  item: BlueprintItem
  denied: boolean
  saving: boolean
  onFocus: () => void
  onToggle: (event: React.MouseEvent<HTMLButtonElement>) => void
}): React.JSX.Element {
  const { t } = useTranslation()
  return (
    <button
      type="button"
      aria-disabled={Boolean(item.locked || saving)}
      aria-busy={saving}
      onMouseDown={(event) => {
        if (item.locked || saving) event.preventDefault()
      }}
      aria-pressed={!denied}
      onFocus={onFocus}
      onClick={(event) => {
        if (!item.locked && !saving) onToggle(event)
      }}
      className={cn(
        'group flex min-h-11 items-center gap-2 rounded-lg border px-3 py-2 text-center text-[0.82em] font-medium transition-[background-color,border-color,color] duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-surface motion-reduce:transition-none',
        denied
          ? 'border-accent/40 bg-accent-soft text-accent'
          : 'border-primary/70 bg-surface text-primary',
        item.locked && 'cursor-default border-primary/30 bg-primary-soft text-primary',
        saving && 'cursor-wait opacity-60',
      )}
    >
      {item.locked ? (
        <LockKeyhole className="h-3.5 w-3.5 shrink-0" strokeWidth={1.8} aria-hidden />
      ) : denied ? (
        <EyeOff className="h-3.5 w-3.5 shrink-0" strokeWidth={1.8} aria-hidden />
      ) : (
        <Eye className="h-3.5 w-3.5 shrink-0" strokeWidth={1.8} aria-hidden />
      )}
      {item.artwork ? (
        <ServiceArtwork artwork={item.artwork} size="row" />
      ) : item.glyph ? (
        <span aria-hidden>{item.glyph}</span>
      ) : null}
      <bdi className="min-w-0 flex-1 break-words whitespace-normal text-center leading-snug" dir="auto">
        {item.label}
      </bdi>
      {' '}
      <span className="sr-only">
        {item.locked
          ? t('access.permissions.mirror.always')
          : denied
            ? t('access.permissions.state.deny')
            : t('access.permissions.state.grant')}
      </span>
    </button>
  )
}

function ServiceTriState({
  item,
  state,
  saving,
  legendId,
  onFocus,
  onSelect,
}: {
  item: BlueprintItem
  state: ServiceAccessState
  saving: boolean
  legendId: string
  onFocus: () => void
  onSelect: (state: ServiceAccessState, event: React.MouseEvent<HTMLButtonElement>) => void
}): React.JSX.Element {
  const { t } = useTranslation()
  // Service ids contain spaces ("General Book"), which aria-labelledby would
  // read as a list of two ids — generate the label id instead.
  const nameId = useId()
  const groupRef = useRef<HTMLDivElement>(null)
  // Arrow keys walk the segments (mirrored in RTL); selection stays manual
  // because every choice is a write, not a local toggle.
  const moveFocus = (event: React.KeyboardEvent<HTMLDivElement>): void => {
    const radios = Array.from(
      groupRef.current?.querySelectorAll<HTMLButtonElement>('[role="radio"]') ?? [],
    )
    const index = radios.indexOf(document.activeElement as HTMLButtonElement)
    if (index === -1) return
    const rtl = getComputedStyle(event.currentTarget).direction === 'rtl'
    const step =
      event.key === 'ArrowDown'
        ? 1
        : event.key === 'ArrowUp'
          ? -1
          : event.key === 'ArrowRight'
            ? rtl
              ? -1
              : 1
            : event.key === 'ArrowLeft'
              ? rtl
                ? 1
                : -1
              : 0
    if (step === 0) return
    event.preventDefault()
    radios[(index + step + radios.length) % radios.length]?.focus()
  }
  return (
    <div className="rounded-lg border border-hairline bg-surface p-2">
      <div className="mb-1.5 flex min-h-8 items-center gap-2 px-1">
        {item.artwork ? (
          <ServiceArtwork artwork={item.artwork} size="row" />
        ) : item.glyph ? (
          <span aria-hidden>{item.glyph}</span>
        ) : null}
        <bdi
          id={nameId}
          className="min-w-0 flex-1 break-words whitespace-normal text-[0.8em] font-medium leading-snug text-foreground"
          dir="auto"
        >
          {item.label}
        </bdi>
      </div>
      <div
        ref={groupRef}
        role="radiogroup"
        aria-labelledby={nameId}
        aria-describedby={legendId}
        onKeyDown={moveFocus}
        className="grid grid-cols-3 gap-1"
      >
        {SERVICE_STATE_ORDER.map((option) => (
          <button
            key={option}
            type="button"
            role="radio"
            aria-checked={option === state}
            tabIndex={option === state ? 0 : -1}
            aria-disabled={saving}
            aria-busy={saving}
            onFocus={onFocus}
            onMouseDown={(event) => {
              if (saving) event.preventDefault()
            }}
            onClick={(event) => {
              if (!saving) onSelect(option, event)
            }}
            className={cn(
              'flex min-h-9 flex-col items-center justify-center gap-0.5 rounded-md border px-1 text-[0.68em] font-medium leading-tight transition-[background-color,border-color,color] duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-1 focus-visible:ring-offset-surface motion-reduce:transition-none',
              option === state
                ? SERVICE_STATE_TONE[option]
                : 'border-hairline bg-surface text-muted-foreground hover:bg-surface-tinted',
              saving && 'cursor-wait opacity-60',
            )}
          >
            {option === state ? (
              <Check className="h-3 w-3 shrink-0" strokeWidth={2.5} aria-hidden />
            ) : null}
            {t(`access.permissions.mirror.${SERVICE_STATE_KEY[option]}`)}
          </button>
        ))}
      </div>
    </div>
  )
}

function MirrorDevice({
  user,
  roleLabel,
  hiddenCount,
  pages,
  services,
  categories,
  showCreation,
  showRecords,
  expanded,
  mobile,
  onExpandedChange,
}: {
  user: AdminUserRead
  roleLabel: string
  hiddenCount: number
  pages: BlueprintItem[]
  services: BlueprintItem[]
  categories: BlueprintItem[]
  showCreation: boolean
  showRecords: boolean
  expanded: boolean
  mobile: boolean
  onExpandedChange: (expanded: boolean) => void
}): React.JSX.Element {
  const { t } = useTranslation()
  const content = (
    <aside
      data-testid="mirror-device"
      aria-label={t('access.permissions.mirror.viewingAs', { name: userLabel(user) })}
      className={cn(
        'mirror-device flex flex-col rounded-[1.9rem] bg-primary p-2 text-primary-foreground shadow-xl min-[900px]:sticky min-[900px]:top-4 min-[900px]:self-start',
        mobile &&
          'fixed inset-x-3 z-[45] max-h-[min(68vh,620px)] shadow-2xl [bottom:calc(4.875rem+env(safe-area-inset-bottom))]',
      )}
    >
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-[1.4rem] bg-primary text-primary-foreground">
      {mobile ? (
        <button
          type="button"
          className="flex min-h-12 w-full items-center gap-3 border-b border-primary-foreground/15 px-4 py-2 text-start focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary-foreground"
          aria-expanded={expanded}
          aria-controls="mirror-device-screen"
          onClick={() => onExpandedChange(!expanded)}
        >
          <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-primary-foreground/10 text-[0.78em] font-bold">
            {initialsOf(user)}
          </span>
          <span className="min-w-0 flex-1">
            <bdi className="block truncate text-[0.82em] font-semibold" dir="auto">
              {t('access.permissions.mirror.viewingAs', { name: userLabel(user) })}
            </bdi>
            <span className="block text-[0.7em] text-primary-foreground">
              {roleLabel} · {t('access.permissions.mirror.hiddenCount', { count: hiddenCount })}
            </span>
          </span>
          <ChevronDown
            className={cn(
              'h-4 w-4 transition-transform motion-reduce:transition-none',
              expanded && 'rotate-180',
            )}
            strokeWidth={1.8}
            aria-hidden
          />
        </button>
      ) : (
        <div className="flex items-center gap-3 border-b border-primary-foreground/15 px-5 py-4">
          <span className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-primary-foreground/10 text-sm font-bold">
            {initialsOf(user)}
          </span>
          <span className="min-w-0">
            <bdi className="block truncate text-[0.86em] font-semibold" dir="auto">
              {t('access.permissions.mirror.viewingAs', { name: userLabel(user) })}
            </bdi>
            <span className="block text-[0.72em] text-primary-foreground">
              {roleLabel} · {t('access.permissions.mirror.hiddenCount', { count: hiddenCount })}
            </span>
          </span>
        </div>
      )}

      {!mobile || expanded ? (
        <div
          id="mirror-device-screen"
          className={cn(
            'max-h-[calc(100dvh-8rem)] space-y-5 overflow-y-auto p-4',
            mobile && 'min-h-0 flex-1',
          )}
        >
          <section data-mirror-region="page">
            <h3 className="mb-2 text-[0.68em] font-semibold uppercase tracking-[0.08em] text-primary-foreground">
              {t('access.permissions.mirror.blueprintPages')}
            </h3>
            <div className="flex flex-wrap gap-1.5">
              {pages.map((page) => (
                <span key={page.id} className="rounded-md bg-primary-foreground/10 px-2 py-1 text-[0.68em]">
                  {page.label}
                </span>
              ))}
            </div>
          </section>

          {showCreation ? (
            <section data-mirror-region="service">
              <div className="mb-2 flex items-center justify-between gap-3 text-[0.68em] font-semibold uppercase tracking-[0.08em] text-primary-foreground">
                <h3>{t('access.permissions.mirror.blueprintServices')}</h3>
                <span>{t('access.permissions.mirror.availableCount', { count: services.length })}</span>
              </div>
              {services.length === 0 ? (
                <p className="text-[0.7em] text-primary-foreground">
                  {t('access.permissions.mirror.nothingVisible')}
                </p>
              ) : (
                <div className="grid grid-cols-2 gap-2">
                  {services.map((service) => (
                    <span
                      key={service.id}
                      className="rounded-lg border border-primary-foreground/10 bg-primary-foreground/10 px-2.5 py-2 text-[0.7em]"
                    >
                      {service.artwork ? (
                        <ServiceArtwork
                          artwork={service.artwork}
                          size="inline"
                          className="me-1 align-text-bottom"
                        />
                      ) : (
                        <span className="me-1" aria-hidden>{service.glyph}</span>
                      )}
                      <bdi dir="auto">{service.label}</bdi>
                    </span>
                  ))}
                </div>
              )}
            </section>
          ) : null}

          {showRecords ? (
            <section data-mirror-region="category">
              <h3 className="mb-2 text-[0.68em] font-semibold uppercase tracking-[0.08em] text-primary-foreground">
                {t('access.permissions.mirror.blueprintCategories')}
              </h3>
              {categories.length === 0 ? (
                <p className="text-[0.7em] text-primary-foreground">
                  {t('access.permissions.mirror.nothingVisible')}
                </p>
              ) : (
                <div className="flex flex-wrap gap-1.5">
                  {categories.map((category) => (
                    <span key={category.id} className="rounded-full border border-primary-foreground/15 px-2.5 py-1 text-[0.68em]">
                      <bdi dir="auto">{category.label}</bdi>
                    </span>
                  ))}
                </div>
              )}
            </section>
          ) : null}

          {showCreation ? (
            <section>
              <h3 className="mb-2 text-[0.68em] font-semibold uppercase tracking-[0.08em] text-primary-foreground">
                {t('access.permissions.mirror.quickActions')}
              </h3>
              {services.length === 0 ? (
                <p className="text-[0.7em] text-primary-foreground">
                  {t('access.permissions.mirror.nothingVisible')}
                </p>
              ) : (
                <div className="grid grid-cols-3 gap-1.5">
                  {services.slice(0, 6).map((service) => (
                    <span key={service.id} className="rounded-md bg-primary-foreground/10 px-2 py-1.5 text-center text-[0.64em]">
                      {service.artwork ? (
                        <ServiceArtwork
                          artwork={service.artwork}
                          size="row"
                          className="mx-auto mb-0.5"
                        />
                      ) : (
                        <span className="block text-base" aria-hidden>{service.glyph}</span>
                      )}
                      <bdi dir="auto">{service.label}</bdi>
                    </span>
                  ))}
                </div>
              )}
            </section>
          ) : null}
        </div>
      ) : null}
      </div>
    </aside>
  )

  if (!mobile) return content
  return createPortal(
    <div dir={document.documentElement.dir || 'ltr'} data-print-hide>
      {content}
    </div>,
    document.body,
  )
}

function RequestStrip({
  requests,
  decidingId,
  onDecide,
}: {
  requests: PermissionRequestRead[]
  decidingId: number | null
  onDecide: (id: number, userId: number, decision: 'permanent' | 'refused') => void
}): React.JSX.Element | null {
  const { t, i18n } = useTranslation()
  if (requests.length === 0) return null
  const formatter = new Intl.DateTimeFormat(i18n.language, {
    dateStyle: 'medium',
    timeStyle: 'short',
  })
  return (
    <div className="border-t border-warning/25 bg-warning-soft px-4 py-3 text-foreground">
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <strong className="text-[0.82em]">{t('access.permissions.mirror.requestedAccess')}</strong>
        <Link
          to="/access-requests?tab=permission-requests"
          className="inline-flex min-h-11 items-center rounded-sm px-2 text-[0.72em] font-medium text-warning underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          {t('access.permReq.tab')}
        </Link>
      </div>
      <div className="space-y-2">
        {requests.map((request) => (
          <div key={request.id} className="flex flex-col gap-2 rounded-lg bg-surface/70 p-3 sm:flex-row sm:items-center">
            <span className="min-w-0 flex-1">
              <bdi className="block text-[0.82em] font-semibold" dir="auto">
                {t(`access.permissions.caps.${request.capability}`, {
                  defaultValue: request.capability_label,
                })}
              </bdi>
              <span className="block font-mono text-[0.68em] text-muted-foreground">
                {formatter.format(new Date(request.created_at))}
              </span>
            </span>
            <span className="flex gap-2">
              <button
                type="button"
                disabled={decidingId !== null}
                onClick={() => onDecide(request.id, request.user_id, 'permanent')}
                className="min-h-11 rounded-full bg-primary px-4 text-[0.78em] font-semibold text-primary-foreground hover:bg-primary-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50"
              >
                {t('access.permissions.mirror.approve')}
              </button>
              <button
                type="button"
                disabled={decidingId !== null}
                onClick={() => onDecide(request.id, request.user_id, 'refused')}
                className="min-h-11 rounded-full border border-accent/30 bg-surface px-4 text-[0.78em] font-semibold text-accent hover:bg-accent-soft focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50"
              >
                {t('access.permissions.mirror.refuse')}
              </button>
            </span>
          </div>
        ))}
      </div>
    </div>
  )
}

export function PermissionsPage(): React.JSX.Element {
  const { t, i18n } = useTranslation()
  const queryClient = useQueryClient()
  const [searchParams, setSearchParams] = useSearchParams()
  const requestedUserParam = searchParams.get('user')
  const requestedUserId = requestedUserParam === null ? null : Number(requestedUserParam)
  const [captionItem, setCaptionItem] = useState<BlueprintItem | null>(null)
  const [mirrorExpanded, setMirrorExpanded] = useState(false)
  const [previewOpen, setPreviewOpen] = useState(false)
  const [peopleOpen, setPeopleOpen] = useState(true)
  const [peopleQuery, setPeopleQuery] = useState('')
  const [decidingId, setDecidingId] = useState<number | null>(null)
  const [beam, setBeam] = useState<Beam | null>(null)
  const workspaceRef = useRef<HTMLElement>(null)
  const beamTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const mobile = useMirrorMobile()
  const isAr = i18n.language.startsWith('ar')

  const usersQuery = useQuery({ queryKey: ['auth-users'], queryFn: api.listAuthUsers })
  const capabilitiesQuery = useQuery({
    queryKey: ['capabilities'],
    queryFn: api.listCapabilities,
  })
  const templatesQuery = useQuery({
    queryKey: ['templates'],
    queryFn: api.listTemplates,
    staleTime: Infinity,
  })
  const categoriesQuery = useQuery({
    queryKey: ['book-categories'],
    queryFn: api.listBookCategories,
  })
  const requestsQuery = useQuery({
    queryKey: ['permission-requests'],
    queryFn: api.listPermissionRequests,
  })

  const users = useMemo(
    () => (usersQuery.data ?? []).filter((user) => user.status === 'active'),
    [usersQuery.data],
  )
  // The rail filter narrows who is listed, never who is being edited: the
  // selection lives in `?user=` so a filtered-out person keeps their workspace.
  const filteredUsers = useMemo(() => {
    const needle = peopleQuery.trim().toLowerCase()
    if (!needle) return users
    return users.filter((user) => userLabel(user).toLowerCase().includes(needle))
  }, [peopleQuery, users])
  const selectedUser =
    requestedUserId === null
      ? (users.find((user) => user.role !== 'admin') ?? null)
      : (users.find(
          (user) => user.id === requestedUserId && user.role !== 'admin',
        ) ?? null)
  const requestedAdmin =
    requestedUserId !== null &&
    users.some((user) => user.id === requestedUserId && user.role === 'admin')
  const requestedUserMissing =
    requestedUserParam !== null &&
    (usersQuery.data ?? []).length > 0 &&
    selectedUser == null &&
    !requestedAdmin
  const selectedId = selectedUser?.id ?? null
  const permissionWritesPending =
    useIsMutating({ mutationKey: ['user-permission-write', selectedId] }) > 0

  const permissionsQuery = useQuery({
    queryKey: ['user-permissions', selectedUser?.id],
    queryFn: () => api.getUserPermissions(selectedUser!.id),
    enabled: selectedUser != null,
  })
  const permissions = permissionsQuery.data
  const effective = useMemo(() => new Set(permissions?.effective ?? []), [permissions?.effective])

  const templatesById = useMemo(() => {
    const byId: Record<string, TemplateMeta> = {}
    for (const template of templatesQuery.data?.items ?? []) byId[template.id] = template
    return byId
  }, [templatesQuery.data?.items])

  const pageItems = useMemo<BlueprintItem[]>(
    () =>
      PAGE_BLUEPRINT.map((page) => ({
        id: page.capability ?? 'dashboard',
        capability: page.capability,
        label: t(page.key),
        kind: 'page',
        locked: page.locked,
      })),
    [t],
  )
  const serviceItems = useMemo<BlueprintItem[]>(
    () => [
      ...QUICK_ACTION_IDS.map((id: QuickActionId) => {
        const template = templatesById[id]
        return {
          id,
          capability: `books.service.${id}`,
          label: (isAr ? template?.name_ar : template?.name_en) || id,
          kind: 'service' as const,
          glyph: emojiForTemplate(id),
          artwork: artworkForTemplate(id),
        }
      }),
      {
        id: 'other',
        capability: 'books.service.other',
        label: t('access.permissions.mirror.serviceOther'),
        kind: 'service',
      },
    ],
    [isAr, t, templatesById],
  )
  const categoryItems = useMemo<BlueprintItem[]>(
    () =>
      (categoriesQuery.data ?? []).map((category: BookCategoryRead) => ({
        id: category.id,
        capability: `books.category.${category.id}`,
        label: (isAr ? category.name_ar : category.name_en) || category.id,
        kind: 'category',
      })),
    [categoriesQuery.data, isAr],
  )

  // Records visibility is the stronger gate: without it the service is gone
  // from Records too, so a stray create-allowed/records-denied pair reads as
  // Hidden until the next choice rewrites the canonical pair.
  const serviceStates = useMemo(() => {
    const states: Record<string, ServiceAccessState> = {}
    for (const item of serviceItems) {
      const recordsDenied = !effective.has(`books.servicerecords.${item.id}`)
      const createDenied = item.capability == null || !effective.has(item.capability)
      states[item.id] = recordsDenied ? 'hidden' : createDenied ? 'records' : 'full'
    }
    return states
  }, [effective, serviceItems])

  const editableItems = useMemo(
    () => [...pageItems.filter((item) => !item.locked), ...serviceItems, ...categoryItems],
    [categoryItems, pageItems, serviceItems],
  )
  const hiddenCount = permissions
    ? editableItems.reduce(
        (count, item) => count + (item.capability && !effective.has(item.capability) ? 1 : 0),
        0,
      )
    : 0
  const canViewRecords = effective.has('books.view')
  const canCreateRecords = canViewRecords && effective.has('documents.generate')
  const showViewPrereqWarning =
    !canViewRecords &&
    RECORD_CAPABILITIES_REQUIRING_VIEW.some((capability) => effective.has(capability))
  const visiblePages = pageItems.filter(
    (item) => item.locked || (item.capability != null && effective.has(item.capability)),
  )
  const visibleServices = canCreateRecords
    ? serviceItems.filter(
        (item) =>
          item.id !== 'other' && item.capability != null && effective.has(item.capability),
      )
    : []
  const visibleCategories = canViewRecords
    ? categoryItems.filter(
        (item) => item.capability != null && effective.has(item.capability),
      )
    : []
  const selectedRequests = (requestsQuery.data ?? []).filter(
    (request) => request.user_id === selectedUser?.id && request.status === 'pending',
  )

  const toggleMutation = useMutation({
    mutationKey: ['user-permission-write', selectedId],
    scope: { id: `user-permission-write:${selectedId ?? 'none'}` },
    mutationFn: ({
      userId,
      capability,
      effect,
    }: {
      userId: number
      capability: string
      effect: PermissionEffect | null
    }) => api.setUserPermission(userId, capability, effect),
    onMutate: async ({ userId, capability, effect }) => {
      const queryKey = ['user-permissions', userId] as const
      await queryClient.cancelQueries({ queryKey })
      const previous = queryClient.getQueryData<UserPermissionRead>(queryKey)
      if (previous) {
        queryClient.setQueryData(queryKey, updatePermissionOptimistically(previous, capability, effect))
      }
      return { previous, queryKey }
    },
    onError: (_error, _variables, context) => {
      if (context?.previous) queryClient.setQueryData(context.queryKey, context.previous)
      toast.error(t('access.permissions.saveError'))
    },
    onSuccess: (data, variables) => {
      queryClient.setQueryData(['user-permissions', variables.userId], data)
    },
  })

  const serviceTriMutation = useMutation({
    mutationKey: ['user-permission-write', selectedId],
    scope: { id: `user-permission-write:${selectedId ?? 'none'}` },
    mutationFn: ({
      userId,
      items,
    }: {
      userId: number
      items: Array<{ capability: string; effect: PermissionEffect | null }>
    }) => api.setUserPermissionsBulk(userId, items),
    onMutate: async ({ userId, items }) => {
      const queryKey = ['user-permissions', userId] as const
      await queryClient.cancelQueries({ queryKey })
      const previous = queryClient.getQueryData<UserPermissionRead>(queryKey)
      if (previous) {
        let next = previous
        for (const item of items) {
          next = updatePermissionOptimistically(next, item.capability, item.effect)
        }
        queryClient.setQueryData(queryKey, next)
      }
      return { previous, queryKey }
    },
    onError: (_error, _variables, context) => {
      if (context?.previous) queryClient.setQueryData(context.queryKey, context.previous)
      toast.error(t('access.permissions.saveError'))
    },
    onSuccess: (data, variables) => {
      queryClient.setQueryData(['user-permissions', variables.userId], data)
    },
  })

  const decideMutation = useMutation({
    mutationFn: ({
      id,
      decision,
    }: {
      id: number
      userId: number
      decision: 'permanent' | 'refused'
    }) => api.decidePermissionRequest(id, { decision }),
    onMutate: ({ id }) => setDecidingId(id),
    onError: () => toast.error(t('access.permissions.saveError')),
    onSettled: (_data, _error, variables) => {
      setDecidingId(null)
      void queryClient.invalidateQueries({ queryKey: ['permission-requests'] })
      void queryClient.invalidateQueries({
        queryKey: ['user-permissions', variables.userId],
      })
    },
  })

  useEffect(
    () => () => {
      clearTimeout(beamTimer.current ?? undefined)
    },
    [],
  )

  const flashBeam = (source: HTMLButtonElement, kind: BlueprintKind): void => {
    if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return
    const workspace = workspaceRef.current
    const target = workspace?.querySelector<HTMLElement>(`[data-mirror-region="${kind}"]`)
    if (!workspace || !target) return
    const rootRect = workspace.getBoundingClientRect()
    const sourceRect = source.getBoundingClientRect()
    const targetRect = target.getBoundingClientRect()
    setBeam({
      x1: sourceRect.left + sourceRect.width / 2 - rootRect.left,
      y1: sourceRect.top + sourceRect.height / 2 - rootRect.top,
      x2: targetRect.left + targetRect.width / 2 - rootRect.left,
      y2: targetRect.top + targetRect.height / 2 - rootRect.top,
    })
    clearTimeout(beamTimer.current ?? undefined)
    beamTimer.current = setTimeout(() => setBeam(null), 300)
  }

  const toggleItem = (
    item: BlueprintItem,
    event: React.MouseEvent<HTMLButtonElement>,
  ): void => {
    setCaptionItem(item)
    if (!permissions || !selectedUser || !item.capability || item.locked) return
    flashBeam(event.currentTarget, item.kind)
    const denied = !effective.has(item.capability)
    const effect: PermissionEffect | null = denied
      ? permissions.overrides[item.capability] === 'deny'
        ? null
        : 'grant'
      : 'deny'
    toggleMutation.mutate({ userId: selectedUser.id, capability: item.capability, effect })
  }

  // One atomic write per choice: creation first, records second, so a partial
  // failure can never leave the person with records they cannot reach.
  const selectServiceState = (
    item: BlueprintItem,
    next: ServiceAccessState,
    event: React.MouseEvent<HTMLButtonElement>,
  ): void => {
    setCaptionItem(item)
    if (!permissions || !selectedUser || !item.capability) return
    flashBeam(event.currentTarget, item.kind)
    serviceTriMutation.mutate({
      userId: selectedUser.id,
      items: [
        { capability: item.capability, effect: next === 'full' ? null : 'deny' },
        {
          capability: `books.servicerecords.${item.id}`,
          effect: next === 'hidden' ? 'deny' : null,
        },
      ],
    })
  }

  const caption = (() => {
    if (!captionItem || !permissions) return t('access.permissions.mirror.hint')
    if (captionItem.locked) return t('access.permissions.mirror.always')
    if (!captionItem.capability) return t('access.permissions.mirror.always')
    if (captionItem.kind === 'service') {
      const state = serviceStates[captionItem.id] ?? 'full'
      return t(`access.permissions.mirror.${SERVICE_CAPTION_KEY[state]}`, {
        name: captionItem.label,
      })
    }
    const denied = !effective.has(captionItem.capability)
    if (denied && captionItem.capability === 'books.view') {
      return t('access.permissions.mirror.consequenceRecords')
    }
    if (denied && captionItem.kind === 'category') {
      return t('access.permissions.mirror.consequence')
    }
    if (denied) return t('access.permissions.mirror.deniedForUser')
    if (permissions.overrides[captionItem.capability] === 'grant') {
      return t('access.permissions.mirror.explicitGrant')
    }
    return t('access.permissions.mirror.roleCaption', {
      role: t(`access.roleName.${permissions.role}`),
    })
  })()

  const selectUser = (user: AdminUserRead): void => {
    if (user.role === 'admin') return
    setCaptionItem(null)
    setSearchParams({ user: String(user.id) }, { replace: true })
  }

  if (usersQuery.isLoading) {
    return (
      <div className="flex flex-1 flex-col overflow-auto bg-background p-6">
        <Skeleton className="mx-auto h-10 w-full max-w-[1680px]" />
        <Skeleton className="mx-auto mt-5 h-[520px] w-full max-w-[1680px] rounded-2xl" />
      </div>
    )
  }

  if (usersQuery.isError) {
    return (
      <div className="flex flex-1 items-center justify-center bg-background p-8">
        <EmptyState message={t('access.permissions.loadError')} />
      </div>
    )
  }

  return (
    <div className="flex flex-1 flex-col overflow-auto bg-background">
      <div className="mx-auto w-full max-w-[1680px] flex-1 px-4 pb-24 pt-5 sm:px-8 sm:pb-12">
        <header className="mb-5">
          <h1 className="text-[1.7em] font-bold tracking-tight text-foreground">
            {t('access.permissions.mirror.title')}
          </h1>
          <p className="mt-1 max-w-[72ch] text-[0.86em] leading-relaxed text-muted-foreground">
            {t('access.permissions.mirror.help')}
          </p>
        </header>
        <div className="grid grid-cols-1 gap-4 min-[1100px]:gap-6 min-[1100px]:[grid-template-columns:280px_minmax(0,1fr)_360px]">
          <aside
            aria-label={t('access.permissions.mirror.people')}
            className="rounded-2xl border border-hairline bg-surface p-3 min-[1100px]:sticky min-[1100px]:top-4 min-[1100px]:self-start"
          >
            <div className="flex items-center justify-between gap-2">
              <h2 className="text-[0.7em] font-semibold uppercase tracking-[0.08em] rtl:tracking-normal text-muted-foreground">
                {t('access.permissions.mirror.people')}
              </h2>
              <button
                type="button"
                aria-label={t('access.permissions.mirror.people')}
                aria-expanded={peopleOpen}
                aria-controls="permissions-people-list"
                onClick={() => setPeopleOpen((value) => !value)}
                className="grid h-9 w-9 shrink-0 place-items-center rounded-lg text-muted-foreground transition-colors hover:bg-surface-tinted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring min-[1100px]:hidden"
              >
                <ChevronDown
                  className={cn(
                    'h-4 w-4 transition-transform motion-reduce:transition-none',
                    peopleOpen && 'rotate-180',
                  )}
                  strokeWidth={1.8}
                  aria-hidden
                />
              </button>
            </div>

            <div
              id="permissions-people-list"
              className={cn('mt-2.5', !peopleOpen && 'hidden min-[1100px]:block')}
            >
              <div className="flex min-h-11 items-center gap-2 rounded-lg border border-border bg-surface px-2.5 focus-within:border-primary focus-within:ring-2 focus-within:ring-primary/10">
                <Search
                  className="h-4 w-4 shrink-0 text-muted-foreground"
                  strokeWidth={1.8}
                  aria-hidden
                />
                <input
                  value={peopleQuery}
                  onChange={(event) => setPeopleQuery(event.target.value)}
                  placeholder={t('access.permissions.mirror.searchPeople')}
                  aria-label={t('access.permissions.mirror.searchPeople')}
                  className="min-w-0 flex-1 bg-transparent text-[0.82em] outline-none placeholder:text-muted-foreground"
                />
              </div>

              {filteredUsers.length === 0 ? (
                <p role="status" className="px-1 py-4 text-[0.78em] text-muted-foreground">
                  {t('common.noResults')}
                </p>
              ) : (
                <div
                  role="group"
                  aria-label={t('access.permissions.mirror.pickUser')}
                  className="mt-2 flex flex-col gap-1 min-[1100px]:max-h-[min(60vh,32rem)] min-[1100px]:overflow-y-auto min-[1100px]:[scrollbar-width:thin]"
                >
                  {filteredUsers.map((user) => {
                    const selected = user.id === selectedUser?.id
                    const adminUser = user.role === 'admin'
                    return (
                      <button
                        key={user.id}
                        type="button"
                        disabled={adminUser}
                        onClick={() => selectUser(user)}
                        aria-pressed={selected}
                        title={adminUser ? t('access.permissions.mirror.adminNote') : undefined}
                        className={cn(
                          'flex min-h-12 w-full items-center gap-2.5 rounded-xl border px-2.5 py-2 text-start transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                          selected
                            ? 'border-primary bg-primary-soft'
                            : 'border-transparent hover:border-border hover:bg-surface-tinted',
                          adminUser && 'cursor-not-allowed opacity-60',
                        )}
                      >
                        <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-primary text-[0.72em] font-bold text-primary-foreground">
                          {initialsOf(user)}
                        </span>
                        <span className="min-w-0 flex-1">
                          <bdi
                            className="block truncate text-[0.82em] font-semibold text-foreground"
                            dir="auto"
                          >
                            {userLabel(user)}
                          </bdi>
                          <span
                            className={cn(
                              'mt-0.5 inline-flex rounded-full px-2 py-0.5 text-[0.62em] font-semibold',
                              roleTone(user.role),
                            )}
                          >
                            {t(`access.roleName.${user.role}`)}
                          </span>
                          {adminUser ? (
                            <span className="ms-1 text-[0.62em] text-muted-foreground">
                              {t('access.permissions.mirror.adminNote')}
                            </span>
                          ) : null}
                        </span>
                      </button>
                    )
                  })}
                </div>
              )}

              <p className="mt-2.5 border-t border-hairline pt-2.5 text-[0.7em] text-muted-foreground">
                {t('access.permissions.mirror.peopleCount', { count: users.length })}
              </p>
            </div>
          </aside>

          <div className="min-w-0">
            {!selectedUser ? (
              requestedAdmin ? (
                <EmptyState
                  icon={ShieldCheck}
                  message={t('access.permissions.mirror.adminNote')}
                />
              ) : requestedUserMissing ? (
                <div className="flex flex-col items-center gap-3">
                  <EmptyState
                    icon={ShieldCheck}
                    message={t('access.permissions.mirror.userNotFound')}
                  />
                  <Link
                    to="/access-requests"
                    className="inline-flex min-h-11 items-center rounded-full border border-hairline bg-surface px-4 text-[0.82em] font-medium text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    {t('access.title')}
                  </Link>
                </div>
              ) : (
                <EmptyState icon={ShieldCheck} message={t('access.permissions.empty')} />
              )
            ) : permissionsQuery.isError ||
              capabilitiesQuery.isError ||
              categoriesQuery.isError ? (
              <EmptyState message={t('access.permissions.loadError')} />
            ) : permissionsQuery.isLoading || !permissions ? (
              <Skeleton className="h-[520px] w-full rounded-2xl" />
            ) : (
              <>
                <section
                  ref={workspaceRef}
                  className="relative overflow-hidden rounded-2xl border border-hairline bg-surface shadow-sm"
                >
                  <div className="flex flex-col gap-3 border-b border-hairline px-5 py-3 sm:flex-row sm:items-center sm:justify-between">
                    <div className="flex min-w-0 items-center gap-2.5">
                      <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-primary text-[0.74em] font-bold text-primary-foreground">
                        {initialsOf(selectedUser)}
                      </span>
                      <span className="min-w-0">
                        <bdi
                          className="block truncate text-[0.84em] font-semibold text-foreground"
                          dir="auto"
                        >
                          {userLabel(selectedUser)}
                        </bdi>
                        <span
                          className={cn(
                            'mt-0.5 inline-flex rounded-full px-2 py-0.5 text-[0.62em] font-semibold',
                            roleTone(selectedUser.role),
                          )}
                        >
                          {t(`access.roleName.${selectedUser.role}`)}
                        </span>
                      </span>
                    </div>
                    {showViewPrereqWarning ? (
                      <div
                        role="note"
                        className="flex min-w-0 items-start gap-2 rounded-lg border border-warning/30 bg-warning-soft px-3 py-2 text-start text-[0.78em] leading-relaxed text-foreground"
                      >
                        <AlertTriangle
                          className="mt-0.5 h-4 w-4 shrink-0 text-warning"
                          strokeWidth={1.8}
                          aria-hidden
                        />
                        <span className="min-w-0">
                          {t('access.permissions.mirror.viewPrereqWarning')}
                        </span>
                      </div>
                    ) : null}
                    <span
                      className={cn(
                        'shrink-0 self-start rounded-full px-3 py-1.5 text-[0.72em] sm:self-auto',
                        hiddenCount > 0
                          ? 'bg-accent-soft text-accent'
                          : 'bg-surface-tinted text-muted-foreground',
                      )}
                    >
                      <strong className="font-mono">{hiddenCount}</strong>{' '}
                      {t('access.permissions.mirror.hiddenLabel', { count: hiddenCount })}
                    </span>
                  </div>

                  <div className="p-4">
                    <section
                      aria-label={t('access.permissions.mirror.blueprintLabel')}
                      className="overflow-hidden rounded-xl border-[1.5px] border-primary bg-surface text-foreground"
                    >
                      <div className="space-y-5 p-4 sm:p-5">
                        <div>
                          <h3 className="mb-2 text-[0.7em] font-semibold uppercase tracking-[0.08em] rtl:tracking-normal text-primary">
                            {t('access.permissions.mirror.blueprintPages')}
                          </h3>
                          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                            {pageItems.map((item) => (
                              <BlueprintButton
                                key={item.id}
                                item={item}
                                denied={item.capability != null && !effective.has(item.capability)}
                                saving={permissionWritesPending}
                                onFocus={() => setCaptionItem(item)}
                                onToggle={(event) => toggleItem(item, event)}
                              />
                            ))}
                          </div>
                        </div>

                        <div>
                          <h3 className="mb-2 text-[0.7em] font-semibold uppercase tracking-[0.08em] rtl:tracking-normal text-primary">
                            {t('access.permissions.mirror.blueprintServices')}
                          </h3>
                          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 xl:grid-cols-3">
                            {serviceItems.map((item) => (
                              <ServiceTriState
                                key={item.id}
                                item={item}
                                state={serviceStates[item.id] ?? 'full'}
                                legendId={SERVICE_LEGEND_ID}
                                saving={permissionWritesPending}
                                onFocus={() => setCaptionItem(item)}
                                onSelect={(next, event) => selectServiceState(item, next, event)}
                              />
                            ))}
                          </div>
                          <p
                            id={SERVICE_LEGEND_ID}
                            className="mt-2 text-[0.72em] leading-relaxed text-muted-foreground"
                          >
                            {t('access.permissions.mirror.svcLegend')}
                          </p>
                        </div>

                        <div>
                          <h3 className="mb-2 text-[0.7em] font-semibold uppercase tracking-[0.08em] rtl:tracking-normal text-primary">
                            {t('access.permissions.mirror.blueprintCategories')}
                          </h3>
                          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                            {categoryItems.map((item) => (
                              <BlueprintButton
                                key={item.id}
                                item={item}
                                denied={item.capability != null && !effective.has(item.capability)}
                                saving={permissionWritesPending}
                                onFocus={() => setCaptionItem(item)}
                                onToggle={(event) => toggleItem(item, event)}
                              />
                            ))}
                          </div>
                        </div>
                      </div>

                      <RequestStrip
                        requests={selectedRequests}
                        decidingId={decidingId}
                        onDecide={(id, userId, decision) =>
                          decideMutation.mutate({ id, userId, decision })
                        }
                      />
                      <div
                        aria-live="polite"
                        className="border-t border-primary/15 bg-primary-soft px-4 py-3 text-[0.74em] leading-relaxed text-foreground"
                      >
                        {caption}
                      </div>
                    </section>
                  </div>

                  {!mobile ? (
                    <div className="border-t border-hairline px-4 py-3">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <span className="inline-flex min-w-0 items-center gap-2 text-[0.74em] text-muted-foreground">
                          <Eye className="h-4 w-4 shrink-0" strokeWidth={1.7} aria-hidden />
                          <bdi className="truncate" dir="auto">
                            {t('access.permissions.mirror.viewingAs', {
                              name: userLabel(selectedUser),
                            })}
                          </bdi>
                        </span>
                        <button
                          type="button"
                          aria-expanded={previewOpen}
                          aria-controls="permissions-mirror-preview"
                          onClick={() => setPreviewOpen((value) => !value)}
                          className="inline-flex min-h-9 shrink-0 items-center rounded-full border border-hairline bg-surface-tinted px-3.5 text-[0.74em] font-medium text-primary transition-colors hover:bg-primary-soft focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                        >
                          {previewOpen
                            ? t('access.permissions.mirror.closePreview')
                            : t('access.permissions.mirror.openPreview')}
                        </button>
                      </div>

                      {previewOpen ? (
                        <div id="permissions-mirror-preview" className="mt-3">
                          <MirrorDevice
                            user={selectedUser}
                            roleLabel={t(`access.roleName.${selectedUser.role}`)}
                            hiddenCount={hiddenCount}
                            pages={visiblePages}
                            services={visibleServices}
                            categories={visibleCategories}
                            showCreation={canCreateRecords}
                            showRecords={canViewRecords}
                            expanded
                            mobile={false}
                            onExpandedChange={() => {}}
                          />
                        </div>
                      ) : null}
                    </div>
                  ) : null}

                  {beam ? (
                    <svg
                      className="pointer-events-none absolute inset-0 z-20 h-full w-full text-accent"
                      aria-hidden
                    >
                      <line
                        x1={beam.x1}
                        y1={beam.y1}
                        x2={beam.x2}
                        y2={beam.y2}
                        stroke="currentColor"
                        strokeWidth="2"
                        strokeDasharray="5 5"
                      />
                    </svg>
                  ) : null}
                </section>

                {mobile ? (
                  <MirrorDevice
                    user={selectedUser}
                    roleLabel={t(`access.roleName.${selectedUser.role}`)}
                    hiddenCount={hiddenCount}
                    pages={visiblePages}
                    services={visibleServices}
                    categories={visibleCategories}
                    showCreation={canCreateRecords}
                    showRecords={canViewRecords}
                    expanded={mirrorExpanded}
                    mobile
                    onExpandedChange={setMirrorExpanded}
                  />
                ) : null}
              </>
            )}
          </div>

          {selectedUser != null &&
          permissions != null &&
          !permissionsQuery.isError &&
          !capabilitiesQuery.isError &&
          !categoriesQuery.isError ? (
            <aside className="min-w-0 min-[1100px]:sticky min-[1100px]:top-4 min-[1100px]:self-start">
              <AdvancedPermissionsPanel
                user={selectedUser}
                perms={permissions}
                capabilities={capabilitiesQuery.data ?? []}
              />
            </aside>
          ) : null}
        </div>
      </div>
    </div>
  )
}

export default PermissionsPage
