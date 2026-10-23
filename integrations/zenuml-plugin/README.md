# ZenUML for Confluence

Let Claude or ChatGPT read, create and update the diagrams on your Confluence
Cloud pages. Ask for a sequence diagram of a code path, a Mermaid flowchart of a
runbook, or a fix to a diagram that no longer matches the system. The assistant
writes the diagram source and saves it to the page. You never open the editor.

Supported diagram types: ZenUML sequence diagrams, Mermaid, PlantUML,
diagrams.net (draw.io) graphs and OpenAPI specifications. Sequence, Mermaid and
PlantUML diagrams are also shown rendered inline in the conversation.

## What you need

- A Confluence Cloud site with the
  [ZenUML Diagrams for Confluence](https://marketplace.atlassian.com/apps/1218380/zenuml-diagrams-for-confluence-freemium)
  app installed.
- An Atlassian account that can view and edit the pages you want to work on.

## Install

In Claude Code:

```
/plugin install zenuml --marketplace ZenUml/zenuml-plugin
```

In Claude and ChatGPT, add it from the plugin directory once it is listed.

## What is in this plugin

| Component | What it does |
|---|---|
| `zenuml` MCP server (`https://conf-lite.zenuml.com/agent-link/mcp`) | Remote tools: `list_sites`, `list_diagrams`, `read_diagram`, `read_page`, `get_status` (read-only), and `create_diagram`, `update_diagram`, `create_page`, `update_page` (write). |
| `confluence-diagrams` skill | Tells the assistant the read-before-write workflow, which diagram type fits which job, and the ZenUML sequence syntax. |

The plugin bundles no local code. Every tool call goes to the ZenUML server
named above, run by ZenUML, which calls the Confluence REST API at
`api.atlassian.com` for you.

## Sign-in and permissions

The first time a tool runs, you sign in with Atlassian and approve access in
your browser. ZenUML then acts **as you**: it can reach only the sites, spaces
and pages your Atlassian account can already reach, and every change appears in
Confluence under your name. You can revoke access at any time from your
Atlassian account's connected apps.

Read-only tools run without asking. Each tool that changes Confluence asks for
your confirmation first.

## How changes are saved

- `update_diagram` saves a new version of the diagram. It refuses source that
  does not parse or that looks like accidental truncation. To undo, write the
  previous source back.
- `create_diagram` adds the diagram to the end of a page and publishes one page
  version, which page history can revert. It never overwrites a page that
  someone else changed in the meantime.
- `create_page` and `update_page` publish ordinary page versions. A page can be
  created as an unpublished draft for you to review.

## Data and privacy

ZenUML stores your Atlassian authorization (encrypted) so the tools can keep
working between sessions. For each tool call it records usage analytics: your
Atlassian account id, the name of the AI client, which tool ran, on which site,
and whether it succeeded. Diagram and page content passes through to Confluence and
is not stored by ZenUML; Confluence remains the only copy. See the
[privacy policy](https://zenuml.com/privacy/) and
[terms of service](https://zenuml.com/terms/).

## Example prompts

- "List the sequence diagrams on the *Auth architecture* page."
- "Our refresh-token hop moved to the gateway. Update the login sequence
  diagram to match."
- "Add a Mermaid flowchart of the retry ladder to the *Payments runbook* page."
- "Create a draft page under *Engineering* that documents this API with a
  sequence diagram for each endpoint."

## Support

Documentation: <https://zenuml.com/docs/products/zenuml-diagrams-for-confluence/mcp-server/>
Contact: <support@zenuml.com>

## License

MIT. See [LICENSE](LICENSE).
