# Analysis: Multi-App Configuration from Single Codebase

This document analyzes how the three Forge apps (Full, Lite, Diagramly) are configured and built from a single codebase, identifying where app-specific logic is scattered and the problems this causes.

## Overview

The project produces three distinct Atlassian Forge apps from one codebase:

| App | APP_ID | CONNECT_KEY | Target Users |
|-----|--------|-------------|--------------|
| ZenUML Full | `d9e4002b-120b-426b-834b-402a4a5adce7` | `com.zenuml.confluence-addon` | Paid customers |
| ZenUML Lite | `8ad26115-211f-4216-971b-0540f606303d` | `com.zenuml.confluence-addon-lite` | Free tier |
| Diagramly | `01ede8b1-4e88-451a-b9ef-89eeef93afaf` | `gptdock-confluence` | Separate product |

---

## Where App-Specific Logic is Defined

### 1. package.json (Lines 12-52)

Contains 22+ scripts with environment variable combinations for building and deploying different app variants.

**Build scripts** use `PRODUCT_TYPE`:
```json
"build:full": "PRODUCT_TYPE=full vite build --mode production",
"build:lite": "PRODUCT_TYPE=lite vite build",
"build:diagramly": "PRODUCT_TYPE=diagramly vite build"
```

**Forge deploy scripts** require multiple environment variables:
- `APP_ID`
- `CONNECT_KEY`
- `SEQUENCE_MACRO_KEY`
- `CUSTOM_CONTENT_KEY`
- `LITE_KEY_SUFFIX`
- `LITE_TITLE_SUFFIX`
- `BASE_URL`
- `DIAGRAMLY_BASE_URL` (for Diagramly only)

Example from `package.json:41`:
```json
"forge:deploy:diagramly:peng": "APP_ID=01ede8b1-4e88-451a-b9ef-89eeef93afaf CONNECT_KEY=gptdock-confluence SEQUENCE_MACRO_KEY=gpt-diagram-macro CUSTOM_CONTENT_KEY=gpt-custom-content-key LITE_KEY_SUFFIX= LITE_TITLE_SUFFIX= BASE_URL=https://8080.diagramly.net forge deploy -e peng-dev --non-interactive"
```

**Observation**: Diagramly scripts repeat all 7 environment variables. Scripts like `forge:deploy:diagramly:peng` vs `forge:deploy:diagramly:yanhui` differ only in `BASE_URL` and environment name.

---

### 2. manifest.yml

Uses Forge environment variables with defaults configured for **Lite app**:

```yaml
environment:
  variables:
    - key: APP_ID
      default: 8ad26115-211f-4216-971b-0540f606303d  # Lite
    - key: CONNECT_KEY
      default: com.zenuml.confluence-addon-lite
    - key: SEQUENCE_MACRO_KEY
      default: zenuml-sequence-macro-lite
    - key: CUSTOM_CONTENT_KEY
      default: zenuml-content-sequence
    - key: LITE_KEY_SUFFIX
      default: -lite
    - key: LITE_TITLE_SUFFIX
      default: " Lite"
```

**Module definitions use variables**:
```yaml
modules:
  macro:
    - key: ${SEQUENCE_MACRO_KEY}
      title: Diagram (ZenUML & Mermaid)${LITE_TITLE_SUFFIX}
  confluence:customContent:
    - key: ${CUSTOM_CONTENT_KEY}
```

**App-specific modules** (must be removed at deploy time):
- `confluence:contentBylineItem` - Only for Diagramly (AI Aide feature)
- `confluence:globalSettings` - Not for Diagramly
- `confluence:globalPage` - Not for Diagramly
- `zenuml-embed-macro` - Not for Diagramly

---

### 3. GitHub Actions Workflows

#### build-test-deploy.yml
- Separate jobs for `staging-lite` and `staging-full`
- Uses `license` parameter (`lite` or `full`) passed to wrangler-publish action
- Uses `yq` to modify manifest at deploy time:
  ```yaml
  - name: Update manifest.yml
    cmd: yq eval 'del(.modules["confluence:contentBylineItem"])' -i manifest.yml
  ```

#### diagramly-build-deploy.yml
- Separate workflow entirely for Diagramly
- Uses `license: diagramly` parameter
- Multiple `yq` commands to remove modules:
  ```yaml
  cmd: yq eval 'del(.modules["confluence:globalSettings"]) | del(.modules["confluence:globalPage"])' -i manifest.yml
  cmd: yq eval 'del(.modules.macro[] | select(.key | test("zenuml-embed-macro")))' -i manifest.yml
  ```

#### release.yml
- Extracts license from git tag name (e.g., `v2024.01.01-lite`, `v2024.01.01-diagramly`)
- Maps `diagramly` to `lite` for Cloudflare project (they share `conf-lite` infrastructure)
- Conditional steps based on license type

---

### 4. Wrangler Configuration Files

#### wrangler-stg.toml
```toml
ALLOWED_FORGE_APP_IDS = "8ad26115-...,01ede8b1-..."  # Lite + Diagramly
```

#### wrangler-prod.toml
```toml
ALLOWED_FORGE_APP_IDS = "d9e4002b-...,01ede8b1-..."  # Full + Diagramly
```

**Observation**: APP_IDs are duplicated here for backend JWT validation, separate from manifest.yml and package.json.

---

### 5. vite.config.mjs

Injects `PRODUCT_TYPE` at build time:
```javascript
define: {
  'import.meta.env.PRODUCT_TYPE': JSON.stringify(process.env.PRODUCT_TYPE || 'full'),
}
```

---

### 6. Source Code (17+ files)

#### Core app type detection (`src/model/globals/forgeGlobal.ts`)
```typescript
global.isDiagramly = import.meta.env.PRODUCT_TYPE === 'diagramly';
global.isLite = import.meta.env.PRODUCT_TYPE === 'lite';
const urlVariant = (global.isLite || global.isDiagramly) ? 'LITE' : 'FULL';
```

#### ApWrapper2.ts
- Line 48: Sets `versionType` based on `isLite()`
- Line 151: Constructs addon key dynamically
- Line 961-963: `isLite()` checks `forgeGlobal.isLite` OR URL `addonKey` param

#### Files with `isLite`/`isDiagramly` checks:
| File | Usage |
|------|-------|
| `src/components/Workspace.vue` | Shows AI title feature only for Lite |
| `src/components/Viewer/GenericViewer.vue` | Shows upgrade button, macro count for Lite |
| `src/components/DocumentList/*.vue` | Upgrade prompts, export behavior |
| `src/utils/window.ts` | Analytics tracking includes `isLite` flag |
| `src/composables/useCustomerSuccessService.ts` | Feature flags |
| `src/services/MacroMetrics.ts` | Usage tracking |
| `src/utils/upgrade.ts` | Upgrade flow logic |

---

### 7. forge-console Sub-package

Already has centralized configuration in `.forge-console/config.json`:

```json
{
  "apps": {
    "zenuml-lite": {
      "appId": "8ad26115-...",
      "variables": { ... },
      "environments": { ... }
    },
    "diagramly": {
      "appId": "01ede8b1-...",
      "variables": { ... },
      "environments": { ... }
    }
  }
}
```

**Current coverage**:
- Used by forge-console for tunnel management
- Shows env vars in UI sidebar
- Logs full command before execution

**Not used by**:
- package.json scripts (still hardcoded)
- GitHub Actions workflows
- `zenuml-full` app is not defined in config

---

## Problems Identified

### 1. No Single Source of Truth

App configuration exists in 5+ locations:
- `.forge-console/config.json` (partial)
- `manifest.yml` (defaults)
- `package.json` (hardcoded in scripts)
- `wrangler-*.toml` (APP_IDs for validation)
- GitHub Actions workflows (logic duplicated)

### 2. Manual Override Required

Deploying Diagramly requires specifying 7 environment variables every time. Missing any variable uses Lite defaults from manifest.yml.

### 3. Easy to Mix Up Configurations

**Past incident**: Deployed "diagramly staging" but used Lite's `CUSTOM_CONTENT_KEY` because one variable was missing from the command.

### 4. Forge Tunnel Inherits Wrong Defaults

When running `forge tunnel`, it uses manifest.yml defaults (Lite) unless ALL variables are overridden in the command.

### 5. Runtime Manifest Manipulation

GitHub Actions use `yq` to delete modules at deploy time:
- Fragile: relies on YAML structure not changing
- Logic duplicated across workflows
- Easy to forget when adding new modules

### 6. Different APP_IDs Per Environment

| App | Staging | Production |
|-----|---------|------------|
| Lite | `8ad26115-...` | `8ad26115-...` |
| Full | - | `d9e4002b-...` |
| Diagramly | `01ede8b1-...` | `01ede8b1-...` |

Full app only exists in production. Staging tests use Lite infrastructure.

### 7. Inconsistent Naming

- Build: `PRODUCT_TYPE=full|lite|diagramly`
- Manifest: Uses variable substitution
- Code: `isLite()`, `isDiagramly`
- Scripts: Mix of app names and environment names

---

## Summary Matrix

| Location | Lite | Full | Diagramly | Source of Truth? |
|----------|------|------|-----------|------------------|
| `.forge-console/config.json` | Yes | **No** | Yes | Partial |
| `manifest.yml` defaults | Yes (default) | No | No | For Lite only |
| `package.json` scripts | Yes | Yes | Yes | Hardcoded, scattered |
| `wrangler-stg.toml` | Yes | No | Yes | APP_IDs only |
| `wrangler-prod.toml` | No | Yes | Yes | APP_IDs only |
| GitHub Actions | Yes | Yes | Yes | Logic duplicated |
| Source code | Runtime check | Runtime check | Runtime check | Build-time injection |

---

## Related Files

- `package.json` - Lines 12-52 (scripts)
- `manifest.yml` - Full file
- `.github/workflows/build-test-deploy.yml`
- `.github/workflows/diagramly-build-deploy.yml`
- `.github/workflows/release.yml`
- `.github/actions/wrangler-publish/action.yml`
- `wrangler-stg.toml`
- `wrangler-prod.toml`
- `vite.config.mjs`
- `.forge-console/config.json`
- `src/model/globals/forgeGlobal.ts`
- `src/model/ApWrapper2.ts`
- `forge-console/src/server/services/env-vars.ts`