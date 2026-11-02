// A break-glass sign-in code for an active admin (ADR 0023, scripts/admin-break-glass.mjs), written as the Worker
// writes an emailed one but claimed by no browser yet: the first to ask for that admin's code on the sign-in page takes
// it (apps/team/worker/auth/auth.break-glass.ts). Takes a query function, so the script and the tests share it.
import { createHash, randomInt } from "node:crypto";

export const BREAK_GLASS_MINUTES = 15;
/** A break-glass code's nonce until a browser claims it (auth.break-glass.ts UNCLAIMED). */
const UNCLAIMED = "break-glass";

/**
 * Make the code for `email`'s admin, or refuse: no active member with that email, or one who can't do everything.
 * Returns the code (to print, never to store), who it's for and when it runs out.
 */
export async function issueBreakGlass(query, { email, now = new Date(), by }) {
  const address = String(email ?? "")
    .trim()
    .toLowerCase();
  const [member] = await query("SELECT id, name FROM members WHERE lower(email) = ? AND status = 'active'", [address]);
  if (!member) throw new Error(`No active member has the email ${address}.`);
  const [admin] = await query(
    `SELECT 1 FROM member_roles mr JOIN role_actions ra ON ra.role_id = mr.role_id
     WHERE mr.member_id = ? AND ra.action = 'manage:all' LIMIT 1`,
    [member.id],
  );
  if (!admin) throw new Error(`${member.name} isn't an admin (manage:all): break glass is only for an admin.`);
  // Six digits, every one equally likely, like the Worker's
  const code = String(randomInt(1_000_000)).padStart(6, "0");
  const at = now.toISOString();
  const expiresAt = new Date(now.getTime() + BREAK_GLASS_MINUTES * 60_000).toISOString();
  // One at a time: an earlier one not used is called off
  await query(
    "UPDATE login_challenges SET expires_at = ? WHERE member_id = ? AND kind = 'break_glass' AND used_at IS NULL AND expires_at > ?",
    [at, member.id, at],
  );
  await query(
    `INSERT INTO login_challenges (member_id, code_hash, nonce_hash, expires_at, created_at, kind)
     VALUES (?, ?, ?, ?, ?, 'break_glass')`,
    [member.id, createHash("sha256").update(code).digest("hex"), UNCLAIMED, expiresAt, at],
  );
  await query("INSERT INTO audit_log (at, member_id, action, detail) VALUES (?, ?, 'auth.break_glass', ?)", [
    at,
    member.id,
    JSON.stringify({ step: "issued", by: by ?? "unknown", expiresAt }),
  ]);
  return { code, memberId: member.id, name: member.name, expiresAt };
}
