# Backend (Cloudflare Workers)

Loaded when working under `functions/`. Project-wide rules stay in the repo-root `CLAUDE.md`.

- **Functions**: Located in `functions/` directory. **CRITICAL:** `public/_routes.json` is an explicit allowlist — any new function path must be added to its `include` array, otherwise Cloudflare Pages serves the path as a static SPA HTML fallback instead of routing it to the function. Symptom: `GET /your/path` returns 200 with `content-type: text/html` instead of running your code.
- **Database**: D1 database with migrations in `functions/migrations/`
- **Auth**: Forge invocation token (RS256) validated via `functions/utils/authenticate.ts`
