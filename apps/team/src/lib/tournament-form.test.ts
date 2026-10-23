import { describe, expect, it } from "vitest";
import { blankForm, feePence, formDay, nextInSeries, setDay, setSeason, toTournament } from "./tournament-form";
import type { TournamentType } from "../demo/model";

const kumite = {
  id: 1,
  name: "The Cougars Kumite",
  defaultFeePence: 1000,
  defaultStartTime: "11:00",
  defaultEndTime: "17:00",
  venueId: 2,
  location: "",
  mapUrl: "",
  pointsWin: 3,
  pointsDraw: 1,
  pointsLoss: 0,
  gameMinutes: 10,
  penaltyRule: "power_play",
  periods: 2,
  defaultPenaltyMinutes: 2,
  breakMinutes: 1,
  kind: "draft",
  awards: [{ name: "MVP", line: "" }],
  playoffs: [{ name: "Final", home: 1, away: 2 }],
} as unknown as TournamentType;

describe("the form the wizard and the editor share", () => {
  it("the next one in a series starts from its defaults: next summer, sign-up opening today", () => {
    const f = nextInSeries(kumite, "2027-09-01");
    expect(f).toMatchObject({ name: "The Cougars Kumite", fee: "10", startTime: "11:00", endTime: "17:00" });
    expect(f).toMatchObject({ venueId: 2, kind: "draft", periods: 2, season: "summer", seasonYear: 2028 });
    expect(f.signupOpensOn).toBe("2027-09-01");
    // Its own copy: changing this one's leaves the series' alone
    f.playoffs[0]!.name = "Grand final";
    expect(kumite.playoffs![0]!.name).toBe("Final");
  });

  it("a day sets its season; a season the day isn't in clears it", () => {
    const f = blankForm("2027-04-01");
    setDay(f, "2027-12-05");
    expect([f.season, f.seasonYear]).toEqual(["winter", 2027]);
    setSeason(f, "winter", 2027);
    expect(f.heldOn).toBe("2027-12-05");
    setSeason(f, "summer", 2027);
    expect(f.heldOn).toBe("");
    expect(formDay(f)).toBe("2027-08-31");
  });

  it("the fee is read as pounds, or isn't one", () => {
    expect(feePence("")).toBe(0);
    expect(feePence("10")).toBe(1000);
    expect(feePence("£12.5")).toBe(1250);
    expect(feePence("ten")).toBeNaN();
    expect(feePence("1.234")).toBeNaN();
  });

  it("is sent as the tournament: a season's last day, only its own afterwards, no draft day for teams that enter", () => {
    const f = { ...nextInSeries(kumite, "2027-04-01"), afterTime: "18:00", draftOn: "2027-08-01" };
    const t = toTournament(f);
    expect(t).toMatchObject({ heldOn: "2027-08-31", season: "summer", feePence: 1000, afterTime: null });
    expect(t.draftOn).toBe("2027-08-01");
    expect(toTournament({ ...f, kind: "teams" }).draftOn).toBeNull();
    expect(toTournament({ ...f, heldOn: "2027-07-10" })).toMatchObject({ heldOn: "2027-07-10", season: null });
  });
});
