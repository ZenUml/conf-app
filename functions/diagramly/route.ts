import { OkResponse, response } from "../OkResponse";
import type { ForgeRequestData } from "../utils/authenticate";
import { resolveDiagramlyIdentity, type DiagramlyIdentity } from "./context";

// `env` stays `any` until the shared Env type from #960 exists; no Env in
// functions/ covers the Diagramly bindings today.
export type DiagramlyRunContext = DiagramlyIdentity & { env: any };

/**
 * The one route shell for the Diagramly AI endpoints: POST only, verified Forge
 * identity, JSON body (400 when it does not parse), `OkResponse` for the
 * result, one log format and one 500 body.
 *
 * - `parse` checks the fields and returns the typed body, or a `Response`
 *   (normally a 400) that is sent as is.
 * - `run` calls the service. It may return a `Response` for a status the shell
 *   does not own (job-status maps "not found" to 404); anything else is sent
 *   through `OkResponse`. A throw becomes a 500.
 */
export function diagramlyRoute<B>(
  name: string,
  opts: {
    parse: (body: any) => B | Response;
    run: (ctx: DiagramlyRunContext, body: B) => Promise<unknown>;
  },
) {
  return async ({
    request,
    env,
    data,
  }: {
    request: Request;
    env: any;
    data: ForgeRequestData;
  }): Promise<Response> => {
    if (request.method !== "POST") {
      return response(405, "Method not allowed");
    }

    try {
      // Identity before the body, as every handler did: an unauthenticated
      // caller gets the auth answer whatever it sent.
      const identity = resolveDiagramlyIdentity(data);
      if (identity instanceof Response) {
        return identity;
      }

      let raw: unknown;
      try {
        raw = await request.json();
      } catch {
        return response(400, "Invalid JSON body");
      }

      const body = opts.parse(raw);
      if (body instanceof Response) {
        return body;
      }

      const result = await opts.run({ ...identity, env }, body);
      if (result instanceof Response) {
        return result;
      }
      return OkResponse(result as object | undefined);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error(`[diagramly/${name}] Error:`, message);
      return response(500, message || "Internal server error");
    }
  };
}
