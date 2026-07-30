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

  it("lite ships no matcher-override edit (it inherits the default); diagramly strips the macro entirely", () => {
    const liteExprs = getManifestEditYqArgs("lite").map((e) => e.expr);
    const diagramlyExprs = getManifestEditYqArgs("diagramly").map((e) => e.expr);
    expect(liteExprs.some((e) => e.includes("conf-lite.zenuml.com") || e.includes("autoConvert"))).toBe(false);
    expect(diagramlyExprs.some((e) => e.includes("zenuml-embed-macro"))).toBe(true);
  });
});
