import uuidv4 from "../utils/uuid";
import type { AnalyticsEventName } from "./analyticsTypes";


export interface MixpanelTrackPayload {
  // NOT the /track endpoint's old transport_version: 2 "canonical" shape
  // (deleted 2026-09-02 — nothing ever sent it). `event` is live: backend
  // callers that already know their own event name pass it directly here
  // (e.g. forge-upload-attachment.ts's async PNG-backup outcome) rather than
  // routing through /track's `action`-keyed legacy body.
  event?: string;
  action?: string;          // legacy event name — from functions/track.ts's TrackRequest body
  user_account_id?: string;
  atlassian_user_id?: string;
  [key: string]: string | number | boolean | undefined | null;
}

export type MixpanelScalar = string | number | boolean | undefined | null;

/**
 * One backend-owned event for Mixpanel's Import API.
 *
 * Unlike MixpanelTrackPayload, identity and deduplication are required and
 * explicit. Scheduled/service work has no user identity: callers pass the
 * verified Forge installation id as distinctId and a deterministic insertId.
 * `time` is Unix epoch seconds and should be derived from the run's capturedAt
 * so retrying the same commit produces the same payload.
 */
export interface MixpanelServiceEvent {
  event: AnalyticsEventName;
  properties: Record<string, MixpanelScalar>;
  distinctId: string;
  insertId: string;
  time: number;
}

export interface MixpanelServiceImportOptions {
  /** Bound each Import request. Defaults conservatively below API limits. */
  batchSize?: number;
}

const DEFAULT_SERVICE_BATCH_SIZE = 500;
const MAX_SERVICE_BATCH_SIZE = 2_000;
const RESERVED_SERVICE_PROPERTIES = new Set([
  "event",
  "token",
  "time",
  "$insert_id",
  "distinct_id",
  // A scheduled job must not masquerade as an Atlassian user.
  "user_account_id",
  "atlassian_user_id",
]);

async function identify(distinctId: string, token: string) {
  const url = "https://api.mixpanel.com/engage#profile-set"
  const payload = [
    {
      "$token": token,
      "$distinct_id": distinctId,
    }
  ]

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload)
  });

  if (!response.ok) {
    throw new Error(`Mixpanel identify request failed with status: ${response.status}, message: ${await response.text()}`);
  }
}

function getDistinctId(event: MixpanelTrackPayload): string {
  return event.user_account_id || event.atlassian_user_id || "unknown_user_account_id";
}

export async function mixpanelTrack(event: MixpanelTrackPayload, token: string) {
  const distinctId = getDistinctId(event);

  if (distinctId !== "unknown_user_account_id") {
    await identify(distinctId, token);
  }
  
  const eventName = event.event || event.action || "unknown_event";
  const events = [{
    "event": eventName,
    "properties": {
      token,
      time: Date.now(),
      '$insert_id': uuidv4(),
      "distinct_id": distinctId,
      user_account_id: distinctId,
      ...event
    }
  }];

  const response = await fetch(`https://api.mixpanel.com/import`, {
    method: 'POST',
    headers: {
      'Authorization': `Basic ${btoa(`${token}:`)}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(events)
  });

  if (!response.ok) {
    throw new Error(`Mixpanel track request failed with status: ${response.status}, message: ${await response.text()}`);
  }
}

function validateServiceEvent(event: MixpanelServiceEvent): void {
  if (!event.event || !event.distinctId || !event.insertId) {
    throw new Error("Mixpanel service event requires event, distinctId, and insertId");
  }
  if (!Number.isFinite(event.time)) {
    throw new Error("Mixpanel service event time must be a finite Unix timestamp");
  }

  for (const [key, value] of Object.entries(event.properties)) {
    if (RESERVED_SERVICE_PROPERTIES.has(key)) {
      throw new Error(`Mixpanel service event property is reserved: ${key}`);
    }
    if (value !== null && value !== undefined && !["string", "number", "boolean"].includes(typeof value)) {
      throw new Error(`Mixpanel service event property must be scalar: ${key}`);
    }
    if (typeof value === "number" && !Number.isFinite(value)) {
      throw new Error(`Mixpanel service event numeric property must be finite: ${key}`);
    }
  }
}

function toMixpanelImportEvent(event: MixpanelServiceEvent, token: string) {
  validateServiceEvent(event);

  return {
    event: event.event,
    properties: {
      ...event.properties,
      token,
      time: event.time,
      "$insert_id": event.insertId,
      distinct_id: event.distinctId,
    },
  };
}

/**
 * Import backend/service events without calling Mixpanel Engage/identify.
 *
 * The existing mixpanelTrack function is intentionally user-oriented and
 * performs a profile identify before every event. Daily snapshot events are
 * installation-level, can contain one event per changed space, and must be
 * idempotent across commit retries, so they use this bounded batch path.
 */
export async function mixpanelImportServiceEvents(
  events: readonly MixpanelServiceEvent[],
  token: string,
  options: MixpanelServiceImportOptions = {},
): Promise<void> {
  if (events.length === 0) return;
  if (!token) throw new Error("Mixpanel token is required");

  const batchSize = options.batchSize ?? DEFAULT_SERVICE_BATCH_SIZE;
  if (!Number.isInteger(batchSize) || batchSize < 1 || batchSize > MAX_SERVICE_BATCH_SIZE) {
    throw new Error(`Mixpanel service batchSize must be an integer between 1 and ${MAX_SERVICE_BATCH_SIZE}`);
  }

  // Validate and materialize every event before the first network write. A
  // malformed later batch must not leave an avoidable partial analytics send.
  const importEvents = events.map((event) => toMixpanelImportEvent(event, token));

  for (let offset = 0; offset < importEvents.length; offset += batchSize) {
    const batch = importEvents.slice(offset, offset + batchSize);

    const response = await fetch("https://api.mixpanel.com/import", {
      method: "POST",
      headers: {
        "Authorization": `Basic ${btoa(`${token}:`)}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(batch),
    });

    if (!response.ok) {
      throw new Error(
        `Mixpanel service import failed with status: ${response.status}, message: ${await response.text()}`,
      );
    }
  }
}
