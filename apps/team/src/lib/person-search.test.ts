// Finding a member by typing (the quick create's Captains): names that start with it first, then a word that does,
// then any that has it.
import { describe, expect, it } from "vitest";
import { findPeople } from "./person-search";

const club = [
  { id: 1, name: "Sam Jones" },
  { id: 2, name: "Alex Samuels" },
  { id: 3, name: "Jo Bassam" },
  { id: 4, name: "Seán Byrne" },
  { id: 5, name: "Zoë Adams" },
  { id: 6, name: "Sam Adams" },
];
const ids = (q: string, limit?: number) => findPeople(club, q, limit).map((m) => m.id);

describe("finding someone by typing", () => {
  it("puts names that start with it first, then a word that does, then any that has it, each alphabetical", () => {
    expect(ids("sam")).toEqual([6, 1, 2, 3]);
  });

  it("ignores case and the spaces round what's typed", () => {
    expect(ids("  SAM ")).toEqual(ids("sam"));
  });

  it("with nothing typed, offers everyone, up to the limit", () => {
    expect(ids("")).toHaveLength(club.length);
    expect(ids("   ", 2)).toEqual([1, 2]);
  });

  it("stops at the limit, keeping the best matches", () => {
    expect(ids("sam", 2)).toEqual([6, 1]);
  });

  it("finds nobody when nobody matches, rather than everyone", () => {
    expect(ids("zzz")).toEqual([]);
    expect(findPeople([], "jo")).toEqual([]);
  });

  it("finds a name with an accent typed with it", () => {
    expect(ids("seán")).toEqual([4]);
    expect(ids("zoë")).toEqual([5]);
  });

  // #118: matching was by the letters as typed, so an accent left off found nobody
  it("typing a name without its accent still finds them: sean finds Seán (#118)", () => {
    expect(ids("sean")).toEqual([4]);
    expect(ids("zoe")).toEqual([5]);
  });
});
