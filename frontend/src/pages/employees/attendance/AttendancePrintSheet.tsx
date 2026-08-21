/**
 * AttendancePrintSheet — the duty register on paper.
 *
 * Hidden on screen (`hidden`), revealed by the print stylesheet
 * (`print:block`), which is the same contract `PermitPrintView` uses: the
 * global `@media print` rules delete app chrome and every `[data-print-hide]`
 * subtree, so only this reaches the paper. Printing the live view instead is
 * what produced the original defect — `RegisterView`'s shift band is a
 * `<header>`, and the print sheet hides every `header`, so the shift name and
 * its working window were deleted on the way to the printer.
 *
 * Two layouts, both A4 landscape (`.print-attendance` → `@page attendance`):
 *
 *   `sheet`  one masthead, then every shift as a band over four name columns.
 *            The whole day on as little paper as possible.
 *   `shift`  one sheet per shift: a large band naming the time of day, the
 *            window and the unit on duty, then posts as blocks carrying in and
 *            out, then a sign-off strip. The sheet a supervisor signs.
 *
 * Every verdict comes from `attendanceModel`, so the paper can never disagree
 * with the screen about one person. Nothing here paints a background: the
 * global print rule flattens every backdrop in `#root` with `!important`, and a
 * register built from rules and weight needs no fill anyway.
 */

import { useContext, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { AuthContext } from '@/lib/authContext'
import { pickEmployeeName } from '@/lib/employeeName'

import type { AttendanceRow, RowState, StateInput } from './attendanceModel'
import {
  groupByUnitAndPost,
  isUnpaired,
  minutesPastGrace,
  needsDecision,
  orderByAttention,
  parseInstant,
  postSummary,
  rowState,
  siteTime,
  splitByShift,
} from './attendanceModel'

export type PrintLayout = 'sheet' | 'roster' | 'shift'

interface Props {
  layout: PrintLayout
  /** The rows on screen — what you filtered is what you print. */
  rows: readonly AttendanceRow[]
  now: Date
  operationalDate: string
  /** Active shift chip, declared on the sheet so a filtered register says so. */
  shiftCode: string | null
  /** Active search term, declared for the same reason. */
  search: string
  graceMinutes?: number
}

/** One section of the register: a single shift worked by a single unit. */
interface Section {
  shiftCode: string
  unit: string
  posts: Map<string, AttendanceRow[]>
}

/**
 * A post whose roster is longer than this spans the full width and sub-columns
 * its own names. Balanced multi-column layout takes its column height from the
 * tallest unbreakable block, so one 24-name post (Liwan carries the whole
 * platoon) would otherwise leave two of the four columns blank.
 */
const WIDE_POST_ROWS = 12

/** Ink per state. Text colour only — see the file header on backgrounds. */
const TONE: Record<RowState, string> = {
  verified: 'text-success',
  grace: 'text-caution',
  late: 'text-warning',
  unpaired: 'text-destructive',
  absent: 'text-accent',
  leave: 'text-info',
  pending: 'text-faint',
}

const LEGEND_ORDER: readonly RowState[] = [
  'verified',
  'grace',
  'late',
  'unpaired',
  'absent',
  'leave',
]

function sections(rows: readonly AttendanceRow[]): Section[] {
  return splitByShift(rows).flatMap(([shiftCode, shiftRows]) =>
    [...groupByUnitAndPost(shiftRows).entries()].map(([unit, posts]) => ({
      shiftCode,
      unit,
      posts,
    })),
  )
}

interface SectionStats {
  due: number
  seen: number
  grace: number
  late: number
  absent: number
  unpaired: number
  leave: number
}

/**
 * Counted off the facts, not off one collapsed verdict: a person who arrived
 * late and never punched out is one late arrival AND one missing pair, and the
 * register has to be able to say both. Same rule `RegisterView` applies.
 */
function sectionStats(rows: readonly AttendanceRow[], input: StateInput): SectionStats {
  const summary = postSummary(rows, input)
  let grace = 0
  let late = 0
  let absent = 0
  for (const row of rows) {
    const state = rowState(row, input)
    if (state === 'grace') grace += 1
    else if (state === 'late') late += 1
    else if (state === 'absent') absent += 1
  }
  return {
    due: summary.due,
    seen: summary.seen,
    leave: summary.leave,
    grace,
    late,
    absent,
    unpaired: rows.filter((row) => isUnpaired(row, input)).length,
  }
}

/** Posts needing attention first, then by size: trouble before names. */
function orderedPosts(
  posts: Map<string, AttendanceRow[]>,
  input: StateInput,
): Array<[string, AttendanceRow[]]> {
  return [...posts.entries()].sort((a, b) => {
    const diff = postSummary(b[1], input).exceptions - postSummary(a[1], input).exceptions
    return diff !== 0 ? diff : b[1].length - a[1].length
  })
}

/**
 * The state, in words, in the time cell.
 *
 * Print carries no tooltip and may well come off a mono laser, so colour cannot
 * be the carrier — every state has to read as text. This is `RegisterView`'s
 * label plus the one case the screen leaves to the bead alone: an arrival after
 * the start but inside the grace, which would otherwise print as a bare time
 * indistinguishable from an on-time one.
 */
function printTimeLabel(
  row: AttendanceRow,
  state: RowState,
  input: StateInput,
  t: (key: string, options?: Record<string, unknown>) => string,
): string {
  if (state === 'leave') return t('attendance.register.leave')
  if (state === 'pending') return t('attendance.register.duePunch', { time: siteTime(row.scheduled_start_at) })
  if (state === 'absent') return t('attendance.register.noPunch')
  if (state === 'unpaired') return t('attendance.register.onlyPunch', { time: siteTime(row.first_punch_at) })
  if (state === 'grace') return t('attendance.print.gracePunch', { time: siteTime(row.first_punch_at) })
  if (state === 'late') {
    // Minutes PAST THE GRACE, which is what "late" means here.
    return t('attendance.register.latePunch', {
      time: siteTime(row.first_punch_at),
      minutes: minutesPastGrace(row, input),
    })
  }
  return siteTime(row.first_punch_at)
}

/**
 * The instant the paper was produced, re-read when the dialog opens.
 *
 * A value captured at mount would put the time the tab was opened on a sheet
 * printed hours later, and this page is a wall-mounted dashboard on some desks.
 * `beforeprint` fires before the dialog paints, so the stamp is honest.
 */
function usePrintedAt(language: string): string {
  const format = (): string =>
    new Intl.DateTimeFormat(language.startsWith('ar') ? 'ar-AE' : 'en-GB', {
      day: '2-digit',
      month: 'short',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
      timeZone: 'Asia/Dubai',
    }).format(new Date())

  const [stamp, setStamp] = useState(format)
  useEffect(() => {
    const restamp = (): void => setStamp(format())
    // Language changes the formatter, so re-stamp on mount of the new locale too.
    restamp()
    window.addEventListener('beforeprint', restamp)
    return () => window.removeEventListener('beforeprint', restamp)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [language])
  return stamp
}

export function AttendancePrintSheet({
  layout,
  rows,
  now,
  operationalDate,
  shiftCode,
  search,
  graceMinutes,
}: Props): React.JSX.Element {
  const { t, i18n } = useTranslation()
  // `useAuth` THROWS without a provider, and the operator's name is one
  // optional line in the footer — hard-requiring the provider would make the
  // whole register unmountable for a courtesy field. Read the context directly
  // and let the line disappear when nobody is signed in.
  const auth = useContext(AuthContext)
  const user = auth?.user ?? null
  const printedAt = usePrintedAt(i18n.language)
  const input: StateInput = { now, graceMinutes }
  const list = sections(rows)

  const operator = user
    ? pickEmployeeName({ name_en: user.name_en ?? user.email, name_ar: user.name_ar }, i18n.language)
    : null

  // The link back to the screen this paper came from, filters included, so the
  // printout can be reproduced rather than argued about.
  const params = new URLSearchParams({ date: operationalDate })
  if (shiftCode) params.set('shift', shiftCode)
  const printLink = `${window.location.origin}/employees/attendance?${params.toString()}`

  // A filtered register must never look like the whole day.
  const filters: string[] = []
  if (shiftCode) filters.push(t(`attendance.shift.${shiftCode}`, shiftCode))
  if (search.trim()) filters.push(t('attendance.print.searchFilter', { term: search.trim() }))
  const filterNote = filters.length > 0 ? t('attendance.print.filtered', { filter: filters.join(' · ') }) : null

  const foot = (tail: string): React.JSX.Element => (
    <Foot printLink={printLink} printedAt={printedAt} operator={operator} tail={tail} />
  )

  if (layout === 'shift') {
    return (
      <div className={ROOT}>
        {list.map((section, index) => (
          <ShiftSheet
            key={`${section.shiftCode}-${section.unit}`}
            section={section}
            index={index}
            total={list.length}
            input={input}
            operationalDate={operationalDate}
            filterNote={filterNote}
            foot={foot(t('attendance.print.sheetOf', { index: index + 1, total: list.length }))}
          />
        ))}
      </div>
    )
  }

  if (layout === 'roster') {
    return (
      <div className={ROOT}>
        <Roster
          list={list}
          input={input}
          operationalDate={operationalDate}
          filterNote={filterNote}
          printLink={printLink}
          printedAt={printedAt}
          operator={operator}
        />
      </div>
    )
  }

  const all = list.flatMap((section) => [...section.posts.values()].flat())
  const exceptions = all.filter((row) => needsDecision(rowState(row, input))).length

  return (
    <div className={ROOT}>
      <Masthead
        subtitle={t('attendance.print.subtitleSheet', { date: operationalDate })}
        filterNote={filterNote}
        facts={[
          [t('attendance.print.date'), operationalDate],
          [t('attendance.print.shifts'), String(list.length)],
          [t('attendance.print.assigned'), String(all.length)],
          [t('attendance.print.exceptions'), String(exceptions)],
        ]}
      />
      {list.map((section) => (
        <section key={`${section.shiftCode}-${section.unit}`}>
          <ShiftBand section={section} input={input} />
          <PostColumns section={section} input={input} withInOut={false} columns={4} />
        </section>
      ))}
      {foot(t('attendance.print.sheetOf', { index: 1, total: 1 }))}
    </div>
  )
}

/**
 * `bg-white text-black` is not decoration: a dark-theme operator would
 * otherwise print near-white ink onto white paper. The print stylesheet re-pins
 * the light token values for this subtree; these two cover the root itself.
 */
const ROOT =
  'print-attendance hidden bg-white text-black text-[9.6pt] leading-[1.35] print:flex print:flex-col'

function Masthead({
  subtitle,
  filterNote,
  facts,
}: {
  subtitle: string
  filterNote: string | null
  facts: ReadonlyArray<readonly [string, string]>
}): React.JSX.Element {
  const { t, i18n } = useTranslation()
  const isAr = i18n.language.startsWith('ar')
  return (
    <div className="flex items-center gap-2.5 border-b-[1.5px] border-black pb-1.5">
      {/* The crest is bilingual by construction (Arabic ring above, English
          below), so one asset serves both directions. Decorative: the title
          beside it already names the document. */}
      <img src="/brand/gssg-logo.png" alt="" className="h-[15mm] w-[15mm] shrink-0 object-contain" />
      <div className="min-w-0 flex-1">
        <h2 className="text-[13pt] font-extrabold tracking-[-0.01em]">
          {t('attendance.print.title')}{' '}
          {/* The peer language, isolated: an Arabic run butted against a Latin
              one is reordered by the bidi algorithm without it. */}
          <span dir={isAr ? 'ltr' : 'rtl'} className="isolate-bidi text-[0.82em] font-semibold">
            {t('attendance.print.titlePeer')}
          </span>
        </h2>
        <p className="mt-px text-[8pt] text-muted-foreground">
          {subtitle}
          {filterNote && <> · <b className="font-semibold text-accent">{filterNote}</b></>}
        </p>
      </div>
      <dl className="flex shrink-0 gap-3 text-end">
        {facts.map(([label, value]) => (
          <div key={label} className="min-w-[15mm]">
            <dt className="text-[6.4pt] uppercase tracking-[.1em] text-muted-foreground ltr:uppercase">
              {label}
            </dt>
            <dd className="font-mono text-[11pt] font-extrabold tabular-nums">{value}</dd>
          </div>
        ))}
      </dl>
    </div>
  )
}

/**
 * Shift chip: the glyph makes the time of day legible before a word is read,
 * and the word is always there because a mono printout has no colour to lean on.
 */
const SHIFT_GLYPH: Record<string, string> = {
  morning: '☀',
  noon: '◑',
  night: '☾',
  office_day: '▣',
}

function ShiftChip({ code, className = '' }: { code: string; className?: string }): React.JSX.Element {
  const { t } = useTranslation()
  return (
    <span className={`whitespace-nowrap ${className}`}>
      <i aria-hidden className="not-italic">
        {SHIFT_GLYPH[code] ?? '·'}
      </i>{' '}
      <b className="font-extrabold">{t(`attendance.shift.${code}`, code)}</b>
    </span>
  )
}

/**
 * A clock RANGE beside Arabic is reordered by the bidi algorithm — "الظهيرة
 * 13:00 – 21:00" prints as "21:00 – 13:00". Isolation with an LTR base fixes it
 * in both directions; single times are neutral and need nothing.
 */
function Window({ from, to, className = '' }: { from: string | null | undefined; to: string | null | undefined; className?: string }): React.JSX.Element {
  return (
    <span
      dir="ltr"
      data-testid="attendance-print-window"
      className={`isolate-bidi font-mono tabular-nums ${className}`}
    >
      {siteTime(from)} – {siteTime(to)}
    </span>
  )
}

/**
 * The unit name — "السرية الرابعة" — at the weight the register is found by.
 *
 * Three reasons this is not just `<b dir="auto">`:
 *
 *   Weight. Only 400/500/700 of Noto Sans Arabic are bundled and Lenos is the
 *   brand display face, so 800 has no real Arabic face behind it and the
 *   browser synthesizes a smeared fake. 700 is a bundled weight.
 *
 *   Family. `--font-sans` is Inter, which carries no Arabic at all, and
 *   `--font-arabic` only applies under `[dir="rtl"]` / `:lang(ar)` — which
 *   `dir="auto"` matches neither of — so this run fell through to whatever
 *   Arabic face the OS happened to have, at whatever weight it happened to
 *   offer. Naming the bundled family first makes the bold identical in both
 *   directions and on every machine, which for a printed document it must be.
 *
 *   Alignment. Unit and post names are organisation data and always Arabic,
 *   whichever language the operator reads in. `dir="auto"` would resolve them
 *   RTL and right-align every one against an otherwise left-aligned English
 *   sheet — the full-width post headers ended up stranded at the far margin.
 *   Isolation alone orders the glyphs correctly while the box still starts
 *   where the rest of the sheet starts, in both directions.
 */
function Unit({ name, className = '' }: { name: string; className?: string }): React.JSX.Element {
  return (
    <b
      data-testid="attendance-print-unit"
      className={`isolate-bidi font-bold [font-family:'Noto_Sans_Arabic',var(--font-sans)] ${className}`}
    >
      {name}
    </b>
  )
}

function Stats({ stats }: { stats: SectionStats }): React.JSX.Element {
  const { t } = useTranslation()
  const cells: ReadonlyArray<readonly [string, number, string]> = [
    [t('attendance.print.due'), stats.due, ''],
    [t('attendance.print.seen'), stats.seen, ''],
    [t('attendance.print.grace'), stats.grace, TONE.grace],
    [t('attendance.print.late'), stats.late, TONE.late],
    [t('attendance.print.absent'), stats.absent, TONE.absent],
    [t('attendance.print.unpaired'), stats.unpaired, TONE.unpaired],
    [t('attendance.print.leave'), stats.leave, TONE.leave],
  ]
  return (
    <dl className="flex gap-2.5 text-muted-foreground ms-auto">
      {cells.map(([label, value, tone]) => (
        <div key={label} className="text-center">
          <dt className="text-[6.2pt] uppercase tracking-[.07em] ltr:uppercase">{label}</dt>
          <dd className={`font-mono text-[9pt] font-extrabold tabular-nums ${tone || 'text-black'}`}>
            {value}
          </dd>
        </div>
      ))}
    </dl>
  )
}

/** Layout `sheet`: the band that heads one shift's names. */
function ShiftBand({ section, input }: { section: Section; input: StateInput }): React.JSX.Element {
  const { t } = useTranslation()
  const rows = [...section.posts.values()].flat()
  const first = rows[0]
  return (
    // break-after-avoid: a band must never be the last thing on a sheet with
    // its names orphaned onto the next one.
    <div className="mt-1 flex items-baseline gap-2 break-after-avoid border-b border-primary py-0.5">
      <ShiftChip code={section.shiftCode} className="text-[10.5pt]" />
      <Window from={first?.scheduled_start_at} to={first?.scheduled_end_at} className="text-[9.5pt] font-bold" />
      <Unit name={section.unit} className="text-[10pt]" />
      <span className="text-[8.4pt] text-muted-foreground">
        · {t('attendance.print.postCount', { count: section.posts.size })}
      </span>
      <Stats stats={sectionStats(rows, input)} />
    </div>
  )
}

/**
 * Column counts, spelled out because Tailwind reads class names statically and
 * a computed `columns-${n}` would never be generated.
 *
 * Four across for the day sheet, whose rows are name / G-number / verdict.
 * Three for the per-shift sheet, which adds in and out: at four, a full Emirati
 * name lost its family name to the ellipsis, and the family name is exactly
 * what distinguishes two brothers on the same post. That sheet has the vertical
 * room to spend.
 */
const COLUMNS: Record<number, string> = { 3: 'columns-3', 4: 'columns-4' }

function PostColumns({
  section,
  input,
  withInOut,
  columns,
}: {
  section: Section
  input: StateInput
  withInOut: boolean
  columns: number
}): React.JSX.Element {
  return (
    <div className={`mt-1 gap-0 ${COLUMNS[columns]}`}>
      {orderedPosts(section.posts, input).map(([post, postRows]) => (
        <PostBlock
          key={post}
          post={post}
          rows={postRows}
          input={input}
          withInOut={withInOut}
          columns={columns}
        />
      ))}
    </div>
  )
}

function PostBlock({
  post,
  rows,
  input,
  withInOut,
  columns,
}: {
  post: string
  rows: readonly AttendanceRow[]
  input: StateInput
  withInOut: boolean
  columns: number
}): React.JSX.Element {
  const wide = rows.length > WIDE_POST_ROWS
  const stats = postSummary(rows, input)
  return (
    <div
      data-testid="attendance-print-post"
      className={`break-inside-avoid px-1.5 pb-1 pt-0.5 ${
        wide ? '[column-span:all]' : 'border-e border-hairline'
      }`}
    >
      <div
        className={`mb-0.5 flex items-baseline gap-1.5 border-b pb-px ${
          stats.exceptions > 0 ? 'border-accent' : 'border-border-strong'
        }`}
      >
        {/* Production post names run long ("فرع الأمن والحراسة - إرساليات"),
            so the name truncates and the count never does. */}
        <b className="isolate-bidi min-w-0 flex-1 truncate text-[8.4pt] font-extrabold">
          {post}
        </b>
        <span
          className={`shrink-0 font-mono text-[7.6pt] tabular-nums ${
            stats.exceptions > 0 ? 'font-bold text-accent' : 'text-muted-foreground'
          }`}
        >
          {stats.seen}/{stats.due}
          {stats.leave > 0 ? ` +${stats.leave}` : ''}
        </span>
      </div>
      <div className={wide ? `gap-4 ${COLUMNS[columns]}` : ''}>
        {orderByAttention(rows, input).map((row) => (
          <PersonRow
            key={`${row.employee_id}-${row.shift_code}`}
            row={row}
            input={input}
            withInOut={withInOut}
          />
        ))}
      </div>
    </div>
  )
}

/**
 * Total time on site, from the first punch to the last.
 *
 * Punches carry no direction — the provider publishes events, not in/out pairs
 * — so the honest figure is the span between the first and the last, and a
 * single punch has no span at all rather than a zero.
 */
function totalMinutes(row: AttendanceRow): number | null {
  if (row.punch_count < 2) return null
  const from = parseInstant(row.first_punch_at)
  const to = parseInstant(row.last_punch_at)
  if (from === null || to === null || to <= from) return null
  return Math.round((to - from) / 60_000)
}

/**
 * Layout `roster`: one line per assignment, on as many sheets as it takes.
 *
 * The columns are the point: a line carrying its own shift, unit, post and
 * hours can be cut out, filed or photocopied on its own and still means
 * something, which the column layouts cannot claim.
 *
 * Masthead and provenance live INSIDE `thead`/`tfoot`. A table header group
 * repeats on every sheet the table spills onto, so sheet three carries the
 * crest and the printed-at stamp too; placed above the table they would appear
 * once and leave the rest of the run unheaded. The cost is the page number:
 * Chrome implements no `@page` margin boxes, so a repeated foot cannot count
 * its own page — it asserts the line total instead, which is the figure that
 * actually proves no sheet went missing.
 */
function Roster({
  list,
  input,
  operationalDate,
  filterNote,
  printLink,
  printedAt,
  operator,
}: {
  list: readonly Section[]
  input: StateInput
  operationalDate: string
  filterNote: string | null
  printLink: string
  printedAt: string
  operator: string | null
}): React.JSX.Element {
  const { t } = useTranslation()
  const all = list.flatMap((section) => [...section.posts.values()].flat())
  const exceptions = all.filter((row) => needsDecision(rowState(row, input))).length

  // Flattened once, up front, so a line number is a pure function of its
  // position rather than a counter mutated from inside a render callback.
  const groups = list.map((section) => ({
    section,
    entries: orderedPosts(section.posts, input).flatMap(([post, postRows]) =>
      orderByAttention(postRows, input).map((row) => ({ post, row })),
    ),
  }))
  const firstLine: number[] = []
  let counted = 0
  for (const group of groups) {
    firstLine.push(counted)
    counted += group.entries.length
  }

  // Column widths belong on <col>, not on <th>: `table-layout: fixed` reads its
  // widths from the first row, and that row is the masthead's single colspan
  // cell — widths declared on the header cells are silently ignored and every
  // column collapses to an equal share, truncating names to a dozen characters.
  const columns: ReadonlyArray<readonly [string, string, string]> = [
    ['w-[7mm]', 'colLine', 'text-center font-mono text-[7.4pt] text-muted-foreground'],
    ['', 'colName', ''],
    ['w-[16mm]', 'colId', 'font-mono font-semibold tabular-nums'],
    ['w-[26mm]', 'colUnit', ''],
    ['w-[40mm]', 'colPost', ''],
    ['w-[20mm]', 'colShift', ''],
    ['w-[14mm]', 'colIn', 'text-center font-mono tabular-nums'],
    ['w-[14mm]', 'colOut', 'text-center font-mono tabular-nums'],
    ['w-[17mm]', 'colTotal', 'text-center font-mono font-semibold tabular-nums'],
    ['w-[12mm]', 'colLate', 'text-center font-mono tabular-nums'],
    ['w-[25mm]', 'colState', ''],
  ]

  return (
    <table className="w-full table-fixed border-collapse">
      <colgroup>
        {columns.map(([width], index) => (
          <col key={index} className={width} />
        ))}
      </colgroup>
      <thead>
        <tr>
          <td colSpan={columns.length} className="pb-1">
            <Masthead
              subtitle={t('attendance.print.subtitleRoster', { date: operationalDate })}
              filterNote={filterNote}
              facts={[
                [t('attendance.print.date'), operationalDate],
                [t('attendance.print.assigned'), String(all.length)],
                [t('attendance.print.exceptions'), String(exceptions)],
              ]}
            />
          </td>
        </tr>
        <tr>
          {columns.map(([, key]) => (
            <th
              key={key}
              className="border-y border-black px-1 py-0.5 text-start text-[6.8pt] font-bold tracking-[.07em] ltr:uppercase"
            >
              {t(`attendance.print.${key}`)}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {groups.map(({ section, entries }, groupIndex) => {
          const rows = [...section.posts.values()].flat()
          const first = rows[0]
          return [
            <tr key={`band-${section.shiftCode}-${section.unit}`} className="break-inside-avoid">
              <td
                colSpan={columns.length}
                className="border-b border-primary pb-px pt-1.5 align-bottom"
              >
                <span className="flex items-baseline gap-2">
                  <ShiftChip code={section.shiftCode} className="text-[9.5pt]" />
                  <Window
                    from={first?.scheduled_start_at}
                    to={first?.scheduled_end_at}
                    className="text-[8.6pt] font-bold"
                  />
                  <Unit name={section.unit} className="text-[9.5pt]" />
                  <Stats stats={sectionStats(rows, input)} />
                </span>
              </td>
            </tr>,
            ...entries.map(({ post, row }, index) => (
              <RosterRow
                key={`${row.employee_id}-${row.shift_code}-${post}`}
                line={(firstLine[groupIndex] ?? 0) + index + 1}
                row={row}
                unit={section.unit}
                post={post}
                input={input}
                columns={columns}
              />
            )),
          ]
        })}
      </tbody>
      <tfoot>
        <tr>
          <td colSpan={columns.length}>
            <Foot
              printLink={printLink}
              printedAt={printedAt}
              operator={operator}
              tail={t('attendance.print.lineCount', { count: all.length })}
            />
          </td>
        </tr>
      </tfoot>
    </table>
  )
}

function RosterRow({
  line,
  row,
  unit,
  post,
  input,
  columns,
}: {
  line: number
  row: AttendanceRow
  unit: string
  post: string
  input: StateInput
  columns: ReadonlyArray<readonly [string, string, string]>
}): React.JSX.Element {
  const { t, i18n } = useTranslation()
  const state = rowState(row, input)
  const name = pickEmployeeName({ name_en: row.name_en, name_ar: row.name_ar ?? null }, i18n.language)
  const total = totalMinutes(row)
  const past = minutesPastGrace(row, input)
  const cell = (index: number): string =>
    `truncate border-b border-hairline px-1 py-px text-[8pt] ${columns[index]?.[2] ?? ''}`
  return (
    // break-inside-avoid: a printed line split across two sheets is a line that
    // belongs to neither.
    <tr className="break-inside-avoid">
      <td className={cell(0)}>{line}</td>
      <td className={cell(1)} dir="auto">
        {name}
      </td>
      <td className={cell(2)}>{row.employee_id}</td>
      {/* Organisation data, always Arabic: isolated so the glyphs order right,
          but not `dir="auto"`, which would right-align these two columns alone
          against an otherwise left-aligned English sheet. */}
      <td className={`${cell(3)} isolate-bidi`}>{unit}</td>
      <td className={`${cell(4)} isolate-bidi`}>{post}</td>
      <td className={cell(5)}>
        <ShiftChip code={row.shift_code ?? '—'} className="text-[7.8pt]" />
      </td>
      <td className={cell(6)}>{siteTime(row.first_punch_at) || '—'}</td>
      <td className={cell(7)}>{row.punch_count > 1 ? siteTime(row.last_punch_at) : '—'}</td>
      <td className={cell(8)}>
        {total === null
          ? '—'
          : t('attendance.print.duration', {
              hours: Math.floor(total / 60),
              minutes: String(total % 60).padStart(2, '0'),
            })}
      </td>
      {/* Minutes PAST THE GRACE, which is what "late" means here: the raw offset
          from the start would bill someone 44 minutes the policy counts as 14. */}
      <td className={`${cell(9)} ${past > 0 ? `font-bold ${TONE.late}` : ''}`}>
        {past > 0 ? `+${past}` : '—'}
      </td>
      <td className={`${cell(10)} ${TONE[state]} ${needsDecision(state) ? 'font-bold' : ''}`}>
        {t(`attendance.state.${state}`)}
      </td>
    </tr>
  )
}

function PersonRow({
  row,
  input,
  withInOut,
}: {
  row: AttendanceRow
  input: StateInput
  withInOut: boolean
}): React.JSX.Element {
  const { t, i18n } = useTranslation()
  const state = rowState(row, input)
  const name = pickEmployeeName({ name_en: row.name_en, name_ar: row.name_ar ?? null }, i18n.language)
  // With in and out already on the line, `printTimeLabel` would print the
  // arrival a second time — so the last cell carries the verdict instead, which
  // is the part in/out cannot tell you. It uses the SHORT labels: the full ones
  // ("Late past grace") are a third of the column, and the name is what a
  // supervisor reads a duty sheet by.
  const past = minutesPastGrace(row, input)
  const verdict = withInOut
    ? `${t(`attendance.print.verdict.${state}`)}${state === 'late' && past > 0 ? ` +${past}` : ''}`
    : printTimeLabel(row, state, input, t)
  return (
    <div className="flex items-center gap-1 py-px text-[8pt]">
      <span dir="auto" className="min-w-0 flex-1 truncate">
        {name}
      </span>
      {/* The identifier a supervisor reads out and types into a report, so it
          never truncates: a partial G-number is worse than none. */}
      <span className="shrink-0 font-mono text-[7.6pt] tabular-nums text-muted-foreground">
        {row.employee_id}
      </span>
      {withInOut ? (
        // nowrap: "12:46 · 21:09" is a hair over 21mm at this size, and without
        // it the pair folds onto two lines and doubles every row's height.
        <span
          dir="ltr"
          className="isolate-bidi w-[23mm] shrink-0 whitespace-nowrap text-end font-mono text-[7.8pt] tabular-nums"
        >
          {siteTime(row.first_punch_at) || '—'} · {siteTime(row.last_punch_at) || '—'}
        </span>
      ) : null}
      <span
        className={`shrink-0 truncate whitespace-nowrap text-end text-[7.8pt] tabular-nums ${TONE[state]} ${
          needsDecision(state) ? 'font-bold' : ''
        } ${withInOut ? 'w-[18mm]' : 'w-[21mm] font-mono'}`}
      >
        {verdict}
      </span>
    </div>
  )
}

/** Layout `shift`: one whole sheet for one shift. */
function ShiftSheet({
  section,
  index,
  total,
  input,
  operationalDate,
  filterNote,
  foot,
}: {
  section: Section
  index: number
  total: number
  input: StateInput
  operationalDate: string
  filterNote: string | null
  foot: React.JSX.Element
}): React.JSX.Element {
  const { t } = useTranslation()
  const rows = [...section.posts.values()].flat()
  const stats = sectionStats(rows, input)
  const first = rows[0]
  return (
    // Each sheet is its own page. `break-after` on the last one would emit a
    // trailing blank sheet, which is exactly the named-@page hazard documented
    // in index.css.
    <div className="flex min-h-0 flex-col last:break-after-auto break-after-page">
      <Masthead
        subtitle={t('attendance.print.subtitleShift', {
          date: operationalDate,
          index: index + 1,
          total,
        })}
        filterNote={filterNote}
        facts={[
          [t('attendance.print.date'), operationalDate],
          [t('attendance.print.posts'), String(section.posts.size)],
        ]}
      />

      <div className="mt-1.5 flex items-stretch border border-black">
        <div className="w-[52mm] shrink-0 border-e border-black px-2 py-1">
          <ShiftChip code={section.shiftCode} className="text-[15pt]" />
        </div>
        <dl className="w-[50mm] shrink-0 border-e border-black px-2 py-1">
          <dt className="text-[6.4pt] uppercase tracking-[.1em] text-muted-foreground ltr:uppercase">
            {t('attendance.print.window')}
          </dt>
          <dd className="mb-0.5">
            <Window from={first?.scheduled_start_at} to={first?.scheduled_end_at} className="text-[12.5pt] font-extrabold" />
          </dd>
          <dt className="text-[6.4pt] uppercase tracking-[.1em] text-muted-foreground ltr:uppercase">
            {t('attendance.print.unitOnDuty')}
          </dt>
          <dd>
            <Unit name={section.unit} className="text-[11.5pt]" />
          </dd>
        </dl>
        <div className="grid flex-1 grid-cols-6">
          {(
            [
              [t('attendance.print.due'), stats.due, ''],
              [t('attendance.print.seen'), stats.seen, ''],
              [t('attendance.print.grace'), stats.grace, TONE.grace],
              [t('attendance.print.late'), stats.late, TONE.late],
              [t('attendance.print.absent'), stats.absent, TONE.absent],
              [t('attendance.print.unpaired'), stats.unpaired, TONE.unpaired],
            ] as ReadonlyArray<readonly [string, number, string]>
          ).map(([label, value, tone]) => (
            <div key={label} className="border-e border-border-strong px-1.5 py-1 text-center last:border-e-0">
              <dt className="text-[6.4pt] uppercase tracking-[.08em] text-muted-foreground ltr:uppercase">
                {label}
              </dt>
              <dd className={`font-mono text-[15pt] font-extrabold leading-[1.1] tabular-nums ${tone || 'text-black'}`}>
                {value}
              </dd>
            </div>
          ))}
        </div>
      </div>

      <PostColumns section={section} input={input} withInOut columns={3} />

      {/* This is the sheet a supervisor signs and hands over, which is the whole
          reason it costs its own page. */}
      <dl className="mt-3 grid grid-cols-3 gap-4">
        {(
          [
            ['attendance.print.supervisor', 'attendance.print.signature'],
            ['attendance.print.dutyOfficer', 'attendance.print.signature'],
            ['attendance.print.handover', 'attendance.print.nameSignature'],
          ] as ReadonlyArray<readonly [string, string]>
        ).map(([label, rule]) => (
          <div key={label} className="border border-border-strong px-1.5 pb-[7mm] pt-1">
            <dt className="text-[6.6pt] uppercase tracking-[.09em] text-muted-foreground ltr:uppercase">
              {t(label)}
            </dt>
            <dd className="mt-[5mm] border-t border-dotted border-border-strong pt-px text-[6.4pt] text-muted-foreground">
              {t(rule)}
            </dd>
          </div>
        ))}
      </dl>

      {foot}
    </div>
  )
}

/**
 * Legend plus provenance.
 *
 * The legend maps ink to the words the time cells already print, so a mono
 * printout loses nothing. The provenance line answers the two questions asked
 * of any printout found on a desk: where did this come from, and when.
 */
function Foot({
  printLink,
  printedAt,
  operator,
  tail,
}: {
  printLink: string
  printedAt: string
  operator: string | null
  tail: string
}): React.JSX.Element {
  const { t } = useTranslation()
  return (
    <div className="mt-auto border-t border-black pt-1">
      <div className="flex flex-wrap gap-2.5 text-[7pt]">
        {LEGEND_ORDER.map((state) => (
          <span key={state} className={TONE[state]}>
            <i aria-hidden className="not-italic">
              ●
            </i>{' '}
            {t(`attendance.state.${state}`)}
          </span>
        ))}
      </div>
      <div className="mt-0.5 flex flex-wrap items-baseline gap-2.5 text-[7pt] text-muted-foreground">
        <span>
          <Label>{t('attendance.print.source')}</Label>{' '}
          <span dir="ltr" className="isolate-bidi break-all font-mono">
            {printLink}
          </span>
        </span>
        <span>
          <Label>{t('attendance.print.printed')}</Label>{' '}
          <span dir="ltr" className="isolate-bidi font-mono" data-testid="attendance-print-stamp">
            {printedAt}
          </span>
        </span>
        {operator && (
          <span>
            <Label>{t('attendance.print.printedBy')}</Label>{' '}
            <span dir="auto" className="isolate-bidi">
              {operator}
            </span>
          </span>
        )}
        <span className="ms-auto font-mono font-bold tabular-nums">{tail}</span>
      </div>
    </div>
  )
}

function Label({ children }: { children: React.ReactNode }): React.JSX.Element {
  return <span className="text-[6.2pt] uppercase tracking-[.08em] ltr:uppercase">{children}</span>
}
