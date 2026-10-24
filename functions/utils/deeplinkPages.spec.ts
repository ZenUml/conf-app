// functions/utils/deeplinkPages.spec.ts
import { describe, it, expect } from "vitest";
import { previewPage, expiredPage, INSTRUCTION_PAGE, confluenceUrl } from "./deeplinkPages";
import type { Ticket } from "./deeplink";

const ticket: Ticket = { v: 1, d: "example", p: "123456", c: "425987", m: 1, t: "Order flow" };

describe("deeplinkPages", () => {
  it("previewPage is product-neutral", () => {
    const html = previewPage("https://conf-lite.zenuml.com", "tok.sig", ticket);
    expect(html).not.toContain("See what the Full plan unlocks");
    expect(html).toContain("<h1>Order flow</h1>");
    expect(html).toContain('og:image" content="https://conf-lite.zenuml.com/i/tok.sig"');
  });

  it("ignores a legacy Lite marker instead of rendering an untracked upsell", () => {
    const legacyLiteTicket = { ...ticket, u: 1 } as Ticket;
    const html = previewPage("https://conf-lite.zenuml.com", "tok.sig", legacyLiteTicket);
    expect(html).not.toContain("See what the Full plan unlocks");
    expect(html).not.toContain('href="https://zenuml.com/pricing"');
  });

  it("escapes a hostile title", () => {
    const hostile: Ticket = { ...ticket, t: "<img src=x onerror=alert(1)>" };
    const html = previewPage("https://conf-lite.zenuml.com", "tok.sig", hostile);
    expect(html).not.toContain("<img src=x");
    expect(html).toContain("&lt;img src=x onerror=alert(1)&gt;");
  });

  it("expiredPage keeps the permanent Open-in-Confluence button, derived from the ticket only", () => {
    const html = expiredPage(ticket);
    expect(html).toContain("This preview has expired");
    expect(html).toContain('href="https://example.atlassian.net/wiki/pages/viewpage.action?pageId=123456"');
  });

  it("confluenceUrl derives host from the ticket subdomain, never a bare cloudId", () => {
    expect(confluenceUrl(ticket)).toBe("https://example.atlassian.net/wiki/pages/viewpage.action?pageId=123456");
  });

  it("INSTRUCTION_PAGE is a static precomputed string with no ticket data", () => {
    expect(INSTRUCTION_PAGE).toContain("This link becomes a diagram in Confluence");
  });
});
