/**
 * Ledger page — host for the Outlook 3-pane shell (Phase 4).
 *
 * Phase 4 rewired `/ledger` to render `LedgerOutlookShell` (folder rail ·
 * message list · reading-pane slot). The old single-column TAMM view
 * (`LedgerTimeline`/`LedgerRow`/`LedgerMobileCard`/`LedgerFilterBar`) and the
 * full-page create/edit/detail/compose machine are NO LONGER the default
 * render — those component files stay in the repo because Phase 5's reading
 * pane (`LedgerEntryDrawer`/`LedgerEmailCompose`/…) still leans on them; they
 * are simply not wired here anymore.
 *
 * This page stays a thin host so the smart-link nav callbacks
 * (`openEmployee`/`openBook`) are owned at the page level and threaded into the
 * shell for Phase 5's reading pane to consume.
 */

import { LedgerOutlookShell } from './outlook/LedgerOutlookShell'

interface LedgerPageProps {
  onNavigate?: (
    page:
      | 'employees'
      | 'books'
      | 'settings'
      | 'application'
      | 'leaves'
      | 'dashboard'
      | 'ledger',
    id?: string,
  ) => void
}

export function LedgerPage({ onNavigate }: LedgerPageProps = {}): React.JSX.Element {
  return <LedgerOutlookShell onNavigate={onNavigate} />
}
