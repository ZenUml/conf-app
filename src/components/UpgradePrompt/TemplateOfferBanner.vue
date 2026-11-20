<template>
  <div
    class="template-offer"
    role="region"
    aria-label="ZenUML page template"
    data-testid="template-offer-banner"
  >
    <template v-if="state === 'created'">
      <strong>Template created.</strong>
      <span>
        Anyone creating a page in this space can now pick
        <em>Diagram page</em> under Templates.
      </span>
      <button
        class="template-offer__ghost"
        data-testid="template-offer-close"
        @click="closeBanner"
      >
        Close
      </button>
    </template>
    <template v-else>
      <strong>This space has {{ macroCount }} diagrams.</strong>
      <span>
        Add a <em>Diagram page</em> template so your team starts new pages
        with a diagram in place.
      </span>
      <button
        class="template-offer__primary"
        data-testid="template-offer-create"
        :disabled="state === 'creating'"
        @click="create"
      >
        {{ state === "creating" ? "Creating…" : "Create template" }}
      </button>
      <button
        class="template-offer__ghost"
        data-testid="template-offer-dismiss"
        :disabled="state === 'creating'"
        @click="dismiss"
      >
        Not now
      </button>
      <span
        v-if="state === 'failed'"
        class="template-offer__error"
        role="alert"
      >
        ZenUML could not create the template ({{ failureReason }}). You can
        still add one under Space settings → Templates.
      </span>
    </template>
  </div>
</template>

<script setup lang="ts">
import { onMounted, ref } from "vue";
import { view } from "@forge/bridge";
import forgeGlobal from "@/model/globals/forgeGlobal";
import { trackAnalyticsEvent } from "@/utils/analytics/trackAnalyticsEvent";
import { deriveWarningBannerIdentity } from "@/utils/paywall/warningBanner";
import { buildMacroTemplateAdf } from "@/utils/template/macroTemplateAdf";
import { liteAppIdentity } from "@/utils/template/variantApp";
import {
  createSpaceTemplate,
  TemplateCreateError,
} from "@/utils/template/createSpaceTemplate";
import {
  markTemplateCreated,
  markTemplateOfferDismissed,
} from "@/utils/template/templateOfferMarker";

const props = defineProps<{ macroCount: number }>();
const state = ref<"idle" | "creating" | "created" | "failed">("idle");
const failureReason = ref("");
const identity = deriveWarningBannerIdentity();

function analyticsContext() {
  return {
    feature_area: "upgrade" as const,
    surface: "page_banner" as const,
    ui_component: "template_offer",
    macro_count: props.macroCount,
    space_key: identity.spaceKey,
  };
}

onMounted(() => {
  trackAnalyticsEvent("template_offer_shown", analyticsContext());
});

async function closeBanner(): Promise<void> {
  await view.close();
}

async function create(): Promise<void> {
  if (state.value === "creating") return;
  state.value = "creating";
  trackAnalyticsEvent("template_offer_clicked", analyticsContext());

  try {
    const { appId, macroKey } = liteAppIdentity();
    const environmentId = forgeGlobal.forgeContext?.environmentId;
    const environmentType = forgeGlobal.forgeContext?.environmentType;
    if (!environmentId || !environmentType) {
      throw new TemplateCreateError(
        "unexpected",
        "Forge environment identity is unavailable",
      );
    }

    const adf = buildMacroTemplateAdf({
      appId,
      environmentId,
      environmentType,
      macroKey,
      heading: "Design note",
      intro: "Describe the change, then keep the diagram below current.",
    });
    const { templateId } = await createSpaceTemplate({
      spaceKey: identity.spaceKey,
      name: "Diagram page",
      adf,
    });

    markTemplateCreated(identity, templateId);
    trackAnalyticsEvent("template_created", {
      ...analyticsContext(),
      template_id: templateId,
    });
    state.value = "created";
  } catch (error) {
    failureReason.value =
      error instanceof TemplateCreateError ? error.reason : "unexpected";
    trackAnalyticsEvent("template_create_failed", {
      ...analyticsContext(),
      failure_reason: failureReason.value,
    });
    state.value = "failed";
  }
}

async function dismiss(): Promise<void> {
  if (state.value === "creating") return;
  markTemplateOfferDismissed(identity);
  trackAnalyticsEvent("template_offer_dismissed", analyticsContext());
  await closeBanner();
}
</script>

<style scoped>
.template-offer {
  display: flex;
  flex-wrap: wrap;
  gap: 8px 12px;
  align-items: center;
  min-height: 46px;
  width: 100%;
  box-sizing: border-box;
  padding: 8px 20px;
  border-bottom: 1px solid var(--ds-border, #dfe1e6);
  background: var(--ds-background-information, #e9f2ff);
  color: var(--ds-text, #172b4d);
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
  font-size: 13px;
}

.template-offer__primary {
  padding: 5px 10px;
  border: 0;
  border-radius: 3px;
  background: var(--ds-background-brand-bold, #0c66e4);
  color: var(--ds-text-inverse, #fff);
  cursor: pointer;
}

.template-offer__primary:disabled {
  cursor: default;
  opacity: 0.65;
}

.template-offer__ghost {
  padding: 5px 10px;
  border: 0;
  border-radius: 3px;
  background: transparent;
  color: var(--ds-text-subtle, #44546f);
  cursor: pointer;
}

.template-offer__ghost:disabled {
  cursor: default;
  opacity: 0.65;
}

.template-offer__error {
  flex-basis: 100%;
  color: var(--ds-text-danger, #ae2a19);
}
</style>
