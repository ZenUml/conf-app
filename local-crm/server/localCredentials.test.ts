import { describe, expect, it } from 'vitest'
import {
  findMainCheckout,
  installLocalCrmCredentials
} from './localCredentials'

describe('local CRM credential bootstrap', () => {
  it('finds the primary checkout through the absolute git common directory', () => {
    const calls: string[] = []
    const main = findMainCheckout('/repo/worktree', repoRoot => {
      calls.push(repoRoot)
      return '/repo/main/.git\n'
    })

    expect(main).toBe('/repo/main')
    expect(calls).toEqual(['/repo/worktree'])
  })

  it('loads only server credential keys from the primary checkout fallback', () => {
    const env: Record<string, string | undefined> = {}
    const file = [
      'FORGE_EMAIL=forge@example.test',
      'FORGE_API_TOKEN="forge-token"',
      'JSM_EMAIL=jsm@example.test',
      "JSM_API_TOKEN='jsm-token'",
      'VITE_SHOULD_NOT_ESCAPE=private-value'
    ].join('\n')

    const result = installLocalCrmCredentials({
      repoRoot: '/repo/worktree',
      env,
      findMainCheckout: () => '/repo/main',
      fileExists: path => path === '/repo/main/.env.forge.local',
      readTextFile: () => file
    })

    expect(env).toMatchObject({
      FORGE_EMAIL: 'forge@example.test',
      FORGE_API_TOKEN: 'forge-token',
      JSM_EMAIL: 'jsm@example.test',
      JSM_API_TOKEN: 'jsm-token'
    })
    expect(env.VITE_SHOULD_NOT_ESCAPE).toBeUndefined()
    expect(result.loaded.sort()).toEqual([
      'FORGE_API_TOKEN',
      'FORGE_EMAIL',
      'JSM_API_TOKEN',
      'JSM_EMAIL'
    ])
  })

  it('preserves explicit process values while allowing a worktree-local override', () => {
    const env: Record<string, string | undefined> = {
      FORGE_EMAIL: 'explicit@example.test'
    }
    const files = new Map([
      ['/repo/main/.env.forge.local', [
        'FORGE_EMAIL=main@example.test',
        'FORGE_API_TOKEN=main-token',
        'JSM_EMAIL=main-jsm@example.test',
        'JSM_API_TOKEN=main-jsm-token'
      ].join('\n')],
      ['/repo/worktree/.env.forge.local', [
        'FORGE_EMAIL=worktree@example.test',
        'FORGE_API_TOKEN=worktree-token'
      ].join('\n')]
    ])

    installLocalCrmCredentials({
      repoRoot: '/repo/worktree',
      env,
      findMainCheckout: () => '/repo/main',
      fileExists: path => files.has(path),
      readTextFile: path => files.get(path) ?? ''
    })

    expect(env).toMatchObject({
      FORGE_EMAIL: 'explicit@example.test',
      FORGE_API_TOKEN: 'worktree-token',
      JSM_EMAIL: 'main-jsm@example.test',
      JSM_API_TOKEN: 'main-jsm-token'
    })
  })

  it('does not block startup when a discovered credential file is unreadable', () => {
    const env: Record<string, string | undefined> = {}
    const result = installLocalCrmCredentials({
      repoRoot: '/repo/worktree',
      env,
      findMainCheckout: () => '/repo/main',
      fileExists: () => true,
      readTextFile: () => {
        throw new Error('permission denied')
      }
    })

    expect(result).toEqual({ loaded: [], filesRead: [] })
    expect(env).toEqual({})
  })
})
