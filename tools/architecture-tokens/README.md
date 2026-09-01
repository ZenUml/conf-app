# Architecture Tokens — local pilot tooling

Phase-1 processing for the Architecture Tokens discovery pilot runs **locally**.
Nothing here deploys, writes to D1, or calls a model.

Three layers, kept distinct everywhere:

| layer | field | example | meaning |
|---|---|---|---|
| raw diagram label | `rawLabel` | `Partner App` | what the author wrote as an explicit declaration label |
| lexical candidate key | `comparisonKey` | `partner.app` | non-binding grouping aid; recomputed on every run |
| canonical Token ID | (not produced here) | `commerce.payments.api` | the only level that can mean "same enterprise object"; assigned by a person |

`actorId` (the explicit declaration name, e.g. `PA` in `participant PA as Partner App`) is
stored as the anchor for durable decisions and is never used as a grouping key —
short ids such as `DB`, `API`, `Svc` recur across unrelated diagrams.

## Files

- `extract.ts` — explicit Mermaid declarations and explicit ZenUML parser-AST
  declarations only; message-derived lifelines are excluded.
- `read-corpus.mjs` — pulls one space's current Mermaid and ZenUML sequence
  diagrams from an explicitly selected D1 mirror.
- `read-corpus-confluence.mjs` — same corpus shape, read straight from Confluence
  by space key. The D1 mirror is written only by `functions/forge-custom-content.ts`
  on a Forge *save*, so content created through the Confluence REST API is absent
  from `CustomContent` and `read-corpus.mjs` returns zero sources for it with no
  error. Use this for REST-seeded spaces; merge its output with the D1 corpus
  (`sources` concatenated, deduped on `sourceId`) before `extract-corpus.mjs`.
- `extract-corpus.mjs` — corpus → occurrence artifact (extraction + normalization).
- `pilot/` — scripts rescued from the 2026-08-27 local pilot: the normalizer
  (`participant-normalization.mjs`, `@sindresorhus/slugify`, `separator: '.'`,
  diacritics preserved), the participant browser builder, and the model-overlay
  scoring scripts. They read/write `$ARCHTOK_DIR` (default: cwd).

## Run

```bash
# 0. ARCHTOK_DIR = private/local-data/architecture-tokens/<pilot>  (git-ignored; holds cloud-id)
# 1. corpus, tenant-wide
node --experimental-strip-types tools/architecture-tokens/read-corpus.mjs --client-domain <domain> --database <staging-d1-name> --out $ARCHTOK_DIR/raw/corpus-$(date +%F).json
# 1b. spaces the D1 mirror does not hold (REST-seeded); merge into the same corpus
node --experimental-strip-types tools/architecture-tokens/read-corpus-confluence.mjs --site <host> --space-keys <K1,K2> --cloud-id <uuid> --type 'ac:<connect-key>:zenuml-content-sequence' --out $ARCHTOK_DIR/raw/corpus-confluence-$(date +%F).json
# 2. occurrences
node --experimental-strip-types tools/architecture-tokens/extract-corpus.mjs --corpus $ARCHTOK_DIR/raw/corpus-$(date +%F).json --out $ARCHTOK_DIR/participant-occurrences-$(date +%F).json
# 3. upload (replaces the tenant's rows in D1)
node --experimental-strip-types tools/architecture-tokens/upload-index.mjs --artifact $ARCHTOK_DIR/participant-occurrences-$(date +%F).json --cloud-id-file $ARCHTOK_DIR/cloud-id --database <staging-d1-name>
# 4. tests
pnpm vitest --run tools/architecture-tokens functions/architecture-tokens functions/api/architecture-tokens src/components/Viewer/RelatedDiagramsFooter.spec.ts
```

Manual: weekly (Monday morning AEST) and on demand. The viewer shows 'as of <date>'.

Customer data — corpus files, extracted labels, model outputs, tenant
identifiers — is never committed to any repository, the `private/` submodule
included. It lives in the git-ignored folder `private/local-data/architecture-tokens/`
(`$ARCHTOK_DIR`), which `private/.gitignore` excludes.
