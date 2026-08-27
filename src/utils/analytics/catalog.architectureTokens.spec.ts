import { describe, expect, it } from 'vitest';
import type { AnalyticsEventName, FeatureArea } from './catalog';
import type { AnalyticsProperties } from './types';

describe('architecture_tokens analytics contract', () => {
  it('declares the five events and the feature area', () => {
    const names: AnalyticsEventName[] = [
      'related_diagrams_lookup_succeeded',
      'related_diagrams_lookup_failed',
      'related_diagrams_shown',
      'related_diagram_popover_opened',
      'related_diagram_link_clicked',
    ];
    const area: FeatureArea = 'architecture_tokens';
    const props: AnalyticsProperties = {
      feature_area: area, surface: 'viewer', macro_type: 'mermaid',
      participant_count: 7, participants_with_related: 5, related_pages_total: 12,
      index_age_days: 3, related_count: 3,
      label_variant_count: 2, same_space: false, same_page: true, error_kind: 'timeout',
    };
    expect(names).toHaveLength(5);
    expect(props.feature_area).toBe('architecture_tokens');
    expect(props.same_page).toBe(true);
  });
});
