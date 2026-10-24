// What a tournament's editor saves, and what it leaves to the tournament's own pages (ADR 0030, 0074): driven through
// the real Worker handlers in the fake world (testing.ts), with the body the app sends (lib/tournament-body.ts).
//
// The user (2026-10-23): a team's name and look are edited only on the team's own page ("Edit the team"), never in the
// Kumite editor; and the editor has no Status: stages change only on the Kumite's page (Manage: Close sign-up,
// Move to…). So an editor opened before either, and saved after, changes neither back.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { logoAt, testWorld } from "../testing";
import { tournamentBody } from "../../src/lib/tournament-body";

const ROSTER = [
  { name: "Dana Admin", position: "D", rating: 75, email: "dana@example.com", roles: ["Admin"] },
  { name: "Cara Captain", position: "F", rating: 70, email: "cara@example.com" },
  { name: "Cole Captain", position: "D", rating: 68, email: "cole@example.com" },
  { name: "Reg Player", position: "F", rating: 60, email: "reg@example.com" },
  { name: "Mo Player", position: "G", rating: 55, email: "mo@example.com" },
  { name: "Ash Player", position: "F", rating: 58, email: "ash@example.com" },
  { name: "Bo Player", position: "D", rating: 52, email: "bo@example.com" },
];
const at = { now: new Date("2026-12-08T19:30:00Z") };
const CREST = "data:image/png;base64,iVBORw0KGgo=";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Json = any;
let w: ReturnType<typeof testWorld>;
beforeEach(() => {
  vi.spyOn(console, "log").mockImplementation(() => {});
  w = testWorld(ROSTER);
});

/** The admin with a tournament scheduled: a draft (Cara and Cole captains) or one that teams enter. */
async function scheduled(kind: "draft" | "teams") {
  const dana = await w.signedIn("dana@example.com");
  const boot = async () => (await dana.call("GET", "/api/bootstrap", undefined, at)).body as Json;
  const idOf = async (name: string) => (await boot()).members.find((m: Json) => m.name === name).id as number;
  const cara = await idOf("Cara Captain");
  const cole = await idOf("Cole Captain");
  const made = await dana.call("POST", "/api/tournaments", {
    name: "Kumite Winter 2026",
    heldOn: "2026-12-12",
    startTime: "11:00",
    endTime: "16:00",
    status: "open",
    feePence: 0,
    kind,
    signupClosesOn: "2026-12-10",
    teams:
      kind === "draft"
        ? [cara, cole].map((captainMemberId) => ({ name: "", captainMemberId }))
        : [{ name: "Ice Breakers", captainMemberId: cara, players: [] }],
  });
  expect(made.status).toBe(201);
  const id = made.body.id as number;
  const tournament = async () => (await boot()).tournaments.find((x: Json) => x.id === id);
  return {
    dana,
    id,
    cara,
    cole,
    tournament,
    /** The editor's Save, as the app sends it, from what it opened with (and any change made in it). */
    save: (opened: Json) => dana.call("PUT", `/api/tournaments/${id}`, tournamentBody(opened), at),
  };
}

describe("an admin's editor leaves the stage to the Kumite's page", () => {
  it("the editor sends no status: opened at Sign-up open, saved after Move to The Anchor, it stays finished", async () => {
    const k = await scheduled("draft");
    const opened = await k.tournament();
    expect(opened.status).toBe("open");
    expect(tournamentBody(opened)).not.toHaveProperty("status");
    // Enough in for a draft of two, then the Kumite's page moves it on (Manage: Move to…)
    for (const who of ["reg", "mo", "ash", "bo"]) {
      const member = await w.signedIn(`${who}@example.com`);
      expect((await member.call("POST", `/api/tournaments/${k.id}/answer`, { answer: "in" }, at)).status).toBe(200);
    }
    const moved = await k.dana.call("POST", `/api/tournaments/${k.id}/move`, { from: "signup", to: "afters" }, at);
    expect(moved.status).toBe(200);
    expect((await k.save({ ...opened, capacity: 30 })).status).toBe(200);
    expect(await k.tournament()).toMatchObject({ status: "finished", capacity: 30 });
  });
});

describe("a team's name and logo are its page's, never the editor's", () => {
  it("a captain renames their team on its page while the admin's editor is open: the editor's Save keeps the new name and logo", async () => {
    const k = await scheduled("draft");
    const opened = await k.tournament();
    const team = opened.teams.find((t: Json) => t.captainMemberId === k.cara);
    const caraP = await w.signedIn("cara@example.com");
    expect(
      (
        await caraP.call("PUT", `/api/tournaments/${k.id}/teams/${team.id}/look`, {
          name: "Dux's Disciples",
          logo: CREST,
        })
      ).status,
    ).toBe(200);
    expect((await k.save({ ...opened, capacity: 30 })).status).toBe(200);
    const after = (await k.tournament()).teams.find((t: Json) => t.id === team.id);
    expect({ name: after.name, logo: await logoAt(caraP, after.logo) }).toEqual({
      name: "Dux's Disciples",
      logo: CREST,
    });
  });

  it("the editor changes a team's captain and keeps the team: same id, same name", async () => {
    const k = await scheduled("teams");
    const opened = await k.tournament();
    const team = opened.teams[0];
    expect(tournamentBody(opened).teams[0]).not.toHaveProperty("name");
    expect((await k.save({ ...opened, teams: [{ ...team, captainMemberId: k.cole }] })).status).toBe(200);
    expect((await k.tournament()).teams).toMatchObject([
      { id: team.id, name: "Ice Breakers", captainMemberId: k.cole },
    ]);
  });

  it("a team that enters, new in the editor, is registered with the name it's given there; one with none is refused", async () => {
    const k = await scheduled("teams");
    const opened = await k.tournament();
    const fresh = {
      name: "Puck Norris",
      logo: null,
      captainMemberId: null,
      captainName: "Walt",
      contact: "",
      players: [],
    };
    expect((await k.save({ ...opened, teams: [...opened.teams, { ...fresh, name: "" }] })).status).toBe(400);
    expect((await k.save({ ...opened, teams: [...opened.teams, fresh] })).status).toBe(200);
    expect((await k.tournament()).teams.map((t: Json) => t.name)).toEqual(["Ice Breakers", "Puck Norris"]);
  });
});
