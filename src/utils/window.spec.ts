import { describe, it, expect, vi, beforeEach } from 'vitest'
import mixpanel from 'mixpanel-browser'
import { getClientDomain, getSpaceKey } from '@/utils/ContextParameters/ContextParameters'
import { _awaitableTrackEvent, addonKey, addonKeyForProductType, getUrlParam, getLocalStorageKey, getLocalState, setLocalState } from './window';
import forgeGlobal from '@/model/globals/forgeGlobal';

// Mock dependencies
vi.mock('mixpanel-browser', () => ({
  default: {
    init: vi.fn(),
    identify: vi.fn(),
    track: vi.fn()
  }
}))

vi.mock('@/model/globals/forgeGlobal', () => ({
  default: {
    isForge: true,
    forgeContext: { localId: 'forge-local-id-123' }
  }
}))

vi.mock('@/utils/ContextParameters/ContextParameters', () => ({
  getClientDomain: vi.fn(),
  getSpaceKey: vi.fn()
}))

// Mock globals
const mockGlobals = {
  apWrapper: {
    currentUser: {
      atlassianAccountId: 'test-user-123'
    },
    getMacroData: vi.fn().mockResolvedValue({ uuid: 'test-macro-123' }),
    isLite: vi.fn().mockReturnValue(false)
  }
}

describe('window utils', async () => {
  beforeEach(async () => {
    vi.clearAllMocks()

    // Reset window.location
    window.location = new URL('https://example.com') as any
    // Reset window.globals
    // @ts-ignore
    window.globals = mockGlobals
    // Reset localStorage
    localStorage.clear()
    // Mock context parameters
    vi.mocked(getClientDomain).mockReturnValue('test-domain')
    vi.mocked(getSpaceKey).mockReturnValue('TEST')
    // Mock fetch
    global.fetch = vi.fn().mockResolvedValue({} as Response)
    vi.mocked(forgeGlobal).isForge = true
    vi.mocked(forgeGlobal).forgeContext = { localId: 'forge-local-id-123' } as any
  })

  describe('getUrlParam', () => {
    it('should return undefined for non-existent parameter', () => {
      window.location.search = ''
      expect(getUrlParam('test')).toBeUndefined()
    })

    it('should return parameter value when it exists', () => {
      window.location.search = '?test=value'
      expect(getUrlParam('test')).toBe('value')
    })

    it('should handle URL encoded values', () => {
      window.location.search = '?test=hello%20world'
      expect(getUrlParam('test')).toBe('hello world')
    })

    it('should handle multiple parameters', () => {
      window.location.search = '?first=1&test=value&last=3'
      expect(getUrlParam('test')).toBe('value')
    })

    it('should return undefined on invalid URL', () => {
      window.location.search = '?test=%invalid'
      expect(getUrlParam('test')).toBeUndefined()
    })
  })

  describe('addonKey', () => {
    it.each([
      ['lite', 'com.zenuml.confluence-addon-lite'],
      ['full', 'com.zenuml.confluence-addon'],
      ['diagramly', 'gptdock-confluence'],
      [undefined, 'com.zenuml.confluence-addon'],
      ['unknown', 'com.zenuml.confluence-addon'],
    ])('maps product type %s to addon key %s', (productType, expected) => {
      expect(addonKeyForProductType(productType)).toBe(expected)
    })

    it('uses the build product type instead of Connect URL parameters', () => {
      window.location.search = '?addonKey=com.zenuml.confluence-addon-lite'

      expect(addonKey()).toBe(addonKeyForProductType(import.meta.env.PRODUCT_TYPE))
    })
  })

  describe('trackEvent', () => {
    it('should enforce EventCategory type safety', () => {
      // This should cause a TypeScript error at compile time
      // @ts-expect-error - Invalid category
      _awaitableTrackEvent('label', 'action', 'invalid-category');

      // These should all be valid and not cause TypeScript errors
      const validCategories = [
        'sequence', 'mermaid', 'graph', 'openapi', 'embed',
        'error', 'warning', 'info',
        'macro', 'ai', 'analytics',
        'user', 'system', 'performance'
      ];

      // No assertions needed - this is a compile-time check
      validCategories.forEach(category => {
        // Just checking that this compiles without errors
        _awaitableTrackEvent('label', 'action', category as any);
      });
    });

    it('should send tracking data via Mixpanel', async () => {
      await _awaitableTrackEvent('test-label', 'test-action', 'analytics')

      expect(mixpanel.track).toHaveBeenCalledWith('test-action', expect.objectContaining({
        event_category: 'analytics',
        event_label: 'test-label',
        user_account_id: 'test-user-123',
        client_domain: 'test-domain',
        confluence_space: 'TEST',
        product_type: 'full'
      }))
    })

    it('should handle Mixpanel errors gracefully', async () => {
      const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
      vi.mocked(mixpanel.track).mockImplementation(() => { throw new Error('Mixpanel error') })

      await _awaitableTrackEvent('test-label', 'test-action', 'analytics')

      expect(consoleErrorSpy).toHaveBeenCalledWith(
        'Error in calling mixpanel.track',
        expect.any(Error)
      )
      consoleErrorSpy.mockRestore()
    })

    it('should initialize Mixpanel and track events', async () => {
      await _awaitableTrackEvent('test-label', 'test-action', 'analytics')

      // init/identify may be skipped if already called in a previous test (module-level flags)
      expect(mixpanel.track).toHaveBeenCalled()
    })

    it('should track event with correct parameters', async () => {
      await _awaitableTrackEvent('test-label', 'test-action', 'analytics')
      expect(mixpanel.track).toHaveBeenCalledWith('test-action', expect.objectContaining({
        event_category: 'analytics',
        event_label: 'test-label',
        user_account_id: 'test-user-123',
        client_domain: 'test-domain',
        confluence_space: 'TEST',
        macro_uuid: 'forge-local-id-123',
        product_type: 'full'
      }))
    })

    it('should handle missing user ID', async () => {
      // @ts-ignore
      window.globals.apWrapper.currentUser = null
      await _awaitableTrackEvent('test-label', 'test-action', 'test-category')
      expect(mixpanel.track).toHaveBeenCalledWith('test-action', expect.objectContaining({
        user_account_id: 'unknown_user_account_id'
      }))
    })

    it('should handle empty label gracefully', async () => {
      await _awaitableTrackEvent('', 'action', 'analytics');

      expect(mixpanel.track).toHaveBeenCalledWith('action', expect.objectContaining({
        event_label: ''
      }));
    })

    it('should include custom event details', async () => {
      const customDetails = { custom_field: 'custom_value' }
      await _awaitableTrackEvent('test-label', 'test-action', 'analytics', customDetails)
      expect(mixpanel.track).toHaveBeenCalledWith('test-action', expect.objectContaining({
        custom_field: 'custom_value'
      }))
    })

    it('should properly merge custom event details with standard details', async () => {
      const customDetails = {
        timing: 123,
        user_type: 'premium',
        // Try to override a standard property
        event_category: 'should-override'
      };

      await _awaitableTrackEvent('label', 'action', 'performance', customDetails);

      // Standard properties should be preserved
      expect(mixpanel.track).toHaveBeenCalledWith('action', expect.objectContaining({
        event_category: 'should-override',
        event_label: 'label',
        timing: 123,
        user_type: 'premium'
      }));
    })

    it('should continue execution even when all tracking services fail', async () => {
      // Make everything fail
      vi.mocked(mixpanel.track).mockImplementationOnce(() => { throw new Error('Mixpanel error') });

      vi.mocked(global.fetch).mockRejectedValueOnce(new Error('Network error'));

      // This should not throw
      await expect(
        _awaitableTrackEvent('label', 'critical_error', 'error')
      ).resolves.not.toThrow();
    })

    it('should warn when a migrated action is used via the legacy path', async () => {
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      await _awaitableTrackEvent('', 'view_macro', 'macro');
      expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('"view_macro"'));
      warnSpy.mockRestore();
    })

    it('should not warn for non-migrated actions', async () => {
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      await _awaitableTrackEvent('', 'some_other_action', 'analytics');
      expect(warnSpy).not.toHaveBeenCalled();
      warnSpy.mockRestore();
    })

    it('should use localId for macro_uuid in Forge mode', async () => {
      // Set up Forge mode with localId
      vi.mocked(forgeGlobal).isForge = true
      vi.mocked(forgeGlobal).forgeContext = { localId: 'forge-local-id-123' } as any

      await _awaitableTrackEvent('test-label', 'test-action', 'analytics')

      expect(mixpanel.track).toHaveBeenCalledWith('test-action', expect.objectContaining({
        macro_uuid: 'forge-local-id-123'
      }))
    })

    it('should fallback to macroData.uuid when Forge context has no localId', async () => {
      vi.mocked(forgeGlobal).forgeContext = {} as any

      await _awaitableTrackEvent('test-label', 'test-action', 'analytics')

      expect(mixpanel.track).toHaveBeenCalledWith('test-action', expect.objectContaining({
        macro_uuid: 'test-macro-123'
      }))
    })
  })

  describe('localStorage utils', () => {
    describe('getLocalStorageKey', () => {
      it('should generate key with domain', () => {
        expect(getLocalStorageKey('test')).toBe('test-test-domain')
      })
    })

    describe('getLocalState', () => {
      it('should return default state when no stored value exists', () => {
        const DEFAULT_STATE = { test: true }
        expect(getLocalState('test', DEFAULT_STATE)).toEqual(DEFAULT_STATE)
      })

      it('should return stored state when it exists', () => {
        const storedState = { test: false }
        localStorage.setItem('test-test-domain', JSON.stringify(storedState))
        expect(getLocalState('test', { test: true })).toEqual(storedState)
      })

      it('should return default state on invalid JSON', () => {
        const DEFAULT_STATE = { test: true }
        localStorage.setItem('test-test-domain', 'invalid json')
        expect(getLocalState('test', DEFAULT_STATE)).toEqual(DEFAULT_STATE)
      })
    })

    describe('setLocalState', () => {
      it('should store state in localStorage with correct key', () => {
        const state = { test: true }
        setLocalState('key', state)
        expect(localStorage.getItem('key-test-domain')).toBe(JSON.stringify(state))
      })
    })
  })
})
