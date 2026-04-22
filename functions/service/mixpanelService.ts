import uuidv4 from "../utils/uuid";

// Separate tokens for different use cases
export const MIXPANEL_TOKEN_FORGE_USER_BEHAVIOUR = "62d0ff230c6799db2a4d30a04fe5e1e2";
export const MIXPANEL_TOKEN_FRONTEND = "62d0ff230c6799db2a4d30a04fe5e1e2";

export interface MixpanelTrackPayload {
  action: string;
  user_account_id?: string;
  atlassian_user_id?: string;
  [key: string]: string | number | boolean | undefined | null;
}

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
  
  const events = [{
    "event": event.action,
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
