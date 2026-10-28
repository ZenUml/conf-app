import { vi } from 'vitest'
import { fakeBrowser } from 'wxt/testing/fake-browser'

vi.stubGlobal('chrome', fakeBrowser)
vi.stubGlobal('browser', fakeBrowser)
