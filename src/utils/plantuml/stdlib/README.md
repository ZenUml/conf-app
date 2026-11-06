# Self-hosted PlantUML standard library (ADR-0010)

The in-browser engine (`@plantuml/core`) resolves `!include <LIB/...>` by asking
for one bundle per library. `../stdlib.ts` answers that request from the JSON
files here, so the diagram never leaves the macro iframe and the engine never
loads code from another origin.

| Library | File | Upstream | Version | License |
|---|---|---|---|---|
| C4 | `c4.json` | [C4-PlantUML](https://github.com/plantuml-stdlib/C4-PlantUML) | 2.14.0 | MIT, see `C4-PlantUML.LICENSE` |

C4 is hosted first because production data (ADR-0010, "Production exposure")
shows it causes about 90% of the includes the engine could not resolve.

## Regenerating or adding a library

The JSON is converted from the official bundle that matches the pinned
`@plantuml/core` version (`https://plantuml.github.io/plantuml/js-plantuml/<lib>.min.js`).
The converter parses the bundle and accepts only literal data, so nothing in it
is executed:

```bash
curl -sSo /tmp/c4.min.js https://plantuml.github.io/plantuml/js-plantuml/c4.min.js
node scripts/plantuml-stdlib/bundle-to-json.mjs /tmp/c4.min.js src/utils/plantuml/stdlib/c4.json
```

To add a library: convert it the same way, add its license file and a row above,
and register it in `HOSTED_LIBRARIES` in `../stdlib.ts`.
