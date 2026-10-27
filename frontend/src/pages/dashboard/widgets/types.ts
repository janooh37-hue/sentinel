/**
 * Contract between the dashboard grid and every widget.
 *
 * The grid decides each widget's box (columns × rows) and passes the content
 * tier that fits it. A widget renders inside that box at every tier and never
 * returns null: whether a widget is available to the user is decided before
 * layout, so a hidden widget can never leave a hole.
 *
 *   glance  — 1 column × 1 row: the one number that matters + one status line
 *   summary — ≥2 columns × 1 row: number + its breakdown
 *   tall    — 1 column × ≥2 rows: compact list
 *   list    — ≥2 columns × ≥2 rows: number/breakdown + list
 */
export type WidgetTier = 'glance' | 'summary' | 'tall' | 'list'

export interface WidgetProps {
  tier: WidgetTier
  /** Upper bound for preview fetching/candidates; measured viewport decides visibility. */
  rows: number
}
