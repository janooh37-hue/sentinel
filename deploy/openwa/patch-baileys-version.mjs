// Repin the WA-Web version WAHA's bundled Baileys advertises.
//
// WAHA's NOWEB engine never passes `version` to makeWASocket, so Baileys uses the
// constant baked into its Defaults. When WhatsApp retires that version it answers
// the pairing handshake with 405 "Connection Failure": the session loops in
// STARTING, never reaches SCAN_QR_CODE, /auth/qr returns 422, and the app's
// reconnect dialog shows no QR. There is no WAHA env knob for it, so rewrite the
// constant. Run inside the container, then restart it — Node caches the module.
//
// Idempotent, and exits non-zero if the constant moves (a silent no-op here would
// look exactly like the bug it fixes).
import { readFileSync, writeFileSync } from 'node:fs'

const DEFAULTS = '/app/node_modules/@adiwajshing/baileys/lib/Defaults/index.js'
const FALLBACK = [2, 3000, 1043857760] // verified against WhatsApp 2026-07-29

let version = FALLBACK
try {
  const { fetchLatestBaileysVersion } = await import('/app/node_modules/@adiwajshing/baileys/lib/index.js')
  const latest = await fetchLatestBaileysVersion()
  // isLatest=false means the fetch failed and it handed back the stale pin.
  if (latest?.isLatest && latest.version?.length === 3) version = latest.version
} catch (err) {
  console.warn(`could not fetch latest WA version (${err.message}) - using fallback`)
}

const src = readFileSync(DEFAULTS, 'utf8')
const out = src.replace(/const version = \[[0-9, ]+\]/, `const version = [${version.join(', ')}]`)
if (out === src) {
  console.error(`PATCH FAILED: version constant not found in ${DEFAULTS}`)
  process.exit(1)
}
writeFileSync(DEFAULTS, out)
console.log(`baileys WA-Web version pinned to ${version.join('.')}`)
