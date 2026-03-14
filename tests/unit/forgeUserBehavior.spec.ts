import { describe, expect, it } from "vitest";
import { mapForgeUserBehaviorEvent } from "../../functions/service/forgeUserBehavior";

describe("mapForgeUserBehaviorEvent", () => {
  it("maps viewed page events into the Mixpanel payload shape", () => {
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
          version: {
            number: 7,
            when: "2026-03-13T23:59:00.000Z",
            by: {
              accountId: "editor-1",
            },
          },
        },
      },
      {
        payload: {
          principal: "user-123",
          app: {
            id: "ari:cloud:ecosystem::app/app-id",
            appVersion: "1.2.3",
            installationId: "ari:cloud:ecosystem::installation/inst-1",
            environment: {
              id: "env-1",
              type: "DEVELOPMENT",
            },
            module: {
              key: "remote-page-behavior-trigger",
            },
          },
          context: {
            cloudId: "cloud-1",
            siteUrl: "https://example.atlassian.net",
            moduleKey: "remote-page-behavior-trigger",
          },
        },
      },
    );

    expect(result).toMatchObject({
      action: "page_viewed",
      event_source: "forge_trigger",
      event_type: "avi:confluence:viewed:page",
      user_account_id: "user-123",
      client_domain: "example.atlassian.net",
      confluence_space: "ENG",
      cloud_id: "cloud-1",
      content_id: "page-1",
      content_title: "Architecture",
      content_version_number: 7,
      forge_module_key: "remote-page-behavior-trigger",
    });
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
        eventType: "avi:confluence:viewed:page",
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
      action: "page_viewed",
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
