// The club's emails about joining (ADR 0069): the admins hear when someone asks to join, and the member hears once
// they're in (added by an admin, or let in after asking). Each goes through sendMail, so outside production only the
// allowed addresses get anything (ADR 0027) and Gmail's breaker has the last word (ADR 0055). An email that doesn't go
// never undoes the change: it's logged, and the caller can say so.
import { all } from "@cougars/shared/d1";
import { sendMail } from "@cougars/shared/email";
import { mailSetup, type AuthEnv } from "../auth/auth";
import { scribe } from "@cougars/shared/scribe";

const log = scribe.logger("members");

const sent = (event: string) => [() => true, (e: unknown) => (log.error(event, e), false)] as const;

/** "You're in": a link to the app that fills in their address on the sign-in screen. */
export async function tellTheyreIn(env: AuthEnv, name: string, address: string, origin: string): Promise<boolean> {
  const link = `${origin}/?email=${encodeURIComponent(address)}`;
  return sendMail(
    {
      to: [address],
      subject: "You're in: the Battersea Cougars app",
      text: [
        `Hi ${name.split(" ")[0]},`,
        "",
        "You're in the Battersea Cougars app: training, tournaments, the draft and what you owe, all in one place.",
        "",
        `Open it here: ${link}`,
        "",
        "Sign in with this email address. We'll send you a code to type in; no password to remember.",
        "",
        "See you at training.",
        "Battersea Cougars",
      ].join("\n"),
    },
    await mailSetup(env),
  ).then(...sent("member.invite_failed"));
}

/** Someone asked to join: one email to whoever lets members in (manage:Member), with a link to their sheet. */
export async function tellAdminsOfRequest(
  env: AuthEnv,
  m: { id: number; name: string; position: string },
  origin: string,
): Promise<boolean> {
  const admins = await all<{ email: string }>(
    env.DB,
    `SELECT DISTINCT lower(m.email) email FROM members m
       JOIN member_roles mr ON mr.member_id = m.id JOIN role_actions ra ON ra.role_id = mr.role_id
     WHERE m.status = 'active' AND m.email IS NOT NULL AND ra.action IN ('manage:Member', 'manage:all')`,
  );
  if (!admins.length) return false;
  const position = { F: "a forward", D: "a defender", G: "a keeper" }[m.position] ?? "a player";
  return sendMail(
    {
      to: admins.map((a) => a.email),
      subject: `${m.name} is asking to join`,
      text: [
        `${m.name}, ${position}, has asked to join the club in the app.`,
        "",
        `Let them in (or not) on their sheet: ${origin}/settings/members?member=${m.id}`,
        "",
        "Battersea Cougars",
      ].join("\n"),
    },
    await mailSetup(env),
  ).then(...sent("member.request_mail_failed"));
}
