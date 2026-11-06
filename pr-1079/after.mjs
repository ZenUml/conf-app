// src/lib/aiTitleGuard.js
var NOT_TITLE_LIKE = "not_title_like";
var MAX_TITLE_REPLY_LENGTH = 100;
var CHAT_REPLY_PATTERNS = [
  /^please (?:provide|share|give|send|paste|specify|describe|enter|let me|note)\b/i,
  /^i(?:'m|'ll|'d|'ve| am| will| would| have| need| can| cannot| can't| don't| do not| see)\b/i,
  /^(?:sorry|however|certainly|sure|of course)\s*[,!.:]/i,
  /^(?:unfortunately|apologies)\b/i,
  /^you (?:did|didn't|haven't|have not|need|must|should|can|will)\b/i,
  /^(?:could|can|would|will) you\b/i,
  /^to (?:create|generate|give|provide|write|help)\b.*\btitle\b/i,
  /^based on the (?:dsl|provided|given|information|description)\b/i,
  /^here(?:'s| is| are)\b/i,
  /\b(?:provide|provided|describing|describes)\b.*\bdsl\b/i,
  /\bdsl\b.*\b(?:provide|provided|describing|describes)\b/i
];
var PROMPT_ECHOES = /^(?:dsl|title|example title|untitled)$/i;
function looksLikeTitle(reply) {
  const text = String(reply ?? "").replace(/’/g, "'").trim();
  if (!text || text.length > MAX_TITLE_REPLY_LENGTH) return false;
  if (text.includes("\n") || text.endsWith("?")) return false;
  if (PROMPT_ECHOES.test(text)) return false;
  return !CHAT_REPLY_PATTERNS.some((pattern) => pattern.test(text));
}

// functions/ai-generate-title.ts
function isOpenApiTitleRequest(type) {
  return /openapi/i.test((type || "").trim());
}
function isSequenceTitleRequest(type) {
  return !type || /sequence/i.test(type);
}
function extractTitle(raw) {
  const text = String(raw ?? "");
  const quoted = text.match(/"""([\s\S]*?)"""/)?.[1] ?? text.match(/"([^"]{2,})"/)?.[1];
  const firstLine = (quoted ?? text).replace(/^\s*title\s*[:\-]\s*/i, "").split("\n").map((line) => line.trim()).find((line) => line.length > 0);
  const title = (firstLine ?? "").replace(/^["'\s]+|["'\s]+$/g, "").trim();
  if (!title) throw new Error("Failed to extract title");
  if (!looksLikeTitle(title)) throw new Error(NOT_TITLE_LIKE);
  return title.slice(0, 80);
}
function extractModelTitle(result) {
  const output = result;
  const raw = Array.isArray(output?.choices) ? output.choices[0]?.message?.content : output?.response;
  if (typeof raw !== "string") throw new Error("Failed to extract title");
  if (/<think\b|<\|channel>thought/i.test(raw)) throw new Error(NOT_TITLE_LIKE);
  return extractTitle(raw);
}
var PRIMARY_MODEL = "@cf/google/gemma-4-26b-a4b-it";
var FALLBACK_MODEL = "@cf/meta/llama-3.3-70b-instruct-fp8-fast";
var strategies = [
  async (ai, dsl, type) => {
    const systemPrompt = isOpenApiTitleRequest(type) ? 'Create one concise title (ideally under 60 characters) for the provided OpenAPI specification. Only output the title, enclosed with triple quotes (like: """example title""").' : `You will help the user to create a title for an ${type || "UML"} diagram, the user will give a DSL that describing an ${type || "UML"} diagram, you should just give out one concise title (ideally under 60 characters) describing the whole UML and enclose it with triple quotes (like: """example title""").`;
    const result = await ai.run(PRIMARY_MODEL, {
      messages: [
        {
          role: "system",
          content: systemPrompt
        },
        { role: "user", content: dsl }
      ],
      // Non-thinking usage: https://developers.cloudflare.com/workers-ai/get-started/workers-wrangler/
      chat_template_kwargs: { enable_thinking: false },
      max_completion_tokens: 128
    });
    return extractModelTitle(result);
  },
  async (ai, dsl, type) => {
    const systemPrompt = isOpenApiTitleRequest(type) ? "Generate one concise title for the provided OpenAPI specification. Only output the title, nothing else." : isSequenceTitleRequest(type) ? "You are an expert of ZenUML sequence diagram. Generate title for the given DSL. Only output the title, nothing else." : `Generate one concise title for the provided ${type} diagram. Only output the title, nothing else.`;
    const result = await ai.run(FALLBACK_MODEL, {
      messages: [
        {
          role: "system",
          content: systemPrompt
        },
        { role: "user", content: dsl }
      ]
    });
    return extractModelTitle(result);
  }
];
var CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type"
};
async function onRequest({ request, env }) {
  if (request.method === "OPTIONS") {
    return new Response(null, { headers: CORS_HEADERS });
  }
  if (request.method !== "POST") {
    return new Response("Method Not Allowed", { status: 405, headers: CORS_HEADERS });
  }
  let body;
  try {
    body = await request.json();
  } catch {
    return new Response("Invalid JSON body", { status: 400, headers: CORS_HEADERS });
  }
  if (typeof body?.dsl !== "string") return new Response("Invalid 'dsl' field", { status: 400, headers: CORS_HEADERS });
  if (body.type && typeof body.type !== "string") return new Response("Invalid 'type' field", { status: 400, headers: CORS_HEADERS });
  const { dsl, type } = body;
  let title = "";
  let lastError = "";
  let modelRefused = false;
  for (const strategy of strategies) {
    try {
      title = await strategy(env.AI, dsl, type);
      if (title) break;
    } catch (err) {
      lastError = String(err);
      modelRefused = err?.message === NOT_TITLE_LIKE;
    }
  }
  if (!title && modelRefused) return new Response(NOT_TITLE_LIKE, { status: 422, headers: CORS_HEADERS });
  if (!title) return new Response(lastError || "Failed to generate title", { status: 500, headers: CORS_HEADERS });
  return new Response(title, { headers: CORS_HEADERS });
}
export {
  extractTitle,
  onRequest
};
