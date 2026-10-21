// The record (ADR 0024, ADR 0095): who did what, when. Written wherever something changes who can do what, at every
// sign-in and sign-out, and for requests the API refused for want of an action (once a minute per member); read on
// Settings → Audit log by whoever holds read:Audit, newest first, a page at a time. Each row names the member who
// acted and, where the detail says which member or role it was about, that one too, so the page can say it in plain
// words.
import { all, run } from "@cougars/shared/d1";
import { scribe } from "@cougars/shared/scribe";

export async function audit(
  db: D1Database,
  now: Date | string,
  memberId: number | null,
  action: string,
  detail: object = {},
) {
  await run(db, `INSERT INTO audit_log (at, member_id, action, detail) VALUES (?, ?, ?, ?)`, [
    typeof now === "string" ? now : now.toISOString(),
    memberId,
    action,
    JSON.stringify(detail),
  ]);
}

const log = scribe.logger("audit");

/**
 * A request refused for want of an action (ADR 0024): on the record at most once a minute per member (#73), so a
 * member (or a stolen session) looping on an admin route can't spend the club's daily D1 writes on refusals. Every
 * refusal is in the log (Workers Logs) whether or not it's written; the one row a minute says which came first.
 */
export async function auditRefused(
  db: D1Database,
  now: Date,
  memberId: number,
  detail: { method: string; path: string; action: string },
) {
  const res = await run(
    db,
    `INSERT INTO audit_log (at, member_id, action, detail)
     SELECT ?, ?, 'refused', ? WHERE NOT EXISTS (
       SELECT 1 FROM audit_log WHERE at > ? AND action = 'refused' AND member_id = ?)`,
    [now.toISOString(), memberId, JSON.stringify(detail), new Date(now.getTime() - 60_000).toISOString(), memberId],
  );
  log.warn("refused", { member: memberId, ...detail, recorded: res.meta.changes === 1 });
}

export interface AuditEntry {
  id: number;
  at: string;
  /** Who acted; null when nobody was signed in, or they've since been deleted. */
  by: { id: number; name: string } | null;
  action: string;
  detail: Record<string, unknown>;
  /** The member or role the entry is about, by its current name, when the detail names one. */
  about: string | null;
}

export const AUDIT_PAGE = 50;
const AUDIT_PAGE_MAX = 200;

/** The newest entries before `before` (an id; none: the newest of all), and whether there are more. */
export async function readAudit(
  db: D1Database,
  { before = null, limit = AUDIT_PAGE }: { before?: number | null; limit?: number } = {},
): Promise<{ entries: AuditEntry[]; more: boolean }> {
  const n = Math.min(Math.max(1, limit), AUDIT_PAGE_MAX);
  const rows = await all<{
    id: number;
    at: string;
    byId: number | null;
    byName: string | null;
    action: string;
    detail: string;
    memberName: string | null;
    roleName: string | null;
  }>(
    db,
    `SELECT a.id, a.at, a.member_id byId, m.name byName, a.action, a.detail,
            (SELECT name FROM members WHERE id = json_extract(a.detail, '$.memberId')) memberName,
            (SELECT name FROM roles WHERE id = json_extract(a.detail, '$.roleId')) roleName
     FROM audit_log a LEFT JOIN members m ON m.id = a.member_id
     WHERE ? IS NULL OR a.id < ?
     ORDER BY a.id DESC LIMIT ?`,
    [before, before, n + 1],
  );
  const more = rows.length > n;
  return {
    entries: rows.slice(0, n).map((r) => ({
      id: r.id,
      at: r.at,
      by: r.byId != null && r.byName != null ? { id: r.byId, name: r.byName } : null,
      action: r.action,
      detail: JSON.parse(r.detail),
      about: r.memberName ?? r.roleName,
    })),
    more,
  };
}
