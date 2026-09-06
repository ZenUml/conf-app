import { describe, expect, it } from "vitest";
import type { AnalyticsEventName as FrontendAnalyticsEventName } from "../../src/utils/analytics/catalog";
import type { AnalyticsProperties } from "../../src/utils/analytics/types";
import {
  CANONICAL_EVENT_NAME_LIST,
  type AnalyticsEventName as BackendAnalyticsEventName,
} from "../../functions/service/analyticsTypes";

// CANONICAL_EVENT_NAMES (a ReadonlySet derived from CANONICAL_EVENT_NAME_LIST)
// was removed 2026-09-02 — this spec was its only consumer. Derive the set
// locally rather than reintroducing an export with a single test-only reader.
const CANONICAL_EVENT_NAMES: ReadonlySet<string> = new Set(CANONICAL_EVENT_NAME_LIST);

const eventNames = [
  "macro_count_snapshot_completed",
  "macro_count_space_changed",
  "macro_count_snapshot_failed",
] as const satisfies readonly FrontendAnalyticsEventName[] & readonly BackendAnalyticsEventName[];

const completedProperties = {
  feature_area: "macro_count",
  surface: "scheduled_job",
  run_id: "run-1",
  captured_at: "2026-07-18T00:00:00.000Z",
  duration_ms: 12_000,
  product_type: "lite",
  environment_type: "production",
  space_count: 3,
  content_count: 120,
  changed_space_count: 2,
  zeroed_space_count: 1,
  sequence_count: 70,
  graph_count: 20,
  openapi_count: 10,
  mermaid_count: 10,
  plantuml_count: 5,
  unknown_count: 5,
  type_request_count: 4,
  chunk_count: 6,
} satisfies AnalyticsProperties;

const changedProperties = {
  feature_area: "macro_count",
  surface: "scheduled_job",
  run_id: "run-1",
  space_key: "ENG",
  change_reason: "changed",
  previous_total: 93,
  current_total: 120,
  delta_total: 27,
  previous_sequence_count: 50,
  current_sequence_count: 70,
  previous_graph_count: 18,
  current_graph_count: 20,
  previous_openapi_count: 8,
  current_openapi_count: 10,
  previous_mermaid_count: 9,
  current_mermaid_count: 10,
  previous_plantuml_count: 4,
  current_plantuml_count: 5,
  previous_unknown_count: 4,
  current_unknown_count: 5,
} satisfies AnalyticsProperties;

const failedProperties = {
  feature_area: "macro_count",
  surface: "scheduled_job",
  run_id: "run-1",
  duration_ms: 4_000,
  failure_stage: "chunk_upload",
  failure_reason: "r2_write_failed",
  completed_type_count: 1,
  last_completed_type: "ac:com.zenuml.confluence-addon-lite:zenuml-content-sequence",
  processed_contents: 250,
  processed_spaces: 4,
  chunk_count: 2,
} satisfies AnalyticsProperties;

describe("daily macro count analytics vocabulary", () => {
  it("registers all three backend event names", () => {
    expect(eventNames.every((name) => CANONICAL_EVENT_NAMES.has(name))).toBe(true);
  });

  it("keeps the approved payloads scalar and typed", () => {
    for (const properties of [completedProperties, changedProperties, failedProperties]) {
      expect(
        Object.values(properties).every(
          (value) => value == null || ["string", "number", "boolean"].includes(typeof value),
        ),
      ).toBe(true);
    }
  });
});
