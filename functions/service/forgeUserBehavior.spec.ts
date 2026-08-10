import { describe, it, expect } from 'vitest'
import { mapForgeUserBehaviorEvent, type ForgeUserBehaviorEventBody } from './forgeUserBehavior'

const forgeContext = {
  payload: {
    principal: 'acct-123',
    app: {
      id: 'app-1',
      appVersion: '9.9.9',
      environment: { id: 'env-1', type: 'PRODUCTION' },
    },
    context: {
      cloudId: 'cloud-1',
      siteUrl: 'https://example-tenant.atlassian.net',
      moduleKey: 'zenuml-page-banner',
    },
  },
}

describe('mapForgeUserBehaviorEvent — app_first_seen (M1)', () => {
  // Regression guard for the exact M1 launch failure mode: the webhook path
  // dereferences event.content unguarded; a content-less body must map, not throw.
  it('maps a content-less app_first_seen body without throwing', () => {
    const body: ForgeUserBehaviorEventBody = {
      eventType: 'app_first_seen',
      atlassianId: 'acct-123',
      eventCreatedDate: '2026-08-09T12:00:00.000Z',
    }

    const mapped = mapForgeUserBehaviorEvent(body, forgeContext)

    expect(mapped).not.toBeNull()
    expect(mapped).toMatchObject({
      action: 'app_first_seen',
      event_source: 'forge_frontend', // NOT forge_trigger — analysts split on this
      event_category: 'system',
      user_account_id: 'acct-123',
      cloud_id: 'cloud-1',
      // Full hostname, not the bare subdomain: this mapper's established
      // convention (same as page_viewed/page_updated). The bare-subdomain
      // normalization happens in the macro-event pipeline, not here.
      client_domain: 'example-tenant.atlassian.net',
    })
  })

  it('falls back to the token principal when the body carries no atlassianId', () => {
    const mapped = mapForgeUserBehaviorEvent({ eventType: 'app_first_seen' }, forgeContext)
    expect(mapped?.user_account_id).toBe('acct-123')
  })

  it('an unknown content-less eventType is ignored (null), not a throw', () => {
    expect(mapForgeUserBehaviorEvent({ eventType: 'someday_new_event' }, forgeContext)).toBeNull()
  })

  it('webhook page events map exactly as before', () => {
    const body: ForgeUserBehaviorEventBody = {
      eventType: 'avi:confluence:updated:page',
      atlassianId: 'acct-123',
      content: {
        id: '111',
        type: 'page',
        status: 'current',
        space: { key: 'ENG', id: 7 },
      },
    }

    const mapped = mapForgeUserBehaviorEvent(body, forgeContext)

    expect(mapped).toMatchObject({
      action: 'page_updated',
      event_source: 'forge_trigger',
      event_category: 'user',
      content_id: '111',
      space_key: 'ENG',
    })
  })

  it('live-doc and non-page webhook events stay ignored', () => {
    const live: ForgeUserBehaviorEventBody = {
      eventType: 'avi:confluence:updated:page',
      content: { id: '1', type: 'page', subType: 'live' },
    }
    const blog: ForgeUserBehaviorEventBody = {
      eventType: 'avi:confluence:updated:page',
      content: { id: '2', type: 'blogpost' },
    }
    expect(mapForgeUserBehaviorEvent(live, forgeContext)).toBeNull()
    expect(mapForgeUserBehaviorEvent(blog, forgeContext)).toBeNull()
  })
})
