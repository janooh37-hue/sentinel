'use strict'

// Decorative silhouettes for recognition at ledger size, not technical diagrams.
{
  const shapes = {
    rifle: '<path class="fill" d="M10 28h11l8-3h25l4 3h22v4H56l-6 4-1 9h-7l-3-9h-8l-7 5H10z"/><path d="M32 31h18m-29-2v8"/>',
    pistol: '<path class="fill" d="M22 22h42v10H46l-4 7-6 1-3 12H22l6-21h-6z"/><path d="M29 26h28m-22 6h10l-4 7h-6"/>',
    magazine: '<path class="fill" d="M34 13h18c0 12-1 24-7 39H30c4-11 5-24 4-39Z"/><path d="M39 21h8m-9 8h8m-10 9h8m-14 13h16"/>',
    rounds: '<path class="fill" d="M27 49V29c0-6 3-11 5-13 2 2 5 7 5 13v20zm13 0V27c0-6 3-11 5-13 2 2 5 7 5 13v22zm13 0V30c0-6 3-11 5-13 2 2 5 7 5 13v19z"/><path d="M27 43h10m3 0h10m3 0h10"/>',
    sling: '<path class="fill" d="M55 15c-14 0-32 22-32 33 0 4 4 6 8 6 13 0 34-21 34-32 0-4-4-7-10-7Zm0 6c3 0 4 1 4 3 0 8-18 24-27 24-2 0-3 0-3-2 0-8 16-25 26-25Z" fill-rule="evenodd"/><rect x="52" y="16" width="7" height="7" rx="1"/>',
    holster: '<path class="fill" d="M24 22h36l-9 24-5 7H28l3-20h-7z"/><path d="M31 27h21l-8 20H33m2-26v-6h12v6"/>',
    tool: '<path class="fill" d="M31 11v10l7 4 7-4V11l5 4 2 12-9 8v17H33V35l-9-8 2-12z" transform="rotate(38 38 32)"/><circle cx="28" cy="44" r="2"/>',
    rod: '<path d="M22 46l39-28m-41 25 5 7m34-35 5 6m-2-8 5 6m-8-1 5 6"/>',
    scabbard: '<path class="fill" d="M19 44V34l38-17h11v10L31 45H19z"/><path d="M29 40l36-17m-8-6 3 10"/>',
    grip: '<path class="fill" d="M26 17h32v8H49l-2 24H35l-3-24h-6z"/><path d="M36 32h11m-10 5h9m-8 5h8"/>',
    adapter: '<rect class="fill" x="21" y="25" width="46" height="16" rx="3"/><path d="M27 25v16m5-16v16m24-16v16m5-16v16"/>',
    case: '<rect class="fill" x="17" y="23" width="54" height="25" rx="4"/><path d="M35 23v-5h18v5m-36 12h54m-44 0v5m34-5v5"/>',
    taser: '<path class="fill" d="M24 21h38l4 6-4 9H47l-5 15H29l4-17H22v-9z"/><path d="M27 26h29m-9 5h9m-24 5 2-5"/>',
    spray: '<rect class="fill" x="33" y="23" width="22" height="30" rx="4"/><path d="M36 23v-9h15l3 4v5m-10-5h8m-18 15h20m-20 9h20"/>',
    cartridge: '<rect class="fill" x="25" y="23" width="38" height="25" rx="5"/><path d="M32 23v25m24-25v25m-17-17h10m-10 8h10"/>',
    cuffs: '<path d="M37 31c0 8-5 13-11 13S15 39 15 32s5-13 11-13c4 0 7 2 9 5m38 7c0 8-5 13-11 13s-11-5-11-12 5-13 11-13c4 0 7 2 9 5M32 30l9-4m6 0 9 4"/><circle class="fill" cx="44" cy="26" r="3"/><path d="M18 28l6 4m30-4 6 4"/>',
    'leg-irons': '<rect class="fill" x="13" y="24" width="20" height="19" rx="7"/><rect class="fill" x="55" y="24" width="20" height="19" rx="7"/><path d="M33 34h5l4 3 4-3 4 3 5-3M20 29v9m49-9v9"/>',
    plastic: '<path d="M44 27c-10-15-25-9-25 1 0 14 17 10 25-1 8-11 25-15 25-1 0 10-15 16-25 1m1 4 9 18m-12-18-11 18"/><rect class="fill" x="40" y="27" width="8" height="6" rx="1"/>',
    key: '<circle class="fill" cx="32" cy="22" r="9"/><circle cx="32" cy="22" r="3"/><path d="M38 29l17 17 7-7m-11 3 4-4"/>',
    baton: '<path class="fill" d="M19 47l7 7 44-40-5-5z"/><path d="m27 42 6 7m-3-10 6 7m-3-10 6 7"/>',
    helmet: '<path class="fill" d="M20 36c0-13 9-22 22-22 15 0 24 10 24 22v7H20z"/><path d="M20 37h46m-23 6 2 6h12l6-6"/>',
    shield: '<path class="fill" d="M29 12h30v22c0 9-6 15-15 21-9-6-15-12-15-21z"/><path d="M34 19h20v9H34zm5 20h10"/>',
    'riot-suit': '<path class="fill" d="M31 16l7-3 6 5 6-5 7 3 11 11-8 8-4-4v18H32V31l-4 4-8-8z"/><path d="M33 37h22m-22-8h22m-11-9v28m-12 2-2 5h11l3-4 3 4h11l-2-5"/>',
    radio: '<rect class="fill" x="30" y="21" width="28" height="35" rx="4"/><path d="M35 21V9m14 12v-5h6v5m-19 7h16v8H36zm1 14h14m-14 5h14"/>',
    bodycam: '<rect class="fill" x="30" y="15" width="28" height="38" rx="6"/><circle cx="44" cy="30" r="7"/><circle cx="44" cy="30" r="2.7"/><path d="M40 44h8m-12-3v6m16-6v6"/>',
    wand: '<path class="fill" d="M22 45l10-10c-2-3-3-7 0-10l17-14c5-4 10-3 14 1 4 4 4 11-1 15L45 42c-3 2-6 2-9 0L25 53z"/><path d="M38 31l17-15m-27 29 5 5"/>',
  }
  window.armoryArt = (kind, cls = '') => `<svg class="art ${cls}" viewBox="0 0 88 64" aria-hidden="true" focusable="false"><path d="M19 58h50" stroke="#dedfd8" stroke-width="1.2"/><g fill="none" stroke="#394c5b" stroke-width="1.65" stroke-linecap="round" stroke-linejoin="round">${shapes[kind]}</g></svg>`

  const icons = {
    plus: '<path d="M12 5v14M5 12h14"/>',
    arrow: '<path d="M4 12h15m-6-6 6 6-6 6"/>',
    back: '<path d="M20 12H5m6-6-6 6 6 6"/>',
    chevron: '<path d="m9 6 6 6-6 6"/>',
    clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
    alert: '<path d="M10.3 4.4a1.9 1.9 0 0 1 3.4 0l7.9 13.3a1.7 1.7 0 0 1-1.5 2.6H3.9a1.7 1.7 0 0 1-1.5-2.6zM12 9v4m0 3h.01"/>',
    check: '<path d="m5 12 4 4L19 6"/>',
    clipboard: '<rect x="5" y="5" width="14" height="16" rx="2"/><rect x="9" y="3" width="6" height="4" rx="1"/><path d="M9 12h6m-6 4h6"/>',
    licence: '<rect x="3" y="5" width="18" height="14" rx="2"/><circle cx="8.5" cy="10" r="1.5"/><path d="M6 16v-1a2.5 2.5 0 0 1 5 0v1m3-6h4m-4 4h4"/>',
    search: '<circle cx="11" cy="11" r="6"/><path d="m16 16 4 4"/>',
    close: '<path d="m6 6 12 12M18 6 6 18"/>',
    print: '<path d="M6 9V3h12v6M6 17H3V9h18v8h-3m-12-3h12v7H6zm12-2h.01"/>',
    safe: '<rect x="3" y="4" width="18" height="16" rx="2"/><circle cx="11" cy="12" r="3"/><path d="M17 9v6M6 20v2m12-2v2"/>',
    calendar: '<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M8 3v4m8-4v4M3 10h18"/>',
    scan: '<path d="M8 4H4v4m12-4h4v4M4 16v4h4m12-4v4h-4M4 12h16"/>',
    package: '<path d="m3 7 9-4 9 4v10l-9 4-9-4zm0 0 9 4 9-4m-9 4v10m-5-16 10 4"/>',
    return: '<path d="M8 6 3 11l5 5m-5-5h11a5 5 0 0 1 0 10h-2"/>',
    filter: '<path d="M4 6h16M7 12h10m-7 6h4"/><circle cx="8" cy="6" r="1" fill="currentColor"/><circle cx="15" cy="12" r="1" fill="currentColor"/>',
    copy: '<rect x="8" y="8" width="12" height="12" rx="2"/><path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2"/>',
    repair: '<path d="M14 6a5 5 0 0 0-6 6L3 17l4 4 5-5a5 5 0 0 0 6-6l-3 3-4-4z"/>',
  }
  window.armoryIcon = (name, cls = '') => `<svg class="icon ${cls}" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.65" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">${icons[name]}</svg>`
}
