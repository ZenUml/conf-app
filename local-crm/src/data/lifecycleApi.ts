import type { LifecycleResponse } from './lifecycleContract'

export interface LifecycleLoadState {
  state: 'loading' | 'live' | 'error'
  generatedAt: string | null
  data: LifecycleResponse | null
  error: string | null
}

export const INITIAL_LIFECYCLE_LOAD: LifecycleLoadState = {
  state: 'loading',
  generatedAt: null,
  data: null,
  error: null
}

export async function loadLifecycleResponse(): Promise<LifecycleResponse> {
  const response = await fetch('/api/local-crm/lifecycle')
  if (!response.ok) {
    const body = await response.json().catch(() => null)
    throw new Error(body?.detail ?? `Lifecycle API returned ${response.status}`)
  }
  return response.json() as Promise<LifecycleResponse>
}
