import { OkResponse, response } from "./OkResponse";
import { captureError } from "./utils/sentry";
import type { ForgeRequestData } from "./utils/authenticate";

// Backend for the `zenuml-byline-newuser` activation nudge (byline-activation
// spec). Backs the `zenuml-prepared-diagram` content property: the frontend
// dialog fetches the curated diagram body for the current
// page from here instead of re-deriving it client-side.
//
//   GET  /activation-prepared?pageId=<numeric>  — cache read. 200 with the
//        newest curated row for (cloudId, pageId), or a bare 404 on miss
//        (the frontend maps 404 -> activation_cache_miss).
//   POST /activation-prepared  { pageId, diagramType, diagramSource, title }
//        — pipeline write, upserts the curated diagram for (cloudId, pageId,
//        appId).
//
// cloudId (and appId) come ONLY from the verified Forge invocation token
// (data.forgeContext), never from a client-supplied query/body param — this
// is a per-tenant cache, and trusting a client-supplied cloudId would let one
// tenant read or overwrite another tenant's curated diagrams.

export interface Env {
  DB: D1Database;
}

const DIGITS_RE = /^\d+$/;
const MAX_TITLE_CHARS = 300;
const MAX_DIAGRAM_SOURCE_BYTES = 100 * 1024;

function errMessage(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

interface PreparedDiagramRow {
  diagramType: string;
  diagramSource: string;
  title: string | null;
  curatedAt: string;
}

export const onRequest = async ({
  request,
  env,
  data,
}: {
  request: Request;
  env: Env;
  data: ForgeRequestData;
}) => {
  if (request.method !== "GET" && request.method !== "POST") {
    return response(405, "Method not allowed");
  }

  const cloudId = data.forgeContext?.cloudId;
  if (!cloudId) {
    return response(401, "Missing cloudId in Forge context");
  }
  const appId = data.forgeContext?.forgeAppId;
  if (!appId) {
    return response(401, "Missing Forge app id in Forge context");
  }

  if (request.method === "GET") {
    return handleGet(request, env, cloudId);
  }
  return handlePost(request, env, cloudId, appId);
};

async function handleGet(request: Request, env: Env, cloudId: string) {
  const url = new URL(request.url);
  const pageId = url.searchParams.get("pageId") || "";
  if (!DIGITS_RE.test(pageId)) {
    return response(400, "pageId must be a numeric string");
  }

  try {
    const row = await env.DB.prepare(
      "SELECT diagramType, diagramSource, title, curatedAt FROM PreparedDiagram WHERE cloudId = ?1 AND pageId = ?2 ORDER BY curatedAt DESC LIMIT 1",
    )
      .bind(cloudId, pageId)
      .first<PreparedDiagramRow>();

    if (!row) {
      return new Response(null, { status: 404 });
    }

    return OkResponse({
      diagramType: row.diagramType,
      diagramSource: row.diagramSource,
      title: row.title,
      curatedAt: row.curatedAt,
    });
  } catch (error) {
    console.error("Error in activation-prepared GET (D1 read):", error);
    captureError(error);
    return response(500, `Internal server error: ${errMessage(error)}`);
  }
}

async function handlePost(request: Request, env: Env, cloudId: string, appId: string) {
  let body: {
    pageId?: unknown;
    diagramType?: unknown;
    diagramSource?: unknown;
    title?: unknown;
  };
  try {
    body = await request.json();
  } catch {
    return response(400, "Invalid JSON body");
  }

  const pageId = typeof body.pageId === "string" ? body.pageId : "";
  if (!DIGITS_RE.test(pageId)) {
    return response(400, "pageId must be a numeric string");
  }

  const diagramType = typeof body.diagramType === "string" ? body.diagramType.trim() : "";
  if (!diagramType) {
    return response(400, "diagramType is required");
  }

  const diagramSource = typeof body.diagramSource === "string" ? body.diagramSource : "";
  if (!diagramSource) {
    return response(400, "diagramSource is required");
  }
  if (new TextEncoder().encode(diagramSource).length > MAX_DIAGRAM_SOURCE_BYTES) {
    return response(413, `diagramSource exceeds ${MAX_DIAGRAM_SOURCE_BYTES} bytes`);
  }

  const title = typeof body.title === "string" ? body.title.slice(0, MAX_TITLE_CHARS) : null;
  const curatedAt = new Date().toISOString();

  try {
    const result = await env.DB.prepare(
      `INSERT INTO PreparedDiagram (cloudId, pageId, appId, diagramType, diagramSource, title, curatedAt)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)
       ON CONFLICT(cloudId, pageId, appId) DO UPDATE SET
         diagramType = excluded.diagramType,
         diagramSource = excluded.diagramSource,
         title = excluded.title,
         curatedAt = excluded.curatedAt`,
    )
      .bind(cloudId, pageId, appId, diagramType, diagramSource, title, curatedAt)
      .run();
    console.log("PreparedDiagram upsert result:", result);
    return OkResponse({ ok: true });
  } catch (error) {
    console.error("Error in activation-prepared POST (D1 write):", error);
    captureError(error);
    return response(500, `Internal server error: ${errMessage(error)}`);
  }
}
