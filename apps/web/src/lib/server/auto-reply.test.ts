import { describe, expect, it } from "vitest";
import { autoReplyMail, greetingName } from "./auto-reply";
import { FALLBACK_CLUB, FALLBACK_FRIDAYS, FALLBACK_KUMITE, FALLBACK_PUB, FALLBACK_TEAM } from "../sanity/fallback";
import type { SiteSettings } from "../sanity/types";

const settings: SiteSettings = {
  ...FALLBACK_CLUB,
  ...FALLBACK_FRIDAYS,
  pub: FALLBACK_PUB,
  team: FALLBACK_TEAM,
  kumite: { ...FALLBACK_KUMITE, awards: FALLBACK_KUMITE.awards.map((name) => ({ name })), next: null },
};
const enquiry = {
  name: "Jo Bloggs",
  email: "jo@example.com",
  phone: null,
  experience: null,
  message: "hi",
  source: null,
};

describe("greetingName", () => {
  it("uses a plain first name", () => {
    expect(greetingName("  Jo Bloggs ")).toBe("Jo");
    expect(greetingName("Zoë O'Neil")).toBe("Zoë");
    expect(greetingName("Anne-Marie")).toBe("Anne-Marie");
  });

  it("says 'there' for anything a spammer could use", () => {
    for (const name of ["https://spam.example", "Cheap!!!", "www.spam.example pills", "x".repeat(40), "", "😀"]) {
      expect(greetingName(name)).toBe("there");
    }
  });
});

describe("autoReplyMail", () => {
  it("goes to the enquirer, replies go to the club, and it states only the site's facts", () => {
    const mail = autoReplyMail(enquiry, settings, "club@example.com");
    expect(mail).toMatchObject({ to: ["jo@example.com"], replyTo: "club@example.com" });
    expect(mail.text).toMatch(/^Hi Jo,/);
    expect(mail.text).toContain("We play Fridays, 19:30–21:30 at Battersea Sports Centre, London SW11 3AB.");
    expect(mail.text).toContain(FALLBACK_FRIDAYS.firstSessionKit!);
    expect(mail.text).toContain(FALLBACK_FRIDAYS.kitNotes);
  });

  it("never repeats what the sender wrote, beyond the first name", () => {
    const mail = autoReplyMail({ ...enquiry, message: "Visit spam.example" }, settings, "club@example.com");
    expect(mail.text).not.toContain("spam.example");
    expect(mail.html).not.toContain("spam.example");
  });

  it("comes in the club's frame: the session, a map button, the kit, and no images or scripts", () => {
    const mail = autoReplyMail(enquiry, settings, "club@example.com");
    expect(mail.html).toContain("Cougars");
    expect(mail.html).toContain("Hi Jo,");
    expect(mail.html).toContain("Fridays");
    expect(mail.html).toContain("19:30–21:30");
    expect(mail.html).toContain("Battersea Sports Centre");
    expect(mail.html).toContain(`href="${FALLBACK_FRIDAYS.venue.mapUrl}"`);
    expect(mail.html).toContain("Helmet, gloves and shin pads are non-negotiable.");
    expect(mail.html).not.toMatch(/<img|<script/);
  });
});
