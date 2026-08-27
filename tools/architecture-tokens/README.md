# Architecture Tokens — local pilot tooling

Phase-1 processing for the Architecture Tokens discovery pilot runs **locally**.
Nothing here deploys, writes to D1, or calls a model.

Three layers, kept distinct everywhere:

| layer | field | example | meaning |
|---|---|---|---|
| raw diagram label | `rawLabel` | `Partner App` | what the author wrote (Mermaid `Actor.description`) |
| lexical candidate key | `comparisonKey` | `partner.app` | non-binding grouping aid; recomputed on every run |
| canonical Token ID | (not produced here) | `commerce.payments.api` | the only level that can mean "same enterprise object"; assigned by a person |

`actorId` (Mermaid `Actor.name`, e.g. `PA` in `participant PA as Partner App`) is
stored as the anchor for durable decisions and is never used as a grouping key —
short ids such as `DB`, `API`, `Svc` recur across unrelated diagrams.

## Files

- `extract.ts` — `extractParticipants()` and `isSequenceDiagram()`. Line-based,
  handles `participant`, `actor`, `create …`, `X as Label`, `box … end`, `;`
  separators, `%%` comments and YAML frontmatter. `extract.spec.ts` checks it
  against mermaid's own `getActors()` under jsdom.
- `read-corpus.mjs` — pulls one space's current Mermaid sequence diagrams from the
  D1 mirror (`wrangler d1 execute conf-zenuml-prod --remote`).
- `extract-corpus.mjs` — corpus → occurrence artifact (extraction + normalization).
- `pilot/` — scripts rescued from the 2026-08-27 local pilot: the normalizer
  (`participant-normalization.mjs`, `@sindresorhus/slugify`, `separator: '.'`,
  diacritics preserved), the participant browser builder, and the model-overlay
  scoring scripts. They read/write `$ARCHTOK_DIR` (default: cwd).

## Run

```bash
# 1. corpus (raw customer source — $ARCHTOK_DIR = private/local-data/architecture-tokens/<pilot>, git-ignored)
node --experimental-strip-types tools/architecture-tokens/read-corpus.mjs \
  --space-id <spaceId> --app-id <forgeAppId> --out $ARCHTOK_DIR/corpus.json

# 2. occurrences
node --experimental-strip-types tools/architecture-tokens/extract-corpus.mjs \
  --corpus $ARCHTOK_DIR/corpus.json --out $ARCHTOK_DIR/participant-normalization-analysis.json

# 3. tests
pnpm vitest --run tools/architecture-tokens
```

Customer data — corpus files, extracted labels, model outputs, tenant
identifiers — is never committed to any repository, the `private/` submodule
included. It lives in the git-ignored folder `private/local-data/architecture-tokens/`
(`$ARCHTOK_DIR`), which `private/.gitignore` excludes.
