import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  mixpanelImportServiceEvents,
  type MixpanelServiceEvent,
} from "./mixpanelService";

function okResponse(): Response {
  return {
    ok: true,
    status: 200,
    text: vi.fn().mockResolvedValue("ok"),
  } as unknown as Response;
}

function makeEvent(overrides: Partial<MixpanelServiceEvent> = {}): MixpanelServiceEvent {
  return {
    event: "macro_count_snapshot_completed",
    distinctId: "forge-installation-123",
    insertId: "macro-count:v1:run-1:completed",
    time: 1_721_260_800,
    properties: {
      feature_area: "macro_count",
      surface: "scheduled_job",
      run_id: "run-1",
      product_type: "lite",
      space_count: 2,
    },
    ...overrides,
  };
}

describe("mixpanelImportServiceEvents", () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn().mockResolvedValue(okResponse());
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("imports an installation-level event without identify or a fake user id", async () => {
    await mixpanelImportServiceEvents([makeEvent()], "mixpanel-token");

    expect(fetchMock).toHaveBeenCalledOnce();
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://api.mixpanel.com/import");
    expect(init).toMatchObject({
      method: "POST",
      headers: {
        "Authorization": `Basic ${btoa("mixpanel-token:")}`,
        "Content-Type": "application/json",
      },
    });

    const body = JSON.parse(init.body);
    expect(body).toEqual([
      {
        event: "macro_count_snapshot_completed",
        properties: {
          feature_area: "macro_count",
          surface: "scheduled_job",
          run_id: "run-1",
          product_type: "lite",
          space_count: 2,
          token: "mixpanel-token",
          time: 1_721_260_800,
          "$insert_id": "macro-count:v1:run-1:completed",
          distinct_id: "forge-installation-123",
        },
      },
    ]);
    expect(body[0].properties).not.toHaveProperty("user_account_id");
    expect(body[0].properties).not.toHaveProperty("atlassian_user_id");
    expect(fetchMock.mock.calls.map(([calledUrl]) => calledUrl)).not.toContain(
      "https://api.mixpanel.com/engage#profile-set",
    );
  });

  it("uses bounded batches and preserves caller-provided deterministic insert ids", async () => {
    const events = [
      makeEvent(),
      makeEvent({
        event: "macro_count_space_changed",
        insertId: "macro-count:v1:run-1:space-10:changed",
        properties: { run_id: "run-1", space_key: "ENG", delta_total: 3 },
      }),
      makeEvent({
        event: "macro_count_snapshot_failed",
        insertId: "macro-count:v1:run-1:failed",
        properties: { run_id: "run-1", failure_stage: "commit" },
      }),
    ];

    await mixpanelImportServiceEvents(events, "mixpanel-token", { batchSize: 2 });

    expect(fetchMock).toHaveBeenCalledTimes(2);
    const firstBatch = JSON.parse(fetchMock.mock.calls[0][1].body);
    const secondBatch = JSON.parse(fetchMock.mock.calls[1][1].body);
    expect(firstBatch).toHaveLength(2);
    expect(secondBatch).toHaveLength(1);
    expect(firstBatch[1].properties["$insert_id"]).toBe(
      "macro-count:v1:run-1:space-10:changed",
    );
    expect(secondBatch[0].properties["$insert_id"]).toBe(
      "macro-count:v1:run-1:failed",
    );
  });

  it("serializes identical input to an identical retry payload", async () => {
    const event = makeEvent();

    await mixpanelImportServiceEvents([event], "mixpanel-token");
    await mixpanelImportServiceEvents([event], "mixpanel-token");

    expect(fetchMock.mock.calls[0][1].body).toBe(fetchMock.mock.calls[1][1].body);
  });

  it.each([
    ["reserved identity", { user_account_id: "not-a-user" }],
    ["reserved insert id", { "$insert_id": "caller-override" }],
    ["non-scalar data", { contents: [{ contentId: "secret" }] }],
    ["non-finite numeric data", { content_count: Number.NaN }],
  ])("rejects %s properties before sending", async (_label, properties) => {
    await expect(
      mixpanelImportServiceEvents(
        [makeEvent({ properties: properties as unknown as Record<string, string> })],
        "mixpanel-token",
      ),
    ).rejects.toThrow();

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("validates later batches before making the first network request", async () => {
    await expect(
      mixpanelImportServiceEvents(
        [
          makeEvent(),
          makeEvent({ properties: { contents: [] } as unknown as Record<string, string> }),
        ],
        "mixpanel-token",
        { batchSize: 1 },
      ),
    ).rejects.toThrow("property must be scalar: contents");

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("does nothing for an empty event list", async () => {
    await mixpanelImportServiceEvents([], "");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("surfaces an Import API failure", async () => {
    fetchMock.mockResolvedValue({
      ok: false,
      status: 503,
      text: vi.fn().mockResolvedValue("unavailable"),
    });

    await expect(
      mixpanelImportServiceEvents([makeEvent()], "mixpanel-token"),
    ).rejects.toThrow("Mixpanel service import failed with status: 503");
  });
});
