import { useLayoutEffect, useRef, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { isArabic } from '@/lib/language'
import { STORE_ART_COLORS, STORE_ART_KINDS } from './storeArtCatalog'

function shade(hex: string, amount: number): string {
  const value = Number.parseInt(hex.slice(1), 16)
  return '#' + [value >> 16, (value >> 8) & 255, value & 255].map((channel) => {
    const adjusted = amount < 0 ? channel * (1 + amount) : channel + (255 - channel) * amount
    return Math.round(adjusted).toString(16).padStart(2, '0')
  }).join('')
}

/** Code-drawn shelf recognition; neighbouring text supplies its accessible name. */
export function StoreItemArt({ kind, color, categoryId, size = 48, className, brandLabel, labelEn, labelAr }: {
  kind?: string | null
  color?: string | null
  categoryId?: number | null
  size?: number
  className?: string
  brandLabel?: string | null
  labelEn?: string | null
  labelAr?: string | null
}): React.JSX.Element {
  const { t, i18n } = useTranslation()
  const arabic = isArabic(i18n.language)
  const brand = brandLabel?.trim()
  const drawingKind = STORE_ART_KINDS.find(value => value === kind) ?? 'carton'
  const fallback = t(`assets.store.presentation.genericLabels.${drawingKind}`)
  const label = brand || (arabic ? labelAr?.trim() || fallback : labelEn?.trim() || fallback)
  const lines = label.split('\n')
  const front = ['box', 'gloves', 'mask', 'carton', 'tissue'].includes(kind ?? 'carton')
  const centerX = front ? 53 : 60
  const labelY = kind === 'jar' ? 68 : kind === 'box' ? 72 : kind === 'canister' ? 57 : kind === 'gloves' || kind === 'mask' ? 94 : kind === 'tissue' ? 72 : kind === 'water' ? 69 : kind === 'tins' ? 74 : 67
  const baseline = lines.length > 1 ? Math.min(labelY, 89) : labelY
  const labelWidth = kind === 'canister' ? 43 : kind === 'cups' ? 28 : kind === 'bigcups' ? 38 : kind === 'tins' || kind === 'water' ? 64 : front ? 49 : 52
  const fontSize = lines.some(line => line.length > 9) ? 7.2 : 8.6
  const svgRef = useRef<SVGSVGElement>(null)
  useLayoutEffect(() => {
    let active = true
    const fit = () => {
      if (!active) return
      svgRef.current?.querySelectorAll('text').forEach(text => {
        text.setAttribute('font-size', String(fontSize))
        const width = text.getComputedTextLength?.() ?? 0
        if (width > labelWidth - 4) text.setAttribute('font-size', String(fontSize * (labelWidth - 4) / width))
      })
    }
    fit()
    void document.fonts?.ready.then(fit)
    return () => { active = false }
  }, [label, labelWidth, fontSize, arabic])
  const main = color && /^#[\da-f]{6}$/i.test(color) ? color : STORE_ART_COLORS[Math.abs(categoryId ?? 0) % STORE_ART_COLORS.length]
  const dark = shade(main, -0.22)
  const light = shade(main, 0.18)
  const secondary = shade(main, -0.45)
  const box = (label?: ReactNode) => <>
    <path d="M28 46l12-10h50l-12 10z" fill={light} />
    <path d="M78 46l12-10v58l-12 10z" fill={dark} />
    <rect x="28" y="46" width="50" height="58" fill={main} />
    {label}
  </>
  let drawing: ReactNode
  switch (kind) {
    case 'jar': drawing = <>
      <rect x="33" y="40" width="54" height="62" rx="9" fill={main} />
      <rect x="36" y="28" width="48" height="15" rx="3" fill={secondary} />
      <rect x="33" y="58" width="54" height="24" fill={secondary} />
      <rect x="38" y="44" width="6" height="52" rx="3" fill="#fff" opacity=".18" />
    </>; break
    case 'canister': drawing = <>
      <rect x="38" y="30" width="44" height="72" rx="6" fill={main} stroke="#d9d2c4" />
      <rect x="36" y="24" width="48" height="10" rx="3" fill={secondary} />
      <path d="M38 70h44v14H38z" fill={secondary} />
      <rect x="42" y="36" width="5" height="62" rx="2.5" fill="#fff" opacity=".4" />
    </>; break
    case 'box': drawing = box(<rect x="28" y="64" width="50" height="20" fill={secondary} />); break
    case 'tins': drawing = [38, 60, 82].map((x) => <g key={x}>
      <rect x={x - 10} y="52" width="20" height="44" rx="3" fill={main} />
      <ellipse cx={x} cy="52" rx="10" ry="3" fill="#dcdcdc" />
      <rect x={x - 10} y="66" width="20" height="14" fill={secondary} />
    </g>); break
    case 'water': drawing = <>
      {[34, 48, 62, 76, 90].map((x) => <g key={x}>
        <rect x={x - 6} y="44" width="12" height="54" rx="4" fill="#cfe9f7" />
        <rect x={x - 3} y="38" width="6" height="7" rx="1.5" fill={main} />
        <rect x={x - 6} y="62" width="12" height="12" fill={main} />
      </g>)}
      <rect x="25" y="50" width="72" height="44" rx="5" fill="#fff" opacity=".22" />
    </>; break
    case 'cups': drawing = <>
      {[0, 1, 2, 3, 4].map((i) => <path key={i} d={`M46 ${44 + i * 9}h28l-2 ${i === 4 ? 26 : 9}H48z`} fill={i % 2 ? '#f7f7f4' : '#fff'} stroke="#d9d6cc" />)}
      <path d="M46 44h28" stroke={secondary} strokeWidth="3" />
      <rect x="51" y="84" width="18" height="4" rx="1" fill={secondary} />
    </>; break
    case 'bigcups': drawing = <>
      {[0, 1, 2, 3].map((i) => <path key={i} d={`M40 ${36 + i * 11}h40l-3 ${i === 3 ? 34 : 11}H43z`} fill={i % 2 ? '#f7f7f4' : '#fff'} stroke="#d9d6cc" />)}
      <path d="M40 36h40" stroke={secondary} strokeWidth="3.5" />
      <rect x="48" y="84" width="24" height="6" rx="1" fill={secondary} />
    </>; break
    case 'tissue': drawing = <>
      <path d="M28 52l10-8h52l-10 8z" fill={shade(main, 0.3)} />
      <path d="M80 52l10-8v46l-10 8z" fill={dark} />
      <rect x="28" y="52" width="52" height="46" fill={main} />
      <path d="M47 50q7-16 14 0q-3 4-7 2q-4 2-7-2z" fill="#fff" />
      <path d="M28 80q26-10 52 0v18H28z" fill={shade(main, -0.1)} />
    </>; break
    case 'gloves': drawing = box(<g fill={secondary} transform="translate(40 52)">
      <rect x="4" y="16" width="18" height="22" rx="5" />
      <rect x="4" y="2" width="4" height="18" rx="2" />
      <rect x="9" y="0" width="4" height="20" rx="2" />
      <rect x="14" y="1" width="4" height="19" rx="2" />
      <rect x="19" y="5" width="3.6" height="15" rx="1.8" />
      <rect x="-3" y="20" width="10" height="4" rx="2" transform="rotate(-35 2 22)" />
    </g>); break
    case 'mask': drawing = box(<>
      <path d="M36 64q17-8 34 0v16q-17 8-34 0z" fill={secondary} />
      <path d="M36 68q-6 4 0 10M70 68q6 4 0 10" stroke={secondary} strokeWidth="2" fill="none" />
      <path d="M38 70h30M38 74h30" stroke="#fff" strokeWidth="1" opacity=".6" />
    </>); break
    default: drawing = box(<path d="M53 46v58M53 46l12-10" stroke={secondary} strokeWidth="3" />)
  }
  return <svg ref={svgRef} viewBox="20 20 80 90" width={size} height={size} className={className} aria-hidden="true" focusable="false">
    <ellipse cx="60" cy="105" rx="36" ry="5" fill="#000" opacity=".12" />
    {drawing}
    <g pointerEvents="none">
      <rect x={centerX - labelWidth / 2} y={baseline - 11} width={labelWidth} height={lines.length > 1 ? 23 : 16} rx="1.5" fill="#fffdf7" opacity=".97" />
      {lines.map((line, index) => <text key={index} x={centerX} y={baseline + index * 10} textAnchor="middle" direction={brand || !arabic ? 'ltr' : 'rtl'} style={{ unicodeBidi: 'isolate' }} fontFamily={arabic && !brand ? 'Noto Sans Arabic, sans-serif' : '"Inter Variable", Inter, sans-serif'} fontWeight="700" fontSize={fontSize} fill="#192c40">{line}</text>)}
    </g>
  </svg>
}
