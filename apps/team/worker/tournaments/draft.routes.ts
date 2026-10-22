// The draft (ADR 0060): picks, and drawing the order, opening, closing (with the fixtures) and resetting it.
import { id, memberIdIn, ok, rowOf, rowsOf, type Route } from "../api/api.route";
import {
  closeDraft,
  draftProgress,
  drawOrder,
  finishDraft,
  lastPickedFor,
  openDraft,
  pick,
  reopenDraft,
  resetDraft,
  undoPick,
} from "./draft";
import { HttpError, body, json } from "../api/api.http";
import { draftOpen } from "../push/push.notices";
import { FIXTURES_TALLY } from "./fixtures";
import { can } from "../../src/access/actions";

export const DRAFT_ROUTES: Route[] = [
  {
    method: "POST",
    path: /^\/api\/tournaments\/(\d+)\/draft\/picks$/,
    // A captain's pick is the draft's own record (pick_number, in order); one made for them by whoever runs the draft
    // goes on the record too, naming both (ADR 0060)
    audit: {
      event: "draft.picked_for",
      subject: (c) => lastPickedFor(c.env.DB, id(c)),
      // The player picked, so the record names them
      about: (_c, reply) => ({ memberId: reply.memberId }),
    },
    // The captain on the clock, or whoever's running the draft: draft.ts decides
    action: "authenticated",
    changes: ["tournaments"],
    // Who picked whom: nothing on the calendar moves
    calendar: false,
    // { memberId, turn? }: turn is the picks made as the app saw them (draft.ts)
    handle: async (c) => {
      const { b, memberId } = await memberIdIn(c);
      if (b.turn !== undefined && (!Number.isInteger(b.turn) || (b.turn as number) < 0))
        throw new HttpError(400, "turn should be the picks made so far.");
      await pick(c.env.DB, id(c), memberId, c, b.turn as number | undefined);
      return json({ ok: true, memberId });
    },
  },
  {
    method: "DELETE",
    path: /^\/api\/tournaments\/(\d+)\/draft\/picks\/last$/,
    audit: {
      event: "draft.pick_undone",
      subject: rowsOf(
        `SELECT p.pick_number pick, p.member_id memberId, p.team_id teamId FROM tournament_team_players p
         JOIN tournament_teams t ON t.id = p.team_id WHERE t.tournament_id = ? AND p.pick_number IS NOT NULL
         ORDER BY p.pick_number`,
      ),
    },
    action: "run:Draft",
    changes: ["tournaments"],
    // Who picked whom: nothing on the calendar moves
    calendar: false,
    handle: async (c) => (await undoPick(c.env.DB, id(c)), ok()),
  },
  {
    method: "POST",
    path: /^\/api\/tournaments\/(\d+)\/draft\/draw$/,
    audit: {
      event: "draft.drawn",
      subject: rowsOf(
        `SELECT t.pick, t.captain_member_id captainMemberId, m.name captain FROM tournament_teams t
         LEFT JOIN members m ON m.id = t.captain_member_id WHERE t.tournament_id = ? ORDER BY t.pick, t.id`,
      ),
    },
    action: "run:Draft",
    changes: ["tournaments"],
    // Who picked whom: nothing on the calendar moves
    calendar: false,
    // Step 1: the pick order, drawn at random, once (ADR 0060); every phone on the page sees it shuffle in
    handle: async (c) => (await drawOrder(c.env.DB, id(c)), ok()),
  },
  {
    method: "POST",
    path: /^\/api\/tournaments\/(\d+)\/draft\/open$/,
    audit: {
      event: "draft.opened",
      subject: rowOf("SELECT id, name, draft_state draftState FROM tournaments WHERE id = ?"),
    },
    action: "run:Draft",
    changes: ["tournaments"],
    // Step 2, once the order's drawn: the captains can pick (ADR 0060), and each hears it, with their place
    notify: draftOpen,
    handle: async (c) => (await openDraft(c.env.DB, id(c)), ok()),
  },
  {
    method: "POST",
    path: /^\/api\/tournaments\/(\d+)\/draft\/reopen$/,
    // Reopened, and what went with it: the matches, results and goals before and after (cleared, or kept)
    audit: {
      event: "draft.reopened",
      subject: rowOf(
        `SELECT t.id, t.name, t.draft_state draftState, ${FIXTURES_TALLY} FROM tournaments t WHERE t.id = ?`,
      ),
    },
    action: "run:Draft",
    changes: ["tournaments"],
    // { fixtures: "keep" | "clear" } (ADR 0060): clearing takes someone who edits the tournament too
    handle: async (c) => {
      const fixtures = (await body(c.request)).fixtures ?? "keep";
      if (fixtures !== "keep" && fixtures !== "clear") throw new HttpError(400, "fixtures should be keep or clear.");
      if (fixtures === "clear" && !can(c.actions, "manage:Tournament"))
        throw new HttpError(403, "Clearing the fixtures takes someone who edits the tournament.");
      await reopenDraft(c.env.DB, id(c), fixtures);
      return ok();
    },
  },
  {
    method: "POST",
    path: /^\/api\/tournaments\/(\d+)\/draft\/finish$/,
    audit: {
      event: "draft.finished",
      subject: rowOf(
        `SELECT id, name, draft_state draftState,
                (SELECT COUNT(*) FROM tournament_games WHERE tournament_id = tournaments.id) games
         FROM tournaments WHERE id = ?`,
      ),
    },
    action: "run:Draft",
    changes: ["tournaments"],
    // Everyone's picked (or { leaveOut: true }): one tap closes the draft and makes the fixtures (ADR 0060)
    handle: async (c) => (await finishDraft(c.env.DB, id(c), (await body(c.request)).leaveOut === true), ok()),
  },
  {
    method: "POST",
    path: /^\/api\/tournaments\/(\d+)\/draft\/close$/,
    audit: {
      event: "draft.closed",
      subject: rowOf("SELECT id, name, draft_state draftState FROM tournaments WHERE id = ?"),
    },
    action: "run:Draft",
    changes: ["tournaments"],
    // Everyone's picked (or the rest are left out on purpose): the teams are locked
    handle: async (c) => (await closeDraft(c.env.DB, id(c), (await body(c.request)).leaveOut === true), ok()),
  },
  {
    method: "POST",
    path: /^\/api\/tournaments\/(\d+)\/draft\/reset$/,
    audit: { event: "draft.reset", subject: (c) => draftProgress(c.env.DB, id(c)) },
    action: "run:Draft",
    changes: ["tournaments"],
    // Start again: the picks (and any fixtures) go, the sign-ups and captains stay
    handle: async (c) => (await resetDraft(c.env.DB, id(c)), ok()),
  },
];
