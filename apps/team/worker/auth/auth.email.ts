// The sign-in code email (ADR 0023): what it is, the code, how long it works, and what to do if you didn't ask. Plain,
// in the club's frame (packages/shared/email-html.ts). The text version says the same.
import { EMAIL, EMAIL_TYPE, emailPage, escapeHtml } from "@cougars/shared/email-html";

export function signInEmail(
  code: string,
  minutes: number,
): { subject: string; text: string; html: string; secrets: string[] } {
  const spaced = `${code.slice(0, 3)} ${code.slice(3)}`;
  const { heading, subheading, text } = EMAIL_TYPE;
  return {
    // The code, as written and as shown: never in a log
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

/** The code that makes a new address a member's sign-in email (members.email.ts): sent to that address, in the same frame. */
export function newEmailCodeEmail(
  code: string,
  minutes: number,
): { subject: string; text: string; html: string; secrets: string[] } {
  const spaced = `${code.slice(0, 3)} ${code.slice(3)}`;
  const { heading, subheading, text } = EMAIL_TYPE;
  return {
    secrets: [code, spaced],
    subject: `Your Cougars email change code: ${code}`,
    text: [
      `Your code is ${code}`,
      "",
      `Type it in the Cougars app within ${minutes} minutes to sign in with this address from now on.`,
      "",
      "Didn't ask for it? Ignore this email: nothing changes without the code.",
      "",
      "Battersea Cougars Inline Hockey Club",
    ].join("\n"),
    html: emailPage({
      title: "Your Cougars email change code",
      preheader: `Your code is ${code}. It works for ${minutes} minutes.`,
      panel: `    <h1 style="${heading}">Confirm your new email</h1>
    <div style="margin:0 0 20px;font-family:${EMAIL.mono};font-size:40px;line-height:1.1;font-weight:700;letter-spacing:6px;color:${EMAIL.bone};white-space:nowrap;">${spaced}</div>
    <p style="${text}">Type it in the Cougars app within ${minutes} minutes to sign in with this address from now on.</p>
    <h2 style="${subheading}">Didn't ask for it?</h2>
    <p style="${text}margin-bottom:0;">Ignore this email. Nothing changes without the code.</p>`,
      footer: "You're getting this because a Cougars member asked to sign in with this address.",
      links: false,
    }),
  };
}

/**
 * The code sent to a member's current address when someone signed in as them asks to move their sign-in elsewhere
 * (members.email.ts): nothing moves without it, so a stolen session alone can't take the account. The new address is
 * half hidden (`masked`), so the owner can tell whose it might be without this email handing it on.
 */
export function moveEmailCodeEmail(
  code: string,
  minutes: number,
  masked: string,
): { subject: string; text: string; html: string; secrets: string[] } {
  const spaced = `${code.slice(0, 3)} ${code.slice(3)}`;
  const { heading, subheading, text } = EMAIL_TYPE;
  const asked = `Someone signed in as you asked to move your Cougars sign-in to ${masked}.`;
  const wasYou = `If it was you, type this code in the Cougars app within ${minutes} minutes, with the one sent to the new address.`;
  const wasnt = "If it wasn't you, ignore this and tell an admin: nothing changes without this code.";
  return {
    secrets: [code, spaced],
    subject: `Your code to move your Cougars sign-in: ${code}`,
    text: [asked, "", `Your code is ${code}`, "", wasYou, "", wasnt, "", "Battersea Cougars Inline Hockey Club"].join(
      "\n",
    ),
    html: emailPage({
      title: "Moving your Cougars sign-in",
      preheader: `${asked} Your code is ${code}.`,
      panel: `    <h1 style="${heading}">Moving your sign-in?</h1>
    <p style="${text}">${escapeHtml(asked)}</p>
    <div style="margin:0 0 20px;font-family:${EMAIL.mono};font-size:40px;line-height:1.1;font-weight:700;letter-spacing:6px;color:${EMAIL.bone};white-space:nowrap;">${spaced}</div>
    <p style="${text}">${wasYou}</p>
    <h2 style="${subheading}">Wasn't you?</h2>
    <p style="${text}margin-bottom:0;">Ignore this and tell an admin. Nothing changes without this code.</p>`,
      footer: "You're getting this because this is the address you sign in to the Cougars team app with.",
      links: false,
    }),
  };
}
