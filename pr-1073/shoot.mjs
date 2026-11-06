import { createRequire } from 'node:module'
const require = createRequire('/home/claude/conf-app-mcp-promo/package.json')
const { chromium } = require('@playwright/test')

const BASE = 'http://127.0.0.1:6107/iframe.html?viewMode=story&id='
const stories = [
  { id: 'viewer-genericviewer--mcp-promo-fullscreen-card', file: 'fullscreen-card.png', w: 1280, h: 800,
    checks: ['[data-testid="mcp-promo-card"]', '[data-testid="connect-mcp-btn"]'] },
  { id: 'viewer-genericviewer--mcp-promo-fullscreen-card', file: 'fullscreen-card-dialog.png', w: 1280, h: 800,
    ready: '[data-testid="mcp-promo-card-cta"]',
    async act(page) { await page.click('[data-testid="mcp-promo-card-cta"]'); await page.waitForSelector('[data-testid="connect-mcp-dialog"]') },
    checks: ['[data-testid="connect-mcp-dialog"]'], absent: ['[data-testid="mcp-promo-card"]'] },
  { id: 'editor-diagram-workspacemcppromo--new-diagram-card', file: 'editor-new-diagram.png', w: 1280, h: 760,
    checks: ['[data-testid="mcp-promo-card"]'] },
  { id: 'editor-diagram-workspacemcppromo--new-diagram-card', file: 'editor-new-diagram-dialog.png', w: 1280, h: 760,
    ready: '[data-testid="mcp-promo-card-cta"]',
    async act(page) { await page.click('[data-testid="mcp-promo-card-cta"]'); await page.waitForSelector('[data-testid="connect-mcp-dialog"]') },
    checks: ['[data-testid="connect-mcp-dialog"]'] },
  { id: 'editor-diagram-workspacemcppromo--typing-tip', file: 'editor-tip.png', w: 1280, h: 760,
    checks: ['[data-testid="mcp-promo-tip"]'] },
  { id: 'shared-mcppromocard--card', file: 'card.png', w: 420, h: 260, checks: ['[data-testid="mcp-promo-card"]'] },
  { id: 'shared-mcppromocard--tip', file: 'tip.png', w: 520, h: 160, checks: ['[data-testid="mcp-promo-tip"]'] },
]

const browser = await chromium.launch({ executablePath: '/usr/bin/google-chrome', args: ['--no-sandbox', '--no-proxy-server', '--disable-background-networking', '--disable-component-update'] })
const results = []
for (const s of stories) {
  const page = await browser.newPage({ viewport: { width: s.w, height: s.h } })
  const errors = []
  page.on('pageerror', e => errors.push(String(e)))
  console.error('->', s.file); await page.goto(BASE + s.id, { waitUntil: 'domcontentloaded', timeout: 30000 })
  try {
    await page.waitForSelector(s.ready ?? s.checks[0], { timeout: 20000 })
    if (s.act) await s.act(page)
    await page.waitForTimeout(800)
  } catch (e) { errors.push('wait: ' + e.message.split('\n')[0]) }
  const found = {}
  for (const sel of s.checks) found[sel] = await page.locator(sel).count()
  for (const sel of s.absent ?? []) found['!' + sel] = await page.locator(sel).count()
  const prompt = await page.locator('[data-testid="connect-mcp-prompt"]').first().textContent().catch(() => null)
  await page.screenshot({ path: s.file })
  results.push({ story: s.id, file: s.file, found, prompt, errors: errors.slice(0, 3) })
  await page.close()
}
await browser.close()
console.log(JSON.stringify(results, null, 2))
