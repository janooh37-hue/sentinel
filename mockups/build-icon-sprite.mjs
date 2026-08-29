import { writeFile } from 'node:fs/promises'

const iconNames = [
  'signature',
  'banknote-arrow-up',
  'banknote-arrow-down',
  'siren',
  'badge-check',
  'calendar-days',
  'book-user',
  'repeat-2',
  'package',
  'notebook-text',
  'user-cog',
  'door-open',
  'ticket',
  'folder-clock',
  'triangle-alert',
  'stamp',
  'chart-column',
  'gavel',
  'medal',
  'map-pinned',
  'user-round-x',
  'file-text',
  'folder',
  'luggage',
  'stethoscope',
  'zap',
  'briefcase',
  'timer',
  'inbox',
  'send',
  'star',
  'flag',
  'paperclip',
  'globe',
  'bell',
  'qr-code',
  'shopping-basket',
  'arrow-right',
  'search',
  'moon',
  'languages',
]

function attributeName(name) {
  return name.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`)
}

function escapeAttribute(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('"', '&quot;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
}

const symbols = []
for (const name of iconNames) {
  const module = await import(new URL(`../frontend/node_modules/lucide-react/dist/esm/icons/${name}.mjs`, import.meta.url))
  const nodes = module.__iconNode
  if (!Array.isArray(nodes)) {
    throw new Error(`Icon ${name} does not export __iconNode`)
  }

  const body = nodes
    .map(([tag, attrs]) => {
      const serialized = Object.entries(attrs)
        .filter(([key]) => key !== 'key')
        .map(([key, value]) => `${attributeName(key)}="${escapeAttribute(value)}"`)
        .join(' ')
      return `    <${tag}${serialized ? ` ${serialized}` : ''}/>`
    })
    .join('\n')

  symbols.push(
    `  <symbol id="i-${name}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">\n${body}\n  </symbol>`,
  )
}

const sprite = `<svg aria-hidden="true" style="display:none" xmlns="http://www.w3.org/2000/svg">\n${symbols.join('\n')}\n</svg>\n`
const outputPath = process.argv[2]
if (outputPath) {
  await writeFile(outputPath, sprite, 'utf8')
  console.log(`Wrote ${iconNames.length} symbols to ${outputPath}`)
} else {
  process.stdout.write(sprite)
}
