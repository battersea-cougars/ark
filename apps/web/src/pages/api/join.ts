import type { APIRoute } from "astro";
import { env } from "cloudflare:workers";
import {
  autoReplyAllowed,
  deleteEnquiry,
  isSpam,
  markAutoReplied,
  parseEnquiry,
  saveEnquiry,
  type Enquiry,
} from "../../lib/server/enquiries";
import { rateLimit } from "@cougars/shared/rate-limit";
import { enquiryMail } from "../../lib/server/enquiry-mail";
import { clubInbox, mailConfig, smokeToken, turnstileSecret } from "../../lib/server/mail-env";
import { isSmoke, smokeMailConfig } from "../../lib/server/smoke";
import { autoReplyMail } from "../../lib/server/auto-reply";
import { TURNSTILE_FIELD, verifyTurnstile } from "../../lib/server/turnstile";
import { getSettings } from "../../lib/sanity/content";
import { sendMail } from "@cougars/shared/email";

export const prerender = false;

// Works without JavaScript: a plain form POST gets a 303 redirect. The
// enhanced form on /join sends `Accept: application/json` and gets JSON back.
export const POST: APIRoute = async ({ request, redirect, clientAddress, locals }) => {
  const wantsJson = request.headers.get("accept")?.includes("application/json");
  const reply = (status: number, body: Record<string, unknown>, location: string) =>
    wantsJson ? Response.json(body, { status }) : redirect(location, 303);

  const form = await request.formData();
  if (isSpam(form)) return reply(200, { ok: true }, "/join/thanks");

  const { allowed } = await rateLimit(await caches.open("rate-limit"), "join", clientAddress ?? "unknown", {
    limit: 5,
    windowSeconds: 15 * 60,
  });
  if (!allowed)
    return reply(429, { ok: false, error: "Too many submissions, please try again later." }, "/join?error=rate");

  const parsed = parseEnquiry(form);
  if (!parsed.ok) return reply(400, { ok: false, errors: parsed.errors }, "/join?error=invalid");

  // The deploy's smoke test (lib/server/smoke.ts): the whole path, its emails to the sending account only, then gone
  if (isSmoke(request, smokeToken())) {
    const id = await saveEnquiry(env.DB, parsed.enquiry, { verified: true });
    try {
      const sent = await emailAfterEnquiry(parsed.enquiry, id, true, { smoke: true });
      console.log(JSON.stringify({ event: "enquiry.smoke", ...sent }));
      return Response.json({ ok: true, smoke: sent });
    } finally {
      await deleteEnquiry(env.DB, id);
    }
  }

  // A person, says Turnstile? Only they can get an auto-reply; everyone else's enquiry still counts.
  const verified = await verifyTurnstile(form.get(TURNSTILE_FIELD), turnstileSecret(), clientAddress);
  const id = await saveEnquiry(env.DB, parsed.enquiry, { verified });
  console.log(JSON.stringify({ event: "enquiry.created", id, source: parsed.enquiry.source, verified }));
  // Emails go out after the answer: the enquiry is already saved, so a failed email never loses it.
  locals.cfContext.waitUntil(emailAfterEnquiry(parsed.enquiry, id, verified));
  return reply(200, { ok: true }, "/join/thanks");
};

type Sent = "sent" | "logged" | "failed" | "skipped";

// The auto-reply first (if allowed), then the club's email, which says whether the person has heard back. Returns what
// happened to each, which the smoke test checks. A smoke test's both go to the sending account (smokeMailConfig).
async function emailAfterEnquiry(
  enquiry: Enquiry,
  id: number,
  verified: boolean,
  { smoke = false } = {},
): Promise<{ autoReply: Sent; club: Sent }> {
  const club = await clubInbox();
  const config = smoke ? smokeMailConfig(mailConfig(club)) : mailConfig(club);
  const sent: { autoReply: Sent; club: Sent } = { autoReply: "skipped", club: "skipped" };
  let autoReply = "No automatic reply was sent: the form wasn't verified as sent by a person.";
  if (verified && !smoke && !(await autoReplyAllowed(env.DB, enquiry.email))) {
    autoReply = "No automatic reply was sent: this address already had one this week, or today's limit was reached.";
  } else if (verified) {
    try {
      sent.autoReply = (await sendMail(autoReplyMail(enquiry, await getSettings(), club), config)).status;
      await markAutoReplied(env.DB, id);
      autoReply = "They've had the automatic reply with the session details.";
    } catch (error) {
      sent.autoReply = "failed";
      autoReply = "The automatic reply failed to send, so they haven't heard from us yet.";
      console.error(JSON.stringify({ event: "enquiry.auto_reply_failed", id, error: String(error) }));
    }
  }
  if (!club) {
    console.error(JSON.stringify({ event: "enquiry.no_club_inbox", id }));
    return { ...sent, club: "failed" };
  }
  try {
    const r = await sendMail(enquiryMail(enquiry, id, club, autoReply), config);
    sent.club = r.status;
    console.log(JSON.stringify({ event: "enquiry.emailed", id, status: r.status }));
  } catch (error) {
    sent.club = "failed";
    console.error(JSON.stringify({ event: "enquiry.email_failed", id, error: String(error) }));
  }
  return sent;
}
