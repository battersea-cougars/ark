// The Kumite night, end to end (ADR 0074, 0124; #154): sign-up opens, players sign up, the order's drawn, the captains
// draft, the teams are set, the fixtures made, the matches scored live, then The Anchor: the vote, the awards
// confirmed and revealed one by one, and done. Three people throughout, each checking what they can and can't do at
// each stage: Ada, an admin who runs it (and doesn't play); Fay, a player; Nell, a member who isn't in it. The
// captains (Cara, Cole, Cass) and the other players come in where the story needs them.
//
// It runs on the real clock, on a fresh database: the Kumite is scheduled for today (London), so it's on its day from
// the start and The Anchor follows its last match (its evening lasts till 06:00).
import { expect, test } from "@playwright/test";
import { asMember, checks, does, noFailedChecks, signIn, stage, type Person } from "./journey";

/** Today in London as the app's day picker names it: "Fri 23 Oct 2026". */
const todayLabel = () =>
  new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/London",
    weekday: "short",
    day: "numeric",
    month: "short",
    year: "numeric",
  })
    .format(new Date())
    .replace(/,/g, "");

const KUMITE = "/tournaments/kumite";

/** Before 06:00 London it's still last night's evening, so a Kumite played today wouldn't be at The Anchor. */
const beforeSix = () =>
  Number(
    new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/London", hour: "numeric", hourCycle: "h23" }).format(
      new Date(),
    ),
  ) < 6;

test("The Kumite night", async ({ browser }) => {
  test.skip(beforeSix(), "Run between 06:00 and midnight London: before 06:00 it's still last night's after-party");
  const ada = await signIn(browser, "Admin", "Ada Admin", "admin@example.com");
  const fay = await signIn(browser, "Player", "Fay Forward", "fay@example.com");
  const nell = await signIn(browser, "Member, not in it", "Nell Nonplayer", "nell@example.com");
  const everyone = [ada, fay, nell];
  const open = (who: Person, path = KUMITE) => who.page.goto(path);
  // The Kumite as the API has it (its id, its places, its teams and games), as the admin
  const adaApi = asMember(ada.email);
  const kumite = async () =>
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ((await adaApi("GET", "/api/bootstrap")).tournaments as any[]).find((t) => t.typeId === 1 && t.heldOn);

  await stage("1. The Kumite scheduled: sign-up opens", async () => {
    for (const who of [fay, nell])
      await checks(who, "can't schedule a Kumite", async () => {
        await open(who);
        await expect(who.page.getByRole("heading", { name: "No Kumite yet" })).toBeVisible();
        await expect(who.page.getByRole("button", { name: "Next Kumite" })).toHaveCount(0);
      });

    await does(
      ada,
      "schedules the next Kumite for today, sign-up opening today, three captains, then Advanced: nine places",
      async () => {
        await open(ada);
        const wizard = ada.page.getByRole("dialog", { name: "The next Kumite" });
        await ada.page.getByRole("button", { name: "Next Kumite" }).click();
        await wizard.getByRole("button", { name: /^Day:/ }).click();
        await ada.page.getByRole("button", { name: todayLabel() }).click();
        await wizard.getByRole("button", { name: "Next · Sign-up" }).click();
        await expect(wizard.getByRole("button", { name: "Sign-up opens" })).toHaveText(todayLabel());
        await wizard.getByRole("button", { name: "Next · Captains" }).click();
        for (const captain of ["Cara Captain", "Cole Captain", "Cass Captain"])
          await wizard.getByRole("button", { name: `Add ${captain} as a captain` }).click();
        // The quick questions don't ask how many places: the full editor does, with the answers filled in
        await wizard.getByRole("button", { name: "Advanced" }).click();
        await wizard.getByRole("tab", { name: "Sign-up" }).click();
        await wizard.getByRole("spinbutton", { name: "Places" }).fill("9");
        await wizard.getByRole("button", { name: "Schedule it" }).click();
        // On a Friday it's over Friday Training: asked, it keeps both (ADR 0122)
        const clash = ada.page.getByRole("dialog", { name: "Already on then" });
        const scheduled = ada.page.getByRole("button", { name: "Save" });
        await expect(clash.or(scheduled).first()).toBeVisible();
        if (await clash.isVisible()) {
          await clash.getByRole("button", { name: "Keep both" }).click();
          await clash.getByRole("button", { name: "Save" }).click();
        }
        // Scheduled, the panel goes on to its editor; closed, the page has it
        await expect.poll(async () => (await kumite())?.capacity).toBe(9);
        await ada.page.keyboard.press("Escape");
        await expect(ada.page.getByRole("dialog")).toHaveCount(0);
      },
    );
  });

  const { id } = await kumite();
  const members = (await adaApi("GET", "/api/bootstrap")).members as { id: number; name: string }[];
  const memberId = (name: string) => members.find((m) => m.name === name)!.id;
  /** The Kumite as last read, for its teams. */
  let cached = await kumite();
  const captainOf = (teamId: number) => {
    const team = (cached.teams as { id: number; captainMemberId: number }[]).find((x) => x.id === teamId)!;
    return members.find((m) => m.id === team.captainMemberId)!.name;
  };
  /** A team none has named yet goes by its captain's: "Team Cara". */
  const teamName = (teamId: number) => `Team ${captainOf(teamId).split(" ")[0]}`;

  await stage("2. Players sign up", async () => {
    await does(fay, "accepts her invitation and is in", async () => {
      await open(fay);
      const invite = fay.page.getByRole("article", { name: "Your invitation to the Kumite" });
      await invite.getByRole("button", { name: "Accept" }).click();
      await expect(fay.page.getByRole("button", { name: "Fay Forward: see their card" })).toBeVisible();
    });

    // A shortcut to a card with enough on it: the other players say they're in through the API, as themselves
    for (const email of ["gus", "gwen", "gil", "sam", "dee"].map((n) => `${n}@example.com`))
      await asMember(email)("POST", `/api/tournaments/${id}/answer`, { answer: "in" });

    await checks(nell, "declines her invitation, and isn't in", async () => {
      await open(nell);
      await nell.page
        .getByRole("article", { name: "Your invitation to the Kumite" })
        .getByRole("button", { name: "Decline" })
        .click();
      await expect(nell.page.getByRole("heading", { name: /Who's in 9/ })).toBeVisible();
      await expect(nell.page.getByRole("heading", { name: "Declined 1" })).toBeVisible();
    });

    for (const who of [fay, nell])
      await checks(who, "can't manage the Kumite", async () => {
        await open(who);
        await expect(who.page.getByRole("button", { name: "Manage the Kumite" })).toHaveCount(0);
      });

    await checks(nell, "can't get a place once the card's full: she'd be a reserve", async () => {
      await open(nell, `${KUMITE}/sign-up`);
      await expect(nell.page.getByText("Changed your mind? You'd be a reserve.")).toBeVisible();
    });

    await does(ada, "closes sign-up from the sign-up view", async () => {
      await open(ada);
      await ada.page.getByRole("button", { name: "Close sign-up" }).click();
      await expect(ada.page.getByRole("status", { name: "Status: Draft open" })).toBeVisible();
    });

    await checks(nell, "can't sign up once sign-up's closed", async () => {
      await open(nell, `${KUMITE}/sign-up`);
      await expect(nell.page.getByRole("button", { name: "Accept" })).toHaveCount(0);
    });
  });

  const manage = async (who: Person) => {
    await who.page.getByRole("button", { name: "Manage the Kumite" }).click();
    return who.page.getByRole("dialog", { name: "Manage the Kumite" });
  };
  /** What Manage offers, by each job's own name ("Move to…", not its line under it). */
  const offered = async (who: Person) => {
    const menu = await manage(who);
    await expect(menu.getByRole("button").nth(1)).toBeVisible();
    const jobs = await menu.locator("button strong").allTextContents();
    await menu.getByRole("button", { name: "Close", exact: true }).click();
    return jobs;
  };

  await stage("3. The order drawn", async () => {
    await checks(ada, "has the order to draw, now sign-up's closed", async () => {
      await expect(ada.page.getByRole("heading", { name: "Draw the order" })).toBeVisible();
    });

    await does(ada, "draws the order (Shuffle)", async () => {
      await ada.page.getByRole("button", { name: "Shuffle" }).click();
      await expect(ada.page.getByRole("region", { name: "Pick order" }).getByRole("listitem")).toHaveCount(3);
      await expect(ada.page.getByRole("button", { name: "Open draft" })).toBeVisible();
    });

    for (const who of [fay, nell])
      await checks(who, "can't see the draft (fighting blind), nor run it", async () => {
        await open(who);
        await expect(who.page.getByRole("heading", { name: "Fighting blind" })).toBeVisible();
        await expect(who.page.getByRole("button", { name: /Shuffle|Open draft/ })).toHaveCount(0);
      });

    await does(ada, "opens the draft", async () => {
      await open(ada);
      await ada.page.getByRole("button", { name: "Open draft" }).click();
      await expect(ada.page.getByRole("link", { name: "Enter the draft room" })).toBeVisible();
    });
  });

  await stage("4. The draft: the captains choose", async () => {
    const captains = new Map<number, Person>();
    for (const [name, email] of [
      ["Cara Captain", "cara@example.com"],
      ["Cole Captain", "cole@example.com"],
      ["Cass Captain", "cass@example.com"],
    ]) {
      const captain = await signIn(browser, "Captain", name, email);
      await open(captain, `${KUMITE}/draft/room`);
      captains.set(memberId(name), captain);
    }

    await checks(ada, "Manage has the draft's jobs and no awards", async () => {
      await open(ada);
      const jobs = await offered(ada);
      expect(jobs).toEqual(expect.arrayContaining(["Close it now", "Back to the drawn order", "Pick log"]));
      expect(jobs).not.toContain("Confirm the awards");
    });
    for (const who of [fay, nell])
      await checks(who, "can't enter the draft room", async () => {
        await open(who);
        await expect(who.page.getByRole("heading", { name: "Fighting blind" })).toBeVisible();
        await expect(who.page.getByRole("link", { name: "Enter the draft room" })).toHaveCount(0);
      });

    // A goalie each in the first round, then a skater each (a team takes one goalie); the order snakes
    const rounds = [
      ["Gus Goalie", "Gwen Glove", "Gil Pads"],
      ["Fay Forward", "Sam Skater", "Dee Defence"],
    ];
    for (const [round, players] of rounds.entries())
      for (const [i, player] of players.entries()) {
        const order = ((await kumite()).teams as { id: number; pick: number; captainMemberId: number }[]).sort(
          (a, b) => a.pick - b.pick,
        );
        const team = (round % 2 ? order.reverse() : order)[i];
        const captain = captains.get(team.captainMemberId)!;
        if (round === 0 && i === 0)
          for (const other of captains.values())
            if (other !== captain)
              await checks(other, "can't choose while another team is choosing", async () => {
                await expect(other.page.getByRole("region", { name: "Players" })).toBeVisible();
                await expect(other.page.getByRole("button", { name: `Choose ${player}` })).toHaveCount(0);
              });
        await does(captain, `chooses ${player}`, async () => {
          await captain.page.getByRole("button", { name: `Choose ${player}` }).click();
          await captain.page.getByRole("button", { name: `Yes, ${player}` }).click();
          await expect
            .poll(async () => ((await kumite()).teams as typeof order).find((x) => x.id === team.id))
            .toMatchObject({
              players: expect.arrayContaining([expect.objectContaining({ memberId: memberId(player) })]),
            });
        });
      }
    for (const captain of captains.values()) await captain.context.close();
  });

  await stage("5. Teams set, and the fixtures", async () => {
    await does(ada, "seals the teams, and the fixtures are made", async () => {
      await open(ada);
      await ada.page.getByRole("button", { name: "Close draft & make fixtures" }).click();
      // On its day, the fixtures out is the Kumite itself (ADR 0074)
      await expect(ada.page.getByRole("status", { name: "Status: Kumite!" })).toBeVisible();
    });

    for (const who of everyone)
      await checks(who, "sees the three teams in full", async () => {
        await open(who, `${KUMITE}/teams`);
        await expect(who.page.getByRole("link", { name: /^Team \w+ .*3 players/ })).toHaveCount(3);
      });
    await checks(fay, "sees her own team first", async () => {
      await expect(fay.page.getByRole("link", { name: /^Team \w+ .*3 players/ }).first()).toContainText(
        /Your team[\s\S]*Fay Forward/,
      );
    });

    for (const who of everyone)
      await checks(who, "sees the fixtures: three matches", async () => {
        await open(who, `${KUMITE}/schedule`);
        await expect(who.page.getByRole("link", { name: /^Game \d:/ })).toHaveCount(3);
      });

    await checks(ada, "Manage offers to make the fixtures again, and no awards", async () => {
      await open(ada);
      const jobs = await offered(ada);
      expect(jobs).toContain("Make the fixtures again");
      expect(jobs).not.toContain("Confirm the awards");
    });
    for (const who of [fay, nell])
      await checks(who, "can't manage the Kumite", async () => {
        await open(who);
        await expect(who.page.getByRole("button", { name: "Manage the Kumite" })).toHaveCount(0);
      });
    await checks(fay, "can still take herself off before a match starts (Punk out)", async () => {
      await open(fay, `${KUMITE}/sign-up`);
      await expect(fay.page.getByRole("button", { name: "Punk out" })).toBeVisible();
    });
  });

  await stage("6. KUMITE!: the matches scored live", async () => {
    cached = await kumite();
    const [first] = cached.games as { id: number; awayTeamId: number }[];
    const live = `${KUMITE}/games/${first.id}/live`;
    // The order was drawn at random: the first match's away team, its captain scoring
    const awayName = teamName(first.awayTeamId);
    const scorer = captainOf(first.awayTeamId);
    // Fay and Nell watch the first match as it's scored
    for (const who of [fay, nell]) await open(who, live);

    await does(ada, "keeps score of the first match and starts the game", async () => {
      await open(ada, live);
      await ada.page.getByRole("button", { name: "Keep score" }).click();
      await ada.page.getByRole("button", { name: "Start the game" }).click();
      await expect(ada.page.getByRole("button", { name: "Pause" })).toBeVisible();
    });

    await does(ada, "logs a goal for the away team, its captain scoring, no assist", async () => {
      await ada.page.getByRole("button", { name: "Goal" }).last().click();
      await ada.page.getByRole("dialog", { name: "Who scored?" }).getByRole("button", { name: scorer }).click();
      await ada.page.getByRole("dialog", { name: "Who assisted?" }).getByRole("button", { name: "No assist" }).click();
      await expect(ada.page.getByRole("row", { name: `${awayName} 1` })).toBeVisible();
    });

    for (const who of [fay, nell])
      await checks(who, "sees the goal come in live, and who's keeping score", async () => {
        await expect(who.page.getByRole("row", { name: `${awayName} 1` })).toBeVisible();
        await expect(who.page.getByText("Score kept by Ada Admin")).toBeVisible();
      });
    for (const who of [fay, nell])
      await checks(who, "can't take the scoresheet while Ada has it", async () => {
        await expect(who.page.getByRole("button", { name: "Keep score" })).toHaveCount(0);
        await expect(who.page.getByRole("button", { name: "Goal" })).toHaveCount(0);
      });

    await checks(fay, "can't take herself off once it's live", async () => {
      const own = await fay.context.newPage();
      await own.goto(`${KUMITE}/sign-up`);
      await expect(own.getByText("On the card. Ask an admin to change it.")).toBeVisible();
      await expect(own.getByRole("button", { name: "Punk out" })).toHaveCount(0);
      await own.close();
    });

    await does(ada, "calls full time", async () => {
      await ada.page.getByRole("button", { name: "You're keeping score: tools" }).click();
      await ada.page.getByRole("button", { name: /^Full time now/ }).click();
      await ada.page.getByRole("button", { name: /^Tap again: full time/ }).click();
      await expect
        .poll(async () => ((await kumite()).games as { status: string }[])[0])
        .toMatchObject({ status: "done", awayGoals: 1, homeGoals: 0 });
    });

    await checks(ada, "Manage has no awards while matches are still to play", async () => {
      await open(ada);
      expect(await offered(ada)).not.toContain("Confirm the awards");
    });

    // The other two matches aren't what this journey tests: the dev simulator plays them out (ADR 0123)
    await does(ada, "plays out the rest (Manage → Play out the Kumite, Spin kick)", async () => {
      await open(ada);
      await (await manage(ada)).getByRole("button", { name: /^Play out the Kumite/ }).click();
      await ada.page.getByRole("button", { name: "Play it out" }).click();
      await ada.page.getByRole("region", { name: "Simulation" }).getByRole("button", { name: "Spin kick" }).click();
      await expect
        .poll(async () => ((await kumite()).games as { status: string }[]).every((g) => g.status === "done"), {
          timeout: 180_000,
          intervals: [2000],
        })
        .toBe(true);
    });
  });

  await stage("7. The Anchor: the vote", async () => {
    for (const who of everyone)
      await checks(who, "sees the Kumite at The Anchor, with the final table", async () => {
        await open(who);
        await expect(who.page.getByRole("status", { name: "Status: The Anchor" })).toBeVisible();
        await expect(who.page.getByRole("heading", { name: "The final table" })).toBeVisible();
      });

    await checks(nell, "can't vote: she didn't play", async () => {
      await open(nell);
      await expect(nell.page.getByRole("region", { name: "The awards" })).toContainText("Waiting for the reveal");
      await expect(nell.page.getByRole("button", { name: "Vote" })).toHaveCount(0);
    });
    for (const who of [fay, nell])
      await checks(who, "can't confirm the awards", async () => {
        await open(who);
        await expect(who.page.getByRole("button", { name: "Confirm the awards" })).toHaveCount(0);
        await expect(who.page.getByRole("button", { name: "Manage the Kumite" })).toHaveCount(0);
      });

    await does(fay, "votes for Best keeper", async () => {
      await open(fay);
      await fay.page.getByRole("region", { name: "Cast your vote" }).getByRole("button", { name: "Vote" }).click();
      const sheet = fay.page.getByRole("dialog", { name: "Cast your vote" });
      await sheet.getByRole("listbox", { name: "Your vote for Best keeper" }).getByRole("option").first().click();
      await sheet.getByRole("button", { name: "Cast your vote" }).click();
      await expect(sheet).toHaveCount(0);
    });

    await checks(ada, "sees Fay's vote counted, and Manage offers to confirm the awards", async () => {
      await open(ada);
      await expect(ada.page.getByRole("region", { name: "The awards" })).toContainText("Best keeper: 1 of 6 voted");
      expect(await offered(ada)).toContain("Confirm the awards");
    });
  });

  await stage("8. The awards confirmed, then revealed one by one", async () => {
    await does(ada, "confirms the awards, making the judges' call", async () => {
      await open(ada);
      await ada.page
        .getByRole("region", { name: "The awards" })
        .getByRole("button", { name: "Confirm the awards" })
        .click();
      const drawer = ada.page.getByRole("dialog", { name: "Confirm the awards" });
      await drawer.getByRole("button", { name: "Make the call" }).click();
      const call = ada.page.getByRole("dialog", { name: "The Judges' Call" });
      await call.getByRole("option", { name: "Best Celly" }).click();
      await call.getByRole("option", { name: /^Fay Forward/ }).click();
      await call.getByRole("button", { name: "Make the call" }).click();
      await expect(call).toHaveCount(0);
      await drawer.getByRole("button", { name: "Confirm the awards" }).click();
      await expect(drawer).toHaveCount(0);
      await expect.poll(async () => (await kumite()).awardsConfirmedAt).not.toBeNull();
    });

    await checks(fay, "can't vote once they're confirmed", async () => {
      await open(fay);
      await expect(fay.page.getByRole("button", { name: "Vote" })).toHaveCount(0);
    });
    await checks(ada, "Manage offers to change the awards, till the reveal", async () => {
      await open(ada);
      const jobs = await offered(ada);
      expect(jobs).toContain("Change the awards");
      expect(jobs).not.toContain("Confirm the awards");
    });

    // Everyone on the awards' page, watching the stage
    const awards = `${KUMITE}/awards`;
    for (const who of everyone) await open(who, awards);
    for (const who of [fay, nell])
      await checks(who, "waits for the reveal: no Reveal of her own", async () => {
        await expect(who.page.getByText("Waiting for the reveal")).toBeVisible();
        await expect(who.page.getByRole("button", { name: /^(Reveal|Next award|The champions)$/ })).toHaveCount(0);
      });

    // The judges' call, Top scorer, Best keeper, then the champions, the finale
    const total = ((await kumite()).awards as unknown[]).length;
    for (let n = 1; n <= total; n++) {
      const last = n === total;
      await does(ada, `reveals award ${n} of ${total}${last ? ", the champions" : ""}`, async () => {
        if (n > 1) await ada.page.getByRole("button", { name: "Next award", exact: true }).click();
        await expect(ada.page.getByText(`${n} of ${total}`)).toBeVisible();
        // The champions' card is revealed by its own button, the finale
        await ada.page.getByRole("button", { name: last ? "The champions" : "Reveal", exact: true }).click();
        await expect.poll(async () => (await kumite()).awardsRevealed).toBe(n);
      });
      if (n === 1)
        for (const who of [fay, nell])
          await checks(who, "sees the judges' call revealed live: Best Celly, Fay", async () => {
            await expect(who.page.getByText("Best Celly")).toBeVisible();
            await expect(who.page.getByText("Fay Forward").first()).toBeVisible();
          });
      if (n === 1)
        await checks(ada, "can't change the awards once the reveal's started", async () => {
          const other = await ada.context.newPage();
          await other.goto(KUMITE);
          await other.getByRole("button", { name: "Manage the Kumite" }).click();
          const menu = other.getByRole("dialog", { name: "Manage the Kumite" });
          await expect(menu.getByRole("button", { name: /^Move to…/ })).toBeVisible();
          await expect(menu.getByRole("button", { name: /^(Change|Confirm) the awards/ })).toHaveCount(0);
          await other.close();
        });
    }
  });

  await stage("9. Done: the champions, every award, the final table", async () => {
    cached = await kumite();
    const champions = (cached.winners as { award: string; teamId: number }[]).find((w) => w.award === "Champions")!;
    const championsName = teamName(champions.teamId);
    for (const who of everyone)
      await checks(
        who,
        `sees the end: ${championsName} the champions, every award face up, the final table`,
        async () => {
          await expect(who.page.getByText(championsName).first()).toBeVisible();
          for (const award of ["Best Celly", "Top scorer", "Best keeper"])
            await expect(who.page.getByText(award).first()).toBeVisible();
          await expect(who.page.getByRole("heading", { name: "The final table" })).toBeVisible({ timeout: 15_000 });
          await expect(who.page.getByRole("list", { name: "The awards" }).getByRole("listitem")).toHaveCount(3);
          // No card still sealed, as a screen reader has the page (a winner's area says "?" till it's out)
          await expect.poll(async () => who.page.getByRole("main").ariaSnapshot()).not.toMatch(/: "\?"$/m);
        },
      );
    await checks(ada, "has nothing left to press on the stage", async () => {
      await expect(ada.page.getByRole("button", { name: /^(Reveal|Next award|The champions)$/ })).toHaveCount(0);
    });
    await checks(ada, "Manage has no awards to confirm or change, only Back to before the awards", async () => {
      await open(ada);
      const jobs = await offered(ada);
      expect(jobs).toContain("Back to before the awards");
      expect(jobs).not.toContain("Confirm the awards");
      expect(jobs).not.toContain("Change the awards");
    });
  });

  noFailedChecks();
  for (const who of everyone) await who.context.close();
});
