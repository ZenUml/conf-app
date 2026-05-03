import { OkResponse, response } from '../../OkResponse';

interface Env {
  EVENT_BUCKET: R2Bucket;
}

interface EvaluationEvent {
  feature: string;
  enabled: boolean;
  timestamp: string;
  context: {
    clientDomain: string;
    userId?: string;
  };
  result: {
    reason: string;
  };
}

export const onRequest: PagesFunction<Env> = async (context) => {
  const { request, env } = context;

  if (request.method !== 'POST') {
    return response(405, 'Method Not Allowed');
  }

  try {
    const event: EvaluationEvent = await request.json();
    
    // Add timestamp if not provided
    if (!event.timestamp) {
      event.timestamp = new Date().toISOString();
    }
    
    // Create path for the event: metrics/YYYY/MM/DD/HH.jsonl
    const date = new Date(event.timestamp);
    const year = date.getUTCFullYear();
    const month = String(date.getUTCMonth() + 1).padStart(2, '0');
    const day = String(date.getUTCDate()).padStart(2, '0');
    const hour = String(date.getUTCHours()).padStart(2, '0');
    
    const key = `metrics/${year}/${month}/${day}/${hour}.jsonl`;
    
    // Append the event to the hourly file
    let content = '';
    try {
      const existing = await env.EVENT_BUCKET.get(key);
      if (existing) {
        content = await existing.text();
      }
    } catch (err) {
      // File might not exist yet, that's ok
    }
    
    // Add new event
    content += JSON.stringify(event) + '\n';
    
    // Store in R2
    await env.EVENT_BUCKET.put(key, content);
    
    return OkResponse();
  } catch (error) {
    console.error('Error recording evaluation metric:', error);
    return response(500, 'Internal Server Error');
  }
}; 