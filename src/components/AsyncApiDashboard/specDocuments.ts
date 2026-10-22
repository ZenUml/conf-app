import type { ICustomContent } from '@/model/ICustomContent'

export interface SpecSummary {
  format?: 'asyncapi' | 'openapi'
  apiVersion?: string
  schemaVersion?: string
  description?: string
  title?: string
  channelsCount?: number
  serversCount?: number
  pathsCount?: number
  operationsCount?: number
}

export interface AsyncApiDoc {
  id: string
  contentId?: string
  format?: 'asyncapi' | 'openapi'
  title?: string
  displayTitle: string
  description?: string
  code?: string
  apiVersion?: string
  schemaVersion?: string
  channelsCount?: number
  serversCount?: number
  pathsCount?: number
  operationsCount?: number
  rev?: number
  status?: string
  createdAt?: string
  updatedAt?: string
  createdLabel?: string
  updatedLabel?: string
  pageId?: string
  pageLabel?: string
  pageUrl?: string
}

// STUB: intentionally wrong so the specs fail first (TDD).
export function parseSpecSummary(_raw?: string): SpecSummary {
  throw new Error('not implemented')
}

export function toSpecDocument(_entry: ICustomContent): AsyncApiDoc | null {
  throw new Error('not implemented')
}
