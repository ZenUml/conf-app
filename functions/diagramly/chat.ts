import { response } from "../OkResponse";
import { chat } from "../service/diagramlyService";
import { diagramlyRoute } from "./route";

export const onRequest = diagramlyRoute("chat", {
  parse: (body: { messages?: Array<any> }) =>
    body.messages ? { messages: body.messages } : response(400, "Missing messages"),
  run: (ctx, { messages }) => chat(ctx, messages),
});
