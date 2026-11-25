// Pure parts of the first-touch worker: who gets an email and what it says. No I/O here.
// Selection mirrors .claude/skills/customer-followup/scripts/first_touch_candidates.py.

export const APPS = {
  lite: "com.zenuml.confluence-addon-lite",
  full: "com.zenuml.confluence-addon",
  diagramly: "gptdock-confluence",
  asyncapi: "my-api",
} as const;
export type App = keyof typeof APPS;

// Draft-only products (owner, 2026-11-25: "Diagramly 和 AsyncAPI 先不发").
export const DRAFT_PRODUCT_NAMES: Record<"diagramly" | "asyncapi", string> = {
  diagramly: "Diagramly for Confluence",
  asyncapi: "AsyncAPI for Confluence",
};

// Sent products. manifest.yml macro title + LITE_TITLE_SUFFIX, globalPage title,
// production appId/environmentId of the globalPage route.
export const WELCOME_FIELDS: Record<"lite" | "full", { product_name: string; macro_title: string; apps_menu: string; page_path: string }> = {
  lite: {
    product_name: "ZenUML for Confluence Lite",
    macro_title: "Diagram (Mermaid, PlantUML &amp; ZenUML) Lite",
    apps_menu: "ZenUML Lite",
    page_path: "8ad26115-211f-4216-971b-0540f606303d/b28ee919-d73b-4f43-b7fd-45a3a881ec46",
  },
  full: {
    product_name: "ZenUML for Confluence",
    macro_title: "Diagram (Mermaid, PlantUML &amp; ZenUML)",
    apps_menu: "ZenUML",
    page_path: "d9e4002b-120b-426b-834b-402a4a5adce7/bd98a544-377a-4832-a72f-eb8d80b19dde",
  },
};

export interface Contact { email?: string; name?: string }
export interface Licence {
  cloudId?: string;
  cloudSiteHostname?: string;
  licenseType?: string;
  status?: string;
  maintenanceStartDate?: string;
  latestEvaluationStartDate?: string;
  contactDetails?: { technicalContact?: Contact; billingContact?: Contact };
  partnerDetails?: { partnerName?: string; billingContact?: Contact };
}

export interface Candidate {
  app: App;
  site: string;
  license_type?: string;
  start: string;
  tech_name?: string;
  tech_email?: string;
  partner?: string;
  reseller_contact: boolean;
  exclude: string[];
}

const DEV_HOST = /(^|[-.])(test|testing|sandbox|stg|staging|bugbounty|bug-bounty|qa)([-.\d]|$)|bugcrowd|hackerone/i;
const INTERNAL_HOST = /zenuml|whimet|diagramly|z4c/i;

export function startDate(r: Licence): string | undefined {
  if (r.licenseType === "EVALUATION" && r.latestEvaluationStartDate) return r.latestEvaluationStartDate;
  return r.maintenanceStartDate;
}

const domain = (email?: string) => (email ?? "").split("@").pop()!.toLowerCase();

export function classify(r: Licence, app: App, otherApps: Set<string>): Candidate {
  const host = r.cloudSiteHostname ?? "";
  const tech = r.contactDetails?.technicalContact ?? {};
  const partnerDom = domain(r.partnerDetails?.billingContact?.email);
  const exclude: string[] = [];
  if (INTERNAL_HOST.test(host)) exclude.push("internal host");
  if (DEV_HOST.test(host)) exclude.push("dev/test host");
  if (otherApps.size) exclude.push("existing customer: " + [...otherApps].sort().join(", "));
  if (!tech.email) exclude.push("no technical contact email");
  if (r.status !== "active") exclude.push("licence not active");
  return {
    app,
    site: host,
    license_type: r.licenseType,
    start: startDate(r)!,
    tech_name: tech.name,
    tech_email: tech.email,
    partner: r.partnerDetails?.partnerName,
    // A technical contact at the reseller is still emailed (owner, 2026-11-25); this only labels it.
    reseller_contact: Boolean(partnerDom && domain(tech.email) === partnerDom),
    exclude,
  };
}

export function select(rowsByApp: Partial<Record<App, Licence[]>>, from: string, to: string): Candidate[] {
  const byCloud = new Map<string | undefined, [App, Licence][]>();
  for (const [app, rows] of Object.entries(rowsByApp) as [App, Licence[]][])
    for (const r of rows) byCloud.set(r.cloudId, [...(byCloud.get(r.cloudId) ?? []), [app, r]]);
  const out: Candidate[] = [];
  for (const [app, rows] of Object.entries(rowsByApp) as [App, Licence[]][]) {
    for (const r of rows) {
      const s = startDate(r);
      if (!s || s < from || s > to) continue;
      // Another conf-app licence on the same site that started earlier = existing customer.
      const others = new Set(
        (byCloud.get(r.cloudId) ?? []).filter(([, o]) => o !== r && (startDate(o) ?? "9999") < s).map(([a]) => a),
      );
      out.push(classify(r, app, others));
    }
  }
  return out.sort((a, b) => (a.start + a.site).localeCompare(b.start + b.site));
}

export function firstName(name?: string): string {
  const word = (name ?? "").trim().split(" ")[0];
  return /^[A-Za-zÀ-ÿ'-]{2,}$/.test(word) ? word : "there";
}

export interface Email { subject: string; text: string; html?: string }

export function renderWelcome(template: string, app: "lite" | "full", site: string, name?: string): Email {
  const host = site.replace(/^https:\/\//, "").replace(/\/+$/, "");
  const siteUrl = `https://${host}`;
  const a = WELCOME_FIELDS[app];
  const fields: Record<string, string> = {
    first_name: firstName(name),
    site_name: host.split(".")[0],
    site_url: siteUrl,
    product_name: a.product_name,
    macro_title: a.macro_title,
    apps_menu: a.apps_menu,
    team_page_url: `${siteUrl}/wiki/apps/${a.page_path}/zenuml-dashboard`,
  };
  // Comments (the header documents the fields) stay out of the email.
  const html = template.replace(/<!--[\s\S]*?-->/g, "").replace(/\{\{(\w+)\}\}/g, (_, k: string) => {
    if (!(k in fields)) throw new Error(`unknown template field ${k}`);
    return fields[k];
  });
  const macro = a.macro_title.replace("&amp;", "&");
  const text = `Hi ${fields.first_name},

Thanks for installing ${a.product_name}. Your first diagram takes about a minute:

1. Open any page you can edit and click Edit.
2. Type /zenuml and pick ${macro}.
3. Choose a starter, change the text, then publish the page.

Open Confluence: ${siteUrl}/wiki

Installed it for your team? Send them the ZenUML page. Everyone on ${fields.site_name} can open it from Apps > ${a.apps_menu}:
${fields.team_page_url}

If anything gets in the way, just reply to this email. It comes to me and the team, and we answer every one.

If a colleague looks after this app, please feel free to forward this.

Peng
ZenUML for Confluence
`;
  return { subject: `ZenUML is ready on ${fields.site_name}`, text, html };
}

// Plain-text drafts for the products the owner still sends by hand.
export function renderDraft(app: "diagramly" | "asyncapi", licenseType: string | undefined, name?: string): Email {
  const product = DRAFT_PRODUCT_NAMES[app];
  const hi = `Hi ${firstName(name)},`;
  if (licenseType === "EVALUATION")
    return {
      subject: `Your ${product} trial`,
      text: `${hi}\n\nI'm Peng from ZenUML. Your Confluence site recently started a trial of ${product}. Is there anything you'd like to check during the trial?\n\nIf a colleague looks after this app, please feel free to forward this.\n\nThanks,\nPeng\n`,
    };
  return {
    subject: `Welcome to ${product}`,
    text: `${hi}\n\nI'm Peng from the ZenUML team. Thanks for installing ${product} on your Confluence site.\n\nI'd love to hear what you are hoping to use it for. If anything felt confusing or got in your way, or there is a feature you wish it had, just reply with a line or two. Every reply reaches me directly.\n\nIf a colleague looks after this app, please feel free to forward this.\n\nBest regards,\nPeng\nZenUML\nsupport@zenuml.com\n`,
  };
}

const b64 = (s: string) => {
  const bytes = new TextEncoder().encode(s);
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin);
};
const wrap = (s: string) => s.replace(/.{1,76}/g, "$&\r\n");

// RFC 2822 message, base64url-encoded for the Gmail API `raw` field.
export function mime(from: string, to: string, e: Email): string {
  const boundary = "ft-" + crypto.randomUUID();
  const head = [`From: ${from}`, `To: ${to}`, `Subject: =?UTF-8?B?${b64(e.subject)}?=`, "MIME-Version: 1.0"];
  const part = (type: string, body: string) =>
    `Content-Type: ${type}; charset="UTF-8"\r\nContent-Transfer-Encoding: base64\r\n\r\n${wrap(b64(body))}`;
  const msg = e.html
    ? [...head, `Content-Type: multipart/alternative; boundary="${boundary}"`, "",
       `--${boundary}`, part("text/plain", e.text), `--${boundary}`, part("text/html", e.html), `--${boundary}--`, ""].join("\r\n")
    : [...head, part("text/plain", e.text)].join("\r\n");
  return b64(msg).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

// Calendar date (YYYY-MM-DD) in a timezone, `daysAgo` days before `now`.
export function localDate(now: Date, timeZone: string, daysAgo = 0): string {
  const d = new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
  const t = new Date(d + "T00:00:00Z");
  t.setUTCDate(t.getUTCDate() - daysAgo);
  return t.toISOString().slice(0, 10);
}
