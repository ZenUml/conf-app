import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { type Licence, localDate, mime, renderWelcome, select } from "./logic";

const template = readFileSync("workers/first-touch/welcome-zenuml.html", "utf8") // vitest runs from the repo root;

const lic = (o: Partial<Licence> & { host: string; start: string }): Licence => ({
  cloudId: o.cloudId ?? o.host,
  cloudSiteHostname: o.host,
  licenseType: o.licenseType ?? "FREE",
  status: o.status ?? "active",
  maintenanceStartDate: o.start,
  contactDetails: o.contactDetails ?? { technicalContact: { email: `admin@${o.host}`, name: "Alex Doe" } },
  partnerDetails: o.partnerDetails,
});

describe("select", () => {
  it("keeps only licences that started inside the window, both ends inclusive", () => {
    const rows = { lite: ["2026-11-19", "2026-11-20", "2026-11-23", "2026-11-24"].map((s, i) => lic({ host: `s${i}.atlassian.net`, start: s })) };
    expect(select(rows, "2026-11-20", "2026-11-23").map((c) => c.start)).toEqual(["2026-11-20", "2026-11-23"]);
  });

  it("excludes a site that already had another conf-app licence, but not the earlier licence itself", () => {
    const rows = {
      full: [lic({ host: "a.atlassian.net", cloudId: "c1", start: "2026-11-21" })],
      lite: [lic({ host: "a.atlassian.net", cloudId: "c1", start: "2026-11-22" })],
    };
    const [full, lite] = select(rows, "2026-11-20", "2026-11-23");
    expect(full.exclude).toEqual([]);
    expect(lite.exclude).toEqual(["existing customer: full"]);
  });

  it("emails a technical contact at the reseller, and only labels it", () => {
    const rows = { lite: [lic({
      host: "b.atlassian.net", start: "2026-11-22",
      contactDetails: { technicalContact: { email: "x@partner.example", name: "X" } },
      partnerDetails: { partnerName: "Partner", billingContact: { email: "y@partner.example" } },
    })] };
    const [c] = select(rows, "2026-11-20", "2026-11-23");
    expect(c.exclude).toEqual([]);
    expect(c.reseller_contact).toBe(true);
  });

  it("excludes internal, test and inactive sites", () => {
    const rows = { lite: [
      lic({ host: "zenuml-demo.atlassian.net", start: "2026-11-22" }),
      lic({ host: "acme-staging.atlassian.net", start: "2026-11-22" }),
      lic({ host: "acme.atlassian.net", start: "2026-11-22", status: "inactive" }),
    ] };
    expect(select(rows, "2026-11-20", "2026-11-23").map((c) => c.exclude[0])).toEqual(["dev/test host", "licence not active", "internal host"]);
  });
});

describe("renderWelcome", () => {
  it("names the Full macro without the Lite suffix and links the Full app page", () => {
    const e = renderWelcome(template, "full", "example.atlassian.net", "Alex Doe");
    expect(e.html).toContain("<b>Diagram (Mermaid, PlantUML &amp; ZenUML)</b>");
    expect(e.html).not.toMatch(/Lite|\{\{|<!--/);
    expect(e.html).toContain("https://example.atlassian.net/wiki/apps/d9e4002b-120b-426b-834b-402a4a5adce7/");
    expect(e.text).toContain("pick Diagram (Mermaid, PlantUML & ZenUML).");
    expect(e.subject).toBe("ZenUML is ready on example");
  });

  it("greets by first name, or 'there' when the name is not a plain word", () => {
    expect(renderWelcome(template, "lite", "example.atlassian.net", "Alex Doe").text).toMatch(/^Hi Alex,/);
    expect(renderWelcome(template, "lite", "example.atlassian.net", "[PARTNER]").text).toMatch(/^Hi there,/);
  });
});

it("mime round-trips a non-ASCII subject and both parts", () => {
  const raw = mime("Peng <support@zenuml.com>", "a@example.com", { subject: "Café", text: "plain ü", html: "<b>html ü</b>" });
  const msg = atob(raw.replace(/-/g, "+").replace(/_/g, "/"));
  const dec = (b: string) => new TextDecoder().decode(Uint8Array.from(atob(b.replace(/\s/g, "")), (ch) => ch.charCodeAt(0)));
  expect(dec(msg.match(/=\?UTF-8\?B\?(.+?)\?=/)![1])).toBe("Café");
  const bodies = [...msg.matchAll(/base64\r\n\r\n([A-Za-z0-9+/=\r\n]+)/g)].map((m) => dec(m[1]));
  expect(bodies).toEqual(["plain ü", "<b>html ü</b>"]);
});

it("localDate uses the Melbourne calendar day", () => {
  // 2026-11-25 14:00 UTC is already 26 Nov in Melbourne (UTC+11).
  expect(localDate(new Date("2026-11-25T14:00:00Z"), "Australia/Melbourne")).toBe("2026-11-26");
  expect(localDate(new Date("2026-11-25T14:00:00Z"), "Australia/Melbourne", 3)).toBe("2026-11-23");
});
