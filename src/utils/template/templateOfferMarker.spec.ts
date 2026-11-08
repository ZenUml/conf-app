import { beforeEach, describe, expect, it } from "vitest";
import {
  isInTemplateOfferBand,
  isTemplateOfferSuppressed,
  markTemplateOfferDismissed,
  markTemplateCreated,
  readTemplateOfferMarker,
} from "./templateOfferMarker";

const identity = { clientDomain: "example-tenant", spaceKey: "ENG" };
const now = Date.parse("2026-09-01T00:00:00Z");

beforeEach(() => localStorage.clear());

describe("template-offer macro-count band", () => {
  it("accepts exactly 50 through 84", () => {
    expect(isInTemplateOfferBand(49)).toBe(false);
    expect(isInTemplateOfferBand(50)).toBe(true);
    expect(isInTemplateOfferBand(84)).toBe(true);
    expect(isInTemplateOfferBand(85)).toBe(false);
    expect(isInTemplateOfferBand(undefined)).toBe(false);
    expect(isInTemplateOfferBand(Number.NaN)).toBe(false);
  });
});

describe("template-offer suppression", () => {
  it("is not suppressed when the space has no marker", () => {
    expect(isTemplateOfferSuppressed(identity, now)).toBe(false);
  });

  it("is permanent after the template is created", () => {
    markTemplateCreated(identity, "99", now);

    expect(readTemplateOfferMarker(identity)).toEqual({
      createdAt: "2026-09-01T00:00:00.000Z",
      templateId: "99",
    });
    expect(isTemplateOfferSuppressed(identity, now + 400 * 86_400_000)).toBe(
      true,
    );
  });

  it("expires 30 days after dismissal", () => {
    markTemplateOfferDismissed(identity, now);

    expect(isTemplateOfferSuppressed(identity, now + 29 * 86_400_000)).toBe(
      true,
    );
    expect(isTemplateOfferSuppressed(identity, now + 30 * 86_400_000)).toBe(
      false,
    );
  });
});
