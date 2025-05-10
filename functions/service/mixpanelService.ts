import { EventBody } from "../track";
import uuidv4 from "../utils/uuid";

const token = "78617e65fdba543d752fb7f6483d55f4";

async function identify(event: EventBody) {
  const url = "https://api.mixpanel.com/engage#profile-set"
  const payload = [
    {
      "$token": token,
      "$distinct_id": event.user_account_id,
      // "$set": {
      //   "$name": "Jane Doe",
      //   "$email": "jane.doe@example.com",
      //   "plan": "Premium"
      // }
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

export async function mixpanelTrack(event: EventBody) {

  await identify(event);
  
  const events = [{ "event": event.action, "properties": { token, time: Date.now(), '$insert_id': uuidv4(), "distinct_id": event.user_account_id, ...event } }];

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