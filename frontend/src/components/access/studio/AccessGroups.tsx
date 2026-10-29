import { useEffect, useId, useMemo, useState } from 'react'
import { ChevronDown } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { cn } from '@/lib/utils'
import {
  destinationId,
  localized,
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
  onStage: (patches: Patch[]) => void
  focusDestination?: string
  expandMatches?: boolean
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
    <div className="space-y-3 px-4 pb-4 text-sm sm:px-5">
      <p className="text-muted-foreground">
        {t(proposed ? 'access.studio.proposed' : 'access.studio.current')} ·{' '}
        {t('access.studio.services.configuration')}:{' '}
        <span className="font-medium text-foreground">
          {t(`access.studio.services.${state}`)}
        </span>
      </p>
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
            <ul className="space-y-1 font-mono text-xs" dir="ltr">
              <li className="[overflow-wrap:anywhere]">
                {create.setting_capabilities[0]}
              </li>
              <li className="[overflow-wrap:anywhere]">
                {browse.setting_capabilities[0]}
              </li>
            </ul>
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
  const { i18n } = useTranslation()
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
          className="flex min-h-11 w-full min-w-0 items-center gap-3 bg-surface-raised px-4 py-4 text-start font-semibold text-foreground hover:bg-surface-tinted focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring sm:px-5"
        >
          <ChevronDown
            className={cn(
              'size-4 shrink-0',
              !open && '-rotate-90 rtl:rotate-90',
            )}
            aria-hidden="true"
          />
          <span className="min-w-0 flex-1 [overflow-wrap:anywhere]">
            {label}
          </span>
          <span className="shrink-0 font-mono text-xs font-normal tabular-nums text-muted-foreground">
            {items.reduce(
              (count: number, item: AccessItem) => count + item.actions.length,
              0,
            )}
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

export function AccessGroups(props: AccessGroupsProps) {
  const { t } = useTranslation()
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(
    () => new Set(),
  )
  const [dismissedFocus, setDismissedFocus] = useState<string>()
  const groups = useMemo(() => {
    const grouped = new Map<string, AccessItem[]>()
    for (const item of props.items) {
      const group = grouped.get(item.group_id)
      if (group) group.push(item)
      else grouped.set(item.group_id, [item])
    }
    return grouped
  }, [props.items])
  const focusedGroup = props.focusDestination
    ? props.items.find((item: AccessItem) =>
        item.actions.some(
          (decision: Decision) =>
            destinationId(item.resource, decision.action) ===
            props.focusDestination,
        ),
      )?.group_id
    : undefined
  useEffect(() => {
    if (!props.focusDestination || !focusedGroup) return
    const frame = requestAnimationFrame(() =>
      document.getElementById(props.focusDestination!)?.focus(),
    )
    return () => cancelAnimationFrame(frame)
  }, [props.focusDestination, focusedGroup])
  return (
    <div className="min-w-0 space-y-4">
      {[...groups].map(([id, items]) => (
        <Group
          key={id}
          {...props}
          id={id}
          items={items}
          label={t(`access.studio.groups.${id}`, {
            defaultValue: t('access.studio.groups.other'),
          })}
          open={
            props.expandMatches ||
            (focusedGroup === id &&
              dismissedFocus !== props.focusDestination) ||
            !collapsed.has(id)
          }
          onToggle={() => {
            const currentlyOpen =
              props.expandMatches ||
              (focusedGroup === id &&
                dismissedFocus !== props.focusDestination) ||
              !collapsed.has(id)
            if (focusedGroup === id) setDismissedFocus(props.focusDestination)
            setCollapsed((previous) => {
              const next = new Set(previous)
              if (currentlyOpen) next.add(id)
              else next.delete(id)
              return next
            })
          }}
        />
      ))}
    </div>
  )
}
