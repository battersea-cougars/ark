// A member changes their own sign-in email (ADR 0023), with a code to the new address and one to the current one, so a
// stolen session alone can't move the account.
import { first, run } from "@cougars/shared/d1";
import { mailPausedUntil, sendMail } from "@cougars/shared/email";
import { HttpError, body, json, text } from "../api/api.http";
import type { Ctx } from "../api/api.route";
import { code, email, localHere, mailConfig, mailSetup, sha256 } from "../auth/auth";
import { moveEmailCodeEmail, newEmailCodeEmail } from "../auth/auth.email";
import { endSessions } from "../auth/auth.sessions";
import { scribe } from "@cougars/shared/scribe";
import { shortName } from "../../src/lib/names";

const log = scribe.logger("members");

const CODE_MINUTES = 15;
/** Wrong guesses allowed against one change, whichever of its two codes was wrong. */
const MAX_ATTEMPTS = 5;
/** Codes one member may ask for, in an hour and in a day: someone else's inbox is at the other end. */
const MAX_PER_HOUR = 5;
const MAX_PER_DAY = 10;

const addMs = (now: string, ms: number) => new Date(Date.parse(now) + ms).toISOString();
const sentTo = (address: string, hasCurrent: boolean) =>
  hasCurrent
    ? `If ${address} can be yours, a code is on its way there, and another to the address you have now. Each works for ${CODE_MINUTES} minutes.`
    : `If ${address} can be yours, a code is on its way there. It works for ${CODE_MINUTES} minutes.`;
/** The new address half hidden, for the current inbox's warning: "t***@example.com". */
export const masked = (address: string) => `${address[0]}***${address.slice(address.indexOf("@"))}`;
const TAKEN_NOTE = {
  subject: "This email is already on a Cougars account",
  text: [
    "Someone signed in to the Cougars app asked to use this address to sign in, but it's already on another",
    "member's account, so nothing has changed.",
    "",
    "If both accounts are yours, ask an admin to sort them out. Didn't ask? Ignore this email.",
    "",
    "Battersea Cougars",
  ].join("\n"),
};

/** `{ email }`: a code to the new address (or a note that it's taken) and one to the current address. The same reply
 * either way: the app never says whose an address is. Someone who's lost their old inbox asks an admin. */
export async function askToChangeEmail(c: Ctx): Promise<Response> {
  const address = email(await body(c.request));
  const me = await first<{ email: string | null }>(c.env.DB, "SELECT email FROM members WHERE id = ?", [c.memberId]);
  const current = me?.email ?? null;
  if (current?.toLowerCase() === address) throw new HttpError(400, "That's already your email.");
  const local = localHere(c.env, c.request);
  if (!local && (await mailPausedUntil()) && (await mailConfig(c.env)).gmail)
    throw new HttpError(503, "Email isn't sending right now, so a code can't reach you. Try again in a few minutes.");
  const counts = await first<{ hour: number; day: number }>(
    c.env.DB,
    `SELECT coalesce(sum(created_at > ?), 0) AS hour, count(*) AS day FROM email_changes
     WHERE member_id = ? AND created_at > ?`,
    [addMs(c.now, -3600_000), c.memberId, addMs(c.now, -86_400_000)],
  );
  if ((counts?.hour ?? 0) >= MAX_PER_HOUR || (counts?.day ?? 0) >= MAX_PER_DAY)
    throw new HttpError(429, "That's a lot of codes. Try again later.");

  const taken = await first(c.env.DB, "SELECT 1 FROM members WHERE email = ? AND id != ?", [address, c.memberId]);
  const newCode = taken ? null : code();
  // The current inbox hears of it either way, so its owner knows someone tried
  const currentCode = current ? code() : null;
  // A new code spends the one before, so only the latest address can become theirs
  await run(c.env.DB, "UPDATE email_changes SET used_at = ? WHERE member_id = ? AND used_at IS NULL", [
    c.now,
    c.memberId,
  ]);
  await run(
    c.env.DB,
    `INSERT INTO email_changes (member_id, email, code_hash, current_code_hash, expires_at, created_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [
      c.memberId,
      address,
      newCode ? await sha256(newCode) : "",
      currentCode ? await sha256(currentCode) : null,
      addMs(c.now, CODE_MINUTES * 60_000),
      c.now,
    ],
  );
  await sendCodes(c, local, { address, newCode, current, currentCode });
  const reply = { ok: true, message: sentTo(address, !!current) };
  // On your own machine the codes come back to the screen, as sign-in's does, and aren't emailed
  if (!local) return json(reply);
  return json({
    ...reply,
    ...(newCode ? { devCode: newCode } : {}),
    ...(currentCode ? { devCurrentCode: currentCode } : {}),
  });
}

/** The new address's code (or the note that it's taken) and the current address's; on your own machine, only the note. */
async function sendCodes(
  c: Ctx,
  local: boolean,
  {
    address,
    newCode,
    current,
    currentCode,
  }: {
    address: string;
    newCode: string | null;
    current: string | null;
    currentCode: string | null;
  },
) {
  const mails = [];
  if (!newCode) mails.push({ to: [address], ...TAKEN_NOTE });
  else if (!local) mails.push({ to: [address], ...newEmailCodeEmail(newCode, CODE_MINUTES) });
  if (current && currentCode && !local)
    mails.push({ to: [current], ...moveEmailCodeEmail(currentCode, CODE_MINUTES, masked(address)) });
  if (!mails.length) return;
  const sending = (async () => {
    const setup = await mailSetup(c.env);
    for (const mail of mails) await sendMail(mail, setup);
  })().catch((e) => log.error("member.email_code_failed", e));
  if (c.waitUntil) c.waitUntil(sending);
  else await sending;
}

/** `{ code, currentCode }`: the new address's code and the current address's (none if they had no address). Both
 * right, and it's their sign-in email from now on. */
export async function confirmEmailChange(c: Ctx): Promise<Response> {
  const sent = await body(c.request);
  const typed = text(sent, "code", { max: 20 }).replace(/\s/g, "");
  const typedCurrent = text(sent, "currentCode", { optional: true, max: 20 }).replace(/\s/g, "");
  // Count the guess before looking at it, in one statement, so a burst of guesses can't all see "no tries yet"
  const live = await first<LiveChange>(
    c.env.DB,
    `UPDATE email_changes SET attempts = attempts + 1
     WHERE id = (SELECT id FROM email_changes WHERE member_id = ? AND used_at IS NULL AND expires_at > ?
                 ORDER BY id DESC LIMIT 1) AND attempts < ?
     RETURNING id, email, code_hash, current_code_hash, attempts`,
    [c.memberId, c.now, MAX_ATTEMPTS],
  );
  if (!live) throw new HttpError(400, "That code has run out, or had too many tries. Ask for a new one.");
  const wrong = await wrongCodes(c, live, typed, typedCurrent);
  if (wrong) throw new HttpError(400, wrong);
  // Spent once: only the first request to get here changes anything
  const spent = await run(c.env.DB, "UPDATE email_changes SET used_at = ? WHERE id = ? AND used_at IS NULL", [
    c.now,
    live.id,
  ]);
  if (spent.meta.changes !== 1) throw new HttpError(400, "That code's been used. Ask for a new one.");

  const was = await first<{ name: string; webName: string | null; email: string | null }>(
    c.env.DB,
    "SELECT name, web_name webName, email FROM members WHERE id = ?",
    [c.memberId],
  );
  // Someone else may have been given it since the code went
  const changed = await run(
    c.env.DB,
    `UPDATE members SET email = ? WHERE id = ? AND NOT EXISTS (SELECT 1 FROM members WHERE email = ? AND id != ?)`,
    [live.email, c.memberId, live.email, c.memberId],
  );
  if (changed.meta.changes !== 1) throw new HttpError(409, "That email is on another account now. Ask an admin.");
  // Whoever was signed in as them elsewhere signs in again, with the new address; this sign-in stays
  await endSessions(c.env, c.now, { memberId: c.memberId, except: c.sessionId });
  if (was?.email) {
    const telling = sendMail(
      {
        to: [was.email],
        subject: "Your Cougars sign-in email has changed",
        text: [
          `Hi ${shortName(was)},`,
          "",
          `You now sign in to the Cougars app with ${live.email}, not this address.`,
          "",
          "Didn't change it? Tell an admin or reply to the club straight away: they can change it back.",
          "",
          "Battersea Cougars",
        ].join("\n"),
      },
      await mailSetup(c.env),
    ).catch((e) => log.error("member.email_changed_mail_failed", e));
    if (c.waitUntil) c.waitUntil(telling);
    else await telling;
  }
  return json({ ok: true, email: live.email });
}

type LiveChange = { id: number; email: string; code_hash: string; current_code_hash: string | null; attempts: number };

/** What's wrong with the typed codes, saying which and how many tries are left; null when both are right. */
async function wrongCodes(c: Ctx, live: LiveChange, typed: string, typedCurrent: string): Promise<string | null> {
  const newRight = !!live.code_hash && live.code_hash === (await sha256(typed));
  const currentRight = live.current_code_hash === null || live.current_code_hash === (await sha256(typedCurrent));
  if (newRight && currentRight) return null;
  const left = MAX_ATTEMPTS - live.attempts;
  if (left <= 0) return "Too many tries. Ask for new codes.";
  const tries = `${left} ${left === 1 ? "try" : "tries"} left.`;
  if (!newRight && !currentRight) return `Neither code is right. ${tries}`;
  if (newRight) return `The code sent to ${await currentAddress(c)} isn't right. ${tries}`;
  return `The code sent to ${live.email} isn't right. ${tries}`;
}

/** The address the member has now, which the second code went to. */
const currentAddress = async (c: Ctx) =>
  (await first<{ email: string | null }>(c.env.DB, "SELECT email FROM members WHERE id = ?", [c.memberId]))?.email ??
  "your current address";
