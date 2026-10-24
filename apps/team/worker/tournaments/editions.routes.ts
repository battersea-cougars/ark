// A series' editions, read when they're wanted (#175, ADR 0074): a past one in full when its page opens, History a
// page at a time, all-time leaders, and each team's logo at an address of its own. Each read as the club read is,
// for this member (view-as too), tagged by the data version so asking again unchanged is an empty 304.
import { id, type Ctx, type Route } from "../api/api.route";
import { versionedRead } from "../api/api.version";
import { allTimeLeaders, editionOf, logoOf, pageOf, pastEditions, tournamentWith } from "./editions";
import { pastMeetings } from "./matchups";
import { broughtTeams } from "./team-name";
import { HttpError, isDay } from "../api/api.http";

/** That tournament in full, or a 404. */
async function edition(c: Ctx, tournamentId: number | null) {
  const tournament = tournamentId === null ? null : await editionOf(c, tournamentId);
  if (!tournament) throw new HttpError(404, "No such tournament.");
  return { tournament };
}

/** A page of the played ones: one series', or every series' (`typeId` null). */
function history(c: Ctx, typeId: number | null) {
  const { before, limit } = pageOf(new URL(c.request.url));
  const what = `editions${typeId ?? ""}_${before ? `${before.heldOn}_${before.id}` : ""}_${limit}`;
  return versionedRead(c, what, () => pastEditions(c.env.DB, { typeId, before, limit }));
}

// A year: a logo's address names its version, so a new logo is a new address
const KEPT_FOR_GOOD = "private, max-age=31536000, immutable";

export const EDITIONS_ROUTES: Route[] = [
  {
    method: "GET",
    path: /^\/api\/tournaments\/editions$/,
    action: "read:Event",
    // Every series' played ones, for Settings → Tournaments' schedule
    handle: (c) => history(c, null),
  },
  {
    method: "GET",
    path: /^\/api\/tournaments\/(\d+)$/,
    action: "read:Event",
    handle: (c) => versionedRead(c, `t${id(c)}`, () => edition(c, id(c))),
  },
  {
    method: "GET",
    path: /^\/api\/tournament-games\/(\d+)\/tournament$/,
    action: "read:Event",
    handle: async (c) =>
      versionedRead(c, `g${id(c)}`, async () => edition(c, await tournamentWith(c.env.DB, "game", id(c)))),
  },
  {
    method: "GET",
    path: /^\/api\/tournament-teams\/(\d+)\/tournament$/,
    action: "read:Event",
    handle: async (c) =>
      versionedRead(c, `k${id(c)}`, async () => edition(c, await tournamentWith(c.env.DB, "team", id(c)))),
  },
  {
    method: "GET",
    path: /^\/api\/tournament-types\/(\d+)\/editions$/,
    action: "read:Event",
    handle: (c) => history(c, id(c)),
  },
  {
    method: "GET",
    path: /^\/api\/tournament-games\/(\d+)\/meetings$/,
    action: "read:Event",
    // When this game's captains' sides last met, in past ones of its series (#177)
    handle: (c) => versionedRead(c, `meet${id(c)}`, async () => ({ editions: await pastMeetings(c.env.DB, id(c)) })),
  },
  {
    method: "GET",
    path: /^\/api\/tournament-types\/(\d+)\/brings$/,
    action: "read:Event",
    // What each captain brings to an edition on `heldOn` (none yet: after every other), `tournament` once it's saved
    // (#177): the tournament editor's "Brings" before the team's made
    handle: (c) => {
      const url = new URL(c.request.url);
      const heldOn = url.searchParams.get("heldOn") || null;
      const saved = url.searchParams.get("tournament");
      if (heldOn !== null && !isDay(heldOn)) throw new HttpError(400, "heldOn should be a day, like 2026-10-02.");
      if (saved !== null && !/^\d+$/.test(saved)) throw new HttpError(400, "tournament should be an id.");
      const tournament = saved === null ? null : Number(saved);
      return versionedRead(c, `brings${id(c)}_${heldOn ?? ""}_${tournament ?? ""}`, async () => ({
        brings: await broughtTeams(c.env.DB, id(c), heldOn, tournament),
      }));
    },
  },
  {
    method: "GET",
    path: /^\/api\/tournament-types\/(\d+)\/leaders$/,
    action: "read:Event",
    handle: (c) =>
      versionedRead(c, `leaders${id(c)}`, async () => ({ leaders: await allTimeLeaders(c.env.DB, id(c)) })),
  },
  {
    method: "GET",
    path: /^\/api\/tournament-teams\/(\d+)\/logo$/,
    action: "read:Event",
    // The image itself, kept by the browser: the club read sends only its address (tournaments.ts logoAddress)
    handle: async (c) => {
      const logo = await logoOf(c.env.DB, id(c));
      if (!logo) throw new HttpError(404, "No logo.");
      const headers = { etag: `"${logo.version}"`, "cache-control": KEPT_FOR_GOOD };
      if (c.request.headers.get("if-none-match")?.replace(/^W\//, "") === headers.etag)
        return new Response(null, { status: 304, headers });
      return new Response(logo.bytes, { headers: { ...headers, "content-type": logo.type } });
    },
  },
];
