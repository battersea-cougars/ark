// Next quarter's plan, as a Quarterly Member reads it a few days before the quarter (ADR 0007, #187): the quarter, the
// rate in force on its first day, the day it's charged, and the last day they can switch to pay as you go. The line
// on their phone, or for anyone without the app the same words by email: plain text first, the same in the club's
// HTML frame (packages/shared/email-html.ts).
import { EMAIL_TYPE, emailPage, escapeHtml } from "@cougars/shared/email-html";
import type { Mail } from "@cougars/shared/email";
import { formatDayDate, pounds } from "../../src/lib/dates";
import type { Notice } from "../push/push";

export interface PlanLetter {
  /** What the app calls them: their first name. */
  firstName: string;
  /** "2027-Q1". */
  quarter: string;
  /** The quarterly rate in force on the quarter's first day. */
  pence: number;
  /** The quarter's first day, when it's charged. */
  chargedOn: string;
  /** The day before: the last day their Dues page takes a change (PUT /api/me/plan). */
  changeBy: string;
}

const TITLE = "Next quarter's fee is due";
const day = (d: string) => formatDayDate(`${d}T12:00:00Z`);

/** "Your Quarterly membership for 2027-Q1 (£90) is charged on Fri 1 Jan. Want to pay as you go instead? …" */
const said = (l: PlanLetter) =>
  `Your Quarterly membership for ${l.quarter} (${pounds(l.pence)}) is charged on ${day(l.chargedOn)}. ` +
  `Want to pay as you go instead? Change it on your Dues page by ${day(l.changeBy)}.`;

/** The line on their phone (ADR 0108, topic dues): tapping it opens their Dues page at next quarter's plan. */
export const planNotice = (l: PlanLetter): Omit<Notice, "to"> => ({
  topic: "dues",
  key: `plan:${l.quarter}`,
  title: TITLE,
  body: said(l),
  path: "/me/tab?plan=next",
});

/** The same, by email, for a member without the app. */
export function planMail(to: string, l: PlanLetter): Mail {
  const where = "Your plan, and everything you've been charged and paid, are under Dues in the Cougars app.";
  const text = [`Hi ${l.firstName},`, "", said(l), "", where, "", "Battersea Cougars Inline Hockey Club"].join("\n");
  const { heading, text: p } = EMAIL_TYPE;
  const html = emailPage({
    title: TITLE,
    preheader: `${pounds(l.pence)} on ${day(l.chargedOn)}. Change your plan by ${day(l.changeBy)}.`,
    panel: `    <h1 style="${heading}">Hi ${escapeHtml(l.firstName)},</h1>
    <p style="${p}">${escapeHtml(said(l))}</p>
    <p style="${p}margin-bottom:0;">${escapeHtml(where)}</p>`,
    footer: "You're getting this because you're down as a Quarterly Member next quarter.",
  });
  return {
    to: [to],
    subject: `${TITLE}: ${pounds(l.pence)} on ${day(l.chargedOn)}`,
    text,
    html,
  };
}
