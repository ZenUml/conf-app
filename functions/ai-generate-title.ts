/// <reference types="@cloudflare/workers-types" />

interface Env {
  AI: Ai;
}

type Strategy = (ai: Ai, dsl: string, type?: string) => Promise<string>;

const strategies: Strategy[] = [
  async (ai, dsl, type) => {
    const result = await (ai as any).run('@cf/meta/llama-2-7b-chat-int8', {
      messages: [
        {
          role: 'system',
          content: `You will help the user to create a title for an ${type || 'UML'} diagram, the user will give a DSL that describing an ${type || 'UML'} diagram, you should just give out one title describing the whole UML and enclose it with triple quotes (like: """example title""").`,
        },
        { role: 'user', content: dsl },
      ],
    });
    const matchResult = (result as any).response.match(/"""(.*)"""/is);
    const title = matchResult?.[1];
    if (!title) throw new Error('Failed to extract title');
    return title;
  },
  async (ai, dsl) => {
    const result = await (ai as any).run('@cf/meta/llama-2-7b-chat-int8', {
      messages: [
        {
          role: 'system',
          content: 'You are an expert of ZenUML sequence diagram. Generate title for the given DSL. Only output the title, nothing else.',
        },
        { role: 'user', content: dsl },
      ],
    });
    const matchResult = (result as any).response.match(/[^"]+title[^"]+"([^"]+)"/is);
    const title = matchResult?.[1];
    if (!title) throw new Error('Failed to extract title');
    return title;
  },
];

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

export async function onRequestPost({ request, env }: { request: Request; env: Env }) {
  if (request.method === 'OPTIONS') {
    return new Response(null, { headers: CORS_HEADERS });
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
