// The club, read: the bootstrap (everything the app shows, ADR 0053), the live stream of what changed (ADR 0072), and
// the parts a change named, for a live page to catch up on without reading the whole club (#112).
import { type Route } from "./api.route";
import { SLICES, slices, type Slice } from "./api.slices";
import { devToolsHere } from "../settings/devtools";
import { simulatorHere } from "../tournaments/simulate";
import { chargeDue } from "../dues/dues";
import { HttpError, json } from "./api.http";
import { sameTag } from "../../src/app/club-tag";
import { liveStream } from "../live/live";
import { ensureSessions } from "../training/training";
import { bootstrapTag, buildOf, dataVersion, notModified, sessionsMade, tagged, whoseClub } from "./api.version";

export const CLUB_ROUTES: Route[] = [
  {
    method: "GET",
    path: /^\/api\/live$/,
    action: "authenticated",
    // Changes as they happen, as a stream (ADR 0072): only the names of the parts that changed, from the live hub
    // Each closed when its sign-in ends (#72): the signed-in member's, whoever they're viewing as (ADR 0024)
    handle: async (c) => liveStream(c.env, { memberId: c.viewedBy ?? c.memberId, sessionId: c.sessionId }),
  },
  {
    method: "GET",
    path: /^\/api\/bootstrap$/,
    action: "authenticated",
    // Everything the app shows, in one go: it's a small club. Or a 304 when nothing's changed (ADR 0053).
    handle: async (c) => {
      const db = c.env.DB;
      // The coming training sessions, on the day's first open; the rest of the day's opens skip it. First, so the
      // tag is the club as this reply shows it.
      const today = await dataVersion(db);
      let { version } = today;
      if (today.sessionsMadeOn !== c.today) {
        await ensureSessions(db, c.today);
        // ...and whatever the new day makes due (ADR 0007), in case the hourly check hasn't run yet
        await chargeDue(c.env, new Date(c.now));
        await sessionsMade(db, c.today);
        ({ version } = await dataVersion(db));
      }
      const tag = bootstrapTag(buildOf(c.env), version, whoseClub(c), c.today);
      if (sameTag(c.request.headers.get("if-none-match"), tag)) return notModified(tag, version);
      const reply = json({
        // Who you are, and who the app is showing (ADR 0024): the member you're viewing as, with their actions
        me: c.viewedBy ?? c.memberId,
        viewingAs: c.viewedBy == null ? null : c.memberId,
        actions: [...c.actions],
        // Dev tools (ADR 0027): outside production, for whoever sets the club's settings
        devTools: devToolsHere(c.env) && (c.actions.has("manage:all") || c.actions.has("manage:Settings")),
        // Screens on demo data (Upload): on dev and locally to try, never in production (#63)
        unfinished: devToolsHere(c.env),
        // The Kumite simulator (ADR 0123): on dev and your own machine only, for whoever runs tournaments
        simulator: simulatorHere(c.env) && (c.actions.has("manage:all") || c.actions.has("manage:Tournament")),
        ...(await slices(c, Object.keys(SLICES) as Slice[])),
      });
      return tagged(reply, tag, version);
    },
  },
  {
    method: "GET",
    path: /^\/api\/slices$/,
    action: "authenticated",
    // Just these parts (`?names=sessions,agenda`), as this member may see them, and the data version they're at
    // least as new as: what a live page reads when the hub names them (ADR 0072). The version is read first, so
    // every change up to it is in what follows.
    handle: async (c) => {
      const names = (new URL(c.request.url).searchParams.get("names") ?? "").split(",").filter(Boolean);
      if (!names.length || !names.every((n) => Object.hasOwn(SLICES, n)))
        throw new HttpError(400, "Which parts of the club?");
      const { version } = await dataVersion(c.env.DB);
      const reply = json({ version, slices: await slices(c, names as Slice[]) });
      reply.headers.set("cache-control", "no-store");
      return reply;
    },
  },
];
