/**
 * Shared pen settings for every signature draw pad.
 *
 * react-signature-canvas defaults (minWidth 0.5 / maxWidth 2.5) draw a
 * hairline that washes out once the signature is embedded and the document is
 * compressed/printed. A heavier pen gives new signatures better source weight;
 * the server (core/signature_render) still thickens every signature at embed
 * time, including existing/uploaded ones.
 */
export const SIGNATURE_PEN = {
  penColor: '#1a1a1f',
  minWidth: 1.2,
  maxWidth: 3.0,
  dotSize: 2.2,
} as const
