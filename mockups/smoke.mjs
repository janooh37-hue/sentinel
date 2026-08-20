// Visual smoke of the F3 redesign against the dev server + mock API.
import { chromium } from '@playwright/test'

const shot = (page, name) =>
  page.screenshot({ path: `mockups/shots/${name}.png`, fullPage: false })

const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 1440, height: 1750 } })
page.on('pageerror', (e) => console.log('PAGEERROR:', e.message))
await page.addInitScript(() => localStorage.setItem('gssg.migration.skipped', '1'))
await page.goto('http://localhost:5173/employees', { waitUntil: 'networkidle' })
await page.waitForTimeout(800)
await shot(page, 'smoke-browse')

// Select an employee through the activity toolbar search
const search = page.locator('#employee-activity-lookup')
await search.scrollIntoViewIfNeeded()
await search.fill('harbi')
await page.waitForTimeout(600)
await page.getByRole('button', { name: /show activity/i }).first().click()
await page.waitForTimeout(800)
await search.scrollIntoViewIfNeeded()
await shot(page, 'smoke-selected')

// Kind chip scoping
await page.getByRole('group', { name: /activity type/i }).getByRole('button', { name: /^leave$/i }).click()
await page.waitForTimeout(600)
await shot(page, 'smoke-selected-leave')

console.log('SMOKE OK')
await browser.close()
