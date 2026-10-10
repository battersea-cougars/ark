// The sign-in code email (ADR 0023): what it is, the code, how long it works, and what to do if you didn't ask. Plain,
// in the club's frame (packages/shared/email-html.ts). The text version says the same.
import { EMAIL, EMAIL_TYPE, emailPage } from "@cougars/shared/email-html";

export function signInEmail(
  code: string,
  minutes: number,
): { subject: string; text: string; html: string; secrets: string[] } {
  const spaced = `${code.slice(0, 3)} ${code.slice(3)}`;
  const { heading, subheading, text } = EMAIL_TYPE;
  return {
    // The code, as written and as shown: never in a log (#74)
    secrets: [code, spaced],
    subject: `Your Cougars sign-in code: ${code}`,
    text: [
      `Your code is ${code}`,
      "",
      `It works for ${minutes} minutes, in the app where you asked for it.`,
      "",
      "Didn't ask for it? Ignore this email: nobody can use the code without the phone or computer it was asked from.",
      "",
      "Battersea Cougars Inline Hockey Club",
    ].join("\n"),
    html: emailPage({
      title: "Your Cougars sign-in code",
      preheader: `Your code is ${code}. It works for ${minutes} minutes.`,
      panel: `    <h1 style="${heading}">Your sign-in code</h1>
    <div style="margin:0 0 20px;font-family:${EMAIL.mono};font-size:40px;line-height:1.1;font-weight:700;letter-spacing:6px;color:${EMAIL.bone};white-space:nowrap;">${spaced}</div>
    <p style="${text}">It works for ${minutes} minutes, in the app where you asked for it.</p>
    <h2 style="${subheading}">Didn't ask for it?</h2>
    <p style="${text}margin-bottom:0;">Ignore this email. Nobody can use the code without the phone or computer it was asked from.</p>`,
      footer: "You're getting this because someone asked to sign in to the Cougars team app with this address.",
      links: false,
    }),
  };
}
