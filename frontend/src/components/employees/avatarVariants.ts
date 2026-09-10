interface AvatarVariant {
  skin: readonly [string, string, string]
  hair: string
  hairShade: string
}

export const AVATAR_VARIANTS: ReadonlyArray<AvatarVariant> = [
  { skin: ['#fbd1a0', '#f0a96a', '#cd7d3e'], hair: '#6e3a14', hairShade: '#4b240a' },
  { skin: ['#fde6c4', '#f5c896', '#d99b66'], hair: '#d4a13a', hairShade: '#a37920' },
  { skin: ['#e7b487', '#c98a52', '#92622f'], hair: '#1c1410', hairShade: '#0f0808' },
  { skin: ['#f9c79a', '#e0975e', '#b16d30'], hair: '#9b3a1c', hairShade: '#6e2010' },
  { skin: ['#c79667', '#a36e3e', '#724a23'], hair: '#2a1808', hairShade: '#150a02' },
]

export function variantForId(id: string): number {
  let hash = 0
  for (let index = 0; index < id.length; index++) {
    hash = (hash * 31 + id.charCodeAt(index)) >>> 0
  }
  return hash % AVATAR_VARIANTS.length
}
