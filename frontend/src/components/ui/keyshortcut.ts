/** Display glyph → ARIA / `KeyboardEvent.key` token. Anything unlisted (letters,
 *  digits, `-`, `=`, `?`, `Enter`, `Shift`, `Alt`, `Tab`, …) is already a valid token. */
const ARIA_KEY: Readonly<Record<string, string>> = {
  Esc: 'Escape',
  Ctrl: 'Control',
  Cmd: 'Meta',
  '⌘': 'Meta',
  '⌃': 'Control',
  '⌥': 'Alt',
  '⇧': 'Shift',
  '↵': 'Enter',
  '⏎': 'Enter',
  '↑': 'ArrowUp',
  '↓': 'ArrowDown',
  '←': 'ArrowLeft',
  '→': 'ArrowRight',
  Del: 'Delete',
  '+': 'Plus',
}

/**
 * Convert a visible shortcut (`Esc`, `Ctrl+K`, `↑`) into an `aria-keyshortcuts`
 * value (`Escape`, `Control+K`, `ArrowUp`). The `+` separator is split off only
 * where another key follows, so `Ctrl++` keeps its final plus key.
 */
export function ariaKeyShortcut(shortcut: string): string {
  return shortcut
    .split(/\+(?=.)/)
    .map((key) => ARIA_KEY[key] ?? key)
    .join('+')
}
