// A member's phone with a live page open, for the live use cases (ADR 0072): the app's own copy of the club
// (src/app/catch-up.ts) reading through the real Worker, its stream from the real hub, and a live match the hub
// pushes put in place as the app does (#161).
import { ClubCopy, withMatch } from "../../src/app/catch-up";
import { atVersion } from "../../src/app/club-tag";
import type { testWorld } from "../testing";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Json = any;

export type LivePhone = Awaited<ReturnType<typeof phoneOn>>;

/**
 * A member's phone with a live page open that follows `parts`: its copy of the club, what it asked the Worker for,
 * every event its stream brought, and whether the page is in view. `stop` when the test is done.
 */
export async function phoneOn(w: ReturnType<typeof testWorld>, email: string, parts: readonly string[]) {
  const b = await w.listening(email);
  let club: Json = null;
  let tag: string | null = null;
  let inView = true;
  const asked: string[] = [];
  const events: Json[] = [];
  const whole = async () => {
    const r = await b.club({
      headers: tag ? { "if-none-match": atVersion(tag, copy.held) } : {},
    });
    asked.push(r.status === 304 ? "whole: unchanged" : "whole");
    if (r.status !== 200) return;
    club = r.body;
    tag = r.headers.get("etag");
    copy.wholeAt(Number(r.headers.get("x-club-version")));
  };
  const copy: ClubCopy = new ClubCopy({
    readParts: async (names) => {
      asked.push(`parts: ${names.join(", ")}`);
      const r = await b.call("GET", `/api/slices?names=${names.join(",")}`);
      if (r.status !== 200) throw new Error(`${r.status}`);
      return r.body;
    },
    readWhole: whole,
    apply: (slices) => (club = { ...club, ...slices }),
    applyMatch: (match) => {
      const tournaments = withMatch(club?.tournaments, match);
      if (tournaments) club = { ...club, tournaments };
      return Boolean(tournaments);
    },
    visible: () => inView,
    waitMs: 100,
  });
  await whole();
  copy.follow(parts);
  // The stream: every event to the copy
  let streaming = true;
  const pump = (async () => {
    while (streaming) {
      const e = await b.next().catch(() => null);
      if (!e) return;
      if (e.event !== "changed") continue;
      events.push(e.data);
      copy.hear(e.data);
    }
  })();
  return {
    email,
    copy,
    asked,
    events,
    club: () => club,
    whole,
    hide: () => (inView = false),
    /** A change from this phone: its reply's parts go in place, as the app's `save` does. */
    change: async (method: string, path: string, payload?: unknown) => {
      const r = await b.call(method, path, payload);
      const v = r.headers.get("x-club-version");
      if (r.status < 300 && r.body.changed && v) Object.assign(club, copy.partsAt(Number(v), r.body.changed));
      return r;
    },
    stop: async () => {
      streaming = false;
      copy.stop();
      await b.close();
      await pump;
    },
  };
}
