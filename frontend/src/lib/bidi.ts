/** Wrap a string in Unicode First-Strong-Isolate / Pop-Directional-Isolate chars.
 * Prevents LTR fragments (ref numbers, Latin names) from scrambling when
 * embedded in Arabic (RTL) text. */
export const bidi = (s: string): string => `⁨${s}⁩`
