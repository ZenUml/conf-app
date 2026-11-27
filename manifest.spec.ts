import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import yaml from "js-yaml";
import { getManifestEditYqArgs } from "./scripts/forge-wizard.mjs";
import { manifestEditsScript } from "./scripts/ci/manifest-edits.mjs";
import { UNPLACED_PROPERTY_KEY } from "./src/utils/byline/unplacedProperty";

// Staging and production no longer carry their own copies of the variant
// edits: each workflow writes scripts/forge-wizard.mjs's list for its variant
// with scripts/ci/manifest-edits.mjs and runs that script. So "the workflow
// applies edit X for variant V" means: the workflow runs the generator with
// its variant expression, and the generated script for V contains X.
const workflowSteps = (file: string) => {
  const workflow: any = yaml.load(readFileSync(`./.github/workflows/${file}`, "utf-8"));
  return Object.values<any>(workflow.jobs).flatMap((job: any) => job.steps ?? []);
};
const CI_WORKFLOWS = [
  ["staging-deploy.yml", "${{ needs.resolve.outputs.variant }}"],
  ["release.yml", "${{ steps.properties.outputs.license }}"],
] as const;
const runsWizardEdits = (file: string, variantExpr: string) =>
  workflowSteps(file).some(
    (s: any) => typeof s.run === "string" && s.run.includes(`node scripts/ci/manifest-edits.mjs "${variantExpr}" manifest-edits.sh`),
  );

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

  // Regression: release.yml once carried NO Full override, so production Full
  // shipped the conf-lite matcher while the viewer minted conf-full links.
  for (const [file, variantExpr] of CI_WORKFLOWS) {
    it(`${file} applies Full's matcher override from the wizard list`, () => {
      expect(runsWizardEdits(file, variantExpr)).toBe(true);
      const script = manifestEditsScript("full");
      expect(script).toContain("conf-full.zenuml.com/d/*/*");
      expect(script).toContain("autoConvert.matchers[0].pattern");
    });
  }

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

  // Regression: both CI workflows once carried a "Remove embed macro for
  // Diagramly" step that silently undid the wizard's decision to ship it.
  it("neither CI workflow strips the embed macro for Diagramly", () => {
    for (const [file, variantExpr] of CI_WORKFLOWS) {
      expect(runsWizardEdits(file, variantExpr), file).toBe(true);
      const stripsEmbed = workflowSteps(file).filter(
        (step: any) =>
          typeof step?.with?.cmd === "string" &&
          step.with.cmd.includes("zenuml-embed-macro") &&
          step.with.cmd.trim().startsWith("yq eval 'del("),
      );
      expect(stripsEmbed, file).toEqual([]);
    }
    expect(manifestEditsScript("diagramly")).not.toContain("zenuml-embed-macro");
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

  it("is stripped only from Diagramly, the one variant that cannot write the property", () => {
    // zenuml-byline-diagrams is the sole writer. Lite, Full and AsyncAPI ship
    // it; Diagramly strips it, so there the module could never fire.
    for (const variant of ["full", "asyncapi"]) {
      const exprs = getManifestEditYqArgs(variant).map((e) => e.expr);
      expect(
        exprs.some((e) => e.includes('del(.modules["confluence:pageBanner"][] | select(.key == "zenuml-unplaced-banner"))')),
        `${variant} should keep zenuml-unplaced-banner`,
      ).toBe(false);
    }
    const diagramly = getManifestEditYqArgs("diagramly").map((e) => e.expr);
    expect(diagramly.some((e) => e.includes('select(.key == "zenuml-unplaced-banner")'))).toBe(true);
  });

  it("keeps the module on Lite", () => {
    const exprs = getManifestEditYqArgs("lite").map((e) => e.expr);
    expect(exprs.some((e) => e.includes("zenuml-unplaced-banner"))).toBe(false);
  });

  for (const [file, variantExpr] of CI_WORKFLOWS) {
    it(`${file} strips it for Diagramly and re-keys it for AsyncAPI, like the wizard`, () => {
      expect(runsWizardEdits(file, variantExpr)).toBe(true);
      expect(manifestEditsScript("diagramly")).toContain('select(.key == "zenuml-unplaced-banner")');
      const asyncapi = manifestEditsScript("asyncapi");
      expect(asyncapi).toContain('select(.key == "zenuml-unplaced-banner")');
      expect(asyncapi).toContain('"zenuml-unplaced-diagrams-asyncapi"');
    });
  }
});

describe("workflows that install Playwright browsers", () => {
  // Playwright 1.59 refuses `install` on ubuntu-latest once that image is 26.04:
  // "Playwright does not support chromium on ubuntu26.04-x64". Jobs with a browser
  // cache hide this until the cache misses; a job without one fails every run.
  const dir = "./.github/workflows";
  const installers = readdirSync(dir).flatMap((file) => {
    const workflow: any = yaml.load(readFileSync(`${dir}/${file}`, "utf-8"));
    return Object.entries<any>(workflow.jobs ?? {})
      .filter(([, job]) => (job.steps ?? []).some((step: any) => /playwright install/.test(step.run ?? "")))
      .map(([id, job]) => {
        // A reusable workflow may take the runner as an input. Its hosted default is
        // what installs browsers; the gcp-conf pool skips the install and runs the
        // shards in the Playwright noble (24.04) container instead.
        const fromInput = /^\$\{\{\s*inputs\.([\w-]+)\s*\}\}$/.exec(String(job["runs-on"]));
        const runner = fromInput
          ? workflow.on?.workflow_call?.inputs?.[fromInput[1]]?.default
          : job["runs-on"];
        return { job: `${file}#${id}`, runner };
      });
  });

  it("finds the jobs that install browsers", () => {
    expect(installers.length).toBeGreaterThan(0);
  });

  it.each(installers)("$job pins a runner Playwright supports", ({ runner }) => {
    expect(runner).toBe("ubuntu-24.04");
  });
});
