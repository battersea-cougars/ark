// The Kumite on the clock (ADR 0074, 0031): the days and times that change what each person sees, with both clocks
// moved (journey.ts `at`: the browser's and the server's). The Kumite night (kumite.journey.ts) walks sign-up to the
// awards on the real clock; this one is about when: one on a Friday asked about Friday Training that evening first
// (ADR 0122), sign-up opening and closing at London midnight, the draft's day, its own day (Today, Tonight), the day
// after unplayed, played on another evening with the final across midnight, the after-party till 06:00, just a
// season, the days the clocks go back (25 Oct 2026) and forward (28 Mar 2027), and a Kumite on a day gone by. Ada runs
// it (an admin), Fay plays, Nell isn't in it.
//
// How each Kumite gets to the step under test is a shortcut, said so where it's taken: scheduled, signed up for and
// played out through the API as the admin and the players, with the server's clock moved (the dev simulator for the
// matches, ADR 0123). What's under test is what each person sees, and the taps that count (Accept, what's refused);
// the Friday one is scheduled through the wizard, as its question is the step under test. Each Kumite is deleted when
// its stage is done, so the club is left as the Kumite night left it.
import { expect, test, type Page } from "@playwright/test";
import { asMember, at, checks, does, london, noFailedChecks, signIn, stage, type Person } from "./journey";
import { kumiteOnAPastDay } from "./past-kumite";

const KUMITE = "/tournaments/kumite";

/**
 * What the pages call things, in one place: the Kumite's editor is being changed (its tabs, its fields), and this
 * journey never opens it (the Kumites here are made through the API), so these are the pages' own words only.
 */
const SAY = {
  status: (s: string | RegExp) => ({ name: typeof s === "string" ? `Status: ${s}` : s }),
  track: "Where the Kumite has got to",
  invite: "Your invitation to the Kumite",
  nothingOn: "No Kumite yet",
  past: /^Past Kumites/,
  table: "The final table",
};

/** A Friday with Friday Training that evening: the one scheduled through the wizard, by day, is asked about it. */
const FRIDAY = "2026-11-06";

/** Days the Kumites here are on (their stand-in day, for the season-only one), so a run cleans up after an earlier one. */
const OURS = [FRIDAY, "2026-11-14", "2027-02-28", "2026-10-25", "2027-03-28", "2026-09-19"];

test("The Kumite on the clock", async ({ browser }) => {
  const ada = await signIn(browser, "Admin", "Ada Admin", "admin@example.com");
  const fay = await signIn(browser, "Player", "Fay Forward", "fay@example.com");
  const nell = await signIn(browser, "Member, not in it", "Nell Nonplayer", "nell@example.com");
  const everyone = [ada, fay, nell];

  /** Everyone, or some, at a London wall-clock time ("2026-11-14T10:00"). */
  const allAt = async (wall: string, who: Person[] = everyone) => {
    for (const p of who) await at(p, london(wall));
  };
  const open = (who: Person, path = KUMITE) => who.page.goto(path);
  const main = (page: Page) => page.getByRole("main");
  /** What the page says as a screen reader has it (its text has hidden phone labels in it): a line matching. */
  const reads = (page: Page, line: RegExp) => expect.poll(() => main(page).ariaSnapshot()).toMatch(line);
  const doesntRead = (page: Page, line: RegExp) => expect.poll(() => main(page).ariaSnapshot()).not.toMatch(line);
  /** The step of the stage track it's at now ("The Anchor"). */
  const trackAt = (page: Page, step: string) =>
    page.getByRole("list", { name: SAY.track }).getByRole("link", { name: `${step} , where it is now` });

  // The club as the admin reads it, the server's clock at `wall` (a shortcut to ids and states, not under test)
  const adaAt = (wall: string) => asMember(ada.email, { at: london(wall) });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const club = async (wall = "2026-10-30T12:00"): Promise<any> => adaAt(wall)("GET", "/api/bootstrap");
  const members = (await club()).members as { id: number; name: string }[];
  const memberId = (name: string) => members.find((m) => m.name === name)!.id;
  /** Deletes a Kumite (Settings → Tournaments has the same delete): a shortcut, the club as it was. */
  const remove = (id: number) => adaAt("2026-10-30T12:00")("DELETE", `/api/tournaments/${id}`);

  // Anything an earlier run of this journey left (a run that stopped half way): gone, so nothing of ours is on
  for (const t of (await club()).tournaments as { id: number; typeId: number; heldOn: string }[])
    if (t.typeId === 1 && OURS.includes(t.heldOn)) await remove(t.id);

  await stage("0. Nothing on: the Kumite night's is history by the next morning", async () => {
    await allAt("2026-10-30T12:00");
    for (const who of everyone)
      await checks(who, "sees No Kumite yet a week on", async () => {
        await open(who);
        await expect(who.page.getByRole("heading", { name: SAY.nothingOn })).toBeVisible();
      });
  });

  // ─── Asked first: a Kumite on a Friday, by day, over Friday Training that evening (ADR 0122) ───

  await stage("0b. A Kumite on a Friday at 11am: asked about Friday Training that night first", async () => {
    // Still Fri 30 Oct, 12:00, nothing on. The user scheduled one like this (a Friday, 11:00) and wasn't asked: a
    // clash is anything on the same London day now (worker/calendar/clashes.ts), the evening's training too
    const wizard = ada.page.getByRole("dialog", { name: "The next Kumite" });
    const clash = ada.page.getByRole("dialog", { name: "Already on then" });
    const training = clash.getByRole("listitem").filter({ hasText: "Friday Training" });
    const onFriday = async () =>
      ((await club()).tournaments as { id: number; typeId: number; heldOn: string; startTime: string }[]).find(
        (t) => t.typeId === 1 && t.heldOn === FRIDAY,
      );

    await does(
      ada,
      "schedules the next Kumite on Fri 6 Nov, 11am to 3pm, through the wizard: asked first",
      async () => {
        await open(ada);
        await ada.page.getByRole("button", { name: "Next Kumite" }).click();
        await wizard.getByRole("button", { name: /^Day:/ }).click();
        const picker = ada.page.getByRole("dialog", { name: "Day" });
        await picker.getByRole("button", { name: "Next month" }).click();
        await picker.getByRole("button", { name: "Fri 6 Nov 2026" }).click();
        await wizard.getByRole("button", { name: /^Starts:/ }).click();
        await ada.page.getByRole("option", { name: "11am", exact: true }).click();
        await wizard.getByRole("button", { name: /^Ends:/ }).click();
        await ada.page.getByRole("option", { name: "3pm", exact: true }).click();
        await wizard.getByRole("button", { name: "Next · Sign-up" }).click();
        await wizard.getByRole("button", { name: "Next · Teams" }).click();
        await wizard.getByRole("button", { name: "Next · Check" }).click();
        await wizard.getByRole("button", { name: "Schedule it" }).click();
        await expect(clash).toBeVisible();
        await expect(training).toContainText("Fri 6 Nov");
      },
    );
    await checks(ada, "closes the question: back in the wizard, nothing scheduled", async () => {
      await clash.getByRole("button", { name: "Close" }).click();
      await expect(clash).toHaveCount(0);
      await expect(wizard).toBeVisible();
      expect(await onFriday()).toBeUndefined();
    });
    await does(
      ada,
      "schedules it again, keeping both: scheduled, and Friday Training still on that night",
      async () => {
        await wizard.getByRole("button", { name: "Schedule it" }).click();
        await expect(training).toBeVisible();
        // Keep both for everything it's over (one answer for all when there are several)
        const all = clash.getByRole("group", { name: /^All of these/ });
        if (await all.count()) await all.getByRole("button", { name: "Keep both" }).click();
        else await training.getByRole("button", { name: "Keep both" }).click();
        await clash.getByRole("button", { name: /^Save/ }).click();
        await expect(wizard).toHaveCount(0);
        await expect.poll(async () => (await onFriday())?.startTime).toBe("11:00");
        const { series, sessions } = await club();
        const friday = (series as { id: number; name: string }[]).find((x) => x.name === "Friday Training")!;
        const night = (sessions as { seriesId: number; heldOn: string; cancelledAt: string | null }[]).find(
          (x) => x.seriesId === friday.id && x.heldOn === FRIDAY,
        );
        expect(night?.cancelledAt ?? null).toBeNull();
      },
    );

    // Gone again (a shortcut, as the journey's other Kumites are), so the next stages start with nothing on
    const scheduled = await onFriday();
    if (scheduled) await remove(scheduled.id);
  });

  // ─── A set day, a fortnight off: Sat 14 Nov 2026, sign-up Mon 2 Nov to Thu 12 Nov, the draft Fri 13 Nov ───

  // Scheduled through the API as the admin, the captains named (the wizard is the Kumite night's to test)
  const { id: dated } = (await adaAt("2026-10-30T12:00")("POST", "/api/tournaments", {
    typeId: 1,
    name: "Clock Kumite",
    heldOn: "2026-11-14",
    signupOpensOn: "2026-11-02",
    signupClosesOn: "2026-11-12",
    draftOn: "2026-11-13",
    capacity: 9,
    teams: ["Cara Captain", "Cole Captain", "Cass Captain"].map((n) => ({ name: "", captainMemberId: memberId(n) })),
  })) as { id: number };
  const datedNow = async (wall: string) =>
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ((await club(wall)).tournaments as any[]).find((t) => t.id === dated);

  await stage("1. Sign-up opens at London midnight (Sun 1 Nov 23:59, then Mon 2 Nov 00:01)", async () => {
    await allAt("2026-11-01T23:59");
    await checks(fay, "at 23:59 sees it Coming up, Sign-up opens Mon 2 Nov, and no Accept", async () => {
      await open(fay);
      await expect(fay.page.getByRole("status", SAY.status("Coming up"))).toBeVisible();
      await expect(main(fay.page)).toContainText("Sign-up opens Mon 2 Nov");
      await expect(fay.page.getByRole("button", { name: "Accept" })).toHaveCount(0);
    });
    await checks(fay, "at 23:59 sees it on Home as coming up, a fortnight off, sign-up still to open", async () => {
      await open(fay, "/");
      await expect(fay.page.getByRole("region", { name: "Coming up" })).toContainText(/Sat 14 Nov: Clock Kumite/);
    });
    await checks(fay, "at 23:59 is refused by the server, with the day in words, not a date code", async () => {
      const said = await asMember(fay.email, { at: london("2026-11-01T23:59") })(
        "POST",
        `/api/tournaments/${dated}/answer`,
        { answer: "in" },
      ).then(
        () => "accepted",
        (e: Error) => e.message,
      );
      expect(said).toContain("409");
      expect(said).not.toMatch(/\d{4}-\d{2}-\d{2}/);
    });

    await allAt("2026-11-02T00:01");
    await does(fay, "at 00:01 has her invitation, and accepts it", async () => {
      await open(fay);
      await expect(fay.page.getByRole("status", SAY.status("Sign-up open"))).toBeVisible();
      await fay.page.getByRole("article", { name: SAY.invite }).getByRole("button", { name: "Accept" }).click();
      await expect(fay.page.getByRole("button", { name: "Fay Forward: see their card" })).toBeVisible();
    });
    await checks(nell, "at 00:01 has hers too, on the Kumite's page", async () => {
      await open(nell);
      await expect(
        nell.page.getByRole("article", { name: SAY.invite }).getByRole("button", { name: "Accept" }),
      ).toBeVisible();
    });
  });

  // The rest of the card says they're in through the API, as themselves, while sign-up's open (not under test)
  for (const name of ["cara", "cole", "cass", "gus", "gwen", "gil", "sam", "dee"])
    await asMember(`${name}@example.com`, { at: london("2026-11-05T12:00") })(
      "POST",
      `/api/tournaments/${dated}/answer`,
      { answer: "in" },
    );

  await stage("2. Sign-up closes at the end of its last day (Thu 12 Nov 23:59, then Fri 13 Nov 00:01)", async () => {
    await allAt("2026-11-10T12:00", [nell]);
    await checks(nell, "sees its last day for sign-up on the Calendar, and the day itself, In 4 days", async () => {
      await open(nell, "/calendar");
      await expect(nell.page.getByRole("heading", { name: "Clock Kumite: sign-up closes" })).toBeVisible();
      await expect(nell.page.getByRole("article").filter({ hasText: "Sat 14 Nov" })).toContainText("In 4 days");
    });
    await allAt("2026-11-12T23:59", [nell]);
    await checks(nell, "at 23:59 on its last day can still say she's in (Accept, a reserve: it's full)", async () => {
      await open(nell);
      await expect(
        nell.page.getByRole("article", { name: SAY.invite }).getByRole("button", { name: "Accept" }),
      ).toBeVisible();
    });
    await allAt("2026-11-13T00:01", [nell]);
    await checks(nell, "at 00:01 the next day can't: no Accept, and the server says Sign-up has closed", async () => {
      await open(nell);
      await expect(nell.page.getByRole("button", { name: "Accept" })).toHaveCount(0);
      const said = await asMember(nell.email, { at: london("2026-11-13T00:01") })(
        "POST",
        `/api/tournaments/${dated}/answer`,
        { answer: "in" },
      ).then(
        () => "accepted",
        (e: Error) => e.message,
      );
      expect(said).toContain("Sign-up has closed.");
    });
  });

  await stage("3. The draft's day (Fri 13 Nov): on the agenda for whoever runs it, nobody else's", async () => {
    await allAt("2026-11-13T10:00");
    await checks(ada, "has the draft on the Calendar, and Draft it under For admins on Home", async () => {
      await open(ada, "/calendar");
      await expect(ada.page.getByRole("heading", { name: "Clock Kumite: the draft" })).toBeVisible();
      await open(ada, "/");
      const admins = ada.page.getByRole("region", { name: "For admins" });
      await expect(admins.getByRole("link", { name: /^Draft Clock Kumite/ })).toBeVisible();
    });
    for (const who of [fay, nell])
      await checks(who, "doesn't have the draft on her Calendar (she isn't a captain)", async () => {
        await open(who, "/calendar");
        await expect(who.page.getByRole("heading", { name: "Calendar", level: 1 })).toBeVisible();
        await expect(who.page.getByRole("heading", { name: "Clock Kumite: the draft" })).toHaveCount(0);
      });
  });

  await stage(
    "4. Its day (Sat 14 Nov, the morning): Today on its page, Tonight on Home (it starts at 7pm)",
    async () => {
      await allAt("2026-11-14T10:00");
      for (const who of everyone)
        await checks(who, "sees Today in its header, and the track at the draft", async () => {
          await open(who);
          await reads(who.page, /- text: Today Sat 14 Nov 7 to 9:30pm$/m);
          await expect(trackAt(who.page, "Draft open")).toBeVisible();
        });
      for (const who of [fay, nell])
        await checks(who, "sees it first on Home, Tonight", async () => {
          await open(who, "/");
          const hero = who.page.getByRole("region", { name: /^The Kumite/ });
          await expect(hero).toContainText("Clock Kumite");
          await expect(hero).toContainText("Tonight");
        });
    },
  );

  await stage("5. The day after, nothing played (Sun 15 Nov): still on, not history", async () => {
    await allAt("2026-11-15T10:00");
    for (const who of everyone)
      await checks(who, "sees it still on its page, its date and no countdown, not No Kumite yet", async () => {
        await open(who);
        await expect(trackAt(who.page, "Draft open")).toBeVisible();
        // Its date alone: no Today, no countdown after it
        await reads(who.page, /- text: Sat 14 Nov 7 to 9:30pm$/m);
        await expect(who.page.getByRole("heading", { name: SAY.nothingOn })).toHaveCount(0);
      });
  });

  await stage(
    "6. Played on another evening (Tue 17 Nov), the final across midnight, The Anchor till 06:00",
    async () => {
      // The draft and the matches played out by the dev simulator as the admin (ADR 0123), the server's clock at 23:40
      // on Tue 17 Nov, three days after its date, till the final's kicked off; its full time at 00:10 on the Wednesday
      await does(ada, "plays it out on Tue 17 Nov, the final kicking off before midnight, over after", async () => {
        for (let i = 0; i < 120; i++) {
          const began = Date.now();
          const games = ((await datedNow("2026-11-17T23:40")).games ?? []) as { startedAt: string | null }[];
          const wall = games.length && games.every((g) => g.startedAt) ? "2026-11-18T00:10" : "2026-11-17T23:40";
          const move = (await adaAt(wall)("POST", `/api/tournaments/${dated}/simulate`, { moves: 4 })) as {
            done: boolean;
          };
          if (move.done) break;
          await new Promise((go) => setTimeout(go, Math.max(0, began + 1250 - Date.now())));
        }
        const games = (await datedNow("2026-11-18T00:10")).games as { status: string; startedAt: string }[];
        expect(games.every((g) => g.status === "done")).toBe(true);
      });

      await allAt("2026-11-17T23:55");
      for (const who of everyone)
        await checks(who, "at 23:55 sees it at The Anchor, the final table up: the evening it was played", async () => {
          await open(who);
          await expect(who.page.getByRole("status", SAY.status("The Anchor"))).toBeVisible();
          await expect(who.page.getByRole("heading", { name: SAY.table })).toBeVisible();
        });

      await allAt("2026-11-18T00:30");
      for (const who of everyone)
        await checks(
          who,
          "at 00:30, past midnight, still sees it at The Anchor: the stamp, the track, the table",
          async () => {
            await open(who);
            await expect(trackAt(who.page, "The Anchor")).toBeVisible();
            await expect(who.page.getByRole("heading", { name: SAY.table })).toBeVisible();
            // The stamp in the header reckons by the date, not the evening (TournamentHead stageBadge): Done after midnight
            await expect(who.page.getByRole("status", SAY.status("The Anchor"))).toBeVisible();
          },
        );
      await checks(nell, "at 00:30 sees it on Home at The Anchor now", async () => {
        await open(nell, "/");
        await expect(nell.page.getByRole("region", { name: /^The Kumite/ })).toContainText("Now At The Anchor");
      });

      await allAt("2026-11-18T05:59");
      for (const who of everyone)
        await checks(who, "at 05:59 still has the after-party on its page, not No Kumite yet", async () => {
          await open(who);
          await expect(who.page.getByRole("heading", { name: SAY.table })).toBeVisible();
          await expect(who.page.getByRole("heading", { name: SAY.nothingOn })).toHaveCount(0);
        });

      await allAt("2026-11-18T06:01");
      for (const who of everyone)
        await checks(who, "at 06:01 sees No Kumite yet, and the Clock Kumite under Past Kumites", async () => {
          await open(who);
          await expect(who.page.getByRole("heading", { name: SAY.nothingOn })).toBeVisible();
          await expect(who.page.getByRole("heading", { name: SAY.past })).toBeVisible();
          // Listed by its date and who won it
          await expect(who.page.getByRole("link", { name: /^Sat 14 Nov .*won it/ }).first()).toBeVisible();
        });
      await checks(nell, "at 06:01 has nothing of it left on Home", async () => {
        await open(nell, "/");
        await expect(nell.page.getByRole("region", { name: /^The Kumite/ })).toHaveCount(0);
      });
    },
  );
  await remove(dated);

  // ─── Just a season (the wizard's default): winter 2026, its stand-in day Sun 28 Feb 2027 ───

  // Scheduled through the API as the admin (the wizard's season-only Kumite is the Kumite night's)
  const { id: seasonal } = (await adaAt("2026-11-20T12:00")("POST", "/api/tournaments", {
    typeId: 1,
    name: "Winter Kumite",
    season: "winter",
    heldOn: "2027-02-28",
    signupOpensOn: "2026-12-01",
  })) as { id: number };

  await stage("7. Just a season: no day shown, no countdown, still on once the season's over", async () => {
    await allAt("2026-11-20T12:00");
    for (const who of everyone)
      await checks(who, "sees Winter 2026, Day to be set, Coming up", async () => {
        await open(who);
        await reads(who.page, /- text: Winter 2026 Day to be set$/m);
        await expect(who.page.getByRole("status", SAY.status("Coming up"))).toBeVisible();
      });
    await checks(nell, "sees it on Home under Coming up, by its season", async () => {
      await open(nell, "/");
      // Its row, by its season (no day yet)
      await expect(nell.page.getByRole("link", { name: /Winter Kumite/ }).first()).toBeVisible();
      await reads(nell.page, /link "Winter 2026: Winter Kumite/i);
    });

    // Its stand-in day is never its day: no Today, nothing on Home saying it's today
    await allAt("2027-02-28T12:00");
    for (const who of [fay, nell])
      await checks(who, "on the season's last day sees no Today, and Home doesn't say it's today", async () => {
        await open(who);
        await reads(who.page, /- text: Winter 2026 Day to be set$/m);
        await open(who, "/");
        await expect(who.page.getByRole("region", { name: "The Kumite's today" })).toHaveCount(0);
      });

    await allAt("2027-03-02T12:00");
    await checks(nell, "after the season, unplayed, still sees it on, not No Kumite yet", async () => {
      await open(nell);
      await reads(nell.page, /- text: Winter 2026 Day to be set$/m);
      await expect(nell.page.getByRole("heading", { name: SAY.nothingOn })).toHaveCount(0);
    });
  });
  await remove(seasonal);

  // ─── The days the clocks change: each a Kumite played out on its own evening, kick-off 7:30pm London ───

  for (const [title, day, nextDay, after] of [
    ["8. The clocks go back (Sun 25 Oct 2026, GMT from 02:00)", "2026-10-25", "2026-10-26", "2026-10-27T12:00"],
    ["9. The clocks go forward (Sun 28 Mar 2027, BST from 01:00)", "2027-03-28", "2027-03-29", "2027-03-30T12:00"],
  ]) {
    // Played out on its evening by the dev simulator as the admin (past-kumite.ts), the server's clock two days on so
    // its day is one gone by (ADR 0123)
    const id = await kumiteOnAPastDay(ada.email, day, 1, { at: london(after) });
    await stage(title, async () => {
      await allAt(`${day}T22:00`);
      for (const who of [ada, nell])
        await checks(who, "sees the first match at 7:30pm on the fight card, as London had it", async () => {
          await open(who, `${KUMITE}/schedule`);
          await expect(who.page.getByRole("link", { name: /^Game 1: 7:30pm/ })).toBeVisible();
        });
      await allAt(`${nextDay}T05:59`);
      for (const who of [ada, nell])
        await checks(who, "at 05:59 the next morning still has its evening on its page", async () => {
          await open(who);
          await expect(who.page.getByRole("heading", { name: SAY.table })).toBeVisible();
          await expect(who.page.getByRole("heading", { name: SAY.nothingOn })).toHaveCount(0);
        });
      await allAt(`${nextDay}T06:01`);
      for (const who of [ada, nell])
        await checks(who, "at 06:01 sees No Kumite yet, it first under Past Kumites", async () => {
          await open(who);
          await expect(who.page.getByRole("heading", { name: SAY.nothingOn })).toBeVisible();
          await expect(who.page.getByRole("heading", { name: SAY.past })).toBeVisible();
        });
    });
    await remove(id);
  }

  // ─── A Kumite on a day gone by, on the real clock ───

  // Recorded and played out on Sat 19 Sep 2026 by the dev simulator as the admin (past-kumite.ts)
  const past = await kumiteOnAPastDay(ada.email, "2026-09-19");
  await stage("10. A Kumite on a day gone by: history, never coming up", async () => {
    // Everyone on tomorrow's clock, mid-morning: this evening may still be the Kumite night's (Done, on its page till
    // 06:00), and a Kumite gone by is what's under test
    const now = new Date(Date.now() + 24 * 3_600_000);
    for (const who of everyone) await at(who, now);
    await checks(nell, "sees it under Past Kumites, and opens it: its matches", async () => {
      await open(nell);
      await expect(nell.page.getByRole("heading", { name: SAY.past })).toBeVisible();
      await nell.page.goto(`${KUMITE}/${past}`);
      await expect(nell.page.getByRole("link", { name: /^Game \d:/ }).first()).toBeVisible();
      await reads(nell.page, /Sat 19 Sep/);
    });
    for (const who of [fay, nell])
      await checks(who, "doesn't see it on Home, nor on the Calendar", async () => {
        await open(who, "/");
        await expect(who.page.getByRole("heading", { level: 1 })).toBeVisible();
        await doesntRead(who.page, /19 Sep/);
        await open(who, "/calendar");
        await expect(who.page.getByRole("heading", { name: "Calendar", level: 1 })).toBeVisible();
        await doesntRead(who.page, /19 Sep/);
      });
  });
  await remove(past);

  noFailedChecks();
  for (const who of everyone) await who.context.close();
});
