/**
 * Ledger page — host for the Outlook 3-pane shell.
 *
 * `/ledger` renders `LedgerOutlookShell` (folder rail · message list ·
 * reading-pane slot). The reading pane is `outlook/ReadingPane` +
 * `LedgerEmailCompose`. This page stays a thin host so the smart-link nav
 * callbacks (`openEmployee`/`openBook`) are owned at the page level and
 * threaded into the shell.
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
