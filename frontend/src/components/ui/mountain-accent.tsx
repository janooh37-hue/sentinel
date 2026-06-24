/**
 * MountainAccent — decorative mountain silhouette used as a corner accent on
 * the Dashboard "My Workspace" card (and reusable elsewhere). Two-layered SVG:
 * solid fill in `--mountain` plus a thin stroked ridge in `--primary` at low
 * opacity, so the silhouette reads against either the light or dark surface.
 */

export interface MountainAccentProps {
  className?: string
}

export function MountainAccent({ className = '' }: MountainAccentProps): React.JSX.Element {
  return (
    <svg
      className={`${className} rtl:-scale-x-100`}
      viewBox="0 0 160 80"
      fill="none"
      aria-hidden="true"
      focusable="false"
    >
      <path
        d="M0 80 L40 30 L65 55 L95 15 L130 45 L160 25 L160 80 Z"
        fill="var(--mountain)"
      />
      <path
        d="M0 80 L40 30 L65 55 L95 15 L130 45 L160 25"
        stroke="var(--primary)"
        strokeWidth={1.5}
        opacity={0.4}
        fill="none"
      />
    </svg>
  )
}
