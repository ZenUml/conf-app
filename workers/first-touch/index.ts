// first-touch: one email per new conf-app install, sent from support@zenuml.com.
//
// Daily cron. Reads the Marketplace licence exports for the four conf-app products, picks licences that
// started in the last WINDOW_DAYS days (Australia/Melbourne), and for each new site:
//   - Lite / Full: sends the approved welcome email (welcome-zenuml.html). Standing approval, owner 2026-11-25.
//   - Diagramly / AsyncAPI: saves a plain-text Gmail draft; the owner sends it (owner 2026-11-25).
// Rules: .claude/skills/customer-followup/references/contact-policy.md. One email per site, ever: a site is
// skipped when the ledger has it or Gmail has any thread with the contact or the site.
// The ledger is KV_FEATURE_FLAGS keys `first-touch:site:<host>`; a summary goes to REPORT_TO when anything
// was sent, drafted or failed.
//
// Deploy:  npx wrangler deploy -c workers/first-touch/wrangler.toml
// Secrets: MARKETPLACE_EMAIL, MARKETPLACE_TOKEN (FORGE_EMAIL / FORGE_API_TOKEN),
//          GMAIL_CLIENT_ID, GMAIL_CLIENT_SECRET, GMAIL_REFRESH_TOKEN (support@zenuml.com, gmail.modify scope)

import template from "./welcome-zenuml.html";
import { APPS, type App, type Candidate, type Email, type Licence, localDate, mime, renderDraft, renderWelcome, select } from "./logic";

export interface Env {
  KV: KVNamespace;
  MARKETPLACE_EMAIL: string;
  MARKETPLACE_TOKEN: string;
  GMAIL_CLIENT_ID: string;
  GMAIL_CLIENT_SECRET: string;
  GMAIL_REFRESH_TOKEN: string;
  REPORT_TO: string;
  WINDOW_DAYS?: string;
  DRY_RUN?: string;
}

const VENDOR = "1215266";
const FROM = "Peng Xiao <support@zenuml.com>";
const KEY = (site: string) => `first-touch:site:${site}`;
const GMAIL = "https://gmail.googleapis.com/gmail/v1/users/me";

interface LedgerRow {
  app: App;
  license_type?: string;
  start?: string;
  tech_email?: string;
  status: string;
  at: string;
  message_id?: string;
  draft_id?: string;
  note?: string;
}

async function exportLicences(env: Env, addon: string): Promise<Licence[]> {
  const res = await fetch(
    `https://marketplace.atlassian.com/rest/2/vendors/${VENDOR}/reporting/licenses/export?accept=json&addon=${addon}`,
    { headers: { Authorization: "Basic " + btoa(`${env.MARKETPLACE_EMAIL}:${env.MARKETPLACE_TOKEN}`), Accept: "application/json" } },
  );
  if (!res.ok) throw new Error(`Marketplace export ${addon}: HTTP ${res.status} ${(await res.text()).slice(0, 200)}`);
  return res.json();
}

class Gmail {
  private token?: string;
  constructor(private env: Env) {}

  private async call(path: string, init: RequestInit = {}): Promise<any> {
    if (!this.token) {
      const r = await fetch("https://oauth2.googleapis.com/token", {
        method: "POST",
        body: new URLSearchParams({
          grant_type: "refresh_token",
          client_id: this.env.GMAIL_CLIENT_ID,
          client_secret: this.env.GMAIL_CLIENT_SECRET,
          refresh_token: this.env.GMAIL_REFRESH_TOKEN,
        }),
      });
      if (!r.ok) throw new Error(`Gmail token: HTTP ${r.status} ${(await r.text()).slice(0, 200)}`);
      this.token = (await r.json<{ access_token: string }>()).access_token;
    }
    const res = await fetch(GMAIL + path, {
      ...init,
      headers: { Authorization: `Bearer ${this.token}`, "Content-Type": "application/json" },
    });
    if (!res.ok) throw new Error(`Gmail ${path.split("?")[0]}: HTTP ${res.status} ${(await res.text()).slice(0, 200)}`);
    return res.json();
  }

  async hasThread(q: string): Promise<boolean> {
    const r = await this.call(`/threads?maxResults=1&includeSpamTrash=true&q=${encodeURIComponent(q)}`);
    return (r.threads ?? []).length > 0;
  }
  async hasDraft(q: string): Promise<boolean> {
    const r = await this.call(`/drafts?maxResults=1&q=${encodeURIComponent(q)}`);
    return (r.drafts ?? []).length > 0;
  }
  send(to: string, e: Email): Promise<{ id: string; labelIds?: string[] }> {
    return this.call("/messages/send", { method: "POST", body: JSON.stringify({ raw: mime(FROM, to, e) }) });
  }
  draft(to: string, e: Email): Promise<{ id: string }> {
    return this.call("/drafts", { method: "POST", body: JSON.stringify({ message: { raw: mime(FROM, to, e) } }) });
  }
}

interface Outcome { c: Candidate; result: string }

export async function run(env: Env, now = new Date()): Promise<{ lines: Outcome[]; waiting: string[]; window: string }> {
  const dry = env.DRY_RUN === "1";
  const days = Number(env.WINDOW_DAYS ?? "3");
  const from = localDate(now, "Australia/Melbourne", days);
  const to = localDate(now, "Australia/Melbourne");
  const gmail = new Gmail(env);
  const stamp = now.toISOString();
  const put = (site: string, row: LedgerRow) => (dry ? Promise.resolve() : env.KV.put(KEY(site), JSON.stringify(row)));

  // 1. Reconcile drafts still waiting for the owner.
  const waiting: string[] = [];
  for (const k of (await env.KV.list({ prefix: KEY("") })).keys) {
    const row = await env.KV.get<LedgerRow>(k.name, "json");
    if (row?.status !== "draft_waiting_owner" || !row.tech_email) continue;
    const site = k.name.slice(KEY("").length);
    if (await gmail.hasThread(`in:sent to:${row.tech_email}`)) await put(site, { ...row, status: "sent", at: stamp });
    else if (!(await gmail.hasDraft(`to:${row.tech_email}`))) await put(site, { ...row, status: "declined_by_owner", at: stamp });
    else waiting.push(`${site}（${row.app}，草稿自 ${row.at.slice(0, 10)}）`);
  }

  // 2. Candidates.
  const rows: Partial<Record<App, Licence[]>> = {};
  for (const [app, addon] of Object.entries(APPS) as [App, string][]) rows[app] = await exportLicences(env, addon);
  const lines: Outcome[] = [];

  for (const c of select(rows, from, to)) {
    if (c.exclude.length) { lines.push({ c, result: "跳过：" + c.exclude.join("; ") }); continue; }
    if (await env.KV.get(KEY(c.site))) continue; // handled on an earlier day
    const email = c.tech_email!;
    const base = { app: c.app, license_type: c.license_type, start: c.start, tech_email: email, at: stamp };
    if (await gmail.hasThread(`(to:${email} OR from:${email} OR "${c.site}")`)) {
      await put(c.site, { ...base, status: "contacted_before" });
      lines.push({ c, result: "跳过：Gmail 已有往来" });
      continue;
    }
    if (c.app === "lite" || c.app === "full") {
      const e = renderWelcome(template, c.app, c.site, c.tech_name);
      if (dry) { lines.push({ c, result: `演练：会发送「${e.subject}」` }); continue; }
      // Claim the site before sending, so a failed or unclear send is never repeated.
      await put(c.site, { ...base, status: "send_unverified" });
      try {
        const sent = await gmail.send(email, e);
        await put(c.site, { ...base, status: "sent", message_id: sent.id });
        lines.push({ c, result: `已发送 https://mail.google.com/mail/u/0/#all/${sent.id}` });
      } catch (err) {
        await put(c.site, { ...base, status: "send_unverified", note: String(err).slice(0, 300) });
        lines.push({ c, result: `发送状态不明，先查 Gmail 已发送再处理：${String(err).slice(0, 160)}` });
      }
    } else {
      const e = renderDraft(c.app, c.license_type, c.tech_name);
      if (dry) { lines.push({ c, result: `演练：会建草稿「${e.subject}」` }); continue; }
      const d = await gmail.draft(email, e);
      await put(c.site, { ...base, status: "draft_waiting_owner", draft_id: d.id });
      lines.push({ c, result: "已建草稿（support@zenuml.com Drafts），等你发" });
    }
  }
  return { lines, waiting, window: `${from}..${to}` };
}

function report(r: Awaited<ReturnType<typeof run>>): Email | null {
  const acted = r.lines.filter((l) => !l.result.startsWith("跳过"));
  if (!acted.length) return null;
  const sent = acted.filter((l) => l.result.startsWith("已发送")).length;
  const drafts = acted.filter((l) => l.result.startsWith("已建草稿")).length;
  const rows = r.lines.map(({ c, result }) =>
    `- ${c.site} | ${c.app} | ${c.license_type} | ${c.start} | ${c.tech_email}${c.reseller_contact ? "（经销商联系人）" : ""} | ${result}`);
  const text = [`新站点 ${r.lines.length} 个，已发 ${sent} 封，草稿 ${drafts} 封（窗口 ${r.window}）`, "", ...rows,
    ...(r.waiting.length ? ["", "草稿还在等你发：", ...r.waiting.map((w) => "- " + w)] : [])].join("\n");
  return { subject: `First-touch ${r.window}: sent ${sent}, drafts ${drafts}`, text };
}

export default {
  async scheduled(_c: ScheduledController, env: Env, ctx: ExecutionContext) {
    ctx.waitUntil((async () => {
      const gmail = new Gmail(env);
      try {
        const r = await run(env);
        console.log(JSON.stringify({ window: r.window, lines: r.lines.map((l) => ({ site: l.c.site, app: l.c.app, result: l.result })), waiting: r.waiting }));
        const e = report(r);
        if (e && env.DRY_RUN !== "1") await gmail.send(env.REPORT_TO, e);
      } catch (err) {
        console.error("first-touch failed", err);
        if (env.DRY_RUN !== "1") await gmail.send(env.REPORT_TO, { subject: "First-touch 扫描失败", text: String(err) }).catch(() => {});
        throw err;
      }
    })());
  },
} satisfies ExportedHandler<Env>;
