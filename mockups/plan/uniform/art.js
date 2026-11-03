'use strict'
// Fixed silhouettes in StoreItemArt's flat frame (viewBox 20 20 80 90, floor shadow).
// An optional main colour changes fabric only; badges, metal and safety trim stay fixed.

window.UNIFORM_ART_GROUPS = [
  { id: 'tops', en: 'Shirts and knitwear', ar: 'قمصان وملابس محبوكة' },
  { id: 'outerwear', en: 'Jackets and workwear', ar: 'سترات ومعاطف وملابس عمل' },
  { id: 'bottoms', en: 'Trousers and shorts', ar: 'بناطيل وسراويل قصيرة' },
  { id: 'headwear', en: 'Headwear', ar: 'أغطية الرأس' },
  { id: 'footwear', en: 'Footwear', ar: 'أحذية' },
  { id: 'accessories', en: 'Accessories', ar: 'ملحقات الملابس' },
]

window.UNIFORM_ART_KINDS = [
  { kind: 'suit', en: 'Suit', ar: 'بدلة', group: 'outerwear', defaultColor: '#22345a' },
  { kind: 'shoes', en: 'Shoes', ar: 'حذاء', group: 'footwear', defaultColor: '#1d1f24' },
  { kind: 'boots', en: 'Boots', ar: 'حذاء ميداني', group: 'footwear', defaultColor: '#c8a57a' },
  { kind: 'polo', en: 'Polo shirt', ar: 'قميص بولو', group: 'tops', defaultColor: '#556642' },
  { kind: 'cargo', en: 'Cargo trousers', ar: 'بنطال بجيوب جانبية', group: 'bottoms', defaultColor: '#c9b38e' },
  { kind: 'belt', en: 'Belt', ar: 'حزام', group: 'accessories', defaultColor: '#7a5233' },
  { kind: 'cap', en: 'Cap', ar: 'قبعة', group: 'headwear', defaultColor: '#c9b38e' },
  { kind: 'socks', en: 'Socks', ar: 'جوارب', group: 'accessories', defaultColor: '#c4ac82' },
  { kind: 'jacket', en: 'Field jacket', ar: 'سترة ميدانية', group: 'outerwear', defaultColor: '#c9b38e' },
  { kind: 'tshirt', en: 'Undershirt', ar: 'قميص داخلي', group: 'tops', defaultColor: '#f2f0e8' },
  { kind: 'beret', en: 'Beret', ar: 'قبعة عسكرية', group: 'headwear', defaultColor: '#22345a' },
  { kind: 'gloves', en: 'Work gloves', ar: 'قفازات عمل', group: 'accessories', defaultColor: '#c9b38e' },
  { kind: 'vest', en: 'Security vest', ar: 'سترة أمنية عاكسة', group: 'outerwear', defaultColor: '#556642' },
  { kind: 'raincoat', en: 'Raincoat', ar: 'معطف مطر', group: 'outerwear', defaultColor: '#22345a' },
  { kind: 'generic', en: 'Folded garments', ar: 'ملابس مطوية', group: 'accessories', defaultColor: '#c9b38e' },
  { kind: 'parka', en: 'Padded winter jacket', ar: 'سترة شتوية مبطنة', group: 'outerwear', defaultColor: '#556642' },
  { kind: 'fleece', en: 'Fleece jacket', ar: 'سترة صوف صناعي', group: 'outerwear', defaultColor: '#22345a' },
  { kind: 'sweater', en: 'Sweater', ar: 'كنزة محبوكة', group: 'tops', defaultColor: '#6b1e2a' },
  { kind: 'hoodie', en: 'Hoodie', ar: 'كنزة بغطاء رأس', group: 'tops', defaultColor: '#72777d' },
  { kind: 'beanie', en: 'Winter hat', ar: 'قبعة شتوية محبوكة', group: 'headwear', defaultColor: '#22345a' },
  { kind: 'scarf', en: 'Scarf', ar: 'وشاح', group: 'accessories', defaultColor: '#6b1e2a' },
  { kind: 'thermal', en: 'Thermal undershirt', ar: 'قميص داخلي حراري', group: 'tops', defaultColor: '#e0ddd4' },
  { kind: 'dressshirt', en: 'Formal shirt', ar: 'قميص رسمي', group: 'tops', defaultColor: '#e8edf2' },
  { kind: 'tie', en: 'Tie', ar: 'ربطة عنق', group: 'accessories', defaultColor: '#6b1e2a' },
  { kind: 'blazer', en: 'Blazer', ar: 'سترة رسمية', group: 'outerwear', defaultColor: '#22345a' },
  { kind: 'trousers', en: 'Formal trousers', ar: 'بنطال رسمي', group: 'bottoms', defaultColor: '#363b45' },
  { kind: 'coverall', en: 'Work coverall', ar: 'بدلة عمل كاملة', group: 'outerwear', defaultColor: '#556642' },
  { kind: 'shorts', en: 'Shorts', ar: 'سروال قصير', group: 'bottoms', defaultColor: '#c9b38e' },
  { kind: 'longsleeve', en: 'Long-sleeve polo', ar: 'قميص بولو بأكمام طويلة', group: 'tops', defaultColor: '#556642' },
]

function shade(hex, amount) {
  const v = Number.parseInt(hex.slice(1), 16)
  return '#' + [v >> 16, (v >> 8) & 255, v & 255].map(c => {
    const n = Math.round(amount < 0 ? c * (1 + amount) : c + (255 - c) * amount)
    return Math.max(0, Math.min(255, n)).toString(16).padStart(2, '0')
  }).join('')
}

// Fabric seams are lighter on dark custom colours so folds survive thumbnail scale.
function fabricDetail(color) {
  const value = Number.parseInt(color.slice(1), 16)
  const brightness = ((value >> 16) * 299 + ((value >> 8) & 255) * 587 + (value & 255) * 114) / 1000
  return shade(color, brightness < 130 ? 0.32 : -0.3)
}

// The unit's globe badge from the photo: red target ring around a blue globe.
const badge = (x, y, r = 5, color) => `<g transform="translate(${x} ${y})"${color ? ' stroke="none"' : ''}><circle r="${r}" fill="#fff" stroke="#c8102e" stroke-width="${r * 0.28}"/><circle r="${r * 0.68}" fill="#2a5aa0"/><path d="M${-r * 0.4} ${-r * 0.2}q${r * 0.3} ${-r * 0.4} ${r * 0.6} 0q${-r * 0.1} ${r * 0.4} ${-r * 0.6} 0zM${r * 0.1} ${r * 0.15}q${r * 0.3} ${-r * 0.1} ${r * 0.4} ${r * 0.3}l${-r * 0.3} ${r * 0.2}z" fill="#e9eef5"/><path d="M0 ${-r * 1.15}v${r * 0.5}M0 ${r * 1.15}v${-r * 0.5}M${-r * 1.15} 0h${r * 0.5}M${r * 1.15} 0h${-r * 0.5}" stroke="#c8102e" stroke-width="${r * 0.18}"/></g>`

const DRAW = {
  suit(color) {
    const navy = color || '#22345a', dark = shade(navy, -0.3), trousers = shade(navy, -0.18)
    return `<path d="M60 30q0-6 4-6t3 4" fill="none" stroke="#8a8f98" stroke-width="1.6" stroke-linecap="round"/>
      <path d="M44 82h15l-1 22H46zM61 82h15l-2 22H62z" fill="${trousers}"/>
      <path d="M46 104h12M62 104h12" stroke="${dark}" stroke-width="1.4"/>
      <path d="M38 38q-8 3-9 12l-2 32h8l2-30z" fill="${dark}"/><path d="M82 38q8 3 9 12l2 32h-8l-2-30z" fill="${dark}"/>
      <path d="M38 38l12-5 10 12 10-12 12 5 3 46H35z" fill="${navy}"/>
      <path d="M51 34l9 30 9-30-9 9z" fill="#fff"${color ? ' stroke="none"' : ''}/><path d="M51 34l4 7 5-2zM69 34l-4 7-5-2z" fill="#e9e7e1"${color ? ' stroke="none"' : ''}/>
      <circle cx="60" cy="50" r=".9" fill="#c9c6bd"${color ? ' stroke="none"' : ''}/><circle cx="60" cy="56" r=".9" fill="#c9c6bd"${color ? ' stroke="none"' : ''}/>
      <path d="M50 33l-5 13 6 1 9 19-8-28zM70 33l5 13-6 1-9 19 8-28z" fill="${dark}"/>
      <path d="M60 66v18" stroke="${dark}" stroke-width="1"/>
      <circle cx="62.5" cy="71" r="1.3" fill="${dark}"/><circle cx="62.5" cy="77" r="1.3" fill="${dark}"/>
      <path d="M40 73h12v2.6H40zM68 73h12v2.6H68z" fill="${dark}"/>
      ${badge(74, 52, 4.4, color)}`
  },
  shoes(color) {
    const shoe = (dx, dy, fill) => `<g transform="translate(${dx} ${dy})">
      <path d="M30 100V87q0-8 8-9l10-1q4 6 12 8l16 3q12 2 12 10v2z" fill="${fill}"/>
      <path d="M28 99h64q2 0 2 2v2q0 2-2 2H30q-2 0-2-2z" fill="#fff" stroke="#d9d6cc" stroke-width=".8"/>
      <path d="M50 80l7 2.4M53 77.6l7 2.4" stroke="#fff" stroke-width="1.8" stroke-linecap="round"/></g>`
    return shoe(-8, -9, color ? shade(color, 0.15) : '#3a3d45') + shoe(4, 0, color || '#1d1f24')
  },
  boots(color) {
    const tan = color || '#c8a57a'
    const boot = (dx, dy, fill) => `<g transform="translate(${dx} ${dy})">
      <path d="M34 100V62q0-4 4-4h16q4 0 4 4v18q4 3 14 5l12 3q8 2 8 9v3z" fill="${fill}"/>
      <rect x="34" y="57" width="24" height="5" rx="2" fill="${shade(fill, -0.2)}"/>
      <path d="M48 64l8 4M56 64l-8 4M48 71l8 4M56 71l-8 4M50 78l8 3" stroke="${color ? fabricDetail(fill) : shade(fill, -0.45)}" stroke-width="1.2" stroke-linecap="round"/>
      <path d="M32 99h66v5q0 2-2 2H34q-2 0-2-2z" fill="#6b4a2b"${color ? ' stroke="none"' : ''}/>
      <path d="M38 106v-2M46 106v-2M54 106v-2M62 106v-2M70 106v-2M78 106v-2M86 106v-2M94 106v-2" stroke="#4a321c" stroke-width="2"/></g>`
    return boot(-10, -10, shade(tan, -0.12)) + boot(0, 0, tan)
  },
  polo(color) {
    const OLIVE = color || '#556642', dark = color ? fabricDetail(color) : shade(OLIVE, -0.28)
    return `<path d="M45 32l-9 4-13 13 9 10 6-6v49h44V53l6 6 9-10-13-13-9-4q-15 7-30 0z" fill="${OLIVE}"/>
      <path d="M32 59l-9-10M88 59l9-10" stroke="${dark}" stroke-width="2"/>
      <path d="M45 32l7 12 8-7zM75 32l-7 12-8-7z" fill="${dark}"/>
      <rect x="57" y="38" width="6" height="18" rx="1" fill="${shade(OLIVE, -0.12)}" stroke="${dark}" stroke-width=".6"/>
      <circle cx="60" cy="44" r="1.4" fill="#b9bdb3"${color ? ' stroke="none"' : ''}/><circle cx="60" cy="50" r="1.4" fill="#b9bdb3"${color ? ' stroke="none"' : ''}/>
      <path d="M38 99h44" stroke="${dark}" stroke-width="1.4"/>
      ${badge(72, 55, 4.6, color)}`
  },
  cargo(color) {
    const KHAKI = color || '#c9b38e', dark = color ? fabricDetail(color) : shade(KHAKI, -0.3), light = shade(KHAKI, 0.12)
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
  belt(color) {
    const brown = color || '#7a5233'
    return `${color ? `<ellipse cx="60" cy="68" rx="30" ry="17" fill="none" stroke="${fabricDetail(color)}" stroke-width="11.5"/>` : ''}<path d="M30 68a30 17 0 0 1 60 0" fill="none" stroke="${shade(brown, -0.3)}" stroke-width="10"/>
      <path d="M30 68a30 17 0 0 0 60 0" fill="none" stroke="${brown}" stroke-width="10"/>
      <path d="M32 66a28 15 0 0 0 56 0" fill="none" stroke="${shade(brown, 0.2)}" stroke-width="1" opacity=".7"/>
      <circle cx="78" cy="80.5" r="1.2" fill="${shade(brown, -0.5)}"/><circle cx="83" cy="77.5" r="1.2" fill="${shade(brown, -0.5)}"/><circle cx="87" cy="74" r="1.2" fill="${shade(brown, -0.5)}"/>
      <rect x="49" y="77" width="22" height="15" rx="2" fill="#a9adb3" stroke="#7d828a" stroke-width="1"/>
      <rect x="53" y="80.5" width="14" height="8" rx="1" fill="#c9ccd1"${color ? ' stroke="none"' : ''}/>`
  },
  cap(color) {
    const KHAKI = color || '#c9b38e', dark = color ? fabricDetail(color) : shade(KHAKI, -0.3)
    return `<path d="M32 80q0-34 28-36 28 2 28 36z" fill="${KHAKI}"/>
      <path d="M60 44v36M60 44q-14 8-16 36M60 44q14 8 16 36" stroke="${dark}" stroke-width=".9" fill="none"/>
      <circle cx="60" cy="44.5" r="2.2" fill="${dark}"/>
      <path d="M32 80h56" stroke="${dark}" stroke-width="2"/>
      <path d="M30 81q30-5 60 0-5 15-30 15T30 81z" fill="${shade(KHAKI, -0.18)}"/>
      <path d="M36 84q24-3 48 0" stroke="${dark}" stroke-width=".8" fill="none"/>
      ${badge(60, 66, 6, color)}`
  },
  socks(color) {
    const sock = (dx, dy, fill) => `<g transform="translate(${dx} ${dy})">
      <path d="M38 34h18v38l18 10q8 4 4 12-4 6-12 2L42 84q-6-3-4-10z" fill="${fill}"/>
      <rect x="38" y="34" width="18" height="9" fill="${shade(fill, -0.18)}"/>
      <path d="M42 34v9M46 34v9M50 34v9M54 34v9" stroke="${color ? fabricDetail(fill) : shade(fill, -0.35)}" stroke-width=".8"/>
      <path d="M66 96q4 2 8-1 4-4 1-9z" fill="${shade(fill, -0.2)}"/>
      <path d="M38 76q2 7 8 9l-2-11z" fill="${shade(fill, -0.2)}"/></g>`
    return sock(12, -6, shade(color || '#c4ac82', -0.12)) + sock(0, 2, color || '#c4ac82')
  },
  jacket(color) {
    const KHAKI = color || '#c9b38e', dark = color ? fabricDetail(color) : shade(KHAKI, -0.3), light = shade(KHAKI, 0.12)
    return `<path d="M40 37l-9 6-7 50 10 2 9-38zM80 37l9 6 7 50-10 2-9-38z" fill="${shade(KHAKI, -0.12)}"/>
      <path d="M40 37l10-5h20l10 5 3 65H37z" fill="${KHAKI}"/>
      <path d="M50 32l10 10 10-10-2-5H52z" fill="${dark}"/>
      <path d="M51 28l-5 13 9 4 5-11 5 11 9-4-5-13-9 6z" fill="${shade(KHAKI, -0.08)}"/>
      <path d="M60 41v60" stroke="${dark}" stroke-width="2"/>
      <rect x="61" y="45" width="2.6" height="6" rx=".8" fill="#7d828a"${color ? ' stroke="none"' : ''}/>
      <path d="M41 51h14v14H41zM65 51h14v14H65z" fill="${light}"/>
      <path d="M40 50h16v5l-8 3-8-3zM64 50h16v5l-8 3-8-3z" fill="${shade(KHAKI, -0.15)}"/>
      <path d="M41 78h13v17H41zM66 78h13v17H66z" fill="${shade(KHAKI, -0.08)}"/>
      <path d="M41 78h13M66 78h13M25 89l10 2M85 91l10-2M38 98h44" stroke="${dark}" stroke-width="1.4"/>
      <circle cx="48" cy="54" r="1" fill="${dark}"/><circle cx="72" cy="54" r="1" fill="${dark}"/>`
  },
  tshirt(color) {
    const cotton = color || '#f2f0e8', seam = color ? fabricDetail(color) : '#b8b6ad'
    return `<path d="M46 33l-10 4-13 15 10 11 8-7v46h38V56l8 7 10-11-13-15-10-4q-14 8-28 0z" fill="${cotton}" stroke="${seam}" stroke-width="1" stroke-linejoin="round"/>
      <path d="M46 33q14 20 28 0" fill="none" stroke="${seam}" stroke-width="3"/>
      <path d="M49 34q11 13 22 0" fill="${color ? shade(color, -0.2) : '#d9d6cc'}"/>
      <path d="M33 59l-8-9M87 59l8-9M41 98h38" stroke="${seam}" stroke-width="1.2" fill="none"/>
      <path d="M42 57v37M78 57v37" stroke="${color ? shade(color, 0.15) : '#e1ded5'}" stroke-width="1.3"/>`
  },
  beret(color) {
    const navy = color || '#22345a', dark = shade(navy, -0.35)
    return `<path d="M28 73q-5-14 6-24 12-12 35-11 19 0 24 13 7 19-10 29L38 82z" fill="${navy}"/>
      <path d="M28 69q21 7 55-2l1 13-46 2q-8-4-10-13z" fill="${shade(navy, -0.16)}"/>
      <path d="M36 78q24 4 48-2l-1 9q-25 6-46 1z" fill="${dark}"/>
      <path d="M68 40q14 6 15 19" stroke="${shade(navy, 0.15)}" stroke-width="1.3" fill="none"/>
      ${badge(47, 68, 6, color)}`
  },
  gloves(color) {
    const KHAKI = color || '#c9b38e', OLIVE = color ? shade(color, -0.25) : '#556642'
    const glove = (dx, dy, angle, fill) => `<g transform="translate(${dx} ${dy}) rotate(${angle} 45 69)">
      <path d="M31 86l-3-24q-.6-5 3-5 3 0 4 5l2 8V43q0-4 3-4t3 4v19-26q0-4 3-4t3 4v26-24q0-4 3-4t3 4v25-18q0-4 3-4t3 4v32q0 12-7 18z" fill="${fill}"/>
      <path d="M37 67q8-5 17 0v18H38z" fill="${shade(fill, 0.12)}"/>
      <path d="M37 48v15M43 43v19M49 42v20M55 48v16M35 74l3 11" stroke="${color ? fabricDetail(fill) : shade(fill, -0.28)}" stroke-width="1" fill="none" stroke-linecap="round"/>
      <path d="M31 85l24 1-1 14H33z" fill="${OLIVE}"/>
      <path d="M33 91h20" stroke="${shade(OLIVE, -0.25)}" stroke-width="1.4"/></g>`
    return glove(25, -2, 14, shade(KHAKI, -0.13)) + glove(-6, 2, -14, KHAKI)
  },
  vest(color) {
    const OLIVE = color || '#556642', dark = color ? fabricDetail(color) : shade(OLIVE, -0.3), reflective = '#d9ddd4'
    return `<path d="M42 31l10 1 8 16 8-16 10-1q-3 23 10 29v41H32V60q13-6 10-29z" fill="${OLIVE}"/>
      <path d="M42 31l10 1 8 16 8-16 10-1M32 60q13-6 10-29M88 60q-13-6-10-29" fill="none" stroke="${dark}" stroke-width="1.5"/>
      <path d="M45 34h6v34h-6zM69 34h6v34h-6zM32 69h56v7H32zM32 88h56v7H32z" fill="${reflective}"${color ? ' stroke="none"' : ''}/>
      <path d="M60 48v53" stroke="${dark}" stroke-width="2.4"/>
      <path d="M37 79h16v6H37zM67 79h16v6H67z" fill="${dark}"/>
      ${badge(74, 55, 4.3, color)}`
  },
  raincoat(color) {
    const navy = color || '#22345a', dark = color ? fabricDetail(color) : shade(navy, -0.3), light = shade(navy, 0.18)
    return `<path d="M47 43q-5-20 13-20t13 20l-13 8z" fill="${navy}"/>
      <path d="M49 40q-1-12 11-13 12 1 11 13L60 49z" fill="${shade(navy, -0.3)}"/>
      <path d="M40 46l-9 6-7 31 10 3 10-23zM80 46l9 6 7 31-10 3-10-23z" fill="${shade(navy, -0.12)}"/>
      <path d="M40 46l9-5 11 8 11-8 9 5 2 58H38z" fill="${navy}"/>
      <path d="M40 46l20 9 20-9v14H40z" fill="${light}"/>
      <path d="M60 49v55" stroke="${dark}" stroke-width="3"/>
      <path d="M62 55v43" stroke="${light}" stroke-width="1"/>
      <path d="M40 78l12-4M68 74l12 4" stroke="${dark}" stroke-width="3" stroke-linecap="round"/>
      <path d="M49 41l2 13M71 41l-2 13" stroke="#a9adb3" stroke-width="1.2"/>
      <path d="M39 100h42M25 80l10 3M85 83l10-3" stroke="${dark}" stroke-width="1.3"/>
      <circle cx="58" cy="68" r="1" fill="#a9adb3"${color ? ' stroke="none"' : ''}/><circle cx="58" cy="84" r="1" fill="#a9adb3"${color ? ' stroke="none"' : ''}/>`
  },
  generic(color) {
    const KHAKI = color || '#c9b38e', OLIVE = color ? shade(color, -0.15) : '#556642', navy = color ? shade(color, -0.3) : '#22345a'
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
  parka(color) {
    const fabric = color || '#556642', seam = fabricDetail(fabric), dark = shade(fabric, -0.25)
    return `<path d="M43 43q-5-20 17-20t17 20l-17 9z" fill="${dark}"/>
      <path d="M45 42q-3-17 15-17t15 17" stroke="${shade(fabric, 0.45)}" stroke-width="5" fill="none"/>
      <path d="M49 42q-1-12 11-12t11 12l-11 9z" fill="${shade(fabric, -0.45)}"/>
      <path d="M39 44l-10 8-6 41 12 3 8-32zM81 44l10 8 6 41-12 3-8-32z" fill="${dark}"/>
      <path d="M39 44l10-3 11 10 11-10 10 3 4 60H35z" fill="${fabric}"/>
      <path d="M38 60h44M37 75h46M36 90h48M27 67l11 2M25 82l11 2M82 69l11-2M84 84l11-2" stroke="${seam}" stroke-width="1.5" fill="none"/>
      <path d="M60 50v53" stroke="#a9adb3" stroke-width="1.8"/>
      <path d="M40 78h13v13H40zM67 78h13v13H67z" fill="${dark}"/>
      <path d="M40 78h13M67 78h13" stroke="${seam}" stroke-width="2"/>
      <rect x="62" y="54" width="2.6" height="5" rx=".6" fill="#c9ccd1" stroke="none"/>`
  },
  fleece(color) {
    const fabric = color || '#22345a', seam = fabricDetail(fabric), dark = shade(fabric, -0.22)
    return `<path d="M39 39l-10 7-6 46 11 3 10-35zM81 39l10 7 6 46-11 3-10-35z" fill="${dark}"/>
      <path d="M39 39l11-5h20l11 5 2 64H37z" fill="${fabric}"/>
      <path d="M49 26h22v13l-11 8-11-8z" fill="${dark}"/>
      <path d="M49 27v12l11 8 11-8V27M60 28v74M38 99h44M25 88l10 3M85 91l10-3" stroke="${seam}" stroke-width="1.6" fill="none"/>
      <path d="M60 43v58" stroke="#a9adb3" stroke-width="1.6"/>
      <rect x="62" y="48" width="2.5" height="5" rx=".6" fill="#c9ccd1" stroke="none"/>
      <path d="M43 76l9-7M68 69l9 7" stroke="${seam}" stroke-width="2" stroke-linecap="round"/>
      <path d="M42 53l2 2M47 62l2 2M72 53l2 2M76 63l2 2M46 88l2 2M73 90l2 2" stroke="${shade(fabric, 0.15)}" stroke-width="1.4"/>`
  },
  sweater(color) {
    const fabric = color || '#6b1e2a', seam = fabricDetail(fabric), dark = shade(fabric, -0.2)
    return `<path d="M46 32l-11 5-12 51 11 4 10-34-2 45h36l-2-45 10 34 11-4-12-51-11-5q-14 9-28 0z" fill="${fabric}"/>
      <path d="M46 32q14 20 28 0" stroke="${dark}" stroke-width="5" fill="none"/>
      <path d="M43 94h34v9H42zM24 84l12 4-2 7-12-4zM84 88l12-4 2 7-12 4z" fill="${dark}"/>
      <path d="M46 95v7M51 95v7M56 95v7M61 95v7M66 95v7M71 95v7M76 95v7" stroke="${seam}" stroke-width="1"/>
      <path d="M49 50l3 4-3 4 3 4-3 4 3 4-3 4 3 4-3 4M59 50l3 4-3 4 3 4-3 4 3 4-3 4 3 4-3 4M69 50l3 4-3 4 3 4-3 4 3 4-3 4 3 4-3 4" stroke="${seam}" stroke-width="1.2" fill="none"/>`
  },
  hoodie(color) {
    const fabric = color || '#72777d', seam = fabricDetail(fabric), dark = shade(fabric, -0.22)
    return `<path d="M43 45q-4-22 17-22t17 22l-17 11z" fill="${dark}"/>
      <path d="M49 43q-1-14 11-14t11 14L60 53z" fill="${shade(fabric, -0.4)}"/>
      <path d="M39 45l-9 7-7 41 11 3 10-32zM81 45l9 7 7 41-11 3-10-32z" fill="${dark}"/>
      <path d="M39 45l10-3 11 11 11-11 10 3 2 58H37z" fill="${fabric}"/>
      <path d="M46 77l7-7h14l7 7v15H46z" fill="${dark}"/>
      <path d="M46 77l7-7M67 70l7 7M46 91h28M38 97h44" stroke="${seam}" stroke-width="1.4" fill="none"/>
      <path d="M51 44v19M69 44v19" stroke="#dedfdc" stroke-width="1.6" stroke-linecap="round"/>
      <path d="M42 99v4M47 99v4M52 99v4M57 99v4M62 99v4M67 99v4M72 99v4M77 99v4" stroke="${seam}" stroke-width=".9"/>`
  },
  beanie(color) {
    const fabric = color || '#22345a', seam = fabricDetail(fabric), dark = shade(fabric, -0.2)
    return `<path d="M32 84V67q0-31 28-32 28 1 28 32v17z" fill="${fabric}"/>
      <path d="M43 44q-6 15-5 31M53 37q-4 16-3 38M63 36v39M73 40q5 16 4 35M82 49q3 13 2 26" stroke="${seam}" stroke-width="1.4" fill="none"/>
      <rect x="29" y="75" width="62" height="22" rx="5" fill="${dark}"/>
      <path d="M35 79v14M41 79v14M47 79v14M53 79v14M59 79v14M65 79v14M71 79v14M77 79v14M83 79v14" stroke="${seam}" stroke-width="1.1"/>
      <rect x="64" y="81" width="16" height="10" rx="1.5" fill="${shade(fabric, 0.25)}"/>`
  },
  scarf(color) {
    const fabric = color || '#6b1e2a', seam = fabricDetail(fabric), dark = shade(fabric, -0.25)
    return `<path d="M37 40q23-16 46 0l-8 26H44z" fill="${dark}"/>
      <path d="M40 43l18 5-10 50H30z" fill="${fabric}"/>
      <path d="M62 47l17-4 11 49-19 5z" fill="${shade(fabric, 0.1)}"/>
      <path d="M37 40q23 17 46 0l-4 18q-20 15-38 0z" fill="${fabric}"/>
      <path d="M42 49q18 12 36 0M35 83l16 4M72 81l15-4M34 90l16 3M73 88l15-4" stroke="${seam}" stroke-width="1.6" fill="none"/>
      <path d="M32 97l-1 7M37 97l-1 7M42 98l-1 7M47 98l-1 7M73 96l2 7M78 95l2 7M83 94l2 7M88 93l2 7" stroke="${dark}" stroke-width="2"/>`
  },
  thermal(color) {
    const fabric = color || '#e0ddd4', seam = fabricDetail(fabric), dark = shade(fabric, -0.15)
    return `<path d="M48 31l-11 6-12 54 9 3 12-37-3 46h34l-3-46 12 37 9-3-12-54-11-6q-12 7-24 0z" fill="${fabric}"/>
      <path d="M48 31q12 16 24 0" stroke="${dark}" stroke-width="4" fill="none"/>
      <path d="M47 48l2 44M53 46l1 46M60 45v47M67 46l-1 46M73 48l-2 44M27 86l8 3M85 89l8-3M44 98h32" stroke="${seam}" stroke-width="1.1" fill="none"/>`
  },
  dressshirt(color) {
    const fabric = color || '#e8edf2', seam = fabricDetail(fabric), dark = shade(fabric, -0.15)
    return `<path d="M40 36l-10 7-6 48 11 2 9-36zM80 36l10 7 6 48-11 2-9-36z" fill="${dark}"/>
      <path d="M40 36l11-6h18l11 6 1 62q-21 12-42 0z" fill="${fabric}"/>
      <path d="M51 30l9 8 9-8 4 12-8 6-5-10-5 10-8-6z" fill="${dark}" stroke="${seam}" stroke-width=".8"/>
      <path d="M60 39v65M25 85l11 2M84 87l11-2M41 96q19 8 38 0" stroke="${seam}" stroke-width="1.2" fill="none"/>
      <path d="M67 52h11v13H67z" fill="${dark}"/>
      <path d="M67 52h11" stroke="${seam}" stroke-width="1.3"/>
      <g fill="${seam}"><circle cx="62" cy="51" r="1"/><circle cx="62" cy="62" r="1"/><circle cx="62" cy="73" r="1"/><circle cx="62" cy="84" r="1"/><circle cx="62" cy="95" r="1"/></g>`
  },
  tie(color) {
    const fabric = color || '#6b1e2a', dark = shade(fabric, -0.25), seam = fabricDetail(fabric)
    return `<path d="M50 29h20l-4 14H54z" fill="${dark}"/>
      <path d="M54 43h12l6 50-12 12-12-12z" fill="${fabric}"/>
      <path d="M55 45l-2 46 7 8" fill="none" stroke="${shade(fabric, 0.15)}" stroke-width="1.4"/>
      <path d="M53 61l15-8M51 76l18-10M50 91l21-11" stroke="${seam}" stroke-width="3"/>`
  },
  blazer(color) {
    const fabric = color || '#22345a', dark = shade(fabric, -0.22), seam = fabricDetail(fabric)
    return `<path d="M39 35l-9 6-7 51 11 2 10-37zM81 35l9 6 7 51-11 2-10-37z" fill="${dark}"/>
      <path d="M39 35l12-5 9 15 9-15 12 5 3 67H36z" fill="${fabric}"/>
      <path d="M51 30l9 15 9-15-9 52z" fill="${shade(fabric, -0.4)}"/>
      <path d="M51 30l-7 18 8 2-3 6 11 25-6-39zM69 30l7 18-8 2 3 6-11 25 6-39z" fill="${dark}" stroke="${seam}" stroke-width="1"/>
      <path d="M60 81v21M40 78h13M67 78h13M69 51h10" stroke="${seam}" stroke-width="1.6"/>
      <circle cx="62.5" cy="84" r="1.5" fill="#a9adb3" stroke="none"/><circle cx="62.5" cy="95" r="1.5" fill="#a9adb3" stroke="none"/>`
  },
  trousers(color) {
    const fabric = color || '#363b45', dark = shade(fabric, -0.22), seam = fabricDetail(fabric)
    return `<path d="M37 29h46l1 75H64l-4-48-4 48H36z" fill="${fabric}"/>
      <path d="M37 29h46v8H37z" fill="${dark}"/>
      <path d="M43 29v8M54 29v8M67 29v8M78 29v8M60 37v18M39 39l10 9M81 39L71 49M46 52l-1 47M74 52l1 47M37 100h19M64 100h20" stroke="${seam}" stroke-width="1.2" fill="none"/>
      <circle cx="61" cy="33" r="1.2" fill="#a9adb3" stroke="none"/>`
  },
  coverall(color) {
    const fabric = color || '#556642', dark = shade(fabric, -0.22), seam = fabricDetail(fabric)
    return `<path d="M42 33l-10 6-8 38 10 3 11-30zM78 33l10 6 8 38-10 3-11-30z" fill="${dark}"/>
      <path d="M42 33l10-5h16l10 5 3 34 4 37H64l-4-30-4 30H35l4-37z" fill="${fabric}"/>
      <path d="M52 28l8 9 8-9 4 11-8 5-4-7-4 7-8-5z" fill="${dark}"/>
      <path d="M60 38v31M40 65h40M44 83l-1 17M76 83l1 17M25 74l10 3M85 77l10-3" stroke="${seam}" stroke-width="1.4" fill="none"/>
      <path d="M44 46h11v12H44zM65 46h11v12H65zM39 75h12v12H39zM69 75h12v12H69z" fill="${shade(fabric, 0.12)}"/>
      <path d="M44 46h11M65 46h11M39 75h12M69 75h12" stroke="${seam}" stroke-width="1.5"/>
      <path d="M60 40v21" stroke="#a9adb3" stroke-width="1.3"/>`
  },
  shorts(color) {
    const fabric = color || '#c9b38e', dark = shade(fabric, -0.2), seam = fabricDetail(fabric)
    return `<path d="M35 39h50l4 53H63l-3-24-3 24H31z" fill="${fabric}"/>
      <path d="M35 34h50v10H35z" fill="${dark}"/>
      <path d="M41 34v10M54 34v10M67 34v10M79 34v10M60 44v24M36 47q4 10 13 10M84 47q-4 10-13 10M32 87h25M63 87h25" stroke="${seam}" stroke-width="1.3" fill="none"/>
      <path d="M34 64h13v14H34zM73 64h13v14H73z" fill="${shade(fabric, 0.1)}"/>
      <path d="M34 64h13M73 64h13" stroke="${seam}" stroke-width="1.6"/>`
  },
  longsleeve(color) {
    const fabric = color || '#556642', dark = shade(fabric, -0.22), seam = fabricDetail(fabric)
    return `<path d="M43 34l-11 7-9 50 11 3 10-35zM77 34l11 7 9 50-11 3-10-35z" fill="${dark}"/>
      <path d="M43 34l7-3h20l7 3 4 69H39z" fill="${fabric}"/>
      <path d="M50 31l10 7 10-7 4 12-8 3-6-8-6 8-8-3z" fill="${dark}"/>
      <rect x="57" y="39" width="6" height="21" rx="1" fill="${shade(fabric, -0.1)}"/>
      <path d="M57 40v19M40 99h40M25 86l10 3M85 89l10-3" stroke="${seam}" stroke-width="1.3"/>
      <circle cx="60" cy="46" r="1.2" fill="#b9bdb3" stroke="none"/><circle cx="60" cy="54" r="1.2" fill="#b9bdb3" stroke="none"/>
      ${badge(72, 55, 4.6, color)}`
  },
}

window.uniformArt = (kind, cls = 'art', opts = {}) => {
  const color = typeof opts?.color === 'string' && /^#[\da-f]{6}$/i.test(opts.color) ? opts.color : undefined
  const drawing = Object.hasOwn(DRAW, kind) ? DRAW[kind] : DRAW.generic
  const fabric = drawing(color)
  // A fine fabric contour keeps black garments legible on dark surfaces without changing defaults.
  const content = color ? `<g stroke="${fabricDetail(color)}" stroke-width=".75" stroke-linejoin="round">${fabric}</g>` : fabric
  return `<svg class="${cls}" viewBox="20 20 80 90" aria-hidden="true" focusable="false"><ellipse cx="60" cy="106" rx="36" ry="4.5" fill="#000" opacity=".12"/>${content}</svg>`
}
