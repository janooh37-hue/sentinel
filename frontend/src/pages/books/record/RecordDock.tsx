/**
 * RecordDock — phone-only fixed bottom workflow bar (sign / return / reject)
 * portaled to <body> while the viewer is a decider.
 */

import { createPortal } from 'react-dom'
import { RecordDecisionActions } from '../RecordDecisionActions'
import { cn } from '@/lib/utils'
import type { RecordPieceProps } from './recordActions'


export function RecordDock({ view, actions }: RecordPieceProps): React.JSX.Element {
  const { isMobile, isAr, action, busy, dockHidden } = view
  const { requestSignConfirm, openMobileDecision, mobileDockSignRef } = actions
  return (
    <>
    {isMobile &&
      action === 'decide' &&
      createPortal(
        <div
          dir={isAr ? 'rtl' : 'ltr'}
          data-print-hide
          aria-hidden={dockHidden ? true : undefined}
          inert={dockHidden}
          className={cn(
            'fixed inset-x-0 bottom-[calc(5.5rem+var(--safe-bottom))] z-40 border-t border-hairline bg-surface/95 px-3 pt-2 backdrop-blur md:hidden',
            'pb-[max(0.5rem,var(--safe-bottom))]',
            'transition-opacity motion-reduce:transition-none',
            dockHidden && 'pointer-events-none opacity-0',
          )}
        >
          <RecordDecisionActions
            signButtonRef={mobileDockSignRef}
            busy={busy}
            onSign={() => requestSignConfirm(mobileDockSignRef)}
            onReturn={() => openMobileDecision('return')}
            onReject={() => openMobileDecision('reject')}
          />
        </div>,
        document.body,
      )}
    </>
  )
}
