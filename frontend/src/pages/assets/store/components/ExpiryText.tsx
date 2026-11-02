import { useTranslation } from 'react-i18next'

import { formatExpiry, type ExpiryParts } from '../storeUtils'

/** A Batch expiry: dates as an isolated LTR run; "No expiry" as plain prose so
 *  its Arabic copy keeps the page direction. */
export function ExpiryText({ batch }: { batch: ExpiryParts }): React.JSX.Element {
  const { t } = useTranslation()
  if (batch.expiry_date == null) return <span>{formatExpiry(batch, t)}</span>
  return (
    <bdi dir="ltr" className="whitespace-nowrap font-mono tabular-nums">
      {formatExpiry(batch, t)}
    </bdi>
  )
}
