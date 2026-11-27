#!/usr/bin/env python3
"""Render and send the first-install welcome email (templates/welcome-zenuml.html) for one Lite or Full install.

Sends from support@zenuml.com through the authenticated `gws` CLI, as an HTML email with a
plain-text alternative. The caller owns the checks that decide whether to send at all (ledger,
prior Gmail contact, first_touch_candidates.py exclusions); this script only renders and sends.

Usage (from the conf-app primary checkout):
  python3 .claude/skills/customer-followup/scripts/send_welcome.py --app lite \
      --site example.atlassian.net --name "Alex Doe" --email alex@example.com [--dry-run out.html]

--dry-run writes the rendered HTML to the given path and sends nothing.
Output: one JSON line with the Gmail message id and thread id. Contains the contact email:
keep it out of public files.
"""
import argparse
import base64
import json
import os
import re
import subprocess
import sys
from email.message import EmailMessage
from email.utils import formataddr

HERE = os.path.dirname(os.path.abspath(__file__))
TEMPLATE = os.path.join(HERE, "..", "templates", "welcome-zenuml.html")

# manifest.yml macro title + LITE_TITLE_SUFFIX, globalPage title, production appId/environmentId.
APPS = {
    "lite": {
        "product_name": "ZenUML for Confluence Lite",
        "macro_title": "Diagram (Mermaid, PlantUML &amp; ZenUML) Lite",
        "apps_menu": "ZenUML Lite",
        "page_path": "8ad26115-211f-4216-971b-0540f606303d/b28ee919-d73b-4f43-b7fd-45a3a881ec46",
    },
    "full": {
        "product_name": "ZenUML for Confluence",
        "macro_title": "Diagram (Mermaid, PlantUML &amp; ZenUML)",
        "apps_menu": "ZenUML",
        "page_path": "d9e4002b-120b-426b-834b-402a4a5adce7/bd98a544-377a-4832-a72f-eb8d80b19dde",
    },
}
SENDER = formataddr(("Peng Xiao", "support@zenuml.com"))


def first_name(name):
    word = (name or "").split(" ")[0].strip()
    return word if re.fullmatch(r"[A-Za-zÀ-ÿ'\-]{2,}", word) else "there"


def render(app, site, name):
    host = site.removeprefix("https://").strip("/")
    site_url = "https://" + host
    a = APPS[app]
    fields = {
        "first_name": first_name(name),
        "site_name": host.split(".")[0],
        "site_url": site_url,
        "product_name": a["product_name"],
        "macro_title": a["macro_title"],
        "apps_menu": a["apps_menu"],
        "team_page_url": f"{site_url}/wiki/apps/{a['page_path']}/zenuml-dashboard",
    }
    html = open(TEMPLATE).read()
    head, body = html.split("-->", 1)  # the header comment documents the fields; leave it out of the email
    html = head[: head.rindex("<!--")] + body
    html = re.sub(r"\{\{(\w+)\}\}", lambda m: fields[m.group(1)], html)
    macro = fields["macro_title"].replace("&amp;", "&")
    text = f"""Hi {fields['first_name']},

Thanks for installing {a['product_name']}. Your first diagram takes about a minute:

1. Open any page you can edit and click Edit.
2. Type /zenuml and pick {macro}.
3. Choose a starter, change the text, then publish the page.

Open Confluence: {site_url}/wiki

Installed it for your team? Send them the ZenUML page. Everyone on {fields['site_name']} can open it from Apps > {a['apps_menu']}:
{fields['team_page_url']}

If anything gets in the way, just reply to this email. It comes to me and the team, and we answer every one.

If a colleague looks after this app, please feel free to forward this.

Peng
ZenUML for Confluence
"""
    subject = f"ZenUML is ready on {fields['site_name']}"
    return subject, html, text


def main():
    p = argparse.ArgumentParser()
    p.add_argument("--app", required=True, choices=sorted(APPS))
    p.add_argument("--site", required=True)
    p.add_argument("--name", default="")
    p.add_argument("--email", required=True)
    p.add_argument("--dry-run", metavar="OUT_HTML")
    args = p.parse_args()

    subject, html, text = render(args.app, args.site, args.name)
    if args.dry_run:
        open(args.dry_run, "w").write(html)
        print(json.dumps({"dry_run": args.dry_run, "subject": subject}))
        return

    msg = EmailMessage()
    msg["From"], msg["To"], msg["Subject"] = SENDER, args.email, subject
    msg.set_content(text)
    msg.add_alternative(html, subtype="html")
    raw = base64.urlsafe_b64encode(msg.as_bytes()).decode()
    r = subprocess.run(["gws", "gmail", "users", "messages", "send", "--params", '{"userId":"me"}',
                        "--json", json.dumps({"raw": raw})], capture_output=True, text=True)
    out = r.stdout[r.stdout.find("{"):] if "{" in r.stdout else ""
    if r.returncode != 0 or not out:
        sys.exit(f"SEND FAILED (state unknown: check Gmail Sent before retrying): {r.stderr.strip()[-300:]}")
    sent = json.loads(out)
    print(json.dumps({"id": sent.get("id"), "threadId": sent.get("threadId"), "labels": sent.get("labelIds")}))


if __name__ == "__main__":
    main()
