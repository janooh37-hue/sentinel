'use strict'
// Fixed drawings in StoreItemArt's flat language and frame (viewBox 20 20 80 90,
// floor shadow). Managers choose a drawing kind, not its shape or colours.

window.UNIFORM_ART_KINDS = [
  { kind: 'suit', en: 'Suit', ar: 'بدلة' },
  { kind: 'shoes', en: 'Shoes', ar: 'حذاء' },
  { kind: 'boots', en: 'Boots', ar: 'حذاء ميداني' },
  { kind: 'polo', en: 'Polo shirt', ar: 'قميص بولو' },
  { kind: 'cargo', en: 'Trousers', ar: 'بنطال' },
  { kind: 'belt', en: 'Belt', ar: 'حزام' },
  { kind: 'cap', en: 'Cap', ar: 'قبعة' },
  { kind: 'socks', en: 'Socks', ar: 'جوارب' },
  { kind: 'jacket', en: 'Field jacket', ar: 'سترة ميدانية' },
  { kind: 'tshirt', en: 'Undershirt', ar: 'قميص داخلي' },
  { kind: 'beret', en: 'Beret', ar: 'قبعة عسكرية' },
  { kind: 'gloves', en: 'Work gloves', ar: 'قفازات عمل' },
  { kind: 'vest', en: 'Security vest', ar: 'سترة أمنية عاكسة' },
  { kind: 'raincoat', en: 'Raincoat', ar: 'معطف مطر' },
  { kind: 'generic', en: 'Folded garments', ar: 'ملابس مطوية' },
]

function shade(hex, amount) {
  const v = Number.parseInt(hex.slice(1), 16)
  return '#' + [v >> 16, (v >> 8) & 255, v & 255].map(c => {
    const n = Math.round(amount < 0 ? c * (1 + amount) : c + (255 - c) * amount)
    return Math.max(0, Math.min(255, n)).toString(16).padStart(2, '0')
  }).join('')
}

const KHAKI = '#c9b38e'
const OLIVE = '#556642'

// The unit's globe badge from the photo: red target ring around a blue globe.
const badge = (x, y, r = 5) => `<g transform="translate(${x} ${y})"><circle r="${r}" fill="#fff" stroke="#c8102e" stroke-width="${r * 0.28}"/><circle r="${r * 0.68}" fill="#2a5aa0"/><path d="M${-r * 0.4} ${-r * 0.2}q${r * 0.3} ${-r * 0.4} ${r * 0.6} 0q${-r * 0.1} ${r * 0.4} ${-r * 0.6} 0zM${r * 0.1} ${r * 0.15}q${r * 0.3} ${-r * 0.1} ${r * 0.4} ${r * 0.3}l${-r * 0.3} ${r * 0.2}z" fill="#e9eef5"/><path d="M0 ${-r * 1.15}v${r * 0.5}M0 ${r * 1.15}v${-r * 0.5}M${-r * 1.15} 0h${r * 0.5}M${r * 1.15} 0h${-r * 0.5}" stroke="#c8102e" stroke-width="${r * 0.18}"/></g>`

const DRAW = {
  suit() {
    const navy = '#22345a', dark = shade(navy, -0.3), trousers = shade(navy, -0.18)
    return `<path d="M60 30q0-6 4-6t3 4" fill="none" stroke="#8a8f98" stroke-width="1.6" stroke-linecap="round"/>
      <path d="M44 82h15l-1 22H46zM61 82h15l-2 22H62z" fill="${trousers}"/>
      <path d="M46 104h12M62 104h12" stroke="${dark}" stroke-width="1.4"/>
      <path d="M38 38q-8 3-9 12l-2 32h8l2-30z" fill="${dark}"/><path d="M82 38q8 3 9 12l2 32h-8l-2-30z" fill="${dark}"/>
      <path d="M38 38l12-5 10 12 10-12 12 5 3 46H35z" fill="${navy}"/>
      <path d="M51 34l9 30 9-30-9 9z" fill="#fff"/><path d="M51 34l4 7 5-2zM69 34l-4 7-5-2z" fill="#e9e7e1"/>
      <circle cx="60" cy="50" r=".9" fill="#c9c6bd"/><circle cx="60" cy="56" r=".9" fill="#c9c6bd"/>
      <path d="M50 33l-5 13 6 1 9 19-8-28zM70 33l5 13-6 1-9 19 8-28z" fill="${dark}"/>
      <path d="M60 66v18" stroke="${dark}" stroke-width="1"/>
      <circle cx="62.5" cy="71" r="1.3" fill="${dark}"/><circle cx="62.5" cy="77" r="1.3" fill="${dark}"/>
      <path d="M40 73h12v2.6H40zM68 73h12v2.6H68z" fill="${dark}"/>
      ${badge(74, 52, 4.4)}`
  },
  shoes() {
    const shoe = (dx, dy, fill) => `<g transform="translate(${dx} ${dy})">
      <path d="M30 100V87q0-8 8-9l10-1q4 6 12 8l16 3q12 2 12 10v2z" fill="${fill}"/>
      <path d="M28 99h64q2 0 2 2v2q0 2-2 2H30q-2 0-2-2z" fill="#fff" stroke="#d9d6cc" stroke-width=".8"/>
      <path d="M50 80l7 2.4M53 77.6l7 2.4" stroke="#fff" stroke-width="1.8" stroke-linecap="round"/></g>`
    return shoe(-8, -9, '#3a3d45') + shoe(4, 0, '#1d1f24')
  },
  boots() {
    const tan = '#c8a57a'
    const boot = (dx, dy, fill) => `<g transform="translate(${dx} ${dy})">
      <path d="M34 100V62q0-4 4-4h16q4 0 4 4v18q4 3 14 5l12 3q8 2 8 9v3z" fill="${fill}"/>
      <rect x="34" y="57" width="24" height="5" rx="2" fill="${shade(fill, -0.2)}"/>
      <path d="M48 64l8 4M56 64l-8 4M48 71l8 4M56 71l-8 4M50 78l8 3" stroke="${shade(fill, -0.45)}" stroke-width="1.2" stroke-linecap="round"/>
      <path d="M32 99h66v5q0 2-2 2H34q-2 0-2-2z" fill="#6b4a2b"/>
      <path d="M38 106v-2M46 106v-2M54 106v-2M62 106v-2M70 106v-2M78 106v-2M86 106v-2M94 106v-2" stroke="#4a321c" stroke-width="2"/></g>`
    return boot(-10, -10, shade(tan, -0.12)) + boot(0, 0, tan)
  },
  polo() {
    const dark = shade(OLIVE, -0.28)
    return `<path d="M45 32l-9 4-13 13 9 10 6-6v49h44V53l6 6 9-10-13-13-9-4q-15 7-30 0z" fill="${OLIVE}"/>
      <path d="M32 59l-9-10M88 59l9-10" stroke="${dark}" stroke-width="2"/>
      <path d="M45 32l7 12 8-7zM75 32l-7 12-8-7z" fill="${dark}"/>
      <rect x="57" y="38" width="6" height="18" rx="1" fill="${shade(OLIVE, -0.12)}" stroke="${dark}" stroke-width=".6"/>
      <circle cx="60" cy="44" r="1.4" fill="#b9bdb3"/><circle cx="60" cy="50" r="1.4" fill="#b9bdb3"/>
      <path d="M38 99h44" stroke="${dark}" stroke-width="1.4"/>
      ${badge(72, 55, 4.6)}`
  },
  cargo() {
    const dark = shade(KHAKI, -0.3), light = shade(KHAKI, 0.12)
    return `<rect x="36" y="28" width="48" height="8" rx="1" fill="${shade(KHAKI, -0.1)}"/>
      <path d="M41 28v8M54 28v8M66 28v8M79 28v8" stroke="${dark}" stroke-width="1.6"/>
      <path d="M36 36h48l2 68H64l-4-48-4 48H34z" fill="${KHAKI}"/>
      <path d="M60 36v20M60 56l-3-6" stroke="${dark}" stroke-width="1" fill="none"/>
      <path d="M38 39q6 6 12 0M82 39q-6 6-12 0" stroke="${dark}" stroke-width="1" fill="none"/>
      <rect x="35.5" y="63" width="13" height="17" rx="1.5" fill="${light}" stroke="${dark}" stroke-width=".8"/>
      <rect x="35" y="62" width="14" height="5" rx="1" fill="${shade(KHAKI, -0.08)}" stroke="${dark}" stroke-width=".8"/>
      <rect x="72" y="63" width="13" height="17" rx="1.5" fill="${light}" stroke="${dark}" stroke-width=".8"/>
      <rect x="71.5" y="62" width="14" height="5" rx="1" fill="${shade(KHAKI, -0.08)}" stroke="${dark}" stroke-width=".8"/>
      <path d="M34.5 99h22M64 99h22" stroke="${dark}" stroke-width="1.2"/>`
  },
  belt() {
    const brown = '#7a5233'
    return `<path d="M30 68a30 17 0 0 1 60 0" fill="none" stroke="${shade(brown, -0.3)}" stroke-width="10"/>
      <path d="M30 68a30 17 0 0 0 60 0" fill="none" stroke="${brown}" stroke-width="10"/>
      <path d="M32 66a28 15 0 0 0 56 0" fill="none" stroke="${shade(brown, 0.2)}" stroke-width="1" opacity=".7"/>
      <circle cx="78" cy="80.5" r="1.2" fill="${shade(brown, -0.5)}"/><circle cx="83" cy="77.5" r="1.2" fill="${shade(brown, -0.5)}"/><circle cx="87" cy="74" r="1.2" fill="${shade(brown, -0.5)}"/>
      <rect x="49" y="77" width="22" height="15" rx="2" fill="#a9adb3" stroke="#7d828a" stroke-width="1"/>
      <rect x="53" y="80.5" width="14" height="8" rx="1" fill="#c9ccd1"/>`
  },
  cap() {
    const dark = shade(KHAKI, -0.3)
    return `<path d="M32 80q0-34 28-36 28 2 28 36z" fill="${KHAKI}"/>
      <path d="M60 44v36M60 44q-14 8-16 36M60 44q14 8 16 36" stroke="${dark}" stroke-width=".9" fill="none"/>
      <circle cx="60" cy="44.5" r="2.2" fill="${dark}"/>
      <path d="M32 80h56" stroke="${dark}" stroke-width="2"/>
      <path d="M30 81q30-5 60 0-5 15-30 15T30 81z" fill="${shade(KHAKI, -0.18)}"/>
      <path d="M36 84q24-3 48 0" stroke="${dark}" stroke-width=".8" fill="none"/>
      ${badge(60, 66, 6)}`
  },
  socks() {
    const sock = (dx, dy, fill) => `<g transform="translate(${dx} ${dy})">
      <path d="M38 34h18v38l18 10q8 4 4 12-4 6-12 2L42 84q-6-3-4-10z" fill="${fill}"/>
      <rect x="38" y="34" width="18" height="9" fill="${shade(fill, -0.18)}"/>
      <path d="M42 34v9M46 34v9M50 34v9M54 34v9" stroke="${shade(fill, -0.35)}" stroke-width=".8"/>
      <path d="M66 96q4 2 8-1 4-4 1-9z" fill="${shade(fill, -0.2)}"/>
      <path d="M38 76q2 7 8 9l-2-11z" fill="${shade(fill, -0.2)}"/></g>`
    return sock(12, -6, shade('#c4ac82', -0.12)) + sock(0, 2, '#c4ac82')
  },
  jacket() {
    const dark = shade(KHAKI, -0.3), light = shade(KHAKI, 0.12)
    return `<path d="M40 37l-9 6-7 50 10 2 9-38zM80 37l9 6 7 50-10 2-9-38z" fill="${shade(KHAKI, -0.12)}"/>
      <path d="M40 37l10-5h20l10 5 3 65H37z" fill="${KHAKI}"/>
      <path d="M50 32l10 10 10-10-2-5H52z" fill="${dark}"/>
      <path d="M51 28l-5 13 9 4 5-11 5 11 9-4-5-13-9 6z" fill="${shade(KHAKI, -0.08)}"/>
      <path d="M60 41v60" stroke="${dark}" stroke-width="2"/>
      <rect x="61" y="45" width="2.6" height="6" rx=".8" fill="#7d828a"/>
      <path d="M41 51h14v14H41zM65 51h14v14H65z" fill="${light}"/>
      <path d="M40 50h16v5l-8 3-8-3zM64 50h16v5l-8 3-8-3z" fill="${shade(KHAKI, -0.15)}"/>
      <path d="M41 78h13v17H41zM66 78h13v17H66z" fill="${shade(KHAKI, -0.08)}"/>
      <path d="M41 78h13M66 78h13M25 89l10 2M85 91l10-2M38 98h44" stroke="${dark}" stroke-width="1.4"/>
      <circle cx="48" cy="54" r="1" fill="${dark}"/><circle cx="72" cy="54" r="1" fill="${dark}"/>`
  },
  tshirt() {
    const cotton = '#f2f0e8', seam = '#b8b6ad'
    return `<path d="M46 33l-10 4-13 15 10 11 8-7v46h38V56l8 7 10-11-13-15-10-4q-14 8-28 0z" fill="${cotton}" stroke="${seam}" stroke-width="1" stroke-linejoin="round"/>
      <path d="M46 33q14 20 28 0" fill="none" stroke="${seam}" stroke-width="3"/>
      <path d="M49 34q11 13 22 0" fill="#d9d6cc"/>
      <path d="M33 59l-8-9M87 59l8-9M41 98h38" stroke="${seam}" stroke-width="1.2" fill="none"/>
      <path d="M42 57v37M78 57v37" stroke="#e1ded5" stroke-width="1.3"/>`
  },
  beret() {
    const navy = '#22345a', dark = shade(navy, -0.35)
    return `<path d="M28 73q-5-14 6-24 12-12 35-11 19 0 24 13 7 19-10 29L38 82z" fill="${navy}"/>
      <path d="M28 69q21 7 55-2l1 13-46 2q-8-4-10-13z" fill="${shade(navy, -0.16)}"/>
      <path d="M36 78q24 4 48-2l-1 9q-25 6-46 1z" fill="${dark}"/>
      <path d="M68 40q14 6 15 19" stroke="${shade(navy, 0.15)}" stroke-width="1.3" fill="none"/>
      ${badge(47, 68, 6)}`
  },
  gloves() {
    const glove = (dx, dy, angle, fill) => `<g transform="translate(${dx} ${dy}) rotate(${angle} 45 69)">
      <path d="M31 86l-3-24q-.6-5 3-5 3 0 4 5l2 8V43q0-4 3-4t3 4v19-26q0-4 3-4t3 4v26-24q0-4 3-4t3 4v25-18q0-4 3-4t3 4v32q0 12-7 18z" fill="${fill}"/>
      <path d="M37 67q8-5 17 0v18H38z" fill="${shade(fill, 0.12)}"/>
      <path d="M37 48v15M43 43v19M49 42v20M55 48v16M35 74l3 11" stroke="${shade(fill, -0.28)}" stroke-width="1" fill="none" stroke-linecap="round"/>
      <path d="M31 85l24 1-1 14H33z" fill="${OLIVE}"/>
      <path d="M33 91h20" stroke="${shade(OLIVE, -0.25)}" stroke-width="1.4"/></g>`
    return glove(25, -2, 14, shade(KHAKI, -0.13)) + glove(-6, 2, -14, KHAKI)
  },
  vest() {
    const dark = shade(OLIVE, -0.3), reflective = '#d9ddd4'
    return `<path d="M42 31l10 1 8 16 8-16 10-1q-3 23 10 29v41H32V60q13-6 10-29z" fill="${OLIVE}"/>
      <path d="M42 31l10 1 8 16 8-16 10-1M32 60q13-6 10-29M88 60q-13-6-10-29" fill="none" stroke="${dark}" stroke-width="1.5"/>
      <path d="M45 34h6v34h-6zM69 34h6v34h-6zM32 69h56v7H32zM32 88h56v7H32z" fill="${reflective}"/>
      <path d="M60 48v53" stroke="${dark}" stroke-width="2.4"/>
      <path d="M37 79h16v6H37zM67 79h16v6H67z" fill="${dark}"/>
      ${badge(74, 55, 4.3)}`
  },
  raincoat() {
    const navy = '#22345a', dark = shade(navy, -0.3), light = shade(navy, 0.18)
    return `<path d="M47 43q-5-20 13-20t13 20l-13 8z" fill="${navy}"/>
      <path d="M49 40q-1-12 11-13 12 1 11 13L60 49z" fill="${dark}"/>
      <path d="M40 46l-9 6-7 31 10 3 10-23zM80 46l9 6 7 31-10 3-10-23z" fill="${shade(navy, -0.12)}"/>
      <path d="M40 46l9-5 11 8 11-8 9 5 2 58H38z" fill="${navy}"/>
      <path d="M40 46l20 9 20-9v14H40z" fill="${light}"/>
      <path d="M60 49v55" stroke="${dark}" stroke-width="3"/>
      <path d="M62 55v43" stroke="${light}" stroke-width="1"/>
      <path d="M40 78l12-4M68 74l12 4" stroke="${dark}" stroke-width="3" stroke-linecap="round"/>
      <path d="M49 41l2 13M71 41l-2 13" stroke="#a9adb3" stroke-width="1.2"/>
      <path d="M39 100h42M25 80l10 3M85 83l10-3" stroke="${dark}" stroke-width="1.3"/>
      <circle cx="58" cy="68" r="1" fill="#a9adb3"/><circle cx="58" cy="84" r="1" fill="#a9adb3"/>`
  },
  generic() {
    const navy = '#22345a'
    return `<rect x="29" y="82" width="62" height="21" rx="4" fill="${shade(navy, -0.15)}"/>
      <path d="M34 88h52M34 99h52" stroke="${shade(navy, 0.12)}" stroke-width="1.3"/>
      <rect x="32" y="65" width="57" height="22" rx="4" fill="${OLIVE}"/>
      <path d="M37 82h47" stroke="${shade(OLIVE, -0.3)}" stroke-width="1.4"/>
      <rect x="28" y="45" width="62" height="25" rx="4" fill="${KHAKI}"/>
      <path d="M32 45l12-9h31l11 9" fill="${shade(KHAKI, 0.12)}"/>
      <path d="M48 37l11 10 12-10M59 47v21" fill="none" stroke="${shade(KHAKI, -0.25)}" stroke-width="1.5"/>
      <path d="M32 65h22M64 65h22" stroke="${shade(KHAKI, -0.2)}" stroke-width="1.2"/>
      <rect x="69" y="51" width="12" height="9" rx="1" fill="${shade(KHAKI, -0.1)}"/>`
  },
}

window.uniformArt = (kind, cls = 'art') =>
  `<svg class="${cls}" viewBox="20 20 80 90" aria-hidden="true" focusable="false"><ellipse cx="60" cy="106" rx="36" ry="4.5" fill="#000" opacity=".12"/>${Object.hasOwn(DRAW, kind) ? DRAW[kind]() : DRAW.generic()}</svg>`
