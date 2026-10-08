import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import yaml from "js-yaml";
import { getManifestEditYqArgs } from "./scripts/forge-wizard.mjs";
import { UNPLACED_PROPERTY_KEY } from "./src/utils/byline/unplacedProperty";

describe("manifest.yml embed deeplink autoConvert matcher", () => {
  it("default (lite/diagramly-inherited) matcher points at conf-lite.zenuml.com", () => {
    const manifest: any = yaml.load(readFileSync("./manifest.yml", "utf-8"));
    const embedMacro = manifest.modules.macro.find((m: any) => m.key.includes("zenuml-embed-macro"));
    expect(embedMacro.autoConvert.matchers[0].pattern).toBe("https://conf-lite.zenuml.com/d/*/*");
  });

  it("full variant's manifestEdits override the matcher to conf-full.zenuml.com", () => {
    const exprs = getManifestEditYqArgs("full").map((e) => e.expr);
    expect(exprs.some((e) => e.includes("conf-full.zenuml.com/d/*/*"))).toBe(true);
  });

  it("the staging deploy workflow also overrides Full's matcher", () => {
    const workflow: any = yaml.load(
      readFileSync("./.github/workflows/staging-deploy.yml", "utf-8"),
    );
    const steps = workflow.jobs.deploy.steps;
    const override = steps.find(
      (step: any) => step.name === "Point Full embed deeplink matcher at conf-full",
    );

    // The gate reads the `resolve` job's output, not `inputs`, since
    // staging-deploy.yml gained a workflow_dispatch entry point: dispatch
    // supplies only `variant`, so `resolve` normalises both trigger shapes
    // into one set of values. What matters is that the step stays gated on
    // the full variant — assert the variant, not the expression's source.
    expect(override?.if).toBe("needs.resolve.outputs.variant == 'full'");
    expect(override?.with?.cmd).toContain("conf-full.zenuml.com/d/*/*");
    expect(override?.with?.cmd).toContain("autoConvert.matchers[0].pattern");
  });

  // Regression: release.yml used to carry NO equivalent override — prod Full
  // shipped the base (conf-lite) matcher while the viewer minted conf-full
  // links, so minted links never autoconverted in production. Mirrors the
  // staging-deploy.yml test above, on release.yml.
  it("the PRODUCTION release workflow also overrides Full's matcher", () => {
    const workflow: any = yaml.load(
      readFileSync("./.github/workflows/release.yml", "utf-8"),
    );
    const steps = workflow.jobs.release.steps;
    const override = steps.find(
      (step: any) => step.name === "Point Full embed deeplink matcher at conf-full",
    );

    expect(override?.if).toBe("${{ steps.properties.outputs.license == 'full' }}");
    expect(override?.with?.cmd).toContain("conf-full.zenuml.com/d/*/*");
    expect(override?.with?.cmd).toContain("autoConvert.matchers[0].pattern");
  });

  it("lite ships no matcher-override edit (it inherits the default); diagramly ships the macro unmodified (no strip, no matcher override)", () => {
    const liteExprs = getManifestEditYqArgs("lite").map((e) => e.expr);
    const diagramlyExprs = getManifestEditYqArgs("diagramly").map((e) => e.expr);
    expect(liteExprs.some((e) => e.includes("conf-lite.zenuml.com") || e.includes("autoConvert"))).toBe(false);
    // Diagramly ships the embed macro (task 6, commit c539e1f7) — no edit in
    // this wizard's diagramly manifestEdits array should reference
    // zenuml-embed-macro at all (neither stripping it nor repointing its
    // matcher; it inherits the base conf-lite.zenuml.com matcher, same as
    // Lite).
    expect(diagramlyExprs.some((e) => e.includes("zenuml-embed-macro"))).toBe(false);
  });

  // Regression: release.yml and staging-deploy.yml each carry their OWN copy
  // of the diagramly manifest edits, independent of scripts/forge-wizard.mjs
  // (see the comment on diagramly's manifestEdits array there). Both used to
  // carry a "Remove embed macro for Diagramly" step that silently undid the
  // wizard's decision to ship it — verify neither CI workflow still does.
  it("neither CI workflow strips the embed macro for Diagramly", () => {
    const release: any = yaml.load(readFileSync("./.github/workflows/release.yml", "utf-8"));
    const staging: any = yaml.load(readFileSync("./.github/workflows/staging-deploy.yml", "utf-8"));

    const stepsMentioningEmbedMacroRemoval = (steps: any[]) =>
      steps.filter(
        (step: any) =>
          typeof step?.with?.cmd === "string" &&
          step.with.cmd.includes("zenuml-embed-macro") &&
          step.with.cmd.trim().startsWith("yq eval 'del("),
      );

    expect(stepsMentioningEmbedMacroRemoval(release.jobs.release.steps)).toEqual([]);
    expect(stepsMentioningEmbedMacroRemoval(staging.jobs.deploy.steps)).toEqual([]);
  });
});

// The unplaced-diagram banner is the one module whose visibility Confluence
// decides for us, from a content property key that is written in TypeScript and
// read in YAML. Two comments say "keep them in lockstep"; this is what enforces
// it — a rename on either side silently means the banner never shows again.
describe("unplaced-diagram banner — the property key both sides depend on", () => {
  const manifest: any = yaml.load(readFileSync("./manifest.yml", "utf-8"));
  const banner = () =>
    manifest.modules["confluence:pageBanner"].find((m: any) => m.key === "zenuml-unplaced-banner");

  it("gates the module on a content property that exists", () => {
    const condition = banner()?.displayConditions?.entityPropertyExists;
    expect(condition?.entity).toBe("content");
    // ${LITE_KEY_SUFFIX} is substituted by Forge at deploy time from the
    // per-variant environment (see .env.forge.*), so the manifest carries the
    // template and the build carries the value.
    expect(condition?.propertyKey).toBe("zenuml-unplaced-diagrams${LITE_KEY_SUFFIX}");
  });

  it("resolves to the same key the writer uses", () => {
    // PRODUCT_TYPE is not set in the unit build, so the writer resolves to the
    // unsuffixed form here. Compare the STEMS: that is what a rename on either
    // side breaks, and it holds whichever variant the bundle is built for.
    const template: string = banner().displayConditions.entityPropertyExists.propertyKey;
    expect(template.replace("${LITE_KEY_SUFFIX}", "")).toBe(
      UNPLACED_PROPERTY_KEY.replace(/-lite$/, ""),
    );
  });

  it("is stripped from every variant that cannot write the property", () => {
    // Only Lite ships zenuml-byline-diagrams, the sole writer. Elsewhere the
    // module could never fire, so it should not be deployed at all.
    for (const variant of ["full", "diagramly", "asyncapi"]) {
      const exprs = getManifestEditYqArgs(variant).map((e) => e.expr);
      expect(
        exprs.some((e) => e.includes('select(.key == "zenuml-unplaced-banner")')),
        `${variant} should strip zenuml-unplaced-banner`,
      ).toBe(true);
    }
  });

  it("keeps the module on Lite", () => {
    const exprs = getManifestEditYqArgs("lite").map((e) => e.expr);
    expect(exprs.some((e) => e.includes("zenuml-unplaced-banner"))).toBe(false);
  });

  for (const [file, gate] of [
    [".github/workflows/staging-deploy.yml", "needs.resolve.outputs.variant != 'lite'"],
    [".github/workflows/release.yml", "${{ steps.properties.outputs.license != 'lite' }}"],
  ] as const) {
    it(`${file} strips it for non-Lite variants too`, () => {
      const workflow: any = yaml.load(readFileSync(`./${file}`, "utf-8"));
      const step = Object.values<any>(workflow.jobs)
        .flatMap((job: any) => job.steps ?? [])
        .find((s: any) => s.name === "Remove the unplaced-diagram page banner (non-Lite variants)");
      expect(step?.if).toBe(gate);
      expect(step?.with?.cmd).toContain('select(.key == "zenuml-unplaced-banner")');
    });
  }
});
