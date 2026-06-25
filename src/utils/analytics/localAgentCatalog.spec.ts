import { describe, it, expect } from "vitest";
import type { AnalyticsEventName } from "./catalog";
import type { AnalyticsProperties } from "./types";

// EAG-96 walking skeleton: this spec proves the catalog/types scaffolding for
// the local-agent diagram integration exists and type-checks. There are no call
// sites yet — these tests are compile-time assertions (the typed literals would
// fail `tsc` if a name/field were missing) with light runtime checks so vitest
// reports green.
describe("local-agent analytics scaffolding (EAG-96)", () => {
  it("registers all 9 new agent_* event names as valid AnalyticsEventName", () => {
    // If any of these were not part of the union, this typed array would not
    // compile — that is the acceptance criterion.
    const events: AnalyticsEventName[] = [
      "agent_dsl_generation_requested",
      "agent_dsl_generated",
      "agent_dsl_export_requested",
      "agent_diagram_list_requested",
      "agent_diagram_read",
      "agent_diagram_write_requested",
      "agent_diagram_write_succeeded",
      "agent_diagram_write_failed",
      "agent_render_preview_requested",
    ];

    expect(events).toHaveLength(9);
    expect(new Set(events).size).toBe(9); // all distinct
  });

  it("accepts an AnalyticsProperties object using every new field", () => {
    // Constructing this with the precise field types is the type-check. The new
    // `local_agent` Surface and EntryPoint enum members are exercised here too.
    const props: AnalyticsProperties = {
      feature_area: "macro",
      surface: "local_agent",
      entry_point: "local_agent",
      agent_client: "claude-code",
      agent_session_id: "sess-abc-123",
      dsl_length: 512,
      export_target: "both",
      paste_token: "tok-xyz-789",
      render_preview_source: "agent",
      preview_rendered: true,
      match_count: 3,
      content_version: 7,
      body_shape_matched: true,
    };

    expect(props.surface).toBe("local_agent");
    expect(props.entry_point).toBe("local_agent");
    expect(props.export_target).toBe("both");
    expect(props.dsl_length).toBe(512);
    expect(props.preview_rendered).toBe(true);
    expect(props.body_shape_matched).toBe(true);
  });

  it("allows export_target to take each of its union members", () => {
    const targets: NonNullable<AnalyticsProperties["export_target"]>[] = [
      "file",
      "clipboard",
      "both",
    ];
    expect(targets).toEqual(["file", "clipboard", "both"]);
  });

  it("accepts paste_token on a macro_create_succeeded payload", () => {
    // paste_token is a shared optional prop, so the editor can read an
    // agent-authored handoff token off a normal create event.
    const event: AnalyticsEventName = "macro_create_succeeded";
    const props: AnalyticsProperties = {
      feature_area: "macro",
      surface: "editor",
      macro_type: "sequence",
      operation_mode: "create",
      paste_token: "tok-from-agent",
    };

    expect(event).toBe("macro_create_succeeded");
    expect(props.paste_token).toBe("tok-from-agent");
  });
});
