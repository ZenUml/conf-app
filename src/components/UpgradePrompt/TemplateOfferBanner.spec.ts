import { flushPromises, mount } from "@vue/test-utils";
import { beforeEach, describe, expect, it, vi } from "vitest";

const track = vi.hoisted(() => vi.fn());
const createTemplate = vi.hoisted(() => vi.fn());
const close = vi.hoisted(() => vi.fn());

vi.mock("@/utils/analytics/trackAnalyticsEvent", () => ({
  trackAnalyticsEvent: track,
}));
vi.mock("@/utils/template/createSpaceTemplate", () => ({
  createSpaceTemplate: createTemplate,
  TemplateCreateError: class TemplateCreateError extends Error {
    constructor(
      public readonly reason: string,
      message: string,
    ) {
      super(message);
    }
  },
}));
vi.mock("@/utils/template/variantApp", () => ({
  liteAppIdentity: () => ({
    appId: "app-1",
    macroKey: "zenuml-sequence-macro-lite",
  }),
}));
vi.mock("@/utils/paywall/warningBanner", () => ({
  deriveWarningBannerIdentity: () => ({
    clientDomain: "example-tenant",
    spaceKey: "ENG",
  }),
}));
vi.mock("@/model/globals/forgeGlobal", () => ({
  default: {
    forgeContext: {
      environmentId: "env-1",
      environmentType: "STAGING",
    },
  },
}));
vi.mock("@forge/bridge", () => ({ view: { close } }));

import TemplateOfferBanner from "./TemplateOfferBanner.vue";
import { readTemplateOfferMarker } from "@/utils/template/templateOfferMarker";
import { TemplateCreateError } from "@/utils/template/createSpaceTemplate";

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
});

describe("TemplateOfferBanner", () => {
  it("reports a shown impression with the targeted macro count", () => {
    mount(TemplateOfferBanner, { props: { macroCount: 60 } });

    expect(track).toHaveBeenCalledWith(
      "template_offer_shown",
      expect.objectContaining({
        feature_area: "upgrade",
        surface: "page_banner",
        ui_component: "template_offer",
        macro_count: 60,
      }),
    );
  });

  it("creates and records the proven one-macro page template", async () => {
    createTemplate.mockResolvedValue({ templateId: "99" });
    const wrapper = mount(TemplateOfferBanner, {
      props: { macroCount: 60 },
    });

    await wrapper.get('[data-testid="template-offer-create"]').trigger("click");
    await flushPromises();

    expect(createTemplate).toHaveBeenCalledWith(
      expect.objectContaining({ spaceKey: "ENG", name: "Diagram page" }),
    );
    const adf = createTemplate.mock.calls[0][0].adf;
    expect(adf.content[2].attrs.parameters).toMatchObject({
      forgeEnvironment: "STAGING",
      guestParams: {},
    });
    expect(adf.content[2].attrs).not.toHaveProperty("localId");
    expect(track).toHaveBeenCalledWith(
      "template_offer_clicked",
      expect.objectContaining({ macro_count: 60 }),
    );
    expect(track).toHaveBeenCalledWith(
      "template_created",
      expect.objectContaining({ template_id: "99" }),
    );
    expect(
      readTemplateOfferMarker({
        clientDomain: "example-tenant",
        spaceKey: "ENG",
      }),
    ).toMatchObject({ templateId: "99" });
    expect(wrapper.text()).toContain("Template created");
  });

  it("reports a typed failure and keeps the offer open", async () => {
    createTemplate.mockRejectedValue(
      new TemplateCreateError("forbidden" as any, "no permission"),
    );
    const wrapper = mount(TemplateOfferBanner, {
      props: { macroCount: 60 },
    });

    await wrapper.get('[data-testid="template-offer-create"]').trigger("click");
    await flushPromises();

    expect(track).toHaveBeenCalledWith(
      "template_create_failed",
      expect.objectContaining({ failure_reason: "forbidden" }),
    );
    expect(wrapper.text()).toContain("could not create");
    expect(
      wrapper.get('[data-testid="template-offer-create"]').attributes("disabled"),
    ).toBeUndefined();
  });

  it("records a 30-day snooze and closes when dismissed", async () => {
    const wrapper = mount(TemplateOfferBanner, {
      props: { macroCount: 60 },
    });

    await wrapper.get('[data-testid="template-offer-dismiss"]').trigger("click");
    await flushPromises();

    expect(track).toHaveBeenCalledWith(
      "template_offer_dismissed",
      expect.objectContaining({ macro_count: 60 }),
    );
    expect(
      readTemplateOfferMarker({
        clientDomain: "example-tenant",
        spaceKey: "ENG",
      })?.dismissedAt,
    ).toBeTruthy();
    expect(close).toHaveBeenCalledOnce();
  });
});
