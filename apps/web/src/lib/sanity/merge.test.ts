import { describe, expect, it } from "vitest";
import { FALLBACK_CLUB, FALLBACK_FRIDAYS, FALLBACK_KUMITE, FALLBACK_PUB, FALLBACK_TEAM } from "./fallback";
import { listOr, mergeClub, mergeFridays, mergeKumite, mergePub, mergeTeam } from "./merge";

// Fixtures are shaped like the GROQ projections in queries.ts return them: missing fields come back as null.
describe("club facts singletons", () => {
  it("use the whole fallback when the document doesn't exist yet", () => {
    expect(mergeClub(FALLBACK_CLUB, null)).toEqual(FALLBACK_CLUB);
    expect(mergeFridays(FALLBACK_FRIDAYS, null)).toEqual(FALLBACK_FRIDAYS);
    expect(mergePub(FALLBACK_PUB, null)).toEqual(FALLBACK_PUB);
    expect(mergeTeam(FALLBACK_TEAM, null)).toEqual(FALLBACK_TEAM);
    expect(mergeKumite(FALLBACK_KUMITE, null)).toEqual(FALLBACK_KUMITE);
  });

  it("keep values from Sanity", () => {
    const pub = mergePub(FALLBACK_PUB, { name: "The Latchmere", about: "Round the corner.", mapUrl: "https://m.ap" });
    expect(pub).toEqual({ name: "The Latchmere", about: "Round the corner.", mapUrl: "https://m.ap" });
  });

  it("merge the venue field by field, so a partial venue never blanks the name", () => {
    const f = mergeFridays(FALLBACK_FRIDAYS, {
      training: null,
      venue: { name: null, address: "London SW11 9ZZ", mapUrl: null },
      kitNotes: null,
      firstSessionKit: null,
      feesText: null,
    });
    expect(f.venue).toEqual({ ...FALLBACK_FRIDAYS.venue, address: "London SW11 9ZZ" });
  });

  it("fall back to the default sessions when the list is empty or every session is incomplete", () => {
    const base = { venue: null, kitNotes: null, firstSessionKit: null, feesText: null };
    expect(mergeFridays(FALLBACK_FRIDAYS, { ...base, training: [] }).training).toEqual(FALLBACK_FRIDAYS.training);
    const half = [{ title: "Friday session", day: null, start: "19:30", end: "21:30", description: null }];
    expect(mergeFridays(FALLBACK_FRIDAYS, { ...base, training: half }).training).toEqual(FALLBACK_FRIDAYS.training);
  });

  it("keep the complete sessions from Sanity", () => {
    const sunday = { title: "Sunday skills", day: "Sunday", start: "10:00", end: "12:00", description: null };
    const f = mergeFridays(FALLBACK_FRIDAYS, { training: [sunday, { title: "Draft", day: null }] });
    expect(f.training).toEqual([sunday]);
  });

  it("treat blank strings as missing for required fields", () => {
    const club = mergeClub(FALLBACK_CLUB, { founded: null, contactEmail: "  ", socials: null });
    expect(club.founded).toBe(FALLBACK_CLUB.founded);
    expect(club.contactEmail).toBe(FALLBACK_CLUB.contactEmail);
  });

  it("leave optional fields empty once the document exists, rather than showing the default", () => {
    const f = mergeFridays(FALLBACK_FRIDAYS, { firstSessionKit: null, feesText: "" });
    expect(f.firstSessionKit).toBeNull();
    expect(f.feesText).toBeNull();
    expect(f.kitNotes).toBe(FALLBACK_FRIDAYS.kitNotes);

    const club = mergeClub(FALLBACK_CLUB, { founded: 1996, contactEmail: "a@b.co", socials: { instagram: null } });
    expect(club.socials).toEqual({ instagram: null, facebook: null, youtube: null });
    expect(mergeClub(FALLBACK_CLUB, { founded: 1996, socials: null }).socials).toEqual(club.socials);

    expect(mergeTeam(FALLBACK_TEAM, { intro: "We play.", league: null, photo: null })).toEqual({
      onWebsite: false,
      intro: "We play.",
      league: null,
      photo: null,
    });
  });

  it("keep the team and the Kumite off the website until an editor switches them on", () => {
    expect(mergeTeam(FALLBACK_TEAM, { intro: "We play.", onWebsite: null }).onWebsite).toBe(false);
    expect(mergeTeam(FALLBACK_TEAM, { intro: "We play.", onWebsite: true }).onWebsite).toBe(true);
    expect(mergeKumite(FALLBACK_KUMITE, { intro: "Twice a year.", onWebsite: null }).onWebsite).toBe(false);
    expect(mergeKumite(FALLBACK_KUMITE, { intro: "Twice a year.", onWebsite: true }).onWebsite).toBe(true);
  });

  it("fall back to the default lists when the Kumite format or awards are empty", () => {
    const k = mergeKumite(FALLBACK_KUMITE, { intro: "Twice a year.", format: [], awards: null });
    expect(k).toEqual({ ...FALLBACK_KUMITE, intro: "Twice a year." });
  });
});

describe("listOr", () => {
  const demo = ["sample"];
  it("prefers Sanity's list", () => expect(listOr(["real"], demo)).toEqual(["real"]));
  it("uses the demo list when Sanity's is empty or missing", () => {
    expect(listOr([], demo)).toEqual(demo);
    expect(listOr(null, demo)).toEqual(demo);
  });
  it("is empty without demo content", () => expect(listOr([], null)).toEqual([]));
});
