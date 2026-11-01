// A member changes their own sign-in email (ADR 0023), keeping everything they've done: it's all theirs by id, never by
// address. They type the new address on the You page and get a 6-digit code there; typing it back, signed in, makes
// it theirs. Their other sign-ins end (as when an admin changes it, #72), this one stays, and the old address hears it
// happened, so a member whose phone was taken can tell the club. An address that's already someone's gets no code, but
// a note saying so, and the reply is the same either way: the app never says whose an address is.
// Guesses are counted before a code is checked, in one statement, as sign-in's are.
import { first, run } from "@cougars/shared/d1";
import { mailPausedUntil, sendMail } from "@cougars/shared/email";
import { HttpError, body, json, text } from "../api/api.http";
import type { Ctx } from "../api/api.route";
import { code, email, localHere, mailConfig, mailSetup, sha256 } from "../auth/auth";
import { newEmailCodeEmail } from "../auth/auth.email";
import { endSessions } from "../auth/auth.sessions";
import { scribe } from "@cougars/shared/scribe";

const log = scribe.logger("members");

const CODE_MINUTES = 15;
/** Wrong codes allowed against one emailed code. */
const MAX_ATTEMPTS = 5;
/** Codes one member may ask for, in an hour and in a day: someone else's inbox is at the other end. */
const MAX_PER_HOUR = 5;
const MAX_PER_DAY = 10;

const addMs = (now: string, ms: number) => new Date(Date.parse(now) + ms).toISOString();
const sentTo = (address: string) =>
  `If ${address} can be yours, a code is on its way there. It works for ${CODE_MINUTES} minutes.`;

/** `{ email }`: a code to the new address, or a note that it's taken. The same reply either way. */
export async function askToChangeEmail(c: Ctx): Promise<Response> {
  const address = email(await body(c.request));
  const me = await first<{ email: string | null }>(c.env.DB, "SELECT email FROM members WHERE id = ?", [c.memberId]);
  if (me?.email?.toLowerCase() === address) throw new HttpError(400, "That's already your email.");
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
  const theCode = taken ? null : code();
  // A new code spends the one before, so only the latest address can become theirs
  await run(c.env.DB, "UPDATE email_changes SET used_at = ? WHERE member_id = ? AND used_at IS NULL", [
    c.now,
    c.memberId,
  ]);
  await run(
    c.env.DB,
    `INSERT INTO email_changes (member_id, email, code_hash, expires_at, created_at) VALUES (?, ?, ?, ?, ?)`,
    [c.memberId, address, theCode ? await sha256(theCode) : "", addMs(c.now, CODE_MINUTES * 60_000), c.now],
  );
  const reply = { ok: true, message: sentTo(address) };
  // On your own machine the code comes back to the screen, as sign-in's does
  if (theCode && local) return json({ ...reply, devCode: theCode });
  const mail = theCode
    ? { to: [address], ...newEmailCodeEmail(theCode, CODE_MINUTES) }
    : {
        to: [address],
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
  const sending = (async () => sendMail(mail, await mailSetup(c.env)))().catch((e) =>
    log.error("member.email_code_failed", e),
  );
  if (c.waitUntil) c.waitUntil(sending);
  else await sending;
  return json(reply);
}

/** `{ code }`: the code from the new address. Right, and it's their sign-in email from now on. */
export async function confirmEmailChange(c: Ctx): Promise<Response> {
  const typed = text(await body(c.request), "code", { max: 20 }).replace(/\s/g, "");
  // Count the guess before looking at it, in one statement, so a burst of guesses can't all see "no tries yet"
  const live = await first<{ id: number; email: string; code_hash: string; attempts: number }>(
    c.env.DB,
    `UPDATE email_changes SET attempts = attempts + 1
     WHERE id = (SELECT id FROM email_changes WHERE member_id = ? AND used_at IS NULL AND expires_at > ?
                 ORDER BY id DESC LIMIT 1) AND attempts < ?
     RETURNING id, email, code_hash, attempts`,
    [c.memberId, c.now, MAX_ATTEMPTS],
  );
  if (!live) throw new HttpError(400, "That code has run out, or had too many tries. Ask for a new one.");
  if (!live.code_hash || live.code_hash !== (await sha256(typed))) {
    const left = MAX_ATTEMPTS - live.attempts;
    throw new HttpError(
      400,
      left > 0
        ? `That's not the code. ${left} ${left === 1 ? "try" : "tries"} left.`
        : "Too many tries. Ask for a new code.",
    );
  }
  // Spent once: only the first request to get here changes anything
  const spent = await run(c.env.DB, "UPDATE email_changes SET used_at = ? WHERE id = ? AND used_at IS NULL", [
    c.now,
    live.id,
  ]);
  if (spent.meta.changes !== 1) throw new HttpError(400, "That code's been used. Ask for a new one.");

  const was = await first<{ name: string; email: string | null }>(
    c.env.DB,
    "SELECT name, email FROM members WHERE id = ?",
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
          `Hi ${was.name.split(" ")[0]},`,
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
