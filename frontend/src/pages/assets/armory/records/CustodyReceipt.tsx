import type { TFunction } from 'i18next'
import { type ReactNode, useId } from 'react'
import { useTranslation } from 'react-i18next'

import type { ArmoryCustodyReceiptRead } from '@/lib/api'
import { pickEmployeeName } from '@/lib/employeeName'
import type { Lang } from '@/lib/i18n'

import { Ltr } from '../ArmoryLtr'
import { orgDateTime } from '../armoryFormat'
import './custodyReceipt.css'

/** A printable document only: nothing in the live assignment can change its contents. */
export function CustodyReceipt({ receipt, language }: { receipt: ArmoryCustodyReceiptRead; language: string }): React.JSX.Element {
  const { i18n } = useTranslation()
  const primary = language.startsWith('ar') ? 'ar' : 'en'
  const secondary = primary === 'ar' ? 'en' : 'ar'
  const issuedAt = orgDateTime(receipt.issued_at)
  return (
    <div className="armory-custody-document">
      <ReceiptSheet receipt={receipt} issuedAt={issuedAt} lang={primary} t={i18n.getFixedT(primary)} />
      <ReceiptSheet receipt={receipt} issuedAt={issuedAt} lang={secondary} t={i18n.getFixedT(secondary)} />
    </div>
  )
}

function ReceiptSheet({ receipt, issuedAt, lang, t }: { receipt: ArmoryCustodyReceiptRead; issuedAt: string; lang: Lang; t: TFunction }) {
  const titleId = useId()
  const title = t('assets.armory.custodyReceipt')
  return (
    <article className="armory-custody-sheet" lang={lang} dir={lang === 'ar' ? 'rtl' : 'ltr'} aria-labelledby={titleId}>
      <header className="armory-custody-letterhead">
        <img src="/brand/gssg-wordmark.png" alt="" width={1440} height={229} />
        <p>{t('assets.armory.org')}</p>
        <h3 id={titleId}>{title}</h3>
      </header>
      <dl className="armory-custody-paper-meta">
        <PaperField label={t('assets.armory.receiptNumber')}><Ltr>{receipt.record_ref}</Ltr></PaperField>
        <PaperField label={t('assets.armory.signedOutAt')}><Ltr>{issuedAt}</Ltr></PaperField>
        <PaperField label={t('assets.armory.receivedFrom')}><bdi>{pickEmployeeName(receipt.source_safe, lang)}</bdi></PaperField>
        <PaperField label={t(receipt.holder_employee_id === null ? 'assets.armory.holderKind.site' : 'assets.armory.holder')}>
          <bdi>{pickEmployeeName(receipt.holder, lang)}</bdi>
          {receipt.holder_employee_id && <span className="armory-custody-paper-id"><Ltr>{receipt.holder_employee_id}</Ltr></span>}
        </PaperField>
        {receipt.supervisor && (
          <PaperField label={t('assets.armory.siteSupervisor')}>
            <bdi>{pickEmployeeName(receipt.supervisor, lang)}</bdi>
            {receipt.supervisor_employee_id && <span className="armory-custody-paper-id"><Ltr>{receipt.supervisor_employee_id}</Ltr></span>}
          </PaperField>
        )}
        <PaperField label={t('assets.armory.actor')}><bdi>{pickEmployeeName(receipt.armorer, lang)}</bdi></PaperField>
        {receipt.firearm_included && (
          <PaperField label={t('assets.armory.securityNumber')}>
            {receipt.licence_number === null ? t('assets.armory.licenceMissingWarning') : <Ltr>{receipt.licence_number}</Ltr>}
          </PaperField>
        )}
      </dl>
      <table className="armory-custody-paper-lines">
        <caption className="sr-only">{t('assets.armory.custodyPane.lines')}</caption>
        <thead>
          <tr>
            <th scope="col">{t('assets.armory.item')}</th>
            <th scope="col">{t('assets.armory.serialNumber')}</th>
            <th scope="col">{t('assets.armory.quantity')}</th>
          </tr>
        </thead>
        <tbody>
          {receipt.lines.map((line, index) => (
            <tr key={index}>
              <th scope="row"><bdi>{pickEmployeeName(line.item, lang)}</bdi></th>
              <td>{line.serial_code ? <Ltr>{line.serial_code}</Ltr> : t('assets.armory.notApplicable')}</td>
              <td><Ltr>{line.qty}</Ltr></td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="armory-custody-condition">{t('assets.armory.conditionStatement')}</p>
      <dl className="armory-custody-paper-notes">
        <PaperField label={t('assets.armory.conditionNote')}>
          {receipt.condition_note ? <bdi>{receipt.condition_note}</bdi> : t('assets.armory.none')}
        </PaperField>
      </dl>
      <section className="armory-custody-signatures" aria-label={t('assets.armory.receiptSheet.signatures')}>
        <Signature label={t('assets.armory.signatureHolder')} date={t('assets.armory.date')} />
        <Signature label={t('assets.armory.signatureArmorer')} date={t('assets.armory.date')} />
      </section>
    </article>
  )
}

function PaperField({ label, children }: { label: string; children: ReactNode }) {
  return <div><dt>{label}</dt><dd>{children}</dd></div>
}

function Signature({ label, date }: { label: string; date: string }) {
  return (
    <div className="armory-custody-signature">
      <p>{label}</p>
      <p className="armory-custody-signature-date">{date}<span aria-hidden /></p>
    </div>
  )
}
