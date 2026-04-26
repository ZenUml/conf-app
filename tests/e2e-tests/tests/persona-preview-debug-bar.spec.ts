import { test, expect, type Page } from '@playwright/test'

const ORIGIN = 'http://127.0.0.1:8082/sandbox.html'
const BASE = 'http://127.0.0.1:8082/index.html'

const MOCK_KEYS = [
  'mockCSSEnabled',
  'mockMacroCount',
  'mockSpacePaid',
  'mockPersonaAwarePaywall',
  'mockPersonalAuthored',
  'mockTenantSizeEstimate',
  'mockConfluenceAdmin',
  'mockPersonaThreshold',
  'mockNotifyAdmin',
] as const

const FLAG_ROW_ORDER = [...MOCK_KEYS]

const PRESETS = [
  {
    name: 'Reset',
    signature: {},
  },
  {
    name: 'Lite blocked',
    signature: {
      mockCSSEnabled: 'true',
      mockMacroCount: '120',
      mockSpacePaid: 'false',
    },
  },
  {
    name: 'Bystander',
    signature: {
      mockCSSEnabled: 'true',
      mockMacroCount: '120',
      mockSpacePaid: 'false',
      mockPersonaAwarePaywall: 'true',
      mockPersonalAuthored: '0',
      mockTenantSizeEstimate: 'small_likely',
      mockConfluenceAdmin: 'false',
      mockNotifyAdmin: '{"notified":true,"adminCount":1}',
    },
  },
  {
    name: 'Heavy creator — Bundle primary',
    signature: {
      mockCSSEnabled: 'true',
      mockMacroCount: '120',
      mockSpacePaid: 'false',
      mockPersonaAwarePaywall: 'true',
      mockPersonalAuthored: '60',
      mockTenantSizeEstimate: 'medium_or_larger',
      mockConfluenceAdmin: 'true',
    },
  },
  {
    name: 'Heavy creator — Marketplace primary',
    signature: {
      mockCSSEnabled: 'true',
      mockMacroCount: '120',
      mockSpacePaid: 'false',
      mockPersonaAwarePaywall: 'true',
      mockPersonalAuthored: '60',
      mockTenantSizeEstimate: 'small_likely',
      mockConfluenceAdmin: 'true',
    },
  },
  {
    name: 'Comparison view',
    signature: {
      mockCSSEnabled: 'true',
      mockMacroCount: '120',
      mockSpacePaid: 'false',
      mockPersonaAwarePaywall: 'true',
      mockPersonalAuthored: '20',
      mockTenantSizeEstimate: 'unknown',
      mockConfluenceAdmin: 'true',
    },
  },
] as const

type MockKey = (typeof MOCK_KEYS)[number]
type MockState = Partial<Record<MockKey, string>>

async function seedStorage(page: Page, state: MockState = {}, extras: Record<string, string> = {}) {
  await page.goto(ORIGIN)
  await page.evaluate(
    ({ keys, nextState, extraState }) => {
      for (const key of keys) localStorage.removeItem(key)
      localStorage.removeItem('zenumlDebug')
      for (const key of Object.keys(extraState)) localStorage.removeItem(key)
      for (const [key, value] of Object.entries(nextState)) localStorage.setItem(key, value)
      for (const [key, value] of Object.entries(extraState)) localStorage.setItem(key, value)
    },
    { keys: MOCK_KEYS, nextState: state, extraState: extras }
  )
}

async function openSandbox(page: Page, sandbox = 'seq-view') {
  await page.goto(`${BASE}?sandbox=${sandbox}&outputType=display`)
  await expect(page.getByRole('status', { name: 'Debug information' })).toBeVisible({ timeout: 10_000 })
}

async function readMocks(page: Page) {
  return await page.evaluate((keys) => {
    return Object.fromEntries(keys.map((key) => [key, localStorage.getItem(key)]))
  }, MOCK_KEYS)
}

async function readLocalStorageValue(page: Page, key: string) {
  return await page.evaluate((storageKey) => localStorage.getItem(storageKey), key)
}

async function expectMockState(page: Page, expected: MockState) {
  const stored = await readMocks(page)
  for (const key of MOCK_KEYS) {
    expect(stored[key]).toBe(expected[key] ?? null)
  }
}

async function applyPreset(page: Page, name: string) {
  await page.locator('[data-testid="preset-trigger"]').click()
  await expect(page.locator('[data-testid="preset-item"]')).toHaveCount(PRESETS.length)
  await Promise.all([
    page.waitForLoadState('domcontentloaded'),
    page.locator('[data-testid="preset-item"]').filter({ hasText: name }).click(),
  ])
}

async function openAdvanced(page: Page) {
  await page.locator('[data-testid="advanced-trigger"]').click()
  await expect(page.locator('[data-testid="flag-row"]').first()).toBeVisible()
}

async function enterEditMode(page: Page) {
  await openAdvanced(page)
  await page.locator('[data-testid="advanced-edit"]').click()
  await expect(page.locator('[data-testid="editor-save"]')).toBeVisible()
}

async function flagValueCell(page: Page, key: MockKey) {
  return page.locator(`[data-testid="flag-row"][data-key="${key}"] [data-testid="flag-value"]`)
}

async function toggleNumberUnset(page: Page, key: 'mockMacroCount' | 'mockPersonalAuthored' | 'mockPersonaThreshold') {
  await page.locator(`[data-testid="edit-${key}"]`).locator('xpath=following-sibling::label/input[@type="checkbox"]').click()
}

async function setNumberInput(page: Page, key: 'mockMacroCount' | 'mockPersonalAuthored' | 'mockPersonaThreshold', value: string) {
  await page.locator(`[data-testid="edit-${key}"]`).evaluate((node, nextValue) => {
    const input = node as HTMLInputElement
    input.value = nextValue as string
    input.dispatchEvent(new Event('input', { bubbles: true }))
  }, value)
}

function presetSignature(name: string): MockState {
  const match = PRESETS.find((preset) => preset.name === name)
  if (!match) throw new Error(`Unknown preset ${name}`)
  return match.signature
}

test.describe('Debug Bar Preview', () => {
  test.use({ viewport: { width: 1280, height: 900 } })

  test('renders in standalone mode with expected controls and metadata shell', async ({ page }) => {
    await seedStorage(page)
    await openSandbox(page)

    await expect(page.getByRole('button', { name: /fullscreen/i })).toBeVisible()
    await expect(page.getByRole('button', { name: /^edit$/i })).toBeVisible()
    await expect(page.locator('[data-testid="preset-trigger"]')).toBeVisible()
    await expect(page.locator('[data-testid="advanced-trigger"]')).toBeVisible()
    await expect(page.locator('[data-testid="debug-clear"]')).toBeVisible()
    await expect(page.locator('[data-testid="preset-active"]')).toHaveText('Reset')
    await expect(page.getByRole('status', { name: 'Debug information' })).toContainText(/\[.{8}\]:\.\.[A-Za-z0-9-]{5}/)
    await expect(page.locator('.screen-capture-content')).toBeVisible()
  })

  test('seq-new shows N/A for missing custom content id', async ({ page }) => {
    await seedStorage(page)
    await openSandbox(page, 'seq-new')

    await expect(page.getByRole('status', { name: 'Debug information' })).toContainText('[local-de]:N/A')
  })

  test('preset dropdown opens in canonical order and stays open when clicking its panel', async ({ page }) => {
    await seedStorage(page)
    await openSandbox(page)

    await page.locator('[data-testid="preset-trigger"]').click()
    const items = page.locator('[data-testid="preset-item"]')
    await expect(items).toHaveText(PRESETS.map((preset) => preset.name))
    const panel = page.locator('[data-testid="preset-item"]').locator('xpath=..')
    await panel.hover({ position: { x: 20, y: 10 } })
    await expect(items).toHaveCount(PRESETS.length)
    await page.locator('[data-testid="preset-trigger"]').click()
    await expect(items).toHaveCount(0)
  })

  for (const preset of PRESETS) {
    test(`preset "${preset.name}" writes the expected signature`, async ({ page }) => {
      await seedStorage(page)
      await openSandbox(page)
      await applyPreset(page, preset.name)

      await expect(page.locator('[data-testid="preset-active"]')).toHaveText(preset.name === 'Reset' ? 'Reset' : preset.name)
      await expectMockState(page, preset.signature)
    })
  }

  test('switching presets removes keys from the prior preset', async ({ page }) => {
    await seedStorage(page, presetSignature('Bystander'))
    await openSandbox(page)

    await applyPreset(page, 'Heavy creator — Bundle primary')

    await expectMockState(page, presetSignature('Heavy creator — Bundle primary'))
    expect(await readLocalStorageValue(page, 'mockNotifyAdmin')).toBeNull()
  })

  test('advanced read-only panel shows canonical row order and current values', async ({ page }) => {
    await seedStorage(page, {
      mockMacroCount: '42',
      mockSpacePaid: 'true',
      mockNotifyAdmin: '{"notified":true,"adminCount":1}',
    })
    await openSandbox(page)
    await openAdvanced(page)

    const rows = page.locator('[data-testid="flag-row"]')
    await expect(rows).toHaveCount(9)
    await expect(rows.evaluateAll((nodes) => nodes.map((node) => node.getAttribute('data-key')))).resolves.toEqual(FLAG_ROW_ORDER)
    await expect(await flagValueCell(page, 'mockMacroCount')).toHaveText('42')
    await expect(await flagValueCell(page, 'mockSpacePaid')).toHaveText('true')
    await expect(await flagValueCell(page, 'mockNotifyAdmin')).toHaveText('{"notified":true,"adminCount":1}')
    await expect(await flagValueCell(page, 'mockCSSEnabled')).toHaveText('—')
  })

  test('advanced panel stays open on outside click and closes on second trigger click', async ({ page }) => {
    await seedStorage(page)
    await openSandbox(page)
    await openAdvanced(page)

    await page.locator('.screen-capture-content').click({ position: { x: 20, y: 20 } })
    await expect(page.locator('[data-testid="flag-row"]')).toHaveCount(9)

    await page.locator('[data-testid="advanced-trigger"]').click()
    await expect(page.locator('[data-testid="flag-row"]')).toHaveCount(0)
  })

  test('editor starts with unset controls and save enabled', async ({ page }) => {
    await seedStorage(page)
    await openSandbox(page)
    await enterEditMode(page)

    await expect(page.locator('[data-testid="advanced-edit"]')).toHaveCount(0)
    await expect(page.locator('[data-testid="edit-mockCSSEnabled"]')).toHaveValue('unset')
    await expect(page.locator('[data-testid="edit-mockSpacePaid"]')).toHaveValue('unset')
    await expect(page.locator('[data-testid="edit-mockTenantSizeEstimate"]')).toHaveValue('unset')
    await expect(page.locator('[data-testid="edit-mockNotifyAdmin"]')).toHaveValue('')
    await expect(page.locator('[data-testid="edit-mockMacroCount"]')).toBeDisabled()
    await expect(page.locator('[data-testid="edit-mockPersonalAuthored"]')).toBeDisabled()
    await expect(page.locator('[data-testid="edit-mockPersonaThreshold"]')).toBeDisabled()
    await expect(page.locator('[data-testid="editor-save"]')).toBeEnabled()
  })

  test('editor pre-populates existing values and cancel does not mutate storage', async ({ page }) => {
    await seedStorage(page, {
      mockMacroCount: '10',
      mockSpacePaid: 'true',
    })
    await openSandbox(page)
    await enterEditMode(page)

    await expect(page.locator('[data-testid="edit-mockMacroCount"]')).toHaveValue('10')
    await expect(page.locator('[data-testid="edit-mockSpacePaid"]')).toHaveValue('true')
    await page.locator('[data-testid="edit-mockMacroCount"]').fill('999')
    await page.locator('[data-testid="editor-cancel"]').click()

    await expect(page.locator('[data-testid="advanced-edit"]')).toBeVisible()
    await expect(await flagValueCell(page, 'mockMacroCount')).toHaveText('10')
    await expectMockState(page, {
      mockMacroCount: '10',
      mockSpacePaid: 'true',
    })
  })

  test('boolean and enum flags can be set and unset through the editor', async ({ page }) => {
    await seedStorage(page, {
      mockCSSEnabled: 'true',
      mockTenantSizeEstimate: 'small_likely',
    })
    await openSandbox(page)
    await enterEditMode(page)

    await page.locator('[data-testid="edit-mockCSSEnabled"]').selectOption('unset')
    await page.locator('[data-testid="edit-mockTenantSizeEstimate"]').selectOption('unset')
    await page.locator('[data-testid="edit-mockSpacePaid"]').selectOption('true')
    await page.locator('[data-testid="edit-mockConfluenceAdmin"]').selectOption('false')

    await Promise.all([
      page.waitForLoadState('domcontentloaded'),
      page.locator('[data-testid="editor-save"]').click(),
    ])

    await expectMockState(page, {
      mockSpacePaid: 'true',
      mockConfluenceAdmin: 'false',
    })
  })

  test('number inputs validate negative, empty, zero, and recover via unset/save', async ({ page }) => {
    await seedStorage(page)
    await openSandbox(page)
    await enterEditMode(page)

    await toggleNumberUnset(page, 'mockMacroCount')
    await setNumberInput(page, 'mockMacroCount', '-5')
    await expect(page.locator('[data-testid="editor-error-mockMacroCount"]')).toBeVisible()
    await expect(page.locator('[data-testid="editor-save"]')).toBeDisabled()

    await toggleNumberUnset(page, 'mockPersonaThreshold')
    await setNumberInput(page, 'mockPersonaThreshold', '')
    await expect(page.locator('[data-testid="editor-error-mockPersonaThreshold"]')).toBeVisible()
    await expect(page.locator('[data-testid="editor-save"]')).toBeDisabled()

    await toggleNumberUnset(page, 'mockPersonalAuthored')
    await setNumberInput(page, 'mockPersonalAuthored', '0')
    await expect(page.locator('[data-testid="editor-error-mockPersonalAuthored"]')).toHaveCount(0)

    await toggleNumberUnset(page, 'mockPersonaThreshold')
    await expect(page.locator('[data-testid="editor-error-mockPersonaThreshold"]')).toHaveCount(0)
    await expect(page.locator('[data-testid="editor-save"]')).toBeDisabled()

    await setNumberInput(page, 'mockMacroCount', '150')
    await expect(page.locator('[data-testid="editor-error-mockMacroCount"]')).toHaveCount(0)
    await expect(page.locator('[data-testid="editor-save"]')).toBeEnabled()

    await Promise.all([
      page.waitForLoadState('domcontentloaded'),
      page.locator('[data-testid="editor-save"]').click(),
    ])

    await expectMockState(page, {
      mockMacroCount: '150',
      mockPersonalAuthored: '0',
    })
  })

  test('json and multi-error validation keep save disabled until all issues are fixed', async ({ page }) => {
    await seedStorage(page)
    await openSandbox(page)
    await enterEditMode(page)

    await toggleNumberUnset(page, 'mockMacroCount')
    await setNumberInput(page, 'mockMacroCount', '-1')
    await page.locator('[data-testid="edit-mockNotifyAdmin"]').fill('{broken json')
    await expect(page.locator('[data-testid="editor-error-mockMacroCount"]')).toBeVisible()
    await expect(page.locator('[data-testid="editor-error-mockNotifyAdmin"]')).toBeVisible()
    await expect(page.locator('[data-testid="editor-save"]')).toBeDisabled()

    await setNumberInput(page, 'mockMacroCount', '50')
    await expect(page.locator('[data-testid="editor-error-mockMacroCount"]')).toHaveCount(0)
    await expect(page.locator('[data-testid="editor-save"]')).toBeDisabled()

    await page.locator('[data-testid="edit-mockNotifyAdmin"]').fill('{"notified":false,"adminCount":0}')
    await expect(page.locator('[data-testid="editor-error-mockNotifyAdmin"]')).toHaveCount(0)
    await expect(page.locator('[data-testid="editor-save"]')).toBeEnabled()

    await Promise.all([
      page.waitForLoadState('domcontentloaded'),
      page.locator('[data-testid="editor-save"]').click(),
    ])

    await expectMockState(page, {
      mockMacroCount: '50',
      mockNotifyAdmin: '{"notified":false,"adminCount":0}',
    })
  })

  test('saving without changes still reloads and preserves values', async ({ page }) => {
    await seedStorage(page, { mockCSSEnabled: 'true' })
    await openSandbox(page)
    await enterEditMode(page)

    await Promise.all([
      page.waitForLoadState('domcontentloaded'),
      page.locator('[data-testid="editor-save"]').click(),
    ])

    await expectMockState(page, { mockCSSEnabled: 'true' })
  })

  test('clear removes only managed mock keys and preserves unrelated storage', async ({ page }) => {
    await seedStorage(
      page,
      {
        ...presetSignature('Bystander'),
        mockPersonaThreshold: '3',
      },
      {
        'unrelated-key': 'hello',
      }
    )
    await openSandbox(page)

    await Promise.all([
      page.waitForLoadState('domcontentloaded'),
      page.locator('[data-testid="debug-clear"]').click(),
    ])

    await expectMockState(page, {})
    expect(await readLocalStorageValue(page, 'unrelated-key')).toBe('hello')
    await expect(page.locator('[data-testid="preset-active"]')).toHaveText('Reset')
  })

  test('clear with empty storage is still a clean reload', async ({ page }) => {
    await seedStorage(page)
    await openSandbox(page)

    await Promise.all([
      page.waitForLoadState('domcontentloaded'),
      page.locator('[data-testid="debug-clear"]').click(),
    ])

    await expectMockState(page, {})
    await expect(page.locator('[data-testid="preset-active"]')).toHaveText('Reset')
  })

  test('viewer upgrade CTA appears for Lite blocked and disappears after reset', async ({ page }) => {
    await seedStorage(page)
    await openSandbox(page)

    await expect(page.getByTitle('Upgrade to unlock unlimited diagrams')).toHaveCount(0)
    await applyPreset(page, 'Lite blocked')
    await expect(page.getByTitle('Upgrade to unlock unlimited diagrams')).toBeVisible()

    await applyPreset(page, 'Reset')
    await expect(page.getByTitle('Upgrade to unlock unlimited diagrams')).toHaveCount(0)
  })

  test('generic Lite blocked edit shows the non-persona upgrade prompt', async ({ page }) => {
    await seedStorage(page)
    await openSandbox(page)

    await applyPreset(page, 'Lite blocked')
    await page.getByRole('button', { name: /^edit$/i }).click()
    await expect(page.getByText('Pick the upgrade that fits your team')).toBeVisible()
  })

  test('bystander edit shows the bystander persona prompt', async ({ page }) => {
    await seedStorage(page)
    await openSandbox(page)

    await applyPreset(page, 'Bystander')
    await page.getByRole('button', { name: /^edit$/i }).click()
    await expect(page.getByText('Editing paused on this space')).toBeVisible()
    await expect(page.locator('[data-testid="notify-admin-btn"]')).toBeVisible()
  })

  test('heavy creator bundle preset shows the heavy creator prompt', async ({ page }) => {
    await seedStorage(page)
    await openSandbox(page)

    await applyPreset(page, 'Heavy creator — Bundle primary')
    await page.getByRole('button', { name: /^edit$/i }).click()
    await expect(page.getByText('This space has reached the Lite limit')).toBeVisible()
    await expect(page.locator('[data-testid="primary-cta"]')).toContainText('$299')
  })

  test('comparison view preset shows both upgrade options', async ({ page }) => {
    await seedStorage(page)
    await openSandbox(page)

    await applyPreset(page, 'Comparison view')
    await page.getByRole('button', { name: /^edit$/i }).click()
    await expect(page.getByText(/marketplace/i).first()).toBeVisible()
    await expect(page.getByText(/enterprise bundle/i).first()).toBeVisible()
  })

  test('paid space allows edit even with high macro count', async ({ page }) => {
    await seedStorage(page, {
      mockCSSEnabled: 'true',
      mockMacroCount: '120',
      mockSpacePaid: 'true',
    })
    await openSandbox(page)

    await expect(page.getByTitle('Upgrade to unlock unlimited diagrams')).toHaveCount(0)
    await page.getByRole('button', { name: /^edit$/i }).click()
    await expect(page.getByText('Pick the upgrade that fits your team')).toHaveCount(0)
    await expect(page.getByText('Editing paused on this space')).toHaveCount(0)
    await expect(page.getByText('This space has reached the Lite limit')).toHaveCount(0)
  })

  test('opening advanced while preset is open leaves both panels present as the current baseline', async ({ page }) => {
    await seedStorage(page)
    await openSandbox(page)

    await page.locator('[data-testid="preset-trigger"]').click()
    await page.locator('[data-testid="advanced-trigger"]').click()

    await expect(page.locator('[data-testid="preset-item"]')).toHaveCount(PRESETS.length)
    await expect(page.locator('[data-testid="flag-row"]')).toHaveCount(9)
  })

  test('applying a preset while advanced is open reloads into the new state', async ({ page }) => {
    await seedStorage(page)
    await openSandbox(page)

    await openAdvanced(page)
    await applyPreset(page, 'Lite blocked')

    await expectMockState(page, presetSignature('Lite blocked'))
    await expect(page.locator('[data-testid="flag-row"]')).toHaveCount(0)
  })
})
