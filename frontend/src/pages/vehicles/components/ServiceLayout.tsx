/**
 * Vehicle Services page layout, «Counter and paper».
 *
 * Every service page reads in the same order:
 *   1. the navy band says where you are (`ServiceBand`);
 *   2. the counter, a white bar across the band's lower edge, starts a new
 *      request (`ServiceCounter`), so it is the first thing seen and the first
 *      thing reached with the keyboard;
 *   3. the register of what is already on record follows, quieter
 *      (`RegisterTabs`, `RegisterStats`, `RegisterSheet`).
 *
 * The counter is the only primary action on a page. It starts a write, so a
 * caller without `vehicles.edit` passes no counter at all: the band then
 * closes flat instead of leaving a gap for a counter that is not there.
 */

import { useId, useState } from 'react'
import { ChevronLeft, ChevronRight, Plus } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { Link } from 'react-router-dom'

import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { ServiceArtwork, type ServiceArtworkId } from '@/components/ui/service-artwork'
import { isArabic, localized } from '@/lib/language'
import { cn } from '@/lib/utils'

import { plateLabel } from '../vehicleUtils'
import { SERVICE_LIFT, SERVICE_WRAP } from './serviceStyles'

export interface ServiceBandProps {
  /** Back link above the title; omitted on the hub itself. */
  back?: { to: string; label: string }
  eyebrow?: string
  title: React.ReactNode
  description?: React.ReactNode
  /** Secondary actions at the band's end (`BAND_BUTTON`). */
  actions?: React.ReactNode
  /** The hub's larger band. */
  big?: boolean
}

/** The navy band: where you are, and the page's secondary actions. */
export function ServiceBand({
  back,
  eyebrow,
  title,
  description,
  actions,
  big = false,
  withCounter = false,
}: ServiceBandProps & { withCounter?: boolean }): React.JSX.Element {
  const { i18n } = useTranslation()
  const Back = isArabic(i18n.language) ? ChevronRight : ChevronLeft
  return (
    <header
      className={cn(
        'shrink-0 bg-primary text-primary-foreground',
        big ? 'pt-6 md:pt-8' : 'pt-4',
        // Room for the counter, which rides up over the band's lower edge.
        withCounter ? 'pb-[4.5rem] md:pb-[4.5rem]' : 'pb-6',
      )}
    >
      <div className={SERVICE_WRAP}>
        {back && (
          <Link
            to={back.to}
            className="mb-1 inline-flex items-center gap-1 rounded-sm text-[0.76rem] font-semibold text-primary-foreground/80 transition-colors hover:text-primary-foreground hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-foreground motion-reduce:transition-none"
          >
            <Back className="h-3.5 w-3.5" strokeWidth={1.9} aria-hidden />
            {back.label}
          </Link>
        )}
        <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-3">
          <div className="min-w-0">
            {eyebrow && (
              <p className="text-[0.7rem] font-semibold uppercase tracking-[0.16em] text-primary-foreground/70 rtl:tracking-normal">
                {eyebrow}
              </p>
            )}
            <h1
              className={cn(
                'flex flex-wrap items-center gap-3 font-extrabold leading-tight tracking-tight rtl:tracking-normal',
                big ? 'text-[1.7rem] md:text-[2.4rem] md:leading-[1.1] rtl:md:leading-[1.35]' : 'text-[1.3rem] md:text-[1.6rem]',
              )}
            >
              {title}
            </h1>
            {description && (
              <p className="mt-1 hidden max-w-[65ch] text-[0.82rem] text-primary-foreground/80 md:block">
                {description}
              </p>
            )}
          </div>
          {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
        </div>
      </div>
    </header>
  )
}

/**
 * A service page: band, then (for an operator who may file) the counter, then
 * the register. The whole page scrolls as one, so the counter scrolls away
 * with the band rather than pinning over the register.
 */
export function ServicePage({
  band,
  counter,
  children,
}: {
  band: ServiceBandProps
  /** `null` when the operator cannot start a request here. */
  counter?: React.ReactNode
  children: React.ReactNode
}): React.JSX.Element {
  return (
    <div className="flex flex-1 flex-col overflow-hidden bg-background">
      <div className="min-h-0 flex-1 overflow-y-auto">
        <ServiceBand {...band} withCounter={Boolean(counter)} />
        <div className={cn(SERVICE_WRAP, 'pb-16')}>
          {counter ? <div className="relative -mt-12 mb-6 md:mb-8">{counter}</div> : <div className="h-6" />}
          {children}
        </div>
      </div>
    </div>
  )
}

/** The vehicle fields the counter's picker shows. */
export interface CounterVehicle {
  id: number
  plate_code?: string | null
  plate_number: string
  type_ar: string
  type_en: string
}

/**
 * The counter on a service page: name the vehicle, start the request.
 * `vehicles` is the order the vehicles are offered in (the renewals page puts
 * the most urgent licence first). The chosen vehicle is a starting point only:
 * the request page lets the operator change it.
 */
export function ServiceCounter({
  artwork,
  title,
  description,
  actionLabel,
  vehicles,
  onStart,
  extra,
}: {
  artwork: ServiceArtworkId
  title: string
  description: string
  actionLabel: string
  /** `undefined` while the fleet is loading. */
  vehicles: readonly CounterVehicle[] | undefined
  onStart: (vehicleId: number) => void
  /** A secondary action beside the large one (for example Fetch from EVG). */
  extra?: React.ReactNode
}): React.JSX.Element {
  const { t, i18n } = useTranslation()
  const titleId = useId()
  const pickerId = useId()
  const [picked, setPicked] = useState<string>('')
  const list = vehicles ?? []
  // The choice survives a refetch; a vehicle that left the list falls back to
  // the first one offered.
  const value = list.some((vehicle) => String(vehicle.id) === picked)
    ? picked
    : String(list[0]?.id ?? '')

  return (
    <section
      aria-labelledby={titleId}
      className={cn(
        'grid grid-cols-[auto_minmax(0,1fr)] items-center gap-x-4 gap-y-4 rounded-md border border-border bg-surface p-4 md:gap-x-5 md:p-6',
        'xl:grid-cols-[auto_minmax(0,1fr)_auto]',
        SERVICE_LIFT,
      )}
    >
      <ServiceArtwork artwork={artwork} className="h-10 w-10 md:h-[3.25rem] md:w-[3.25rem]" />
      <div className="min-w-0">
        <h2
          id={titleId}
          className="text-[1.1rem] font-bold leading-tight tracking-tight text-primary-text md:text-[1.3rem] rtl:tracking-normal"
        >
          {title}
        </h2>
        <p className="mt-1 hidden text-[0.8rem] text-muted-foreground md:block">{description}</p>
      </div>
      <div className="col-span-full flex flex-wrap items-end justify-end gap-3 xl:col-span-1">
        <div className="flex min-w-0 flex-[1_1_100%] flex-col gap-1.5 sm:flex-[1_1_14rem] xl:w-[17rem] xl:flex-none">
          <Label htmlFor={pickerId}>{t('vehicles.vehicle')}</Label>
          <Select value={value} onValueChange={setPicked} disabled={list.length === 0}>
            <SelectTrigger id={pickerId} className="h-11 text-[0.86rem]">
              <SelectValue placeholder={vehicles ? t('vehicles.noVehicles') : t('common.loading')} />
            </SelectTrigger>
            <SelectContent>
              {list.map((vehicle) => (
                <SelectItem key={vehicle.id} value={String(vehicle.id)}>
                  <bdi dir="ltr" className="font-mono">
                    {plateLabel(vehicle)}
                  </bdi>
                  {' · '}
                  {localized(vehicle.type_ar, vehicle.type_en, i18n.language)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <Button
          type="button"
          size="lg"
          className="h-11 flex-[1_1_100%] px-6 text-[0.9rem] sm:flex-none"
          disabled={!value}
          onClick={() => onStart(Number(value))}
        >
          <Plus className="h-4 w-4" aria-hidden />
          {actionLabel}
        </Button>
        {extra}
      </div>
    </section>
  )
}

export interface RegisterTab<K extends string> {
  key: K
  label: string
  /** Shown beside the label; omitted when the tab has no count. */
  count?: string
}

/**
 * The register's own filter or view switch. A pressed tab is named by
 * `aria-pressed` and an underline, never by colour alone.
 */
export function RegisterTabs<K extends string>({
  label,
  items,
  value,
  onChange,
  className,
}: {
  label: string
  items: readonly RegisterTab<K>[]
  value: K
  onChange: (key: K) => void
  className?: string
}): React.JSX.Element {
  return (
    <div
      role="group"
      aria-label={label}
      className={cn(
        'flex max-w-full gap-5 overflow-x-auto overflow-y-hidden [scrollbar-width:none]',
        className,
      )}
    >
      {items.map((item) => {
        const active = item.key === value
        return (
          <button
            key={item.key}
            type="button"
            aria-pressed={active}
            onClick={() => onChange(item.key)}
            className={cn(
              'inline-flex shrink-0 items-center gap-2 whitespace-nowrap border-b-2 py-2 text-[0.84rem] font-semibold transition-colors',
              'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-background motion-reduce:transition-none',
              active
                ? 'border-primary text-primary-text'
                : 'border-transparent text-muted-foreground hover:text-foreground',
            )}
          >
            {item.label}
            {item.count != null && (
              <span className="font-mono text-[0.85em] text-faint">
                <bdi>{item.count}</bdi>
              </span>
            )}
          </button>
        )
      })}
    </div>
  )
}

/** Totals that sit beside the register's tabs. */
export function RegisterStats({
  items,
}: {
  items: readonly { label: string; value: React.ReactNode }[]
}): React.JSX.Element {
  return (
    <dl className="flex flex-wrap gap-x-5 gap-y-1">
      {items.map((item) => (
        <div key={item.label} className="flex items-baseline gap-2">
          <dt className="text-[0.72rem] text-muted-foreground">{item.label}</dt>
          <dd className="text-[0.95rem] font-bold text-primary-text">{item.value}</dd>
        </div>
      ))}
    </dl>
  )
}

/** Tabs at the start, totals or tools at the end, wrapping on a phone. */
export function RegisterBar({ children }: { children: React.ReactNode }): React.JSX.Element {
  return (
    <div className="mb-3 flex flex-wrap items-end justify-between gap-x-5 gap-y-2">{children}</div>
  )
}

/** A register sheet: square-shouldered and ruled in navy like the letterhead. */
export function RegisterSheet({
  title,
  meta,
  children,
  className,
}: {
  title?: React.ReactNode
  meta?: React.ReactNode
  children: React.ReactNode
  className?: string
}): React.JSX.Element {
  return (
    <section
      className={cn(
        'mb-4 overflow-hidden rounded-b-md border border-t-2 border-border border-t-primary bg-surface',
        className,
      )}
    >
      {(title || meta) && (
        <header className="flex items-baseline justify-between gap-4 px-3 pb-2 pt-3">
          {title && <h3 className="text-base font-bold">{title}</h3>}
          {meta && <span className="text-[0.72rem] text-muted-foreground">{meta}</span>}
        </header>
      )}
      {children}
    </section>
  )
}

/** The register heading on a page that has more than one register (the hub). */
export function RegisterHeading({
  id,
  title,
  description,
  tools,
}: {
  id?: string
  title: string
  description?: string
  tools?: React.ReactNode
}): React.JSX.Element {
  return (
    <header className="mb-3 mt-10 flex flex-wrap items-end justify-between gap-x-5 gap-y-3 md:mt-12">
      <div className="min-w-0">
        <h2 id={id} className="text-[1.35rem] font-extrabold tracking-tight rtl:tracking-normal">
          {title}
        </h2>
        {description && <p className="text-[0.78rem] text-muted-foreground">{description}</p>}
      </div>
      {tools && <div className="flex flex-wrap items-center gap-2">{tools}</div>}
    </header>
  )
}
