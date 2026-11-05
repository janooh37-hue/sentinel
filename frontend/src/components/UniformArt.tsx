import { UNIFORM_ART_KINDS } from './uniformArtCatalog'

// Fixed artwork from mockups/plan/uniform/art.js; no user-supplied SVG markup.
const DRAWINGS = {
  suit: <><ellipse cx="60" cy="106" rx="36" ry="4.5" fill="#000" opacity=".12"/><path d="M60 30q0-6 4-6t3 4" fill="none" stroke="#8a8f98" strokeWidth="1.6" strokeLinecap="round"/>
      <path d="M44 82h15l-1 22H46zM61 82h15l-2 22H62z" fill="#1c2b4a"/>
      <path d="M46 104h12M62 104h12" stroke="#18243f" strokeWidth="1.4"/>
      <path d="M38 38q-8 3-9 12l-2 32h8l2-30z" fill="#18243f"/><path d="M82 38q8 3 9 12l2 32h-8l-2-30z" fill="#18243f"/>
      <path d="M38 38l12-5 10 12 10-12 12 5 3 46H35z" fill="#22345a"/>
      <path d="M51 34l9 30 9-30-9 9z" fill="#fff"/><path d="M51 34l4 7 5-2zM69 34l-4 7-5-2z" fill="#e9e7e1"/>
      <circle cx="60" cy="50" r=".9" fill="#c9c6bd"/><circle cx="60" cy="56" r=".9" fill="#c9c6bd"/>
      <path d="M50 33l-5 13 6 1 9 19-8-28zM70 33l5 13-6 1-9 19 8-28z" fill="#18243f"/>
      <path d="M60 66v18" stroke="#18243f" strokeWidth="1"/>
      <circle cx="62.5" cy="71" r="1.3" fill="#18243f"/><circle cx="62.5" cy="77" r="1.3" fill="#18243f"/>
      <path d="M40 73h12v2.6H40zM68 73h12v2.6H68z" fill="#18243f"/>
      <g transform="translate(74 52)"><circle r="4.4" fill="#fff" stroke="#c8102e" strokeWidth="1.2320000000000002"/><circle r="2.9920000000000004" fill="#2a5aa0"/><path d="M-1.7600000000000002 -0.8800000000000001q1.32 -1.7600000000000002 2.64 0q-0.44000000000000006 1.7600000000000002 -2.64 0zM0.44000000000000006 0.66q1.32 -0.44000000000000006 1.7600000000000002 1.32l-1.32 0.8800000000000001z" fill="#e9eef5"/><path d="M0 -5.06v2.2M0 5.06v-2.2M-5.06 0h2.2M5.06 0h-2.2" stroke="#c8102e" strokeWidth="0.792"/></g></>,
  boots: <><ellipse cx="60" cy="106" rx="36" ry="4.5" fill="#000" opacity=".12"/><g transform="translate(-10 -10)">
      <path d="M34 100V62q0-4 4-4h16q4 0 4 4v18q4 3 14 5l12 3q8 2 8 9v3z" fill="#b0916b"/>
      <rect x="34" y="57" width="24" height="5" rx="2" fill="#8d7456"/>
      <path d="M48 64l8 4M56 64l-8 4M48 71l8 4M56 71l-8 4M50 78l8 3" stroke="#61503b" strokeWidth="1.2" strokeLinecap="round"/>
      <path d="M32 99h66v5q0 2-2 2H34q-2 0-2-2z" fill="#6b4a2b"/>
      <path d="M38 106v-2M46 106v-2M54 106v-2M62 106v-2M70 106v-2M78 106v-2M86 106v-2M94 106v-2" stroke="#4a321c" strokeWidth="2"/></g><g transform="translate(0 0)">
      <path d="M34 100V62q0-4 4-4h16q4 0 4 4v18q4 3 14 5l12 3q8 2 8 9v3z" fill="#c8a57a"/>
      <rect x="34" y="57" width="24" height="5" rx="2" fill="#a08462"/>
      <path d="M48 64l8 4M56 64l-8 4M48 71l8 4M56 71l-8 4M50 78l8 3" stroke="#6e5b43" strokeWidth="1.2" strokeLinecap="round"/>
      <path d="M32 99h66v5q0 2-2 2H34q-2 0-2-2z" fill="#6b4a2b"/>
      <path d="M38 106v-2M46 106v-2M54 106v-2M62 106v-2M70 106v-2M78 106v-2M86 106v-2M94 106v-2" stroke="#4a321c" strokeWidth="2"/></g></>,
  polo: <><ellipse cx="60" cy="106" rx="36" ry="4.5" fill="#000" opacity=".12"/><path d="M45 32l-9 4-13 13 9 10 6-6v49h44V53l6 6 9-10-13-13-9-4q-15 7-30 0z" fill="#556642"/>
      <path d="M32 59l-9-10M88 59l9-10" stroke="#3d4930" strokeWidth="2"/>
      <path d="M45 32l7 12 8-7zM75 32l-7 12-8-7z" fill="#3d4930"/>
      <rect x="57" y="38" width="6" height="18" rx="1" fill="#4b5a3a" stroke="#3d4930" strokeWidth=".6"/>
      <circle cx="60" cy="44" r="1.4" fill="#b9bdb3"/><circle cx="60" cy="50" r="1.4" fill="#b9bdb3"/>
      <path d="M38 99h44" stroke="#3d4930" strokeWidth="1.4"/>
      <g transform="translate(72 55)"><circle r="4.6" fill="#fff" stroke="#c8102e" strokeWidth="1.288"/><circle r="3.128" fill="#2a5aa0"/><path d="M-1.8399999999999999 -0.9199999999999999q1.38 -1.8399999999999999 2.76 0q-0.45999999999999996 1.8399999999999999 -2.76 0zM0.45999999999999996 0.69q1.38 -0.45999999999999996 1.8399999999999999 1.38l-1.38 0.9199999999999999z" fill="#e9eef5"/><path d="M0 -5.289999999999999v2.3M0 5.289999999999999v-2.3M-5.289999999999999 0h2.3M5.289999999999999 0h-2.3" stroke="#c8102e" strokeWidth="0.828"/></g></>,
  cargo: <><ellipse cx="60" cy="106" rx="36" ry="4.5" fill="#000" opacity=".12"/><rect x="36" y="28" width="48" height="8" rx="1" fill="#b5a180"/>
      <path d="M41 28v8M54 28v8M66 28v8M79 28v8" stroke="#8d7d63" strokeWidth="1.6"/>
      <path d="M36 36h48l2 68H64l-4-48-4 48H34z" fill="#c9b38e"/>
      <path d="M60 36v20M60 56l-3-6" stroke="#8d7d63" strokeWidth="1" fill="none"/>
      <path d="M38 39q6 6 12 0M82 39q-6 6-12 0" stroke="#8d7d63" strokeWidth="1" fill="none"/>
      <rect x="35.5" y="63" width="13" height="17" rx="1.5" fill="#cfbc9c" stroke="#8d7d63" strokeWidth=".8"/>
      <rect x="35" y="62" width="14" height="5" rx="1" fill="#b9a583" stroke="#8d7d63" strokeWidth=".8"/>
      <rect x="72" y="63" width="13" height="17" rx="1.5" fill="#cfbc9c" stroke="#8d7d63" strokeWidth=".8"/>
      <rect x="71.5" y="62" width="14" height="5" rx="1" fill="#b9a583" stroke="#8d7d63" strokeWidth=".8"/>
      <path d="M34.5 99h22M64 99h22" stroke="#8d7d63" strokeWidth="1.2"/></>,
  belt: <><ellipse cx="60" cy="106" rx="36" ry="4.5" fill="#000" opacity=".12"/><path d="M30 68a30 17 0 0 1 60 0" fill="none" stroke="#553924" strokeWidth="10"/>
      <path d="M30 68a30 17 0 0 0 60 0" fill="none" stroke="#7a5233" strokeWidth="10"/>
      <path d="M32 66a28 15 0 0 0 56 0" fill="none" stroke="#95755c" strokeWidth="1" opacity=".7"/>
      <circle cx="78" cy="80.5" r="1.2" fill="#3d291a"/><circle cx="83" cy="77.5" r="1.2" fill="#3d291a"/><circle cx="87" cy="74" r="1.2" fill="#3d291a"/>
      <rect x="49" y="77" width="22" height="15" rx="2" fill="#a9adb3" stroke="#7d828a" strokeWidth="1"/>
      <rect x="53" y="80.5" width="14" height="8" rx="1" fill="#c9ccd1"/></>,
  cap: <><ellipse cx="60" cy="106" rx="36" ry="4.5" fill="#000" opacity=".12"/><path d="M32 80q0-34 28-36 28 2 28 36z" fill="#c9b38e"/>
      <path d="M60 44v36M60 44q-14 8-16 36M60 44q14 8 16 36" stroke="#8d7d63" strokeWidth=".9" fill="none"/>
      <circle cx="60" cy="44.5" r="2.2" fill="#8d7d63"/>
      <path d="M32 80h56" stroke="#8d7d63" strokeWidth="2"/>
      <path d="M30 81q30-5 60 0-5 15-30 15T30 81z" fill="#a59374"/>
      <path d="M36 84q24-3 48 0" stroke="#8d7d63" strokeWidth=".8" fill="none"/>
      <g transform="translate(60 66)"><circle r="6" fill="#fff" stroke="#c8102e" strokeWidth="1.6800000000000002"/><circle r="4.08" fill="#2a5aa0"/><path d="M-2.4000000000000004 -1.2000000000000002q1.7999999999999998 -2.4000000000000004 3.5999999999999996 0q-0.6000000000000001 2.4000000000000004 -3.5999999999999996 0zM0.6000000000000001 0.8999999999999999q1.7999999999999998 -0.6000000000000001 2.4000000000000004 1.7999999999999998l-1.7999999999999998 1.2000000000000002z" fill="#e9eef5"/><path d="M0 -6.8999999999999995v3M0 6.8999999999999995v-3M-6.8999999999999995 0h3M6.8999999999999995 0h-3" stroke="#c8102e" strokeWidth="1.08"/></g></>,
  socks: <><ellipse cx="60" cy="106" rx="36" ry="4.5" fill="#000" opacity=".12"/><g transform="translate(12 -6)">
      <path d="M38 34h18v38l18 10q8 4 4 12-4 6-12 2L42 84q-6-3-4-10z" fill="#ac9772"/>
      <rect x="38" y="34" width="18" height="9" fill="#8d7c5d"/>
      <path d="M42 34v9M46 34v9M50 34v9M54 34v9" stroke="#70624a" strokeWidth=".8"/>
      <path d="M66 96q4 2 8-1 4-4 1-9z" fill="#8a795b"/>
      <path d="M38 76q2 7 8 9l-2-11z" fill="#8a795b"/></g><g transform="translate(0 2)">
      <path d="M38 34h18v38l18 10q8 4 4 12-4 6-12 2L42 84q-6-3-4-10z" fill="#c4ac82"/>
      <rect x="38" y="34" width="18" height="9" fill="#a18d6b"/>
      <path d="M42 34v9M46 34v9M50 34v9M54 34v9" stroke="#7f7055" strokeWidth=".8"/>
      <path d="M66 96q4 2 8-1 4-4 1-9z" fill="#9d8a68"/>
      <path d="M38 76q2 7 8 9l-2-11z" fill="#9d8a68"/></g></>,
  jacket: <><ellipse cx="60" cy="106" rx="36" ry="4.5" fill="#000" opacity=".12"/><path d="M40 37l-9 6-7 50 10 2 9-38zM80 37l9 6 7 50-10 2-9-38z" fill="#b19e7d"/>
      <path d="M40 37l10-5h20l10 5 3 65H37z" fill="#c9b38e"/>
      <path d="M50 32l10 10 10-10-2-5H52z" fill="#8d7d63"/>
      <path d="M51 28l-5 13 9 4 5-11 5 11 9-4-5-13-9 6z" fill="#b9a583"/>
      <path d="M60 41v60" stroke="#8d7d63" strokeWidth="2"/>
      <rect x="61" y="45" width="2.6" height="6" rx=".8" fill="#7d828a"/>
      <path d="M41 51h14v14H41zM65 51h14v14H65z" fill="#cfbc9c"/>
      <path d="M40 50h16v5l-8 3-8-3zM64 50h16v5l-8 3-8-3z" fill="#ab9879"/>
      <path d="M41 78h13v17H41zM66 78h13v17H66z" fill="#b9a583"/>
      <path d="M41 78h13M66 78h13M25 89l10 2M85 91l10-2M38 98h44" stroke="#8d7d63" strokeWidth="1.4"/>
      <circle cx="48" cy="54" r="1" fill="#8d7d63"/><circle cx="72" cy="54" r="1" fill="#8d7d63"/></>,
  vest: <><ellipse cx="60" cy="106" rx="36" ry="4.5" fill="#000" opacity=".12"/><path d="M42 31l10 1 8 16 8-16 10-1q-3 23 10 29v41H32V60q13-6 10-29z" fill="#556642"/>
      <path d="M42 31l10 1 8 16 8-16 10-1M32 60q13-6 10-29M88 60q-13-6-10-29" fill="none" stroke="#3b472e" strokeWidth="1.5"/>
      <path d="M45 34h6v34h-6zM69 34h6v34h-6zM32 69h56v7H32zM32 88h56v7H32z" fill="#d9ddd4"/>
      <path d="M60 48v53" stroke="#3b472e" strokeWidth="2.4"/>
      <path d="M37 79h16v6H37zM67 79h16v6H67z" fill="#3b472e"/>
      <g transform="translate(74 55)"><circle r="4.3" fill="#fff" stroke="#c8102e" strokeWidth="1.204"/><circle r="2.924" fill="#2a5aa0"/><path d="M-1.72 -0.86q1.2899999999999998 -1.72 2.5799999999999996 0q-0.43 1.72 -2.5799999999999996 0zM0.43 0.6449999999999999q1.2899999999999998 -0.43 1.72 1.2899999999999998l-1.2899999999999998 0.86z" fill="#e9eef5"/><path d="M0 -4.944999999999999v2.15M0 4.944999999999999v-2.15M-4.944999999999999 0h2.15M4.944999999999999 0h-2.15" stroke="#c8102e" strokeWidth="0.7739999999999999"/></g></>,
  parka: <><ellipse cx="60" cy="106" rx="36" ry="4.5" fill="#000" opacity=".12"/><path d="M43 43q-5-20 17-20t17 20l-17 9z" fill="#404d32"/>
      <path d="M45 42q-3-17 15-17t15 17" stroke="#a2ab97" strokeWidth="5" fill="none"/>
      <path d="M49 42q-1-12 11-12t11 12l-11 9z" fill="#2f3824"/>
      <path d="M39 44l-10 8-6 41 12 3 8-32zM81 44l10 8 6 41-12 3-8-32z" fill="#404d32"/>
      <path d="M39 44l10-3 11 10 11-10 10 3 4 60H35z" fill="#556642"/>
      <path d="M38 60h44M37 75h46M36 90h48M27 67l11 2M25 82l11 2M82 69l11-2M84 84l11-2" stroke="#8b977e" strokeWidth="1.5" fill="none"/>
      <path d="M60 50v53" stroke="#a9adb3" strokeWidth="1.8"/>
      <path d="M40 78h13v13H40zM67 78h13v13H67z" fill="#404d32"/>
      <path d="M40 78h13M67 78h13" stroke="#8b977e" strokeWidth="2"/>
      <rect x="62" y="54" width="2.6" height="5" rx=".6" fill="#c9ccd1" stroke="none"/></>,
  dressshirt: <><ellipse cx="60" cy="106" rx="36" ry="4.5" fill="#000" opacity=".12"/><path d="M40 36l-10 7-6 48 11 2 9-36zM80 36l10 7 6 48-11 2-9-36z" fill="#c5c9ce"/>
      <path d="M40 36l11-6h18l11 6 1 62q-21 12-42 0z" fill="#e8edf2"/>
      <path d="M51 30l9 8 9-8 4 12-8 6-5-10-5 10-8-6z" fill="#c5c9ce" stroke="#a2a6a9" strokeWidth=".8"/>
      <path d="M60 39v65M25 85l11 2M84 87l11-2M41 96q19 8 38 0" stroke="#a2a6a9" strokeWidth="1.2" fill="none"/>
      <path d="M67 52h11v13H67z" fill="#c5c9ce"/>
      <path d="M67 52h11" stroke="#a2a6a9" strokeWidth="1.3"/>
      <g fill="#a2a6a9"><circle cx="62" cy="51" r="1"/><circle cx="62" cy="62" r="1"/><circle cx="62" cy="73" r="1"/><circle cx="62" cy="84" r="1"/><circle cx="62" cy="95" r="1"/></g></>,
  longsleeve: <><ellipse cx="60" cy="106" rx="36" ry="4.5" fill="#000" opacity=".12"/><path d="M43 34l-11 7-9 50 11 3 10-35zM77 34l11 7 9 50-11 3-10-35z" fill="#425033"/>
      <path d="M43 34l7-3h20l7 3 4 69H39z" fill="#556642"/>
      <path d="M50 31l10 7 10-7 4 12-8 3-6-8-6 8-8-3z" fill="#425033"/>
      <rect x="57" y="39" width="6" height="21" rx="1" fill="#4d5c3b"/>
      <path d="M57 40v19M40 99h40M25 86l10 3M85 89l10-3" stroke="#8b977e" strokeWidth="1.3"/>
      <circle cx="60" cy="46" r="1.2" fill="#b9bdb3" stroke="none"/><circle cx="60" cy="54" r="1.2" fill="#b9bdb3" stroke="none"/>
      <g transform="translate(72 55)"><circle r="4.6" fill="#fff" stroke="#c8102e" strokeWidth="1.288"/><circle r="3.128" fill="#2a5aa0"/><path d="M-1.8399999999999999 -0.9199999999999999q1.38 -1.8399999999999999 2.76 0q-0.45999999999999996 1.8399999999999999 -2.76 0zM0.45999999999999996 0.69q1.38 -0.45999999999999996 1.8399999999999999 1.38l-1.38 0.9199999999999999z" fill="#e9eef5"/><path d="M0 -5.289999999999999v2.3M0 5.289999999999999v-2.3M-5.289999999999999 0h2.3M5.289999999999999 0h-2.3" stroke="#c8102e" strokeWidth="0.828"/></g></>,
}

/** Garment recognition only; neighbouring text supplies its accessible name. */
export function UniformArt({ kind, size = 48, className }: {
  kind?: string | null
  size?: number
  className?: string
}): React.JSX.Element {
  const drawingKind = UNIFORM_ART_KINDS.find(value => value === kind) ?? 'polo'
  return <svg viewBox="20 20 80 90" width={size} height={size} className={className} aria-hidden="true" focusable="false">
    {DRAWINGS[drawingKind]}
  </svg>
}
