import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import yaml from "js-yaml";
import { getManifestEditYqArgs } from "./scripts/forge-wizard.mjs";

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

    expect(override?.if).toBe("inputs.variant == 'full'");
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
