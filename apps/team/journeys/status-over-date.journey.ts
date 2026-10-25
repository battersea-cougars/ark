// Status, not the date (ADR 0074, 0031; #182): "status decides whether an event or game is past, on or next, never its
// date or time" (the user, 2026-10-25). Three stories, both clocks moved (journey.ts `at`):
//   a Kumite played early: set for Sat 12 Dec, played on Sat 5 Dec; Home, the calendar and its page all have it as
//   played, the next one (Sat 16 Jan) as next, and on its own day it's still past;
//   a training night not closed: past its end, its register still open, Home and its page stay on it till 06:00;
//   a game running late: the January Kumite's first match, set for 7pm, starts at 7:45; till then it's the one up, and
//   the one after doesn't become current; once it's over, the next one's up.
// Ada runs it (an admin), Fay plays (in the Kumites and the training), Nell is in none of it.
//
// How each gets to the step under test is a shortcut, said so where it's taken: the Kumites, their teams and fixtures,
// the training and Fay's answer are made through the API as the admin and Fay, and the matches kicked off and their
// results put in through the API as the admin, at the moment the story's at. What's under test is what each person
// sees. The Kumites are deleted at the end, so the club's left as it was.
import { expect, test, type Page } from "@playwright/test";
import { asMember, at, checks, clubVia, does, london, noFailedChecks, signIn, stage, type Person } from "./journey";

const KUMITE = "/tournaments/kumite";
/** The training this journey makes: on a database other runs may have used, a name nobody's used yet. */
const TAG = Date.now().toString(36).slice(-4);
const SKATE = `Late Skate ${TAG}`;

const EARLY = "Early Kumite";
const NEXT = "January Kumite";
const NEXT_ON = "Sat 16 Jan";

test("Status, not the date", async ({ browser }) => {
  const ada = await signIn(browser, "Admin", "Ada Admin", "admin@example.com");
  const fay = await signIn(browser, "Player", "Fay Forward", "fay@example.com");
  const nell = await signIn(browser, "Member, not in it", "Nell Nonplayer", "nell@example.com");
  const everyone = [ada, fay, nell];

  /** Everyone, or some, at a London wall-clock time ("2026-12-05T22:00"). */
  const allAt = async (wall: string, who: Person[] = everyone) => {
    for (const p of who) await at(p, london(wall));
  };
  const open = async (who: Person, path: string) => {
    await who.page.goto(path);
    await expect(who.page.getByRole("main").getByRole("heading").first()).toBeVisible();
  };
  const main = (page: Page) => page.getByRole("main");
  const lead = (page: Page) => page.locator('section[aria-labelledby="lead-title"]');
  const comingUp = (page: Page) => page.getByRole("region", { name: "Coming up" });
  /** The match the KUMITE! carousel brings forward: the current one (ADR 0074). */
  const current = (page: Page) =>
    page.getByRole("list", { name: "Matches, in order of play" }).locator('li[aria-current="true"]');

  // The API as the admin, the server's clock at `wall` (a shortcut, not under test)
  const adaAt = (wall: string) => asMember(ada.email, { at: london(wall) });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const club = async (wall: string): Promise<any> => clubVia(adaAt(wall));
  const members = (await club("2026-12-01T12:00")).members as { id: number; name: string }[];
  const memberId = (name: string) => members.find((m) => m.name === name)!.id;
  const team = (name: string, captain: string, player: string) => ({
    name,
    logo: null,
    captainMemberId: memberId(captain),
    players: [{ memberId: memberId(player) }],
  });
  /** A Kumite whose teams enter (no draft), its fixtures out: a shortcut to a fight card, made as the admin. */
  const kumiteOn = async (name: string, heldOn: string) => {
    const api = adaAt("2026-12-01T12:00");
    const { id } = (await api("POST", "/api/tournaments", {
      typeId: 1,
      name,
      heldOn,
      startTime: "19:00",
      endTime: "21:30",
      kind: "teams",
      playoffs: [],
      teams: [
        team("Ants", "Cara Captain", "Fay Forward"),
        team("Bees", "Cole Captain", "Sam Skater"),
        team("Cats", "Cass Captain", "Dee Defence"),
      ],
    })) as { id: number };
    await api("POST", `/api/tournaments/${id}/fixtures`);
    return id;
  };
  const gamesOf = async (id: number, wall: string) =>
    (
      ((await club(wall)).tournaments as { id: number; games: { id: number; position: number }[] }[]).find(
        (t) => t.id === id,
      )!.games ?? []
    ).sort((a, b) => a.position - b.position);
  /** A match kicked off on the clock, as the admin holding its sheet, at `wall`: a shortcut to a match on. */
  const kickOff = async (id: number, gameId: number, wall: string) => {
    const path = `/api/tournaments/${id}/games/${gameId}`;
    await adaAt(wall)("POST", `${path}/scorer`, { action: "claim" });
    await adaAt(wall)("POST", `${path}/clock`, { action: "start" });
  };
  /** A match's result put in, as the admin, at `wall`: over (a shortcut). */
  const result = (id: number, gameId: number, wall: string) =>
    adaAt(wall)("PUT", `/api/tournaments/${id}/games/${gameId}`, { homeGoals: 3, awayGoals: 1 });

  const early = await kumiteOn(EARLY, "2026-12-12");
  const next = await kumiteOn(NEXT, "2027-01-16");

  // A training on Wednesdays, 7:30 to 9pm, always open, through the API as the admin; Fay's in for Wed 9 Dec
  const { id: skate } = (await adaAt("2026-12-01T12:00")("POST", "/api/series", {
    name: SKATE,
    shortName: `Skate ${TAG}`,
    icon: "skate",
    tone: "green",
    repeatEvery: 1,
    weekdays: ["wed"],
    startsOn: "2026-12-02",
    endsOn: "2026-12-30",
    startTime: "19:30",
    endTime: "21:00",
    venue: "The Rink",
    capacity: null,
    goalieCapacity: null,
    signupOpensDays: null,
    public: false,
    active: true,
    fees: [],
    clashes: [],
  })) as { id: number };
  const skatePath = `/training/${
    ((await club("2026-12-01T12:00")).series as { id: number; slug: string }[]).find((s) => s.id === skate)!.slug
  }`;
  const night = ((await club("2026-12-01T12:00")).sessions as { id: number; seriesId: number; heldOn: string }[]).find(
    (s) => s.seriesId === skate && s.heldOn === "2026-12-09",
  )!;
  await asMember(fay.email, { at: london("2026-12-02T12:00") })("POST", `/api/sessions/${night.id}/answer`, {
    answer: "in",
  });

  await stage("1. A Kumite played early: set for Sat 12 Dec, played on Sat 5 Dec", async () => {
    await allAt("2026-12-04T12:00");
    await checks(nell, "before it's played, sees it coming up on Home, on Sat 12 Dec", async () => {
      await open(nell, "/");
      await expect(main(nell.page)).toContainText(EARLY);
    });

    // Played on Sat 5 Dec through the API as the admin: the first match kicked off at 7pm, every result in by 9pm
    await does(ada, "plays it out on Sat 5 Dec, a week before its day", async () => {
      const games = await gamesOf(early, "2026-12-05T19:00");
      await kickOff(early, games[0].id, "2026-12-05T19:00");
      for (const g of games) await result(early, g.id, "2026-12-05T21:00");
    });

    await allAt("2026-12-05T22:00");
    for (const who of everyone)
      await checks(who, "that evening sees it at The Anchor on its page: the evening it was played", async () => {
        await open(who, KUMITE);
        await expect(who.page.getByRole("status", { name: "Status: The Anchor" })).toBeVisible();
      });
    for (const who of [fay, nell])
      await checks(who, "that evening has it nowhere on Home as coming up, nor on the Calendar", async () => {
        await open(who, "/");
        await expect(comingUp(who.page)).not.toContainText(EARLY);
        await open(who, "/calendar");
        await expect(who.page.getByRole("heading", { name: EARLY })).toHaveCount(0);
      });

    await allAt("2026-12-06T10:00");
    for (const who of everyone)
      await checks(
        who,
        "the morning after sees the January Kumite on its page, and the early one in History",
        async () => {
          await open(who, KUMITE);
          // Its header is the series' name; its when is the January one's
          await expect(main(who.page)).toContainText(NEXT_ON);
          await expect(who.page.getByRole("status", { name: "Status: The Anchor" })).toHaveCount(0);
          await open(who, `${KUMITE}/history`);
          await expect(who.page.getByRole("link", { name: /^Sat 12 Dec .*won it/ }).first()).toBeVisible();
        },
      );
    for (const who of [fay, nell])
      await checks(
        who,
        "the morning after has the January Kumite coming up on Home and the Calendar, not the early one",
        async () => {
          await open(who, "/");
          await expect(lead(who.page)).not.toContainText(EARLY);
          await expect(comingUp(who.page)).not.toContainText(EARLY);
          await expect(main(who.page)).toContainText(NEXT);
          await open(who, "/calendar");
          await expect(who.page.getByRole("heading", { name: EARLY })).toHaveCount(0);
          await expect(who.page.getByRole("heading", { name: NEXT })).toBeVisible();
        },
      );
  });

  await stage("2. A night not closed: past its end, its register open till 06:00, it's still the one", async () => {
    await allAt("2026-12-09T21:30", [fay]);
    await checks(fay, "at 9:30pm, half an hour after it ended, still has Wed 9 Dec leading Home, over", async () => {
      await open(fay, "/");
      await expect(lead(fay.page).locator('a[href$="/2026-12-09"]').first()).toBeVisible();
      await expect(lead(fay.page)).toContainText("Over: the register says who came");
    });
    await checks(fay, "at 9:30pm has it on the training's page too, not next week's", async () => {
      await open(fay, skatePath);
      await expect(main(fay.page)).toContainText("Over: the register says who came");
    });

    await allAt("2026-12-10T01:00", [fay]);
    await checks(fay, "at 1am, after midnight, still has it leading Home and on its page", async () => {
      await open(fay, "/");
      await expect(lead(fay.page).locator('a[href$="/2026-12-09"]').first()).toBeVisible();
      await open(fay, skatePath);
      await expect(main(fay.page)).toContainText("Over: the register says who came");
    });

    await allAt("2026-12-10T06:30", [fay]);
    await checks(fay, "at 6:30am, its register closed, Home and its page are on to Wed 16 Dec", async () => {
      await open(fay, "/");
      await expect(lead(fay.page).locator('a[href$="/2026-12-09"]')).toHaveCount(0);
      await open(fay, skatePath);
      await expect(main(fay.page)).not.toContainText("Over: the register says who came");
      await expect(main(fay.page)).toContainText("16 Dec");
    });
  });

  await stage("3. The early Kumite's own day (Sat 12 Dec): still past, no sign-up and no Today for it", async () => {
    await allAt("2026-12-12T18:00");
    for (const who of [fay, nell])
      await checks(
        who,
        "on its day sees the January Kumite on its page, no invitation, nothing of it on Home",
        async () => {
          await open(who, KUMITE);
          await expect(main(who.page)).toContainText(NEXT_ON);
          await expect(main(who.page)).not.toContainText("Today");
          await open(who, "/");
          await expect(lead(who.page)).not.toContainText(EARLY);
          await expect(comingUp(who.page)).not.toContainText(EARLY);
          await expect(who.page.getByRole("region", { name: "The Kumite's today" })).toHaveCount(0);
        },
      );
    await checks(nell, "on its day has no Calendar entry for it", async () => {
      await open(nell, "/calendar");
      await expect(nell.page.getByRole("heading", { name: EARLY })).toHaveCount(0);
    });
  });

  await stage("4. A game running late: the 7pm match starts at 7:45", async () => {
    const games = await gamesOf(next, "2027-01-16T12:00");
    await allAt("2027-01-16T19:20");
    for (const who of [ada, nell])
      await checks(who, "at 7:20, the first match not started, sees it still the one up, not the second", async () => {
        await open(who, KUMITE);
        await expect(current(who.page)).toContainText("Game 1 of 3");
        await expect(current(who.page)).toContainText("You are next!");
      });

    await does(ada, "kicks off the first match late, at 7:45 (through the API, a shortcut)", async () => {
      await kickOff(next, games[0].id, "2027-01-16T19:45");
    });
    await allAt("2027-01-16T20:05");
    for (const who of [ada, nell])
      await checks(
        who,
        "at 8:05, past the second match's time, sees the first on now, still the current one",
        async () => {
          await open(who, KUMITE);
          await expect(current(who.page)).toContainText("Game 1 of 3");
          await expect(current(who.page)).toContainText("Kumite!");
        },
      );

    await does(ada, "puts in the first match's result at 8:10 (a shortcut)", async () => {
      await result(next, games[0].id, "2027-01-16T20:10");
    });
    await allAt("2027-01-16T20:12");
    for (const who of [ada, nell])
      await checks(who, "at 8:12 sees the second match up next, the current one", async () => {
        await open(who, KUMITE);
        await expect(current(who.page)).toContainText("Game 2 of 3");
        await expect(current(who.page)).toContainText("You are next!");
      });
  });

  // Gone (a shortcut, as the other journeys' Kumites are): the club as it was
  await adaAt("2027-01-17T12:00")("DELETE", `/api/tournaments/${early}`);
  await adaAt("2027-01-17T12:00")("DELETE", `/api/tournaments/${next}`);
  noFailedChecks();
});
