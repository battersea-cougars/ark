// The email someone gets after the "Try a session" form, if Turnstile says they're a person and the caps allow
// (docs/adr/0028-turnstile-and-auto-reply.md). Every fact comes from the Studio (or the confirmed fallbacks), so it
// never says anything the site doesn't. It goes to an address anyone can type, so nothing the sender wrote is
// repeated except a cleaned-up first name. The HTML version is in the club's frame (packages/shared/email-html.ts).
import type { Mail } from "@cougars/shared/email";
import { EMAIL, EMAIL_TYPE, emailPage, escapeHtml as h } from "@cougars/shared/email-html";
import type { SiteSettings } from "../sanity/types";
import type { Enquiry } from "./enquiries";

/** "Jo" from "Jo Bloggs"; "there" for anything that isn't plainly a name (links, symbols, very long). */
export function greetingName(name: string): string {
  const first = name.trim().split(/\s+/)[0] ?? "";
  return /^\p{L}[\p{L}'’-]{0,23}$/u.test(first) ? first : "there";
}

export function autoReplyMail(e: Enquiry, s: SiteSettings, club: string | null): Mail {
  const slot = s.training[0];
  const lines = [
    `Hi ${greetingName(e.name)},`,
    "",
    "Thanks for your interest in Battersea Cougars. We've got your details and someone from the club will get back to you soon.",
    ...(slot
      ? [
          "",
          `We play ${slot.day}s, ${slot.start} to ${slot.end} at ${s.venue.name}, ${s.venue.address}.`,
          `Map: ${s.venue.mapUrl}`,
        ]
      : []),
    "",
    ...(s.firstSessionKit ? [s.firstSessionKit] : []),
    s.kitNotes,
    "",
    "See you on court,",
    "Battersea Cougars",
  ];
  return {
    to: [e.email],
    subject: "Thanks for getting in touch, Battersea Cougars",
    text: lines.join("\n"),
    html: autoReplyHtml(e, s, club),
    ...(club && { replyTo: club }),
  };
}

function autoReplyHtml(e: Enquiry, s: SiteSettings, club: string | null): string {
  const { carbon, bone, muted, yellow, display, body } = EMAIL;
  const slot = s.training[0];
  const label = `font-family:${body};font-size:12px;font-weight:600;letter-spacing:2px;text-transform:uppercase;color:${muted};`;
  const kit = [s.firstSessionKit, s.kitNotes].filter(Boolean) as string[];
  const when = slot
    ? `
    <div style="margin:28px 0 0;${label}">When and where</div>
    <div style="padding:8px 0 4px;font-family:${display};font-size:30px;line-height:1.1;text-transform:uppercase;color:${bone};">${h(slot.day)}s · ${h(slot.start)} to ${h(slot.end)}</div>
    <p style="${EMAIL_TYPE.text}">${h(s.venue.name)}, ${h(s.venue.address)}</p>
    <div style="padding-top:8px;"><a href="${h(s.venue.mapUrl)}" style="display:inline-block;background:${yellow};color:${carbon};border-radius:8px;padding:12px 20px;font-family:${body};font-size:16px;font-weight:700;text-decoration:none;">Open the map</a></div>`
    : "";
  return emailPage({
    title: "Thanks for getting in touch, Battersea Cougars",
    preheader: "We've got your details and someone from the club will get back to you soon.",
    panel: `    <h1 style="${EMAIL_TYPE.heading}">Hi ${h(greetingName(e.name))},</h1>
    <p style="${EMAIL_TYPE.text}">Thanks for your interest in Battersea Cougars. We've got your details and someone from the club will get back to you soon.</p>${when}${
      kit.length
        ? `
    <h2 style="${EMAIL_TYPE.subheading}">Kit</h2>
${kit.map((line) => `    <p style="${EMAIL_TYPE.text}">${h(line)}</p>`).join("\n")}`
        : ""
    }
    <p style="${EMAIL_TYPE.text}margin-top:28px;color:${bone};">See you on court,<br>Battersea Cougars</p>`,
    footer: "You're getting this because you asked to try a session on our website. Reply to reach the club.",
    contact: club,
  });
}
