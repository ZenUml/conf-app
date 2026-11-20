import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const catalogTs = readFileSync(resolve(__dirname, "catalog.ts"), "utf8");
const catalogMd = readFileSync(
  resolve(__dirname, "../../../docs/analytics/events-catalog.md"),
  "utf8",
);
const typesTs = readFileSync(resolve(__dirname, "types.ts"), "utf8");

const names = [
  "template_offer_shown",
  "template_offer_clicked",
  "template_created",
  "template_create_failed",
  "template_offer_dismissed",
];

describe("space-template offer event vocabulary", () => {
  it("declares and documents the complete funnel", () => {
    for (const name of names) {
      expect(catalogTs).toContain(`| "${name}"`);
      expect(catalogMd).toContain(`\`${name}\``);
    }
  });

  it("declares the created-template identifier", () => {
    expect(typesTs).toMatch(/template_id\?: string/);
  });
});
