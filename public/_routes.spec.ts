import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const routesPath = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "_routes.json");
const routes = JSON.parse(readFileSync(routesPath, "utf-8"));

describe("public/_routes.json (Pages route allowlist)", () => {
  it("includes the new deeplink serving + mint paths", () => {
    expect(routes.include).toEqual(expect.arrayContaining(["/d/*", "/i/*", "/deeplink-ticket", "/architecture-tokens/*"]));
  });
});
