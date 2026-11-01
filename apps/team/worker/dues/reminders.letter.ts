// A reminder of what someone owes (ADR 0007), as the member reads it: plain text first, in the club's voice, the same in
// the club's HTML frame (packages/shared/email-html.ts); and the line their phone shows. What they owe, charge by
// charge, the total, their own reference and where to pay. Firmer the longer it's been.
import { EMAIL, EMAIL_TYPE, emailPage, escapeHtml } from "@cougars/shared/email-html";
import type { Mail } from "@cougars/shared/email";
import { formatDayDate } from "../../src/lib/dates";
import { quarterMonths } from "../../src/lib/dues";
import type { Bank } from "../settings/settings";
import type { Notice } from "../push/push";

export interface Owed {
  /** The training's or tournament's name, or an adjustment's reason; null for a quarter. */
  what: string | null;
  quarter: string | null;
  dueOn: string;
  left: number;
}

export interface Letter {
  /** What the app calls them: their first name. */
  firstName: string;
  reference: string;
  charges: Owed[];
  bank: Bank;
  /** The age of their oldest charge, as Unpaid fees buckets it: 0 up to 30 days, 1 31 to 60, 2 61 to 90, 3 over 90. */
  stage: 0 | 1 | 2 | 3;
}

/** The most charges listed one by one; the rest are summed in a line, and the total is always the whole. */
const LISTED = 20;

/** £12.00: an email shows the pence. */
export const money = (pence: number) => `£${(pence / 100).toFixed(2)}`;

const OPENING = [
  (total: string) => `A friendly nudge from the Cougars: you've ${total} to settle.`,
  (total: string) => `A reminder from the Cougars: you've ${total} owing, some of it for over a month.`,
  (total: string) =>
    `A reminder from the Cougars: you've ${total} owing, some of it for over two months. Please settle up this week.`,
  (total: string) =>
    `A firm reminder from the Cougars: you've ${total} owing, some of it for over three months. Please settle up, or reply and tell us what's going on.`,
];

const whatOf = (c: Owed) => c.what ?? (c.quarter ? `Quarterly, ${quarterMonths(c.quarter)}` : "Dues");
const dayOf = (c: Owed) => formatDayDate(`${c.dueOn}T12:00:00Z`);

export function reminderMail(to: string, l: Letter): Mail {
  const total = money(l.charges.reduce((s, c) => s + c.left, 0));
  const listed = l.charges.slice(0, LISTED);
  const rest = l.charges.slice(LISTED);
  const day = Math.max(...listed.map((c) => dayOf(c).length));
  const what = Math.max(5, ...listed.map((c) => whatOf(c).length));
  const lines = [
    ...listed.map((c) => `  ${dayOf(c).padEnd(day)}   ${whatOf(c).padEnd(what)}   ${money(c.left)}`),
    ...(rest.length
      ? [`  ${`and ${rest.length} more`.padEnd(day + 3 + what)}   ${money(rest.reduce((s, c) => s + c.left, 0))}`]
      : []),
    `  ${"Total".padEnd(day + 3 + what)}   ${total}`,
  ];
  const details: [string, string][] = [
    ["Name", l.bank.name],
    ["Sort code", l.bank.sortCode],
    ["Account", l.bank.account],
    ["Reference", l.reference],
  ];
  const opening = OPENING[l.stage](total);
  const after = "Always use your reference, so your payment is matched to you.";
  const paid = "Already paid? Thank you, and ignore this: a transfer can take a few days to show.";
  const where = "Everything you've been charged and paid is under Dues in the Cougars app.";
  const text = [
    `Hi ${l.firstName},`,
    "",
    opening,
    "",
    ...lines,
    "",
    "Pay by bank transfer:",
    ...details.map(([k, v]) => `  ${k.padEnd(11)}${v}`),
    "",
    after,
    paid,
    "",
    where,
    "",
    "Battersea Cougars Inline Hockey Club",
  ].join("\n");

  const { heading, subheading, text: p } = EMAIL_TYPE;
  const cell = `padding:6px 0;font-family:${EMAIL.body};font-size:15px;line-height:1.4;color:${EMAIL.muted};`;
  const num = `${cell}text-align:right;white-space:nowrap;color:${EMAIL.bone};`;
  const row = (a: string, b: string, c: string, strong = false) =>
    `<tr><td style="${cell}white-space:nowrap;padding-right:16px;">${a}</td><td style="${cell}${strong ? `color:${EMAIL.bone};font-weight:700;` : ""}">${b}</td><td style="${num}${strong ? "font-weight:700;" : ""}">${c}</td></tr>`;
  const html = emailPage({
    title: "What you owe the Cougars",
    preheader: `${total} to settle. Your reference: ${l.reference}`,
    panel: `    <h1 style="${heading}">Hi ${escapeHtml(l.firstName)},</h1>
    <p style="${p}">${escapeHtml(opening)}</p>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:8px 0 8px;">
${listed.map((c) => row(escapeHtml(dayOf(c)), escapeHtml(whatOf(c)), money(c.left))).join("\n")}
${rest.length ? row("", `and ${rest.length} more`, money(rest.reduce((s, c) => s + c.left, 0))) : ""}
${row("", "Total", total, true)}
    </table>
    <h2 style="${subheading}">Pay by bank transfer</h2>
    <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 16px;">
${details.map(([k, v]) => `<tr><td style="${cell}padding-right:20px;">${k}</td><td style="${cell}font-family:${EMAIL.mono};color:${EMAIL.bone};">${escapeHtml(v)}</td></tr>`).join("\n")}
    </table>
    <p style="${p}">${after} ${paid}</p>
    <p style="${p}margin-bottom:0;">${where}</p>`,
    footer: "You're getting this because you're a member of the Cougars and something's still to pay.",
  });
  return { to: [to], subject: `What you owe the Cougars: ${total}`, text, html };
}

/** The line on their phone (ADR 0108): tapping it opens their Dues. */
export const reminderNotice = (l: Letter): Omit<Notice, "to"> => ({
  topic: "dues",
  key: "dues",
  title: "What you owe",
  body: `${money(l.charges.reduce((s, c) => s + c.left, 0))} to settle. Your reference: ${l.reference}`,
  path: "/me/tab",
});
