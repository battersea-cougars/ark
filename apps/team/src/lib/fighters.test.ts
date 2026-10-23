// The Kumite's fighters (ADR 0074): your number is your place in the sign-up order, as Who's in has always counted
// it; the waitlist are the reserves, numbered in theirs; said out, you declined.
import { describe, expect, it } from "vitest";
import { fighterLabel, fighterNo, fighterOf } from "./fighters";

const t = { going: [4, 9, 7], waitlist: [12, 3], out: [5] };

describe("a fighter's number", () => {
  it("is your place in the sign-up order", () => {
    expect(fighterOf(t, 7)).toEqual({ is: "fighter", no: 3 });
    expect(fighterOf(t, 4)).toEqual({ is: "fighter", no: 1 });
  });
  it("on the waitlist you're a reserve, numbered in its order", () => {
    expect(fighterOf(t, 3)).toEqual({ is: "reserve", no: 2 });
  });
  it("said out, you declined; not answered, nothing", () => {
    expect(fighterOf(t, 5)).toEqual({ is: "declined" });
    expect(fighterOf(t, 99)).toBeNull();
    expect(fighterOf({ going: [], waitlist: [] }, 5)).toBeNull();
  });
  it("is printed on the pass with two figures, said plainly elsewhere", () => {
    expect(fighterNo(7)).toBe("07");
    expect(fighterNo(23)).toBe("23");
    expect(fighterLabel({ is: "fighter", no: 7 })).toBe("Fighter No. 7");
    expect(fighterLabel({ is: "reserve", no: 3 })).toBe("Reserve No. 3");
    expect(fighterLabel({ is: "declined" })).toBe("Declined");
  });
});
