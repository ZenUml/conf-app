# Real host: claude.ai custom connector (production)

- Endpoint: `https://conf-lite.zenuml.com/mcp/render`
- Host: claude.ai web, in Chrome. Model: Opus 5.5. Only the ZenUML Render connector was enabled in the chat.
- Test window: **2026-10-31 03:01:50Z – 03:09:16Z**. Exclude it from adoption numbers (`mcp_mode = "render"`, `unknown_user_account_id`).
- Every prompt and diagram is invented. The screenshots are cropped to the chat column.

| Step | Result | Screenshot |
|---|---|---|
| Add a custom connector | claude.ai pre-selected **No sign-in (Detected)**. No OAuth prompt | [01](01-connector-no-sign-in.jpg) |
| Connect | Connected; `Render diagram` is listed under "Interactive tools" | [02](02-connector-connected.jpg) |
| Sequence ("Draw a sequence diagram of a user logging in") | The model chose `sequence` (ZenUML) itself. **Drawn inline**; the wide diagram scrolls sideways inside the frame | [03](03-sequence.jpg) |
| Mermaid flowchart | **Drawn inline** | [04](04-mermaid.jpg) |
| PlantUML class diagram | **Drawn inline** | [05](05-plantuml.jpg) |
| draw.io (graph) | **Drawn inline** | [06](06-drawio.jpg) |
| OpenAPI 3 | **Drawn inline** (swagger-ui) | [07](07-openapi.jpg) |
| Broken Mermaid, sent unchanged | The tool returned `line 2, column 4: Parse error on line 2:`. The model fixed the source, called again, and the fix was drawn | [08](08-broken-call.jpg), [09](09-error-and-retry.jpg) |

## Findings

1. **Mermaid error text is truncated.** `parseMermaid` in `functions/agent-link/parseDsl.ts` keeps only `message.split('\n')[0]`. For jison errors that is just "Parse error on line N:", so the excerpt and the "Expecting …" line are dropped. The model still recovered from the line/column, but it had to guess the cause.
2. **The ZenUML parse check let a mis-drawn source through.** The model wrote `Browser->AuthService.POST /login(email, password)`. It parsed as valid, but it drew an unnamed participant and two "SECTION" blocks. The parse check only catches outright syntax errors, not sources that parse into something unintended.
3. Not tested: the Claude desktop app.
