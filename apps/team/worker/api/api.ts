// The team app's JSON API: a table of contents. Each feature's routes live with it ({feature}.routes.ts, ADR 0105);
// this file mounts them and does what they share. Every route declares the action it needs (ADR 0024); a request is
// refused unless the signed-in member's roles grant it (manage:all grants everything). Anything not listed is a 404.
import { londonToday } from "../../src/lib/dates";
import { type Ctx, type Env, type Route } from "./api.route";
import { ACCESS, SCHEDULE, slices } from "./api.slices";
import { audit, auditRefused } from "../settings/audit";
import { carriesSession, localHere, sessionOf } from "../auth/auth";
import { devClock } from "./api.dev-clock";
import { handleAuth } from "../auth/auth.routes";
import { CLUB_ROUTES } from "./bootstrap.routes";
import { ANNOUNCEMENTS_ROUTES } from "../announcements/announcements.routes";
import { DRAFT_ROUTES } from "../tournaments/draft.routes";
import { recharge } from "../dues/dues";
import { DUES_ROUTES } from "../dues/dues.routes";
import { REMINDERS_ROUTES } from "../dues/reminders.routes";
import { ENTRIES_ROUTES } from "../entries/entries.routes";
import { EVENTS_ROUTES } from "../calendar/events.routes";
import { HttpError, json, sameOrigin, withinLimit } from "./api.http";
import { LIMITS, addressOf, enforce } from "./api.limits";
import { notifyLive } from "../live/live";
import { pushedWith } from "../live/live.parts";
import { MAIL_ROUTES } from "../mail/mail.routes";
import { ME_ROUTES } from "../members/me.routes";
import { MEMBERS_ROUTES } from "../members/members.routes";
import { PASSKEY_ROUTES } from "../auth/auth.passkeys.routes";
import { BREAK_GLASS_ROUTES } from "../auth/auth.break-glass.routes";
import { actionsOf, firstAdmin } from "../members/members";
import { ROLES_ROUTES } from "../members/roles.routes";
import { SCORING_ROUTES } from "../tournaments/scoring.routes";
import { SETTINGS_ROUTES } from "../settings/settings.routes";
import { PAST_ROUTES } from "../tournaments/past.routes";
import { SIMULATE_ROUTES } from "../tournaments/simulate.routes";
import { TOURNAMENTS_ROUTES } from "../tournaments/tournaments.routes";
import { TRAINING_ROUTES } from "../training/training.routes";
import { notify } from "../push/push";
import { PUSH_ROUTES } from "../push/push.routes";
import { bumpDataVersion } from "./api.version";
import { VERSION_HEADER } from "../../src/app/club-tag";
import { onTheWebsite, tournamentOfPath, wantRebuild } from "../website/website";
import { scribe } from "@cougars/shared/scribe";
import { sentryTunnel } from "@cougars/shared/sentry-tunnel";

const log = scribe.logger("api");

export type { Env, Route } from "./api.route";

/**
 * Every route, by feature (ADR 0105). Each feature's file says what it covers; the wrapper below (handleApi) does what
 * they share: who's asking, the action check, the record, the parts a change sends back, and the live hub.
 */
export const ROUTES: Route[] = [
  // The club, read; you (and what your phone tells you)
  ...CLUB_ROUTES,
  ...ANNOUNCEMENTS_ROUTES,
  ...ME_ROUTES,
  ...PUSH_ROUTES,
  // People: members and roles
  ...MEMBERS_ROUTES,
  ...ROLES_ROUTES,
  // Ways in: a member's passkeys from their sheet, and the week's break-glass sign-ins (ADR 0023)
  ...PASSKEY_ROUTES,
  ...BREAK_GLASS_ROUTES,
  // Fridays: training nights, sign-ups, and what they cost
  ...TRAINING_ROUTES,
  ...ENTRIES_ROUTES,
  ...DUES_ROUTES,
  ...REMINDERS_ROUTES,
  // The Kumite and other tournaments: editions, the draft, scoring games
  ...TOURNAMENTS_ROUTES,
  ...DRAFT_ROUTES,
  ...SCORING_ROUTES,
  // A Kumite from before the app, recorded after the fact (ADR 0126)
  ...PAST_ROUTES,
  // Dev only (ADR 0123): the Kumite played on to its after-party
  ...SIMULATE_ROUTES,
  // Everything else on the calendar, and the club's own settings
  ...EVENTS_ROUTES,
  ...SETTINGS_ROUTES,
  ...MAIL_ROUTES,
];

/** Who's asking: their session, or (on your own machine, when asked for) the first admin. */
async function whoIs(
  request: Request,
  env: Env,
  now: Date,
): Promise<{ memberId: number; sessionId?: number; setCookie?: string } | null> {
  const session = await sessionOf(request, env, now);
  if (session) return session;
  // Only on a private address (ADR 0023): a build that said "local" by mistake still opens to nobody
  if (localHere(env, request) && env.TEAM_AUTO_ADMIN === "1") {
    const memberId = await firstAdmin(env.DB);
    return memberId == null ? null : { memberId };
  }
  return null;
}

async function health(env: Env): Promise<Response> {
  try {
    await env.DB.prepare("SELECT 1").first();
    return json({ ok: true });
  } catch (e) {
    log.error("health.failed", e);
    return json({ ok: false }, 503);
  }
}

const FROM_HERE = "Too many requests from here. Wait a minute.";

/** What sign-in's routes and the app's error reports may send: a form, a Sentry envelope (#73). */
const MAX_AUTH_BODY = 16 * 1024;
const MAX_ERRORS_BODY = 256 * 1024;

export async function handleApi(
  sent: Request,
  env: Env,
  now = new Date(),
  waitUntil?: (p: Promise<unknown>) => void,
): Promise<Response> {
  let request = sent;
  const url = new URL(request.url);
  // Up means it can read the database: a deploy whose D1 binding is broken fails its smoke test (ADR 0010)
  if (url.pathname === "/api/health") return health(env);
  if (!sameOrigin(request)) return json({ error: "That came from somewhere else." }, 403);
  // A route that's only on some Workers (a dev-only tool) isn't there at all on the rest: a 404
  const match = ROUTES.filter((r) => !r.only || r.only(env))
    .map((r) => ({ r, m: url.pathname.match(r.path) }))
    .filter((x) => x.m);
  const hit = match.find((x) => x.r.method === request.method);
  // Generous limits (ADR 0055); sign-in and changes have tighter ones of their own. Someone not signed in is counted
  // by their address; a member as themselves, as a squad on the rink's wifi shares one address (#113)
  const address = addressOf(request);
  // A request with a session cookie is counted apart from the strangers', so one device using their allowance up
  // (sign-in, error reports, pages that aren't there) never turns away the signed-in phones on its wifi; a cookie
  // that's nobody's spends an allowance of its own
  const withSession = carriesSession(request);
  const unknown = withSession
    ? (spend = true) => enforce("api-unknown-session", address, LIMITS.unknownSessions, FROM_HERE, spend)
    : (spend = true) => enforce("api", address, LIMITS.perAddress, FROM_HERE, spend);
  try {
    // A ceiling over everyone on one address, first
    await enforce("api-address", address, LIMITS.addressCeiling, FROM_HERE);
    // Sign-in, the app's error reports and a route that isn't there have no member to count by. Anything else is
    // counted once it's known who's asking, but an address already over its allowance for unknown sessions gets no
    // further: a made-up session is never looked up
    const errors = url.pathname === "/api/errors";
    const signingIn = url.pathname.startsWith("/api/auth/");
    if (errors || signingIn || !hit) await enforce("api", address, LIMITS.perAddress, FROM_HERE);
    else await unknown(false);
    // A body over its route's limit is refused before anything reads it, signed in or not (#73)
    const max = errors ? MAX_ERRORS_BODY : signingIn ? MAX_AUTH_BODY : hit?.r.maxBody;
    request = await withinLimit(request, max);
  } catch (e) {
    if (e instanceof HttpError) return json({ error: e.message }, e.status);
    throw e;
  }
  // The app's own errors on their way to Sentry (ADR 0111), signed in or not: an error at sign-in counts too
  if (url.pathname === "/api/errors") return sentryTunnel(request, env.SENTRY_DSN);
  if (url.pathname.startsWith("/api/auth/")) {
    try {
      return (await handleAuth(request, env, now, waitUntil)) ?? json({ error: "Not found." }, 404);
    } catch (e) {
      if (e instanceof HttpError) return json({ error: e.message }, e.status);
      log.error("request.failed", e, { method: request.method, path: url.pathname });
      return json({ error: "Something went wrong." }, 500);
    }
  }
  if (!hit) return json({ error: match.length ? "Method not allowed." : "Not found." }, match.length ? 405 : 404);
  // Who's signed in is the real clock's, whatever a journey says (below)
  const signedInAt = now;
  // Who it was, for the log if it fails: their number only, never their name or email (ADR 0110)
  let member: number | undefined;
  // A renewed session's cookie goes back on a refusal too, or the member is signed out once the old one's grace ends
  let renewal: string | undefined;
  try {
    const who = await whoIs(request, env, signedInAt);
    if (!who) {
      await unknown();
      return json({ error: "Sign in first." }, 401);
    }
    const { memberId } = who;
    member = memberId;
    renewal = who.setCookie;
    await enforce("member", String(memberId), LIMITS.perMember, "That's a lot of requests at once. Wait a minute.");
    const writes = request.method !== "GET";
    if (writes)
      await enforce(
        "writes",
        String(memberId),
        LIMITS.writesPerMember,
        "That's a lot of changes at once. Wait a minute.",
      );
    const actions = await actionsOf(env.DB, memberId);
    // A journey may move the club's clock, on dev (an admin) or your own machine only (api.dev-clock.ts)
    now = devClock(request, env, actions) ?? now;
    const { action } = hit.r;
    if (action !== "authenticated" && !actions.has("manage:all") && !actions.has(action)) {
      // Refused for want of an action: on the record (ADR 0024), so poking at admin routes is seen, once a minute at
      // most per member (#73); every one is in the log
      await auditRefused(env.DB, now, memberId, { method: request.method, path: url.pathname, action });
      return json({ error: "Your role can't do that." }, 403);
    }
    const ctx: Ctx = {
      env,
      request,
      params: hit.m!.slice(1),
      memberId,
      sessionId: who.sessionId ?? null,
      actions,
      today: londonToday(now),
      now: now.toISOString(),
      waitUntil,
    };
    // On the record (ADR 0095): what the change is to, before it
    const record = writes && hit.r.audit && "event" in hit.r.audit ? hit.r.audit : null;
    const before = record ? await record.subject(ctx) : undefined;
    // A finished tournament's result is on the website's pages (ADR 0100): a change to it, or one that finishes it,
    // wants a rebuild. Read before too, so deleting one or making it private counts.
    const tournament = writes ? tournamentOfPath(url.pathname) : null;
    const wasOnWebsite = tournament ? await onTheWebsite(env.DB, tournament) : false;
    // News for members' phones (ADR 0108): what it's compared with, before the change
    const notice = writes ? hit.r.notify : undefined;
    const noticeBefore = notice?.before ? await notice.before(ctx) : undefined;
    const res = await hit.r.handle(ctx);
    if (record && res.ok) {
      const reply = (await res
        .clone()
        .json()
        .catch(() => ({}))) as Record<string, unknown>;
      const after = await record.subject(ctx, reply);
      if (JSON.stringify(before ?? null) !== JSON.stringify(after ?? null))
        await audit(env.DB, now, memberId, record.event, {
          ...record.about?.(ctx, reply),
          from: before ?? null,
          to: after ?? null,
        });
    }
    if (tournament && res.ok && (wasOnWebsite || (await onTheWebsite(env.DB, tournament))))
      await wantRebuild(env.DB, now);
    if (writes && res.ok && hit.r.changes?.includes("charges")) {
      // Who came, a fee or a quarterly membership changed: so may what people owe (ADR 0007)
      await recharge(env.DB, ctx.today, ctx.now);
    }
    if (notice && res.ok) {
      const reply = (await res
        .clone()
        .json()
        .catch(() => ({}))) as Record<string, unknown>;
      const told = notice
        .after(ctx, noticeBefore, reply)
        .then((notices) => notify(env, notices, now))
        // News never fails the change it's about
        .catch((e) => log.error("push.failed", e));
      if (waitUntil) waitUntil(told);
      else await told;
    }
    if (writes && res.ok) {
      // A change: every member's bootstrap is out of date (ADR 0053)
      const version = await bumpDataVersion(env.DB);
      // ...and this member gets the parts it touched back, to put in place
      const declared = hit.r.changes ?? [];
      const calendar = hit.r.calendar !== false && declared.some((d) => SCHEDULE.includes(d));
      const changes = calendar ? [...declared, "agenda" as const] : declared;
      // ...and everyone on a live page hears which parts, and the version (ADR 0072), with a live match as it is
      // (#161), once this reply is on its way
      const told = pushedWith(ctx, hit.r, changes).then((pushed) => notifyLive(env, changes, version, pushed));
      if (waitUntil) waitUntil(told);
      else await told;
      if (changes.length) {
        const now = changes.some((s) => ACCESS.includes(s))
          ? { ...ctx, actions: await actionsOf(env.DB, memberId) }
          : ctx;
        const reply = (await res.json().catch(() => ({}))) as Record<string, unknown>;
        const out = json({ ...reply, changed: await slices(now, changes) }, res.status);
        // Read after the version went up: the app's copy has this change's parts at least as new (src/app/catch-up.ts)
        out.headers.set(VERSION_HEADER, String(version));
        // ...keeping any cookie the handler set (a Gmail reconnect's round trip, mail/mail.ts)
        for (const set of res.headers.getSetCookie()) out.headers.append("set-cookie", set);
        if (who.setCookie) out.headers.append("set-cookie", who.setCookie);
        return out;
      }
    }
    // A session in use is renewed now and then, with a new token. A reply from elsewhere (the live hub's stream) has
    // headers that can't change, so it's copied first
    if (!who.setCookie) return res;
    const renewed = new Response(res.body, res);
    renewed.headers.append("set-cookie", who.setCookie);
    return renewed;
  } catch (e) {
    if (e instanceof HttpError) {
      const refused = json({ error: e.message }, e.status);
      if (renewal) refused.headers.append("set-cookie", renewal);
      return refused;
    }
    log.error("request.failed", e, { method: request.method, path: url.pathname, route: hit.r.path.source, member });
    return json({ error: "Something went wrong." }, 500);
  }
}
