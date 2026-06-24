/**
 * Decorative artwork for the identity tiles — a UAE Emirates ID card and a navy
 * passport, built from divs + inline SVG (no external images). Sized to sit in
 * the DocumentTile 170px preview area. Purely visual (aria-hidden).
 */

// NOTE: the tiny text-[Npx] sizes below are intentional — these are decorative,
// aria-hidden card-mockup labels (not user-facing content), so the rem-based
// font-scale rule does not apply. Do not "fix" them to text-sm/text-xs.

export function EmiratesIdArt(): React.JSX.Element {
  return (
    <div
      aria-hidden="true"
      className="relative h-[100px] w-[160px] overflow-hidden rounded-lg p-2.5 shadow"
      style={{ background: 'linear-gradient(135deg, #fdeef2 0%, #eef3fb 60%, #e7eef9 100%)' }}
    >
      {/* Header row: emblem + country name */}
      <div className="flex items-center gap-1.5">
        <div className="h-3.5 w-3.5 rounded-full bg-amber-500/80" />
        <div className="leading-tight">
          <div className="text-[5px] font-semibold tracking-wide text-stone-600">UNITED ARAB EMIRATES</div>
          <div className="text-[5px] text-stone-500">الإمارات العربية المتحدة</div>
        </div>
        <div className="ms-auto text-[5px] font-semibold text-stone-500">Identity Card</div>
      </div>
      {/* Body: photo box + data lines */}
      <div className="mt-2 flex gap-2">
        <div className="h-[46px] w-[34px] rounded-sm bg-stone-300/80" />
        <div className="mt-1 flex-1 space-y-[3px]">
          <div className="h-[3px] w-[80%] rounded bg-stone-400/70" />
          <div className="h-[3px] w-[60%] rounded bg-stone-400/60" />
          <div className="h-[3px] w-[70%] rounded bg-stone-400/60" />
          <div className="h-[3px] w-[45%] rounded bg-stone-400/50" />
        </div>
      </div>
      {/* Bottom tint band */}
      <div className="absolute inset-x-0 bottom-0 h-3 bg-gradient-to-r from-pink-300/40 via-sky-300/30 to-indigo-300/40" />
    </div>
  )
}

export function PassportArt(): React.JSX.Element {
  return (
    <div
      aria-hidden="true"
      className="relative flex h-[120px] w-[88px] flex-col items-center justify-center rounded-md p-2 shadow"
      style={{ background: 'linear-gradient(160deg, #20305a 0%, #16233f 100%)' }}
    >
      <div className="text-[5.5px] font-semibold tracking-widest text-amber-300/90">جواز السفر</div>
      {/* Gold globe */}
      <svg viewBox="0 0 48 48" className="my-1.5 h-12 w-12 text-amber-300/90" fill="none" stroke="currentColor" strokeWidth="1">
        <circle cx="24" cy="24" r="20" />
        <ellipse cx="24" cy="24" rx="8" ry="20" />
        <ellipse cx="24" cy="24" rx="20" ry="8" />
        <line x1="4" y1="24" x2="44" y2="24" />
        <line x1="24" y1="4" x2="24" y2="44" />
      </svg>
      <div className="text-[6px] font-semibold tracking-[0.2em] text-amber-300/90">PASSPORT</div>
      {/* Chip */}
      <div className="absolute bottom-2 start-2 h-3 w-4 rounded-[2px] border border-amber-300/70 bg-amber-300/20" />
    </div>
  )
}
