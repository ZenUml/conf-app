import { describe, expect, it, vi } from "vitest";
import { insertUserBehaviorEvent } from "../../functions/utils/dbUtils";
import { MixpanelTrackPayload } from "../../functions/service/mixpanelService";

function createMockD1() {
  const run = vi.fn().mockResolvedValue({ success: true });
  const bind = vi.fn().mockReturnValue({ run });
  const prepare = vi.fn().mockReturnValue({ bind });
  return { prepare, bind, run } as any;
}

function createSampleEvent(overrides: Partial<MixpanelTrackPayload> = {}): MixpanelTrackPayload {
  return {
    action: "page_updated",
    event_source: "forge_trigger",
    event_category: "user",
    event_label: "page-1",
    event_type: "avi:confluence:updated:page",
    user_account_id: "user-123",
    client_domain: "example.atlassian.net",
    confluence_space: "ENG",
    cloud_id: "cloud-abc",
    content_id: "page-1",
    content_type: "page",
    space_key: "ENG",
    isForge: true,
    ...overrides,
  };
}

describe("insertUserBehaviorEvent", () => {
  it("inserts event with all essential columns and JSON payload", async () => {
    const db = createMockD1();
    const event = createSampleEvent();

    await insertUserBehaviorEvent(db, event);

    expect(db.prepare).toHaveBeenCalledWith(
      expect.stringContaining("INSERT INTO UserBehaviorEvent"),
    );
    expect(db.bind).toHaveBeenCalledWith(
      "cloud-abc",
      "user-123",
      "page-1",
      "page_updated",
      "example.atlassian.net",
      "ENG",
      JSON.stringify(event),
    );
    expect(db.run).toHaveBeenCalled();
  });

  it("uses fallback values for missing optional fields", async () => {
    const db = createMockD1();
    const event = createSampleEvent({
      cloud_id: undefined,
      user_account_id: undefined,
      content_id: undefined,
      client_domain: undefined,
      space_key: undefined,
      confluence_space: undefined,
    });

    await insertUserBehaviorEvent(db, event);

    expect(db.bind).toHaveBeenCalledWith(
      "unknown_cloud_id",
      "unknown_user",
      "unknown_content",
      "page_updated",
      null,
      null,
      JSON.stringify(event),
    );
  });

  it("prefers space_key over confluence_space", async () => {
    const db = createMockD1();
    const event = createSampleEvent({
      space_key: "OPS",
      confluence_space: "ENG",
    });

    await insertUserBehaviorEvent(db, event);

    expect(db.bind).toHaveBeenCalledWith(
      expect.any(String),
      expect.any(String),
      expect.any(String),
      expect.any(String),
      expect.any(String),
      "OPS",
      expect.any(String),
    );
  });
});
