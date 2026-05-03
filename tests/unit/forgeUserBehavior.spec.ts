import { describe, expect, it } from "vitest";
import { mapForgeUserBehaviorEvent } from "../../functions/service/forgeUserBehavior";

describe("mapForgeUserBehaviorEvent", () => {
  it("maps page_viewed events to D1", () => {
    const result = mapForgeUserBehaviorEvent(
      {
        eventType: "avi:confluence:viewed:page",
        atlassianId: "user-123",
        eventCreatedDate: "2026-03-14T00:00:00.000Z",
        suppressNotifications: false,
        content: {
          id: "page-1",
          type: "page",
          status: "current",
          title: "Architecture",
          space: {
            id: 42,
            key: "ENG",
            name: "Engineering",
          },
        },
      },
      {
        payload: {
          principal: "user-123",
          context: {
            cloudId: "cloud-1",
            siteUrl: "https://example.atlassian.net",
          },
        },
      },
    );

    expect(result).not.toBeNull();
    expect(result!.action).toBe("page_viewed");
    expect(result!.content_id).toBe("page-1");
    expect(result!.cloud_id).toBe("cloud-1");
    expect(result!.space_key).toBe("ENG");
  });

  it("maps updated page events and preserves updateTrigger", () => {
    const result = mapForgeUserBehaviorEvent(
      {
        eventType: "avi:confluence:updated:page",
        eventCreatedDate: "2026-03-14T00:00:00.000Z",
        updateTrigger: "page_started",
        content: {
          id: "page-2",
          type: "page",
          status: "current",
          title: "Runbook",
          space: {
            key: "OPS",
          },
        },
      },
      {
        payload: {
          principal: "user-456",
          app: {
            apiBaseUrl: "https://api.atlassian.com/ex/confluence/abc-123",
          },
        },
      },
    );

    expect(result).toMatchObject({
      action: "page_updated",
      update_trigger: "page_started",
      user_account_id: "user-456",
      client_domain: "unknown_atlassian_domain",
      cloud_id: "abc-123",
      confluence_space: "OPS",
    });
  });

  it("falls back to the stored installation client domain when siteUrl is missing", () => {
    const result = mapForgeUserBehaviorEvent(
      {
        eventType: "avi:confluence:updated:page",
        content: {
          id: "page-4",
          type: "page",
          space: {
            key: "ENG",
          },
        },
      },
      {
        payload: {
          principal: "user-789",
          context: {
            cloudId: "cloud-2",
          },
        },
      },
      {
        clientDomain: "whimet4.atlassian.net",
      },
    );

    expect(result).toMatchObject({
      action: "page_updated",
      user_account_id: "user-789",
      client_domain: "whimet4.atlassian.net",
      cloud_id: "cloud-2",
    });
  });

  it("ignores live docs so V1 stays page-only", () => {
    const result = mapForgeUserBehaviorEvent(
      {
        eventType: "avi:confluence:viewed:page",
        content: {
          id: "page-3",
          type: "page",
          subType: "live",
        },
      },
      {},
    );

    expect(result).toBeNull();
  });
});
