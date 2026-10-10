// The team app's JSON API: a table of contents. Each feature's routes live with it ({feature}.routes.ts, ADR 0105);
// this file mounts them and does what they share. Every route declares the action it needs (ADR 0024); a request is
// refused unless the signed-in member's roles grant it (manage:all grants everything). Anything not listed is a 404.
import { londonToday } from "../../src/lib/dates";
import { type Ctx, type Env, type Route } from "./api.route";
import { ACCESS, SCHEDULE, slices } from "./api.slices";
import { audit } from "../settings/audit";
import { handleAuth, localHere, sessionOf } from "../auth/auth";
import { CLUB_ROUTES } from "./bootstrap.routes";
import { ANNOUNCEMENTS_ROUTES } from "../announcements/announcements.routes";
import { DRAFT_ROUTES } from "../tournaments/draft.routes";
import { chargeAttendance, chargeQuarters } from "../dues/dues";
import { DUES_ROUTES } from "../dues/dues.routes";
import { ENTRIES_ROUTES } from "../entries/entries.routes";
import { EVENTS_ROUTES } from "../calendar/events.routes";
import { HttpError, json, sameOrigin } from "./api.http";
import { LIMITS, addressOf, enforce } from "./api.limits";
import { notifyLive } from "../live/live";
import { ME_ROUTES } from "../members/me.routes";
import { MEMBERS_ROUTES } from "../members/members.routes";
import { actionsOf, firstAdmin } from "../members/members";
import { ROLES_ROUTES } from "../members/roles.routes";
import { SCORING_ROUTES } from "../tournaments/scoring.routes";
import { SETTINGS_ROUTES } from "../settings/settings.routes";
import { TOURNAMENTS_ROUTES } from "../tournaments/tournaments.routes";
import { TRAINING_ROUTES } from "../training/training.routes";
import { bumpDataVersion } from "./api.version";
import { onTheWebsite, tournamentOfPath, wantRebuild } from "../website/website";

export type { Audit, Ctx, Env, Route } from "./api.route";
export type { Slice } from "./api.slices";

/**
 * Every route, by feature (ADR 0105). Each feature's file says what it covers; the wrapper below (handleApi) does what
 * they share: who's asking, the action check, the record, the parts a change sends back, and the live hub.
 */
export const ROUTES: Route[] = [
  // The club, read; you
  ...CLUB_ROUTES,
  ...ANNOUNCEMENTS_ROUTES,
  ...ME_ROUTES,
  // People: members and roles
  ...MEMBERS_ROUTES,
  ...ROLES_ROUTES,
  // Fridays: training nights, sign-ups, and what they cost
  ...TRAINING_ROUTES,
  ...ENTRIES_ROUTES,
  ...DUES_ROUTES,
  // The Kumite and other tournaments: editions, the draft, scoring games
  ...TOURNAMENTS_ROUTES,
  ...DRAFT_ROUTES,
  ...SCORING_ROUTES,
  // Everything else on the calendar, and the club's own settings
  ...EVENTS_ROUTES,
  ...SETTINGS_ROUTES,
];

/** Who's asking: their session, or (on your own machine, when asked for) the first admin. */
async function whoIs(request: Request, env: Env, now: Date): Promise<{ memberId: number; setCookie?: string } | null> {
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
    console.error(JSON.stringify({ event: "health.failed", error: String(e) }));
    return json({ ok: false }, 503);
  }
}

export async function handleApi(
  request: Request,
  env: Env,
  now = new Date(),
  waitUntil?: (p: Promise<unknown>) => void,
): Promise<Response> {
  const url = new URL(request.url);
  // Up means it can read the database: a deploy whose D1 binding is broken fails its smoke test (ADR 0010)
  if (url.pathname === "/api/health") return health(env);
  if (!sameOrigin(request)) return json({ error: "That came from somewhere else." }, 403);
  try {
    // A generous limit per address (ADR 0055); sign-in and changes have tighter ones of their own
    await enforce("api", addressOf(request), LIMITS.perAddress, "Too many requests from here. Wait a minute.");
  } catch (e) {
    if (e instanceof HttpError) return json({ error: e.message }, e.status);
    throw e;
  }
  if (url.pathname.startsWith("/api/auth/")) {
    try {
      return (await handleAuth(request, env, now, waitUntil)) ?? json({ error: "Not found." }, 404);
    } catch (e) {
      if (e instanceof HttpError) return json({ error: e.message }, e.status);
      console.error(e);
      return json({ error: "Something went wrong." }, 500);
    }
  }
  const match = ROUTES.map((r) => ({ r, m: url.pathname.match(r.path) })).filter((x) => x.m);
  const hit = match.find((x) => x.r.method === request.method);
  if (!hit) return json({ error: match.length ? "Method not allowed." : "Not found." }, match.length ? 405 : 404);
  try {
    const who = await whoIs(request, env, now);
    if (!who) return json({ error: "Sign in first." }, 401);
    const { memberId } = who;
    const writes = request.method !== "GET";
    if (writes)
      await enforce(
        "writes",
        String(memberId),
        LIMITS.writesPerMember,
        "That's a lot of changes at once. Wait a minute.",
      );
    const actions = await actionsOf(env.DB, memberId);
    const { action } = hit.r;
    if (action !== "authenticated" && !actions.has("manage:all") && !actions.has(action)) {
      // Refused for want of an action: on the record (ADR 0024), so poking at admin routes is seen
      await audit(env.DB, now, memberId, "refused", { method: request.method, path: url.pathname, action });
      return json({ error: "Your role can't do that." }, 403);
    }
    const ctx: Ctx = {
      env,
      request,
      params: hit.m!.slice(1),
      memberId,
      actions,
      today: londonToday(now),
      now: now.toISOString(),
    };
    // On the record (ADR 0095): what the change is to, before it
    const record = writes && hit.r.audit ? hit.r.audit : null;
    const before = record ? await record.subject(ctx) : undefined;
    // A finished tournament's result is on the website's pages (ADR 0100): a change to it, or one that finishes it,
    // wants a rebuild. Read before too, so deleting one or making it private counts.
    const tournament = writes ? tournamentOfPath(url.pathname) : null;
    const wasOnWebsite = tournament ? await onTheWebsite(env.DB, tournament) : false;
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
      await chargeAttendance(env.DB, ctx.today, ctx.now);
      await chargeQuarters(env.DB, ctx.today, ctx.now);
    }
    if (writes && res.ok) {
      // A change: every member's bootstrap is out of date (ADR 0053)
      await bumpDataVersion(env.DB);
      // ...and this member gets the parts it touched back, to put in place
      const declared = hit.r.changes ?? [];
      const changes = declared.some((d) => SCHEDULE.includes(d)) ? [...declared, "agenda" as const] : declared;
      // ...and everyone on a live page hears which parts (ADR 0072), once this reply is on its way
      const told = notifyLive(env, changes);
      if (waitUntil) waitUntil(told);
      else await told;
      if (changes.length) {
        const now = changes.some((s) => ACCESS.includes(s))
          ? { ...ctx, actions: await actionsOf(env.DB, memberId) }
          : ctx;
        const reply = (await res.json().catch(() => ({}))) as Record<string, unknown>;
        const out = json({ ...reply, changed: await slices(now, changes) }, res.status);
        if (who.setCookie) out.headers.append("set-cookie", who.setCookie);
        return out;
      }
    }
    // A session in use is renewed now and then
    if (who.setCookie) res.headers.append("set-cookie", who.setCookie);
    return res;
  } catch (e) {
    if (e instanceof HttpError) return json({ error: e.message }, e.status);
    console.error(e);
    return json({ error: "Something went wrong." }, 500);
  }
}
