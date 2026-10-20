import { describe, expect, it } from "vitest";
import type { Action } from "../access/actions";
import { newEventKinds } from "./new-event";

const kumite = { id: 7, shortName: "Kumite", icon: "gong" as const, tone: "red" as const, kind: "draft", active: true };
const paused = { ...kumite, id: 8, shortName: "Cup", kind: "teams", active: false };
const ids = (perms: Action[]) => newEventKinds(new Set(perms), [kumite, paused]).map((k) => k.label);

describe("newEventKinds", () => {
  it("offers an admin every kind, each running series' next date among them", () => {
    expect(ids(["manage:all"])).toEqual(["One-off event", "Training", "Next Kumite", "Tournament"]);
  });
  it("offers only what each action allows", () => {
    expect(ids(["create:Event"])).toEqual(["One-off event"]);
    expect(ids(["manage:Training"])).toEqual(["Training"]);
    expect(ids(["manage:Tournament"])).toEqual(["Next Kumite", "Tournament"]);
  });
  it("offers nothing to a member who can't create any", () => {
    expect(ids(["read:Event", "signup:Event", "update:Event"])).toEqual([]);
  });
  it("opens a series' next date in that series", () => {
    const next = newEventKinds(new Set<Action>(["manage:Tournament"]), [kumite]).find((k) => k.id === "series");
    expect(next).toMatchObject({ typeId: 7, action: "manage:Tournament" });
  });
});
