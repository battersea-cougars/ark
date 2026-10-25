// "Has anything changed?" for the app's bootstrap (ADR 0053). The app reloads everything after each change and when it
// opens; most of those reloads find nothing new. The bootstrap carries an ETag, and the app asks again with it
// (If-None-Match, src/app/api.ts): if the club's data hasn't changed, the answer is an empty 304 after one row read,
// not the whole club read out of D1.
//
// The tag is the club's data version (data_version, one more on every change), who's asking (each member sees their
// own view, ADR 0036), the day (a view depends on it: what's upcoming, who's a Quarterly Member) and the deploy (a new
// build may send a different shape).
import { first, run } from "@cougars/shared/d1";
import { londonEvening } from "@cougars/shared/london";
import { APP_BUILD, BUILD_HEADER } from "../../src/app/build";
import { clubTag, sameTag, VERSION_HEADER } from "../../src/app/club-tag";
import { json } from "./api.http";
import type { Ctx } from "./api.route";

// On your own machine, the Worker's code reloads on every change, and with it this
const STARTED = Date.now().toString(36);

/** The club's data version, and what's kept beside it: the day sessions were made, and each part's version (#178). */
export interface DataVersion {
  version: number;
  /** The London day the coming training sessions were last made (null: never). */
  sessionsMadeOn: string | null;
  /** The version each family of parts last changed at through the app (src/app/club-parts.ts). */
  parts: Record<string, number>;
  /** The last version a change that didn't say what it changed made: every part is at least this new. */
  untold: number;
}

/** The club's data version, the day the coming sessions were made, and each part's version: one row read. */
export async function dataVersion(db: D1Database): Promise<DataVersion> {
  const row = await first<{ version: number; sessions_made_on: string | null; parts: string; untold: number }>(
    db,
    "SELECT version, sessions_made_on, parts, untold FROM data_version WHERE id = 1",
  );
  return {
    version: row?.version ?? 0,
    sessionsMadeOn: row?.sessions_made_on ?? null,
    parts: JSON.parse(row?.parts ?? "{}"),
    untold: row?.untold ?? 0,
  };
}

/** How new what these families are made of is: the last change to any of them, or to anything unsaid. */
export const versionOf = (at: DataVersion, families: readonly string[]) =>
  Math.max(at.untold, ...families.map((f) => at.parts[f] ?? 0));

/**
 * The coming training sessions are made for this day: later opens of the app skip making them. The version moves on
 * with it, unsaid, so nothing read before the day's sessions were made is taken for what's there now (#178).
 */
export async function sessionsMade(db: D1Database, today: string): Promise<void> {
  await run(
    db,
    `INSERT INTO data_version (id, version, sessions_made_on) VALUES (1, CAST(strftime('%s', 'now') AS INTEGER), ?)
     ON CONFLICT (id) DO UPDATE SET sessions_made_on = excluded.sessions_made_on, version = version + 1`,
    [today],
  );
}

/**
 * After a change through the app: every member's bootstrap is out of date. The new version, which names this change
 * (ADR 0072), and is now the version of each family it `told` it changed (#178), with the rest of the row. Anything
 * else that moves the version on (a script, the hourly run, `told` left out) makes every part new (the schema's
 * data_version_untold), as the reply says too.
 */
export async function bumpDataVersion(db: D1Database, told?: readonly string[]): Promise<DataVersion> {
  const parts = told?.length ? `, parts = json_set(parts, ${told.map(() => "?, version + 1").join(", ")})` : "";
  const row = await first<{ version: number; sessions_made_on: string | null; parts: string; untold: number }>(
    db,
    `INSERT INTO data_version (id, version) VALUES (1, CAST(strftime('%s', 'now') AS INTEGER))
     ON CONFLICT (id) DO UPDATE SET version = version + 1${told ? ", told = version + 1" : ""}${parts}
     RETURNING version, sessions_made_on, parts, untold`,
    (told ?? []).map((family) => `$.${family}`),
  );
  const version = row?.version ?? 0;
  return {
    version,
    sessionsMadeOn: row?.sessions_made_on ?? null,
    parts: JSON.parse(row?.parts ?? "{}"),
    // Told nothing (or a first row): the trigger makes it every part's
    untold: told ? (row?.untold ?? 0) : version,
  };
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

/**
 * The day a reply is for, as its tag says it: London's day, and London's evening (till 06:00, the night before), since
 * at 06:00 the night just held moves from Home's next nights to the weeks just held, with nothing changed (#178).
 */
export const dayOf = (c: Ctx) => {
  const evening = londonEvening(new Date(c.now));
  return evening === c.today ? c.today : `${c.today}~${evening}`;
};

/** Whose club a reply is, as whom: an admin viewing as Sam isn't sent Sam's own copy, nor their own (ADR 0024). */
export const whoseClub = (c: Ctx) => (c.viewedBy == null ? String(c.memberId) : `${c.viewedBy}as${c.memberId}`);

/**
 * A read of part of the club on demand (a past tournament, a page of History; #175), tagged as the bootstrap is: at
 * the data version, for this member, today, from this deploy, and `what` it is (no dots). Asked again with its tag
 * while nothing's changed, an empty 304 after one row read; never kept by the browser, as the bootstrap isn't.
 */
export async function versionedRead(c: Ctx, what: string, read: () => Promise<unknown>): Promise<Response> {
  const { version } = await dataVersion(c.env.DB);
  const tag = bootstrapTag(buildOf(c.env), version, `${whoseClub(c)}~${what}`, dayOf(c));
  if (sameTag(c.request.headers.get("if-none-match"), tag)) return notModified(tag, version);
  return tagged(json(await read()), tag, version);
}
