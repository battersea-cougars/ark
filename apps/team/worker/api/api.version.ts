// "Has anything changed?" for the app's bootstrap (ADR 0053). The app reloads everything after each change and when it
// opens; most of those reloads find nothing new. The bootstrap carries an ETag, and the app asks again with it
// (If-None-Match, src/app/api.ts): if the club's data hasn't changed, the answer is an empty 304 after one row read,
// not the whole club read out of D1.
//
// The tag is the club's data version (data_version, one more on every change), who's asking (each member sees their
// own view, ADR 0036), the day (a view depends on it: what's upcoming, who's a Quarterly Member) and the deploy (a new
// build may send a different shape).
import { first, run } from "@cougars/shared/d1";
import { APP_BUILD, BUILD_HEADER } from "../../src/app/build";
import { clubTag, sameTag, VERSION_HEADER } from "../../src/app/club-tag";
import { json } from "./api.http";
import type { Ctx } from "./api.route";

// On your own machine, the Worker's code reloads on every change, and with it this
const STARTED = Date.now().toString(36);

/** The club's data version, and the London day the coming training sessions were last made (null: never). */
export async function dataVersion(db: D1Database): Promise<{ version: number; sessionsMadeOn: string | null }> {
  const row = await first<{ version: number; sessions_made_on: string | null }>(
    db,
    "SELECT version, sessions_made_on FROM data_version WHERE id = 1",
  );
  return { version: row?.version ?? 0, sessionsMadeOn: row?.sessions_made_on ?? null };
}

/** The coming training sessions are made for this day: later opens of the app skip making them. */
export async function sessionsMade(db: D1Database, today: string): Promise<void> {
  await run(
    db,
    `INSERT INTO data_version (id, version, sessions_made_on) VALUES (1, CAST(strftime('%s', 'now') AS INTEGER), ?)
     ON CONFLICT (id) DO UPDATE SET sessions_made_on = excluded.sessions_made_on`,
    [today],
  );
}

/** After a change: every member's bootstrap is out of date. The new version, which names this change (ADR 0072). */
export async function bumpDataVersion(db: D1Database): Promise<number> {
  const row = await first<{ version: number }>(
    db,
    `INSERT INTO data_version (id, version) VALUES (1, CAST(strftime('%s', 'now') AS INTEGER))
     ON CONFLICT (id) DO UPDATE SET version = version + 1 RETURNING version`,
  );
  return row?.version ?? 0;
}

/** The deploy: Cloudflare's version id, or (on your own machine) when this code was loaded. */
export const buildOf = (env: { TEAM_ENV?: string; CF_VERSION_METADATA?: { id: string } }) =>
  (env.TEAM_ENV !== "local" && env.CF_VERSION_METADATA?.id) || STARTED;

export const bootstrapTag = clubTag;

// Never kept by the browser (#81): the club's data, members' details included, would stay in its disk cache after
// signing out. The app keeps the tag in memory and asks with it itself, so a check is still a 304 when nothing's new
const NOT_KEPT = "private, no-store";

/** A reply with its tag, which the browser keeps and asks about next time, and the data version it's at. */
export function tagged(res: Response, tag: string, version: number): Response {
  res.headers.set("etag", tag);
  res.headers.set(VERSION_HEADER, String(version));
  res.headers.set("cache-control", NOT_KEPT);
  // Which build answered: an app left open sees a newer one is out and offers to reload (ADR 0104)
  res.headers.set(BUILD_HEADER, APP_BUILD);
  return res;
}

export const notModified = (tag: string, version: number) =>
  new Response(null, {
    status: 304,
    headers: { etag: tag, "cache-control": NOT_KEPT, [BUILD_HEADER]: APP_BUILD, [VERSION_HEADER]: String(version) },
  });

/** Whose club a reply is, as whom: an admin viewing as Sam isn't sent Sam's own copy, nor their own (ADR 0024). */
export const whoseClub = (c: Ctx) => (c.viewedBy == null ? String(c.memberId) : `${c.viewedBy}as${c.memberId}`);

/**
 * A read of part of the club on demand (a past tournament, a page of History; #175), tagged as the bootstrap is: at
 * the data version, for this member, today, from this deploy, and `what` it is (no dots). Asked again with its tag
 * while nothing's changed, an empty 304 after one row read; never kept by the browser, as the bootstrap isn't.
 */
export async function versionedRead(c: Ctx, what: string, read: () => Promise<unknown>): Promise<Response> {
  const { version } = await dataVersion(c.env.DB);
  const tag = bootstrapTag(buildOf(c.env), version, `${whoseClub(c)}~${what}`, c.today);
  if (sameTag(c.request.headers.get("if-none-match"), tag)) return notModified(tag, version);
  return tagged(json(await read()), tag, version);
}
