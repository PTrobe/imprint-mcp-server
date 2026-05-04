#!/usr/bin/env node

/**
 * Imprint MCP server.
 *
 * Exposes Imprint's local SQLite data (meeting notes, calendar events, email
 * metadata, daily digests) to Claude Desktop / Claude Code / any MCP client
 * via the Model Context Protocol over stdio.
 *
 * Read-only by design — this process never writes to Imprint's DB. Imprint
 * itself remains the source of truth for sync, classification, and writes.
 */

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import { zodToJsonSchema } from "./zod-to-json-schema.js";

import { openImprintDB } from "./db.js";
import {
  searchMeetingNotes,
  searchMeetingNotesSchema,
  getMeetingNote,
  getMeetingNoteSchema,
  listCalendarEvents,
  listCalendarEventsSchema,
  searchEmails,
  searchEmailsSchema,
  getDailyDigest,
  getDailyDigestSchema,
} from "./tools.js";

const db = openImprintDB();

const server = new Server(
  {
    name: "imprint-mcp-server",
    version: "0.1.0",
  },
  {
    capabilities: {
      tools: {},
    },
  },
);

// Tool registry — single source of truth for name → handler mapping. Each
// entry pairs a Zod schema (for runtime validation + JSON-Schema generation)
// with a sync handler. Adding a new tool = one entry here + one tools.ts fn.
type ToolDef<T extends z.ZodTypeAny> = {
  name: string;
  description: string;
  schema: T;
  handler: (db: import("better-sqlite3").Database, args: z.infer<T>) => unknown;
};

const TOOLS: ToolDef<z.ZodTypeAny>[] = [
  {
    name: "search_meeting_notes",
    description:
      "Search Imprint's meeting notes by keyword (matches title, summary, AI summary, project context). Returns up to N most-recent matches with previews. Use this first when the user asks about a meeting topic.",
    schema: searchMeetingNotesSchema,
    handler: searchMeetingNotes,
  },
  {
    name: "get_meeting_note",
    description:
      "Fetch the full content of a specific meeting note by ID. Includes title, body summary, AI summary, action items, participants, and optionally the full transcript. Call after `search_meeting_notes` to drill into a specific match.",
    schema: getMeetingNoteSchema,
    handler: getMeetingNote,
  },
  {
    name: "list_calendar_events",
    description:
      "List meetings/events for a specific day. Returns title, start/end times, attendee count, and any online meeting URL (Teams, Zoom, etc).",
    schema: listCalendarEventsSchema,
    handler: listCalendarEvents,
  },
  {
    name: "search_emails",
    description:
      "Search Imprint's email metadata. Imprint stores only metadata (sender domain, subject, date) — NEVER email bodies. Filter by query, sender domain, direction, or date range.",
    schema: searchEmailsSchema,
    handler: searchEmails,
  },
  {
    name: "get_daily_digest",
    description:
      "Get Imprint's pre-generated daily summary for a date — work hours, top apps, focus time, meetings overview. Returns null if no digest exists yet.",
    schema: getDailyDigestSchema,
    handler: getDailyDigest,
  },
];

// MCP — list-tools handler advertises every tool's name + JSON Schema. Claude
// uses this to know what's callable and how to format args.
server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: TOOLS.map((t) => ({
    name: t.name,
    description: t.description,
    inputSchema: zodToJsonSchema(t.schema),
  })),
}));

// MCP — tool-call dispatcher. Validate args via the same Zod schema we
// advertised, then run the SQLite-backed handler synchronously. Errors are
// returned as content rather than thrown so Claude can self-correct.
server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const tool = TOOLS.find((t) => t.name === request.params.name);
  if (!tool) {
    return {
      content: [{ type: "text", text: `Unknown tool: ${request.params.name}` }],
      isError: true,
    };
  }
  try {
    const args = tool.schema.parse(request.params.arguments ?? {});
    const result = tool.handler(db, args);
    return {
      content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      content: [{ type: "text", text: `Error: ${message}` }],
      isError: true,
    };
  }
});

const transport = new StdioServerTransport();
await server.connect(transport);

// Keep the process alive — the SDK handles stdin EOF on its own.
process.stderr.write("imprint-mcp-server: ready (read-only)\n");
