import { beforeEach, describe, expect, it, vi } from 'vitest';
import { captureCreationAttemptProperties as capture, resetCreationAttemptTelemetry } from './creationAttemptTelemetry';
import type { AnalyticsEventName } from './catalog';
import type { AnalyticsProperties } from './types';

const props: AnalyticsProperties = { feature_area: 'macro', surface: 'editor', macro_type: 'sequence', operation_mode: 'create' };
const event = (name: AnalyticsEventName, overrides: Partial<AnalyticsProperties> = {}) => capture(name, { ...props, ...overrides });

beforeEach(() => { resetCreationAttemptTelemetry(); vi.restoreAllMocks(); });

describe('creation attempt lifecycle', () => {
  it('pairs a no-switch create with durable success', () => {
    const start = event('macro_create_started');
    expect(event('macro_create_succeeded')).toMatchObject({ creation_attempt_id: start.creation_attempt_id, initial_macro_type: 'sequence', final_macro_type: 'sequence', creation_event_index: 1 });
    expect(start.creation_attempt_id).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('preserves the initial type and orders multiple switches independently of identity', () => {
    const start = event('macro_create_started');
    const mermaid = event('macro_type_changed', { from_macro_type: 'sequence', to_macro_type: 'mermaid' });
    const plantuml = event('macro_type_changed', { from_macro_type: 'mermaid', to_macro_type: 'plantuml' });
    expect([start, mermaid, plantuml].map(p => p.creation_event_index)).toEqual([0, 1, 2]);
    expect(plantuml).toMatchObject({ creation_attempt_id: start.creation_attempt_id, initial_macro_type: 'sequence', final_macro_type: 'plantuml' });
    expect(start.final_macro_type).toBe('sequence');
    expect(mermaid.final_macro_type).toBe('mermaid');
  });

  it('keeps the same attempt across blocked publish, failure and retry', () => {
    const start = event('macro_create_started');
    const results = ['macro_publish_requested', 'macro_publish_blocked', 'macro_publish_requested', 'macro_save_failed', 'macro_publish_requested', 'macro_create_succeeded', 'macro_publish_completed'].map(n => event(n as AnalyticsEventName));
    expect(results.map(p => p.creation_attempt_id)).toEqual(Array(7).fill(start.creation_attempt_id));
    expect(results.map(p => p.creation_event_index)).toEqual([1, 2, 3, 4, 5, 6, 7]);
  });

  it('records explicit close after one switch and elapsed time, with no inferred teardown', () => {
    vi.spyOn(Date, 'now').mockReturnValue(1000);
    const start = event('macro_create_started');
    event('macro_type_changed', { macro_type: 'mermaid' });
    vi.spyOn(Date, 'now').mockReturnValue(2500);
    expect(event('macro_create_cancelled', { macro_type: 'mermaid', close_source: 'host_close' })).toMatchObject({ creation_attempt_id: start.creation_attempt_id, final_macro_type: 'mermaid', creation_elapsed_ms: 1500 });
    expect(event('macro_type_changed')).toEqual({});
  });

  it('does not attach a create ID to edits or unrelated events', () => {
    event('macro_create_started');
    expect(event('macro_type_changed', { operation_mode: 'edit' })).toEqual({});
    expect(event('macro_viewed')).toEqual({});
    event('macro_edit_started', { operation_mode: 'edit' });
    expect(event('macro_save_failed')).toEqual({});
  });

  it('does not invent an attempt for orphan outcomes and gives a new editor a new ID', () => {
    expect(event('macro_create_succeeded')).toEqual({});
    const first = event('macro_create_started');
    event('macro_create_cancelled');
    expect(event('macro_create_started').creation_attempt_id).not.toBe(first.creation_attempt_id);
  });

  it('copies no raw content, customer identity or replay data into attempt properties', () => {
    const result = event('macro_create_started', { user_account_id: 'secret-account', client_domain: 'secret-tenant', page_id: 'secret-page', custom_content_id: 'secret-content', source: 'secret-source', session_id: 'secret-session' });
    expect(Object.keys(result).sort()).toEqual(['creation_attempt_id', 'creation_elapsed_ms', 'creation_event_index', 'final_macro_type', 'initial_macro_type']);
    expect(JSON.stringify(result)).not.toContain('secret');
  });
});
