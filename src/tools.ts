import type Database from "better-sqlite3";
import { z } from "zod";

// ─────────────────────────────────────────────────────────────────────────────
// Tool: search_meeting_notes
// ─────────────────────────────────────────────────────────────────────────────

export const searchMeetingNotesSchema = z.object({
  query: z.string().min(1).describe("Search term — matched against title, summary, ai_summary, and project_context (case-insensitive substring)."),
  after: z.string().optional().describe("ISO date (YYYY-MM-DD). Only include notes with meeting_date on or after this."),
  before: z.string().optional().describe("ISO date (YYYY-MM-DD). Only include notes with meeting_date on or before this."),
  limit: z.number().int().positive().max(50).default(20),
});

export function searchMeetingNotes(
  db: Database.Database,
  args: z.infer<typeof searchMeetingNotesSchema>,
) {
  const where: string[] = ["is_personal = 0"];
  const params: Record<string, unknown> = {};
  // Case-insensitive substring match on the most informative columns. SQLite's
  // LIKE is case-insensitive for ASCII; for Norwegian å/ø/æ that's not strictly
  // true, but acceptable for v1. Future: FTS5 virtual table.
  const q = `%${args.query.toLowerCase()}%`;
  where.push(
    "(LOWER(title) LIKE :q OR LOWER(COALESCE(summary, '')) LIKE :q OR LOWER(COALESCE(ai_summary, '')) LIKE :q OR LOWER(COALESCE(project_context, '')) LIKE :q)",
  );
  params.q = q;
  if (args.after) {
    where.push("meeting_date >= :after");
    params.after = args.after;
  }
  if (args.before) {
    where.push("meeting_date <= :before");
    params.before = args.before;
  }
  const sql = `
    SELECT id, title, meeting_date, project_context, folder, source_type,
           SUBSTR(COALESCE(ai_summary, summary, ''), 1, 280) AS preview,
           notion_url
    FROM meeting_notes
    WHERE ${where.join(" AND ")}
    ORDER BY meeting_date DESC, id DESC
    LIMIT :limit
  `;
  return db.prepare(sql).all({ ...params, limit: args.limit });
}

// ─────────────────────────────────────────────────────────────────────────────
// Tool: get_meeting_note
// ─────────────────────────────────────────────────────────────────────────────

export const getMeetingNoteSchema = z.object({
  id: z.number().int().positive().describe("The meeting note's `id` from search_meeting_notes."),
  include_transcript: z.boolean().default(false).describe("Inkluder full transkripsjon (kan være lang). Default false for token-økonomi."),
});

export function getMeetingNote(
  db: Database.Database,
  args: z.infer<typeof getMeetingNoteSchema>,
) {
  const note = db
    .prepare(
      `SELECT id, title, meeting_date, start_time, duration_minutes,
              participants, summary, action_items, project_context, folder,
              ai_summary, ai_summary_generated_at, notion_url, source_type,
              transcript_session_id
       FROM meeting_notes WHERE id = ?`,
    )
    .get(args.id) as Record<string, unknown> | undefined;
  if (!note) return { error: "Note not found" };

  const result: Record<string, unknown> = { ...note };

  if (args.include_transcript && note.transcript_session_id) {
    const chunks = db
      .prepare(
        `SELECT offset_start_s, offset_end_s, text, source
         FROM transcript_chunks
         WHERE transcript_session_id = ?
         ORDER BY offset_start_s ASC`,
      )
      .all(note.transcript_session_id);
    result.transcript = chunks;
  }

  return result;
}

// ─────────────────────────────────────────────────────────────────────────────
// Tool: list_calendar_events
// ─────────────────────────────────────────────────────────────────────────────

export const listCalendarEventsSchema = z.object({
  date: z.string().describe("ISO date (YYYY-MM-DD). Returns all events on that day."),
  include_personal: z.boolean().default(false).describe("Include events Imprint has classified as personal. Default false (work-only)."),
});

export function listCalendarEvents(
  db: Database.Database,
  args: z.infer<typeof listCalendarEventsSchema>,
) {
  const personalClause = args.include_personal ? "" : "AND is_personal = 0";
  return db
    .prepare(
      `SELECT id, title, event_date, start_time, end_time, duration_minutes,
              attendee_count, event_type, calendar_name, source_type,
              online_meeting_url, online_meeting_provider, is_personal
       FROM calendar_events
       WHERE event_date = ? ${personalClause}
       ORDER BY start_time ASC NULLS LAST`,
    )
    .all(args.date);
}

// ─────────────────────────────────────────────────────────────────────────────
// Tool: search_emails
// ─────────────────────────────────────────────────────────────────────────────

export const searchEmailsSchema = z.object({
  query: z.string().optional().describe("Match against truncated subject (case-insensitive substring). Optional."),
  sender_domain: z.string().optional().describe("Filter by sender domain (e.g. \"loyco.no\")."),
  direction: z.enum(["incoming", "outgoing"]).optional(),
  after: z.string().optional().describe("ISO date (YYYY-MM-DD)."),
  before: z.string().optional().describe("ISO date (YYYY-MM-DD)."),
  limit: z.number().int().positive().max(100).default(50),
});

export function searchEmails(
  db: Database.Database,
  args: z.infer<typeof searchEmailsSchema>,
) {
  const where: string[] = ["is_personal = 0"];
  const params: Record<string, unknown> = {};
  if (args.query) {
    where.push("LOWER(COALESCE(subject_truncated, '')) LIKE :q");
    params.q = `%${args.query.toLowerCase()}%`;
  }
  if (args.sender_domain) {
    where.push("sender_domain = :domain");
    params.domain = args.sender_domain;
  }
  if (args.direction) {
    where.push("direction = :direction");
    params.direction = args.direction;
  }
  if (args.after) {
    where.push("date >= :after");
    params.after = args.after;
  }
  if (args.before) {
    where.push("date <= :before");
    params.before = args.before;
  }
  const sql = `
    SELECT id, date, direction, subject_truncated, sender_domain,
           category, account_name, hour_of_day
    FROM email_entries
    WHERE ${where.join(" AND ")}
    ORDER BY date DESC, id DESC
    LIMIT :limit
  `;
  return db.prepare(sql).all({ ...params, limit: args.limit });
}

// ─────────────────────────────────────────────────────────────────────────────
// Tool: get_daily_digest
// ─────────────────────────────────────────────────────────────────────────────

export const getDailyDigestSchema = z.object({
  date: z.string().describe("ISO date (YYYY-MM-DD)."),
});

export function getDailyDigest(
  db: Database.Database,
  args: z.infer<typeof getDailyDigestSchema>,
) {
  const row = db
    .prepare(
      `SELECT * FROM daily_digests WHERE date = ?`,
    )
    .get(args.date);
  if (!row) {
    return {
      error: "No digest found for this date. Imprint generates digests automatically; there may not be enough data for the day yet.",
    };
  }
  return row;
}
