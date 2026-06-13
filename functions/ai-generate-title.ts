/// <reference types="@cloudflare/workers-types" />

interface Env {
  AI: Ai;
}

type Strategy = (ai: Ai, dsl: string, type?: string) => Promise<string>;

// Robustly pull a title out of the model's free-form response. Llama often
// ignores the "wrap in triple quotes" instruction (especially for sequence
// DSLs), so fall back through: triple-quoted span -> any quoted span -> the
// first non-empty line of the raw text. Throws only when nothing usable remains.
export function extractTitle(raw: string): string {
  const text = String(raw ?? '');
  const quoted = text.match(/"""([\s\S]*?)"""/)?.[1] ?? text.match(/"([^"]{2,})"/)?.[1];
  const firstLine = (quoted ?? text)
    .replace(/^\s*title\s*[:\-]\s*/i, '')
    .split('\n')
    .map((line) => line.trim())
    .find((line) => line.length > 0);
  const title = (firstLine ?? '').replace(/^["'\s]+|["'\s]+$/g, '').trim();
  if (!title) throw new Error('Failed to extract title');
  return title.slice(0, 80);
}

// Two strategies deliberately run on *different* models so a single model
// deprecation/outage degrades the fallback chain instead of breaking it. This
// endpoint has been taken down twice by Cloudflare deprecating the one shared
// model (llama-2-7b-chat-int8, then llama-3.1-8b-instruct); diverging the models
// closes that failure mode. Verify replacements against `wrangler ai models`.
const PRIMARY_MODEL = '@cf/meta/llama-3.1-8b-instruct-fp8';
const FALLBACK_MODEL = '@cf/meta/llama-3.3-70b-instruct-fp8-fast';

const strategies: Strategy[] = [
  async (ai, dsl, type) => {
    const result = await (ai as any).run(PRIMARY_MODEL, {
      messages: [
        {
          role: 'system',
          content: `You will help the user to create a title for an ${type || 'UML'} diagram, the user will give a DSL that describing an ${type || 'UML'} diagram, you should just give out one concise title (ideally under 60 characters) describing the whole UML and enclose it with triple quotes (like: """example title""").`,
        },
        { role: 'user', content: dsl },
      ],
    });
    return extractTitle((result as any).response);
  },
  async (ai, dsl) => {
    const result = await (ai as any).run(FALLBACK_MODEL, {
      messages: [
        {
          role: 'system',
          content: 'You are an expert of ZenUML sequence diagram. Generate title for the given DSL. Only output the title, nothing else.',
        },
        { role: 'user', content: dsl },
      ],
    });
    return extractTitle((result as any).response);
  },
];

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

export async function onRequest({ request, env }: { request: Request; env: Env }) {
  if (request.method === 'OPTIONS') {
    return new Response(null, { headers: CORS_HEADERS });
  }
  if (request.method !== 'POST') {
    return new Response('Method Not Allowed', { status: 405, headers: CORS_HEADERS });
  }

  let body: { dsl?: string; type?: string };
  try {
    body = await request.json();
  } catch {
    return new Response('Invalid JSON body', { status: 400, headers: CORS_HEADERS });
  }

  if (typeof body?.dsl !== 'string') return new Response("Invalid 'dsl' field", { status: 400, headers: CORS_HEADERS });
  if (body.type && typeof body.type !== 'string') return new Response("Invalid 'type' field", { status: 400, headers: CORS_HEADERS });

  const { dsl, type } = body;
  let title = '';
  let lastError = '';

  for (const strategy of strategies) {
    try {
      title = await strategy(env.AI, dsl, type);
      if (title) break;
    } catch (err) {
      lastError = String(err);
    }
  }

  if (!title) return new Response(lastError || 'Failed to generate title', { status: 500, headers: CORS_HEADERS });
  return new Response(title, { headers: CORS_HEADERS });
}
