# imprint-mcp-server

A [Model Context Protocol](https://modelcontextprotocol.io) server that exposes
[Imprint](https://imprint.fraction.no)'s local data — meeting notes, calendar
events, email metadata, daily digests — to Claude Desktop, Claude Code, and
any other MCP-compatible client.

Read-only by design. The server never writes to Imprint's database; Imprint
remains the source of truth for sync, classification, and writes.

## What you can ask Claude

> "What did we agree on in the Loyco meeting last week?"
>
> "List my meetings tomorrow with online links."
>
> "How many emails did I get from `acme.no` in April?"
>
> "Summarize what I worked on this Tuesday."

Claude calls the appropriate tool(s), gets structured JSON back, and answers
with full context from your own local Imprint data.

## Tools

| Name | Purpose |
| --- | --- |
| `search_meeting_notes` | Keyword search over titles, summaries, AI summaries, project context. |
| `get_meeting_note` | Full content of one note + optional full transcript. |
| `list_calendar_events` | All events on a given date, with online-meeting URLs. |
| `search_emails` | Filter email metadata by query / sender domain / direction / date range. (Imprint never stores email bodies.) |
| `get_daily_digest` | Imprint's pre-generated work-hours/focus/apps summary for a date. |

## Install

```bash
npm install -g imprint-mcp-server
```

Or use it ad-hoc via `npx` (recommended — no global install needed):

```jsonc
// ~/Library/Application Support/Claude/claude_desktop_config.json
{
  "mcpServers": {
    "imprint": {
      "command": "npx",
      "args": ["-y", "imprint-mcp-server"]
    }
  }
}
```

Restart Claude Desktop. You'll see Imprint show up in the tools menu, and
Claude will call its tools whenever a question matches.

## Custom database location

By default the server looks at the standard Imprint path:

```
~/Library/Application Support/Imprint/imprint.db
```

Override via env var if Imprint's DB lives elsewhere:

```jsonc
{
  "mcpServers": {
    "imprint": {
      "command": "npx",
      "args": ["-y", "imprint-mcp-server"],
      "env": { "IMPRINT_DB_PATH": "/path/to/imprint.db" }
    }
  }
}
```

## Privacy

- The server runs **locally** on your machine. The MCP transport is stdio —
  there's no network listener.
- The SQLite connection is opened **read-only**.
- Tool results travel from the MCP server to Claude Desktop via stdio, then
  Claude Desktop sends them to Anthropic's API for the model to read. So:
  whatever you tell Claude to look up _is_ sent to the model, just like any
  other Claude conversation. Use the same judgment you would if you pasted
  the data into a chat.
- Imprint stores only email metadata (sender domain, subject, timestamp) —
  no message bodies. The MCP server can't surface what isn't there.

## Development

```bash
git clone <repo>
cd imprint-mcp-server
npm install
npm run build
npm start
```

Smoke-test by piping JSON-RPC at it:

```bash
(
  echo '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"smoke","version":"1"}}}'
  echo '{"jsonrpc":"2.0","method":"notifications/initialized"}'
  echo '{"jsonrpc":"2.0","id":2,"method":"tools/list"}'
  sleep 0.3
) | node dist/index.js
```

## Releasing

Releases are published to npm via GitHub Actions using **OIDC trusted
publishing** — no long-lived tokens are stored in the repo or secrets.

To cut a release:

```bash
# 1. Bump version in package.json
npm version patch  # or minor / major

# 2. Push the tag
git push --follow-tags
```

The `Release to npm` workflow runs on tag push, builds, and publishes with
`--provenance` (a signed SLSA attestation linking the tarball to the exact
commit + run — visible on the npm package page).

### One-time npm setup (already done for `imprint-mcp-server`)

On `npmjs.com → Packages → imprint-mcp-server → Settings → Trusted Publishers`,
the following GitHub Actions config is registered:

| Field | Value |
| --- | --- |
| Organization | `PTrobe` |
| Repository | `imprint-mcp-server` |
| Workflow filename | `release.yml` |
| Environment name | _(empty)_ |

This means npm will accept publishes from `.github/workflows/release.yml` on
the `PTrobe/imprint-mcp-server` repo without any secret. Tokens with 90-day
expirations stop being a maintenance burden.

## Roadmap

- [ ] Tasks tool (requires Imprint to cache tasks in DB; today they're fetched live per provider)
- [ ] Activity-events search (window/app tracking)
- [ ] Resources (vs. tools) for browsing notes by folder
- [ ] Write tools — e.g. `create_meeting_note`, `complete_task`
