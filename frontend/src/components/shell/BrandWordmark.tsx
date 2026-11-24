import { cn } from '@/lib/utils'

interface BrandWordmarkProps {
  /**
   * `surface`: the mark sits on a theme surface, so it follows the app theme: grey letters on a light surface,
   * the lightened file under `data-theme="dark"`. `on-dark`: the surface is dark in both themes (the navy phone
   * bar, a hero band, the badge's printed band), so it always takes the lightened file.
   */
  tone?: 'surface' | 'on-dark'
  /** The mark spells the brand, so `GSSG` by default; pass `''` where the company name already sits beside it. */
  alt?: string
  /** Size it by WIDTH (the files are 1440×229, about 6.3:1); the height follows, so a narrow box scales it down whole. */
  className?: string
}

const LIGHT_SRC = '/brand/gssg-wordmark.png'
const ON_DARK_SRC = '/brand/gssg-wordmark-on-dark.png'

/**
 * The GSSG wordmark (red swoosh over the GSSG letters). For `surface`, both files are in the DOM and the theme
 * picks one in CSS (`.brand-wordmark` in index.css), so the swap follows `data-theme` with no render; the wrapper
 * carries the one accessible name. The image is never mirrored in RTL.
 */
export function BrandWordmark({ tone = 'surface', alt = 'GSSG', className }: BrandWordmarkProps): React.JSX.Element {
  if (tone === 'on-dark') {
    return <img src={ON_DARK_SRC} alt={alt} width={1440} height={229} className={cn('block h-auto', className)} />
  }
  return (
    <span
      role={alt ? 'img' : undefined}
      aria-label={alt || undefined}
      aria-hidden={alt ? undefined : true}
      className={cn('brand-wordmark block', className)}
    >
      <img src={LIGHT_SRC} alt="" width={1440} height={229} className="brand-wordmark__light" />
      <img src={ON_DARK_SRC} alt="" width={1440} height={229} className="brand-wordmark__dark" />
    </span>
  )
}
