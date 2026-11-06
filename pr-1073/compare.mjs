import { createRequire } from 'node:module'
const require = createRequire('/home/claude/conf-app-mcp-promo/package.json')
const { chromium } = require('@playwright/test')
const sides = { before: 6108, after: 6107 }
const stories = [
  { id: 'viewer-genericviewer--header-mermaid-inline', name: 'inline-more-menu', w: 1000, h: 560, ready: '[role="menuitemcheckbox"]' },
  { id: 'viewer-genericviewer--header-mermaid-fullscreen', name: 'fullscreen', w: 1280, h: 800, ready: '[role="menuitemcheckbox"]' },
]
const browser = await chromium.launch({ executablePath: '/usr/bin/google-chrome', args: ['--no-sandbox', '--no-proxy-server'] })
const out = []
for (const s of stories) for (const [side, port] of Object.entries(sides)) {
  const page = await browser.newPage({ viewport: { width: s.w, height: s.h } })
  await page.goto(`http://127.0.0.1:${port}/iframe.html?viewMode=story&id=${s.id}`, { waitUntil: 'domcontentloaded' })
  await page.waitForSelector(s.ready, { timeout: 30000 })
  await page.waitForTimeout(1500)
  const info = {
    mcpHeaderBtn: await page.locator('[data-testid="connect-mcp-btn"]').count(),
    copyForAi: await page.locator('[data-testid="copy-for-ai-btn"]').count(),
    menu: (await page.locator('[role="menuitem"]').allTextContents()).map(t => t.trim().replace(/\s+/g, ' ')),
    card: await page.locator('[data-testid="mcp-promo-card"]').count(),
  }
  const file = `${s.name}-${side}.png`
  await page.screenshot({ path: file })
  out.push({ file, ...info })
  await page.close()
}
await browser.close()
console.log(JSON.stringify(out, null, 1))
