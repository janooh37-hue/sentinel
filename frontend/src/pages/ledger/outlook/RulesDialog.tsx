/**
 * RulesDialog — the Correspondence-Log auto-capture rules editor (Phase 7,
 * Task 5). Opened from the FolderRail ⚙️ button (Task 6), gated `settings.edit`.
 *
 * Lists the rules (`GET /correspondence/rules`) as
 *   When [trigger] [condition] → file as [category]
 * with on/off toggles (PATCH `enabled`), a delete per rule, an ＋ Add-rule
 * builder (trigger Select · a simple key=value condition · category Select with
 * an inline ＋new bilingual category), and a small category list that guards
 * `system` categories (no delete affordance). All CRUD rides the existing
 * `/correspondence/*` endpoints (Phase 3) — no backend change.
 *
 * The real rule shape (not the prototype's free text): `trigger` ∈ 4 enums;
 * `condition_json` is a `dict[str,str]` (e.g. `{category:"HR"}`, `{kind:"incoming"}`,
 * or `{}` = Any); `category_id` is an FK. See
 * backend/app/services/correspondence_service.DEFAULT_RULES.
 *
 * Prototype reference: `.rulemodal`/`.rule`/`.tog`/`.builder`
 * (docs/prototypes/ledger-outlook-redesign.html CSS 372–406, renderRules
 * 1283–1305). Tokens only — no inline hex.
 */

import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { Plus, Trash2 } from 'lucide-react'

import { api } from '@/lib/api'
import type { CorrespondenceCategoryRead, CorrespondenceRuleRead } from '@/lib/api'
import { cn } from '@/lib/utils'
import {
  DialogRoot,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'

/** The four rule triggers (mirror the backend enum). */
const TRIGGERS = [
  'document_generated',
  'book_signed',
  'intake_classified',
  'email_sent',
] as const
type Trigger = (typeof TRIGGERS)[number]

const NEW_CATEGORY = '__new__'

interface RulesDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
}

export function RulesDialog({ open, onOpenChange }: RulesDialogProps): React.JSX.Element {
  const { t, i18n } = useTranslation()
  const qc = useQueryClient()
  const lang = i18n.language

  const rulesQuery = useQuery({
    queryKey: ['correspondence-rules'],
    queryFn: () => api.getCorrespondenceRules(),
    enabled: open,
  })
  const categoriesQuery = useQuery({
    queryKey: ['correspondence-categories'],
    queryFn: () => api.getCorrespondenceCategories(),
    enabled: open,
  })

  const categories = categoriesQuery.data ?? []
  const catById = new Map(categories.map((c) => [c.id, c]))
  const catName = (c: CorrespondenceCategoryRead): string =>
    (lang === 'ar' ? c.name_ar : c.name_en) || c.name_en || c.key

  const invalidateRules = (): void => {
    void qc.invalidateQueries({ queryKey: ['correspondence-rules'] })
  }
  const invalidateCategories = (): void => {
    void qc.invalidateQueries({ queryKey: ['correspondence-categories'] })
  }

  const toggleMutation = useMutation({
    mutationFn: ({ id, enabled }: { id: number; enabled: boolean }) =>
      api.updateCorrespondenceRule(id, { enabled }),
    onSuccess: invalidateRules,
  })
  const deleteRuleMutation = useMutation({
    mutationFn: (id: number) => api.deleteCorrespondenceRule(id),
    onSuccess: invalidateRules,
  })
  const deleteCategoryMutation = useMutation({
    mutationFn: (id: number) => api.deleteCorrespondenceCategory(id),
    onSuccess: invalidateCategories,
  })

  const rules = [...(rulesQuery.data ?? [])].sort((a, b) => a.sort - b.sort || a.id - b.id)

  return (
    <DialogRoot open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-[660px]">
        <DialogHeader>
          <DialogTitle>{t('ledger.outlook.rules.title')}</DialogTitle>
          <DialogDescription>{t('ledger.outlook.rules.description')}</DialogDescription>
        </DialogHeader>

        <div className="min-h-0 flex-1 overflow-y-auto">
          {/* Rules list. */}
          {rules.length === 0 ? (
            <div className="px-4 py-8 text-center text-xs text-muted-foreground" dir="auto">
              {t('ledger.outlook.rules.empty')}
            </div>
          ) : (
            rules.map((rule) => (
              <RuleRow
                key={rule.id}
                rule={rule}
                categoryName={
                  catById.has(rule.category_id) ? catName(catById.get(rule.category_id)!) : '—'
                }
                onToggle={(enabled) => toggleMutation.mutate({ id: rule.id, enabled })}
                onDelete={() => deleteRuleMutation.mutate(rule.id)}
              />
            ))
          )}

          {/* Categories — create + guard system. */}
          <CategoriesSection
            categories={categories}
            catName={catName}
            onDeleteCategory={(id) => deleteCategoryMutation.mutate(id)}
          />

          {/* Add-rule builder. */}
          <RuleBuilder
            categories={categories}
            catName={catName}
            onCreated={invalidateRules}
            onCategoryCreated={invalidateCategories}
            nextSort={(rules.at(-1)?.sort ?? 0) + 10}
          />
        </div>
      </DialogContent>
    </DialogRoot>
  )
}

/** One rule row: toggle · "When [trigger] [cond] → file as [cat]" · delete. */
function RuleRow({
  rule,
  categoryName,
  onToggle,
  onDelete,
}: {
  rule: CorrespondenceRuleRead
  categoryName: string
  onToggle: (enabled: boolean) => void
  onDelete: () => void
}): React.JSX.Element {
  const { t } = useTranslation()
  const off = !rule.enabled
  const condEntries = Object.entries(rule.condition_json ?? {})
  const triggerLabel = t(`ledger.outlook.rules.triggers.${rule.trigger}`)

  return (
    <div
      data-testid="rule-row"
      className={cn(
        'flex flex-wrap items-center gap-2 border-b border-hairline px-4 py-3 text-xs',
        off && 'opacity-60',
      )}
    >
      <button
        type="button"
        role="switch"
        aria-checked={rule.enabled}
        aria-label={t('ledger.outlook.rules.toggle')}
        onClick={() => onToggle(!rule.enabled)}
        className={cn(
          'relative h-[18px] w-8 flex-none rounded-full transition-colors',
          rule.enabled ? 'bg-success' : 'bg-border-strong',
        )}
      >
        <span
          className={cn(
            'absolute top-0.5 h-3.5 w-3.5 rounded-full bg-white transition-all',
            rule.enabled ? 'end-0.5' : 'start-0.5',
          )}
          aria-hidden
        />
      </button>

      <span className="text-muted-foreground">{t('ledger.outlook.rules.when')}</span>
      <span className="rounded-md border border-border bg-surface-tinted px-2 py-0.5 font-semibold text-foreground" dir="auto">
        {triggerLabel}
      </span>
      {condEntries.length > 0 && (
        <span
          className="rounded-md border border-border bg-surface-tinted px-2 py-0.5 font-semibold text-foreground"
          dir="auto"
        >
          {condEntries.map(([k, v]) => `${k}=${v}`).join(', ')}
        </span>
      )}
      <span className="text-faint">{t('ledger.outlook.rules.fileAs')}</span>
      <span className="rounded-md bg-success-soft px-2 py-0.5 font-semibold text-success" dir="auto">
        {categoryName}
      </span>

      <button
        type="button"
        aria-label={t('ledger.outlook.rules.delete')}
        onClick={onDelete}
        className="ms-auto rounded-md p-1 text-faint transition-colors hover:bg-surface-tinted hover:text-accent"
      >
        <Trash2 className="h-3.5 w-3.5" aria-hidden />
      </button>
    </div>
  )
}

/** The category list — create new (bilingual); delete only non-system ones. */
function CategoriesSection({
  categories,
  catName,
  onDeleteCategory,
}: {
  categories: CorrespondenceCategoryRead[]
  catName: (c: CorrespondenceCategoryRead) => string
  onDeleteCategory: (id: number) => void
}): React.JSX.Element {
  const { t } = useTranslation()
  return (
    <div className="border-b border-border bg-surface-raised px-4 py-3">
      <div className="mb-2 text-[0.62rem] font-semibold uppercase tracking-wider text-muted-foreground">
        {t('ledger.outlook.rules.categories')}
      </div>
      <div className="flex flex-wrap gap-1.5">
        {categories.map((c) => (
          <span
            key={c.id}
            data-testid="category-chip"
            className="inline-flex items-center gap-1.5 rounded-md border border-border bg-surface px-2 py-1 text-xs text-foreground"
            dir="auto"
          >
            {catName(c)}
            {/* System categories are protected — no delete affordance. */}
            {!c.system && (
              <button
                type="button"
                aria-label={t('ledger.outlook.rules.deleteCategory')}
                onClick={() => onDeleteCategory(c.id)}
                className="rounded p-0.5 text-faint transition-colors hover:text-accent"
              >
                <Trash2 className="h-3 w-3" aria-hidden />
              </button>
            )}
          </span>
        ))}
      </div>
    </div>
  )
}

/** The ＋ Add-rule builder: trigger · condition (key=value or Any) · category. */
function RuleBuilder({
  categories,
  catName,
  onCreated,
  onCategoryCreated,
  nextSort,
}: {
  categories: CorrespondenceCategoryRead[]
  catName: (c: CorrespondenceCategoryRead) => string
  onCreated: () => void
  onCategoryCreated: () => void
  nextSort: number
}): React.JSX.Element {
  const { t } = useTranslation()
  const [trigger, setTrigger] = useState<Trigger>('document_generated')
  const [condKey, setCondKey] = useState('')
  const [condValue, setCondValue] = useState('')
  // Category select value: a category id (as string), or NEW_CATEGORY, or ''.
  const [categoryValue, setCategoryValue] = useState('')
  const [newNameEn, setNewNameEn] = useState('')
  const [newNameAr, setNewNameAr] = useState('')

  const createCategoryMutation = useMutation({
    mutationFn: () =>
      api.createCorrespondenceCategory({
        // A simple slug key from the EN name; the backend stores name_en/name_ar.
        key: newNameEn.trim().toLowerCase().replace(/\s+/g, '_').slice(0, 64) || `cat_${Date.now()}`,
        name_en: newNameEn.trim(),
        name_ar: newNameAr.trim(),
        sort: (categories.at(-1)?.sort ?? 0) + 10,
      }),
    onSuccess: (created) => {
      onCategoryCreated()
      setCategoryValue(String(created.id))
      setNewNameEn('')
      setNewNameAr('')
    },
  })

  const createRuleMutation = useMutation({
    mutationFn: () => {
      const condition_json: Record<string, string> =
        condKey.trim() && condValue.trim() ? { [condKey.trim()]: condValue.trim() } : {}
      return api.createCorrespondenceRule({
        trigger,
        condition_json,
        category_id: Number(categoryValue),
        enabled: true,
        sort: nextSort,
      })
    },
    onSuccess: () => {
      onCreated()
      setCondKey('')
      setCondValue('')
    },
  })

  const creatingNewCategory = categoryValue === NEW_CATEGORY
  const canSave =
    categoryValue !== '' && !creatingNewCategory && !createRuleMutation.isPending

  return (
    <div className="border-t-2 border-primary/30 bg-primary-soft px-4 py-3.5">
      <div className="mb-2 text-[0.62rem] font-semibold uppercase tracking-wider text-primary">
        {t('ledger.outlook.rules.newRule')}
      </div>

      <div className="flex flex-wrap items-center gap-2 text-xs text-foreground">
        <span>{t('ledger.outlook.rules.when')}</span>
        <Select value={trigger} onValueChange={(v) => setTrigger(v as Trigger)}>
          <SelectTrigger className="h-8 w-auto min-w-[150px]" aria-label={t('ledger.outlook.rules.when')}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {TRIGGERS.map((tr) => (
              <SelectItem key={tr} value={tr}>
                {t(`ledger.outlook.rules.triggers.${tr}`)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <span>{t('ledger.outlook.rules.condition')}</span>
        <Input
          value={condKey}
          onChange={(e) => setCondKey(e.target.value)}
          placeholder={t('ledger.outlook.rules.condKey')}
          aria-label={t('ledger.outlook.rules.condKey')}
          className="h-8 w-28"
        />
        <span className="text-faint">=</span>
        <Input
          value={condValue}
          onChange={(e) => setCondValue(e.target.value)}
          placeholder={t('ledger.outlook.rules.condValue')}
          aria-label={t('ledger.outlook.rules.condValue')}
          className="h-8 w-28"
        />

        <span className="text-faint">{t('ledger.outlook.rules.fileAs')}</span>
        <Select value={categoryValue} onValueChange={setCategoryValue}>
          <SelectTrigger className="h-8 w-auto min-w-[150px]" aria-label={t('ledger.outlook.rules.fileAs')}>
            <SelectValue placeholder={t('ledger.outlook.rules.pickCategory')} />
          </SelectTrigger>
          <SelectContent>
            {categories.map((c) => (
              <SelectItem key={c.id} value={String(c.id)}>
                {catName(c)}
              </SelectItem>
            ))}
            <SelectItem value={NEW_CATEGORY}>{t('ledger.outlook.rules.newCategory')}</SelectItem>
          </SelectContent>
        </Select>

        <button
          type="button"
          disabled={!canSave}
          onClick={() => createRuleMutation.mutate()}
          className="ms-auto inline-flex items-center gap-1.5 rounded-md bg-info px-3 py-1.5 text-xs font-semibold text-white transition-colors hover:bg-info/90 disabled:cursor-not-allowed disabled:opacity-50"
        >
          <Plus className="h-3.5 w-3.5" aria-hidden />
          {t('ledger.outlook.rules.save')}
        </button>
      </div>

      {/* Inline new-category create, revealed when ＋ new category is chosen. */}
      {creatingNewCategory && (
        <div className="mt-2.5 flex flex-wrap items-center gap-2 rounded-md border border-border bg-surface p-2.5 text-xs">
          <Input
            value={newNameEn}
            onChange={(e) => setNewNameEn(e.target.value)}
            placeholder={t('ledger.outlook.rules.nameEn')}
            aria-label={t('ledger.outlook.rules.nameEn')}
            className="h-8 w-40"
          />
          <Input
            value={newNameAr}
            onChange={(e) => setNewNameAr(e.target.value)}
            placeholder={t('ledger.outlook.rules.nameAr')}
            aria-label={t('ledger.outlook.rules.nameAr')}
            className="h-8 w-40"
            dir="rtl"
          />
          <button
            type="button"
            disabled={!newNameEn.trim() || createCategoryMutation.isPending}
            onClick={() => createCategoryMutation.mutate()}
            className="rounded-md bg-info px-3 py-1.5 text-xs font-semibold text-white transition-colors hover:bg-info/90 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {t('ledger.outlook.rules.addCategory')}
          </button>
        </div>
      )}
    </div>
  )
}
