// An admin closes a tournament's sign-up now (ADR 0074), before its closing day: when, on its own (signup_closed_at),
// its dates left as they were, so a later save never finds it closing before it opens (lib/signup.ts signupOver).
// Members can't say they're in any more, and a captains' draft moves on to Draft open, where the order's drawn
// (lib/tournament-front.ts statusOf). One statement that only does anything while sign-up's open and nothing's drawn
// or made, so two taps at once close it once (ADR 0121). Back to Sign-up open (step-back.ts) opens it again.
import { all, first, run, type Param } from "@cougars/shared/d1";
import { syncTournament } from "@cougars/shared/agenda";
import { HttpError } from "../api/api.http";
import { londonToday } from "@cougars/shared/london";
import { formatDayDate } from "../../src/lib/dates";
import { notify, type Notice, type PushEnv } from "../push/push";
import { invitationOnly } from "../../src/lib/motif";
import { startedSql } from "./started";

/** Sign-up closed, and the agenda told (`agenda` false: the caller syncs it once at the end, as Move to does). */
export async function closeSignup(db: D1Database, tournamentId: number, today: string, now: string, agenda = true) {
  const res = await run(
    db,
    `UPDATE tournaments SET signup_closed_at = ?
     WHERE id = ? AND signup_closed_at IS NULL
       AND (status = 'open' OR (status = 'planned' AND signup_opens_on IS NOT NULL AND signup_opens_on <= ?))
       AND (signup_closes_on IS NULL OR signup_closes_on >= ?)
       AND NOT EXISTS (SELECT 1 FROM tournament_games WHERE tournament_id = ?)
       AND (kind <> 'draft' OR draft_state = 'none')`,
    [now, tournamentId, today, today, tournamentId],
  );
  if (!res.meta.changes) {
    const there = await first(db, "SELECT 1 FROM tournaments WHERE id = ?", [tournamentId]);
    throw there ? new HttpError(409, "Sign-up isn't open.") : new HttpError(404, "No such tournament.");
  }
  if (agenda) await syncTournament(db, tournamentId);
}

// Its sign-up opening (ADR 0074, 0108): members hear it once, under Your place (topic `places`), on the day it's set to
// open (the cron, announceOpenTournaments) or the moment an admin opens it by hand (push.notices.ts tournamentSaved).
// Whichever comes first marks it told (`signup_told_at`) in the statement that takes it, so it's never said twice, and
// opened again (Back to Sign-up open) it isn't news. Nor is it to a member who's answered already (said Out, or
// declined the Kumite, or been put in by an admin), who isn't told. The Kumite is invitation-only, as in Bloodsport: its notification
// is an invitation; any other tournament says its sign-up's open.

/** A tournament whose sign-up has just opened, as its notification needs it. */
export interface Opened {
  id: number;
  name: string;
  heldOn: string;
  /** Its series' slug and full name; none for one in no series. */
  slug: string | null;
  series: string | null;
  /** Who's answered already, as JSON (its entries' members): not news to them. */
  answered: string;
}

/** What its notification says: the Kumite's an invitation ("The Cougars Kumite, Fri 23 Oct."), the rest plainly. */
export function signupOpenNotice(t: Opened): Notice {
  const day = formatDayDate(t.heldOn);
  const invitation = invitationOnly(t.slug ? { slug: t.slug } : undefined);
  return {
    to: "everyone",
    except: JSON.parse(t.answered) as number[],
    topic: "places",
    key: `signup-open:tournament:${t.id}`,
    title: invitation ? "An invitation has arrived" : `${t.name}: sign-up's open`,
    body: invitation ? `${t.series ?? t.name}, ${day}.` : `Say you're in for ${day}.`,
    path: t.slug ? `/tournaments/${t.slug}` : "/calendar",
  };
}

/**
 * Marks the tournaments matching `where` told, and returns them: only those nobody's told yet, not started (one played
 * early is past, whatever its date, ADR 0074, #182), their sign-up not over.
 */
export const markTold = (db: D1Database, where: string, args: Param[], now: Date) =>
  all<Opened>(
    db,
    `UPDATE tournaments SET signup_told_at = ?
     WHERE signup_told_at IS NULL AND NOT ${startedSql("tournaments")}
       AND (signup_closes_on IS NULL OR signup_closes_on >= ?) AND ${where}
     RETURNING id, name, held_on heldOn,
       (SELECT slug FROM tournament_types ty WHERE ty.id = type_id) slug,
       (SELECT name FROM tournament_types ty WHERE ty.id = type_id) series,
       (SELECT json_group_array(member_id) FROM tournament_entries e WHERE e.tournament_id = tournaments.id) answered`,
    [now.toISOString(), londonToday(now), ...args],
  );

/**
 * Every run of the cron: the tournaments whose sign-up opens by itself today (London), told once, queued for the
 * drain straight after (as a training night's, training.signup.ts). Only on its day: one made already open isn't news.
 */
export async function announceOpenTournaments(env: PushEnv, now: Date) {
  const opened = await markTold(env.DB, "status = 'planned' AND signup_opens_on = ?", [londonToday(now)], now);
  await notify(env, opened.map(signupOpenNotice), now, 0);
}
