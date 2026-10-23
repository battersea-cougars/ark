// The apps' recent errors (ADR 0111): an admin opens Settings → Errors and sees each project's open issues in Sentry,
// for this environment, newest first, with how often, when last, where, and a link to each. Sentry is asked at most
// every few minutes, whoever opens it; when it's down the page says so calmly and keeps the last answer. Members
// can't see it. Sentry's API is faked; everything else is real.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { captureLogs } from "@cougars/shared/testing/scribe";
import { NOW, minutes, testWorld } from "../testing";
import { ERRORS_FRESH_MS } from "./errors";

const ROSTER = [
  { name: "Dana Admin", position: "D", rating: 75, email: "dana@example.com", roles: ["Admin"] },
  { name: "Reg Player", position: "F", rating: 60, email: "reg@example.com" },
];

let w: ReturnType<typeof testWorld>;
let sentry: ReturnType<ReturnType<typeof testWorld>["sentry"]>;

beforeEach(() => {
  vi.unstubAllGlobals();
  w = testWorld(ROSTER);
  sentry = w.sentry();
});

const errorsAs = async (email: string, now = NOW) =>
  (await w.signedIn(email)).call("GET", "/api/sentry/issues", undefined, { now });

describe("an admin looks at what's gone wrong lately", () => {
  it("sees each app's open issues in this environment, newest first: what, how often, when last, where, and a link", async () => {
    sentry.issues.team.push(
      sentry.issue({
        title: "TypeError: Cannot read properties of undefined (reading 'teams')",
        culprit: "POST /api/tournaments/:id/draft/picks",
        count: "12",
        userCount: 3,
        lastSeen: minutes(-90).toISOString(),
      }),
      sentry.issue({ title: "live.notify.failed", culprit: "notifyLive", lastSeen: minutes(-5).toISOString() }),
      sentry.issue({ title: "Fixed already", status: "resolved" }),
      sentry.issue({ title: "Only in production", environment: "production" }),
    );
    sentry.issues.web.push(sentry.issue({ title: "content.sanity_error", culprit: "/whats-on", count: "2" }));

    const res = await errorsAs("dana@example.com");

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ configured: true, environment: "dev", readAt: NOW.toISOString() });
    expect(res.body.unavailable).toBeUndefined();
    const [team, web] = res.body.projects;
    expect(team).toMatchObject({ slug: "team", name: "Team app", more: false });
    expect(team.issues.map((i: { title: string }) => i.title)).toEqual([
      "live.notify.failed",
      "TypeError: Cannot read properties of undefined (reading 'teams')",
    ]);
    expect(team.issues[1]).toEqual({
      id: expect.any(String),
      shortId: expect.stringMatching(/^TEAM-/),
      title: "TypeError: Cannot read properties of undefined (reading 'teams')",
      culprit: "POST /api/tournaments/:id/draft/picks",
      count: 12,
      users: 3,
      level: "error",
      firstSeen: NOW.toISOString(),
      lastSeen: minutes(-90).toISOString(),
      link: expect.stringMatching(/^https:\/\/battersea-cougars\.sentry\.io\/issues\/\d+\/$/),
    });
    expect(web).toMatchObject({ slug: "web", name: "Website", issues: [{ title: "content.sanity_error", count: 2 }] });
    // One request a project, for the open issues of the last 14 days in dev
    expect(sentry.asked).toEqual([
      { project: "team", query: "is:unresolved environment:dev", statsPeriod: "14d" },
      { project: "web", query: "is:unresolved environment:dev", statsPeriod: "14d" },
    ]);
  });

  it("on production, sees production's", async () => {
    w.env.SITE_ENV = "production";
    sentry.issues.team.push(
      sentry.issue({ title: "On dev" }),
      sentry.issue({ title: "Live", environment: "production" }),
    );
    const res = await errorsAs("dana@example.com");
    expect(res.body.environment).toBe("production");
    expect(res.body.projects[0].issues.map((i: { title: string }) => i.title)).toEqual(["Live"]);
  });

  it("sees the ten most recent of a project, and that there are more", async () => {
    for (let i = 0; i < 12; i++)
      sentry.issues.web.push(sentry.issue({ title: `Error ${i}`, lastSeen: minutes(-i).toISOString() }));
    const web = (await errorsAs("dana@example.com")).body.projects[1];
    expect(web.issues).toHaveLength(10);
    expect(web.issues[0].title).toBe("Error 0");
    expect(web.more).toBe(true);
  });

  it("never sees an email address in a title, even if one got past Sentry's own cleaning", async () => {
    sentry.issues.team.push(
      sentry.issue({ title: "No member for reg@example.com", culprit: "mail to dana@example.com" }),
    );
    const [issue] = (await errorsAs("dana@example.com")).body.projects[0].issues;
    expect(issue.title).toBe("No member for r…@example.com");
    expect(issue.culprit).toBe("mail to d…@example.com");
  });

  it("an empty list when nothing's open", async () => {
    const res = await errorsAs("dana@example.com");
    expect(res.body.projects.map((p: { issues: unknown[] }) => p.issues)).toEqual([[], []]);
  });
});

describe("Sentry is asked at most every few minutes", () => {
  it("a second admin a minute later sees the same answer, and Sentry isn't asked again; after five minutes it is", async () => {
    sentry.issues.team.push(sentry.issue({ title: "First" }));
    await errorsAs("dana@example.com");
    sentry.issues.team.push(sentry.issue({ title: "Second" }));

    const soon = await errorsAs("dana@example.com", minutes(1));
    expect(soon.body.projects[0].issues.map((i: { title: string }) => i.title)).toEqual(["First"]);
    expect(soon.body.readAt).toBe(NOW.toISOString());
    expect(sentry.asked).toHaveLength(2);

    const later = await errorsAs("dana@example.com", new Date(NOW.getTime() + ERRORS_FRESH_MS));
    expect(later.body.projects[0].issues).toHaveLength(2);
    expect(later.body.readAt).toBe(new Date(NOW.getTime() + ERRORS_FRESH_MS).toISOString());
    expect(sentry.asked).toHaveLength(4);
  });
});

describe("when Sentry can't be read", () => {
  it("says so calmly, logs a warning (not an error, which would go to the Sentry that's down), and asks again only after a few minutes", async () => {
    sentry.down = true;
    const logs = captureLogs();
    const res = await errorsAs("dana@example.com");
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ configured: true, unavailable: "down", readAt: null, projects: [] });
    expect(logs.entries).toContainEqual(
      expect.objectContaining({
        level: "warn",
        msg: "errors.sentry_unavailable",
        fields: expect.objectContaining({ failure: "down" }),
      }),
    );
    expect(logs.entries.filter((e) => e.level === "error")).toEqual([]);

    const asked = sentry.asked.length;
    await errorsAs("dana@example.com", minutes(2));
    expect(sentry.asked).toHaveLength(asked);
  });

  it("keeps showing the last answer, saying when it was from", async () => {
    sentry.issues.team.push(sentry.issue({ title: "Seen before" }));
    await errorsAs("dana@example.com");
    sentry.down = true;
    const res = await errorsAs("dana@example.com", minutes(10));
    expect(res.body).toMatchObject({ unavailable: "down", readAt: NOW.toISOString() });
    expect(res.body.projects[0].issues[0].title).toBe("Seen before");

    // Back up: the next ask after the pause brings it up to date
    sentry.down = false;
    const back = await errorsAs("dana@example.com", minutes(16));
    expect(back.body.unavailable).toBeUndefined();
    expect(back.body.readAt).toBe(minutes(16).toISOString());
  });

  it("says the token was refused when Sentry won't let it in", async () => {
    sentry.refuses = true;
    const res = await errorsAs("dana@example.com");
    expect(res.body).toMatchObject({ configured: true, unavailable: "refused" });
  });

  it("without the token, says it isn't set up, and Sentry isn't asked", async () => {
    delete w.env.SENTRY_ISSUES_TOKEN;
    const res = await errorsAs("dana@example.com");
    expect(res.body).toEqual({ configured: false, environment: "dev", readAt: null, projects: [] });
    expect(sentry.asked).toEqual([]);
  });
});

describe("who can see it", () => {
  // A role given See errors can (api.permissions.use-cases.test.ts checks every action's routes)
  it("a member is refused, and Sentry isn't asked", async () => {
    const res = await errorsAs("reg@example.com");
    expect(res.status).toBe(403);
    expect(sentry.asked).toEqual([]);
  });
});
