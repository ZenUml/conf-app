# PR #1026 evidence: third-party notices for the in-browser PlantUML engine

- BEFORE: `c8c363b` (merge-base, `main`)
- AFTER: `238c4bc` (PR head)
- Change type: a static text file plus a unit test. No runtime or UI change, so no screenshots: there is nothing on screen to compare.

## Probe 1: is the notice in the source tree that Vite copies into `dist/`?

```
$ git ls-tree c8c363b public/ | grep third-party
(no output: file absent)

$ git ls-tree -l 238c4bc public/third-party-notices.txt
100644 blob 8d7c4fe1c650a1a208029327cc47c91f5941334f    9033	public/third-party-notices.txt
```

## Probe 2: does a real build ship it?

AFTER, `238c4bc`, run in the agent container:

```
$ PRODUCT_TYPE=diagramly npx vite build --outDir <tmp>/dist-check --emptyOutDir
✓ built in 1m 36s
$ ls -la <tmp>/dist-check/third-party-notices.txt
-rw-r--r-- 1 root root 9033 ... third-party-notices.txt
```

BEFORE was not built. `public/` holds no such file at `c8c363b` (probe 1), and `vite.config.mjs` sets no `publicDir` or `copyPublicDir`, so the default copy of `public/` would have nothing to ship.

## Probe 3: the new guard test against both trees

The same `src/utils/plantuml/thirdPartyNotices.spec.ts` was copied into a worktree at BEFORE:

```
BEFORE c8c363b:
Error: ENOENT: no such file or directory, open '.../public/third-party-notices.txt'
 Test Files  1 failed (1)

AFTER 238c4bc:
$ npx vitest --run src/utils/plantuml/
 Test Files  8 passed (8)
      Tests  87 passed (87)
```

## Limits

- I didn't check that every bundled part is listed beyond those PlantUML's own licence credits and the C4 library. The AWS and tupadr3 stdlib sprites that PlantUML credits are not served by our loader (`stdlib.ts` serves C4 only), so they are not listed.
- This is a reading of the licence texts, not legal advice.
