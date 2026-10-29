import { useEffect, useId, useMemo, useState } from 'react'
import { ChevronDown } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { cn } from '@/lib/utils'
import {
  destinationId,
  localized,
  needsAttention,
  personalSetting,
  type AccessItem,
  type Decision,
  type Patch,
  type Snapshot,
} from './studioModel'
import { ActionRow } from './ActionRow'

export interface AccessGroupsProps {
  items: AccessItem[]
  snapshot: Snapshot
  proposed?: Snapshot
  patches: Patch[]
  disabled: boolean
  selected: ReadonlySet<string>
  onSelect: (destination: string, selected: boolean) => void
  onStage: (patches: Patch[], requireReview?: boolean) => void
  focusDestination?: string
  expandMatches?: boolean
  filter?: 'all' | 'exceptions' | 'attention'
  matchingGroups?: string[]
}

function ServicePresets({
  item,
  snapshot,
  proposed,
  patches,
  disabled,
  onStage,
}: Pick<
  AccessGroupsProps,
  'snapshot' | 'proposed' | 'patches' | 'disabled' | 'onStage'
> & { item: AccessItem }) {
  const { t } = useTranslation()
  const create = item.actions.find(
    (decision: Decision) => decision.action === 'create',
  )
  const browse = item.actions.find(
    (decision: Decision) => decision.action === 'read',
  )
  if (!create || !browse) return null
  const currentItem: AccessItem =
    proposed?.items.find(
      (candidate: AccessItem) =>
        candidate.resource.kind === item.resource.kind &&
        candidate.resource.id === item.resource.id,
    ) ?? item
  const createAuthorization = currentItem.actions.find(
    (decision: Decision) => decision.action === 'create',
  )?.authorization
  const browseAuthorization = currentItem.actions.find(
    (decision: Decision) => decision.action === 'read',
  )?.authorization
  const state =
    createAuthorization === 'allowed' && browseAuthorization === 'allowed'
      ? 'createBrowse'
      : createAuthorization === 'denied' && browseAuthorization === 'allowed'
        ? 'browseOnly'
        : createAuthorization === 'denied' && browseAuthorization === 'denied'
          ? 'removeOrdinary'
          : 'custom'
  const exactPair =
    create.setting_capabilities.length === 1 &&
    browse.setting_capabilities.length === 1 &&
    create.setting_capabilities[0] !== browse.setting_capabilities[0] &&
    create.configurable &&
    browse.configurable
  const presets: {
    key: string
    create: Decision['editable_effects'][number]
    browse: Decision['editable_effects'][number]
  }[] = [
    { key: 'createBrowse', create: 'grant', browse: 'grant' },
    { key: 'browseOnly', create: 'deny', browse: 'grant' },
    { key: 'removeOrdinary', create: 'deny', browse: 'deny' },
  ]
  return (
    <div className="px-3 pb-2 text-sm sm:px-4">
      <details className="group/service">
        <summary className="flex min-h-11 cursor-pointer items-center gap-2 text-xs text-muted-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring">
          {t('access.studio.services.configuration')}: {t(`access.studio.services.${state}`)}
        </summary>
        <div className="space-y-3 pb-3">
      {createAuthorization === 'allowed' &&
        browseAuthorization === 'denied' && (
          <p className="text-muted-foreground">
            {t('access.studio.services.createOnly')}
          </p>
        )}
      {exactPair && (
        <details className="group/presets">
          <summary className="flex min-h-11 cursor-pointer list-none items-center gap-2 rounded-sm font-medium text-primary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring">
            <ChevronDown
              className="size-4 shrink-0 -rotate-90 group-open/presets:rotate-0 rtl:rotate-90 rtl:group-open/presets:rotate-0"
              aria-hidden="true"
            />
            {t('access.studio.services.presets')}
          </summary>
          <div className="space-y-3 pt-2">
            <p className="text-muted-foreground">
              {t('access.studio.services.exactPair')}
            </p>
            <details>
              <summary className="min-h-11 cursor-pointer text-xs">{t('access.studio.why.technical')}</summary>
              <ul className="space-y-1 font-mono text-xs" dir="ltr">
                <li className="[overflow-wrap:anywhere]">{create.setting_capabilities[0]}</li>
                <li className="[overflow-wrap:anywhere]">{browse.setting_capabilities[0]}</li>
              </ul>
            </details>
            <div className="flex flex-wrap gap-2">
              {presets
                .filter(
                  (preset) =>
                    create.editable_effects.includes(preset.create) &&
                    browse.editable_effects.includes(preset.browse),
                )
                .map((preset) => (
                  <button
                    key={preset.key}
                    type="button"
                    disabled={disabled}
                    className="min-h-11 rounded-md border border-border bg-surface px-3 py-2 text-start font-medium text-primary hover:bg-surface-tinted focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring disabled:cursor-not-allowed disabled:opacity-60"
                    onClick={() =>
                      onStage([
                        {
                          ...personalSetting(
                            create.setting_capabilities[0],
                            snapshot,
                            patches,
                          ),
                          effect: preset.create,
                        },
                        {
                          ...personalSetting(
                            browse.setting_capabilities[0],
                            snapshot,
                            patches,
                          ),
                          effect: preset.browse,
                        },
                      ])
                    }
                  >
                    {t(`access.studio.services.${preset.key}`)}
                  </button>
                ))}
            </div>
            <p className="text-muted-foreground">
              {t('access.studio.services.noCascade')}
            </p>
          </div>
        </details>
      )}
        </div>
      </details>
    </div>
  )
}

function Group({
  id,
  label,
  items,
  open,
  onToggle,
  ...props
}: AccessGroupsProps & {
  id: string
  label: string
  open: boolean
  onToggle: () => void
}) {
  const { t, i18n } = useTranslation()
  const actions = items.flatMap((item) => item.actions)
  const allowed = actions.filter((action) => action.authorization === 'allowed').length
  const exceptions = new Set(actions.flatMap((action) => action.setting_capabilities).filter((capability) => props.snapshot.overrides.some((override) => override.capability === capability) || props.patches.some((patch) => patch.capability === capability && patch.effect != null))).size
  const attention = actions.filter((action) => needsAttention(action, props.snapshot)).length
  const summary = [
    allowed > 0 ? t('access.studio.groupSummary.allowed', { count: allowed }) : '',
    exceptions > 0 ? t('access.studio.groupSummary.exceptions', { count: exceptions }) : '',
    attention > 0 ? t('access.studio.groupSummary.attention', { count: attention }) : '',
  ].filter(Boolean).join(' · ')
  const contentId = useId()
  return (
    <section
      className="min-w-0 overflow-hidden rounded-xl border border-border bg-surface"
      aria-labelledby={`${contentId}-heading`}
    >
      <h3 id={`${contentId}-heading`}>
        <button
          type="button"
          aria-expanded={open}
          aria-controls={contentId}
          onClick={onToggle}
          className="flex min-h-11 w-full min-w-0 flex-wrap items-center gap-x-3 gap-y-1 bg-surface-raised px-3 py-3 text-start font-semibold text-foreground hover:bg-surface-tinted focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring sm:px-4"
        >
          <ChevronDown
            className={cn(
              'size-4 shrink-0',
              !open && '-rotate-90 rtl:rotate-90',
            )}
            aria-hidden="true"
          />
          <span className="min-w-0 text-sm [overflow-wrap:anywhere]">{label}</span>
          <span title={summary} className="min-w-0 basis-full truncate ps-7 text-xs font-normal tabular-nums text-muted-foreground sm:ms-auto sm:basis-auto sm:ps-0">
            {summary}
          </span>
        </button>
      </h3>
      <div id={contentId} hidden={!open} data-access-group={id}>
        {items.map((item: AccessItem) => (
          <section
            key={`${item.resource.kind}:${item.resource.id}`}
            className="min-w-0"
            aria-label={localized(item.label, i18n.language)}
          >
            {item.actions.map((decision: Decision) => {
              const destination = destinationId(item.resource, decision.action)
              const proposed = props.proposed?.items
                .find(
                  (candidate: AccessItem) =>
                    candidate.resource.kind === item.resource.kind &&
                    candidate.resource.id === item.resource.id,
                )
                ?.actions.find(
                  (candidate: Decision) => candidate.action === decision.action,
                )
              return (
                <ActionRow
                  key={destination}
                  item={item}
                  decision={decision}
                  proposed={proposed}
                  snapshot={props.snapshot}
                  patches={props.patches}
                  disabled={props.disabled}
                  selected={props.selected.has(destination)}
                  onSelect={(selected) => props.onSelect(destination, selected)}
                  onStage={props.onStage}
                />
              )
            })}
            {item.resource.kind === 'service' && (
              <ServicePresets
                item={item}
                snapshot={props.snapshot}
                proposed={props.proposed}
                patches={props.patches}
                disabled={props.disabled}
                onStage={props.onStage}
              />
            )}
          </section>
        ))}
      </div>
    </section>
  )
}


const groupOrder: Record<string, number> = {
  services: 0, services_records: 0,
  people: 1, people_attendance: 1,
  templates: 2, templates_notifications: 2,
  correspondence: 3, administration: 4,
}

export function AccessGroups(props: AccessGroupsProps) {
  const { t } = useTranslation()
  const [expansions, setExpansions] = useState<ReadonlyMap<string, { trigger: string; open: boolean }>>(() => new Map())
  const groups = useMemo(() => {
    const grouped = new Map<string, AccessItem[]>()
    for (const item of props.items) {
      const group = grouped.get(item.group_id)
      if (group) group.push(item)
      else grouped.set(item.group_id, [item])
    }
    return [...grouped].sort(([a], [b]) => (groupOrder[a] ?? 5) - (groupOrder[b] ?? 5))
  }, [props.items])
  const focusedGroup = props.focusDestination ? props.items.find((item) => item.actions.some((decision) => destinationId(item.resource, decision.action) === props.focusDestination))?.group_id : undefined
  useEffect(() => {
    if (!props.focusDestination || !focusedGroup) return
    const frame = requestAnimationFrame(() => document.getElementById(props.focusDestination!)?.focus())
    return () => cancelAnimationFrame(frame)
  }, [props.focusDestination, focusedGroup])
  return (
    <div className="min-w-0 space-y-2">
      {groups.map(([id, items]) => {
        const attention = items.some((item) => item.actions.some((action) => {
          const proposedAction = props.proposed?.items.find((candidate) => candidate.resource.kind === item.resource.kind && candidate.resource.id === item.resource.id)?.actions.find((candidate) => candidate.action === action.action)
          return needsAttention(proposedAction ?? action, props.proposed ?? props.snapshot)
        }))
        const exception = props.filter === 'exceptions' && items.some((item) => item.actions.some((action) => action.setting_capabilities.some((capability) => props.snapshot.overrides.some((override) => override.capability === capability) || props.patches.some((patch) => patch.capability === capability && patch.effect != null))))
        const matched = !!props.expandMatches || (props.matchingGroups?.includes(id) ?? false)
        const trigger = `${focusedGroup === id ? props.focusDestination : ''}:${matched ? 'matches' : ''}:${exception ? 'exceptions' : ''}:${attention ? 'attention' : ''}`
        const expansion = expansions.get(id)
        const automatic = matched || focusedGroup === id || exception || attention
        const open = expansion?.trigger === trigger ? expansion.open : automatic || expansion?.open === true
        return <Group
          key={id}
          {...props}
          id={id}
          items={items}
          label={t(`access.studio.groups.${id}`, { defaultValue: t('access.studio.groups.other') })}
          open={open}
          onToggle={() => setExpansions((previous) => new Map(previous).set(id, { trigger, open: !open }))}
        />
      })}
    </div>
  )
}
