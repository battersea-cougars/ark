// The draft (ADR 0060): picks, and opening, closing and resetting it.
import { id, memberIdIn, ok, rowOf, rowsOf, type Route } from "../api/api.route";
import { closeDraft, draftProgress, openDraft, pick, resetDraft, undoPick } from "./draft";
import { body } from "../api/api.http";

export const DRAFT_ROUTES: Route[] = [
  {
    method: "POST",
    path: /^\/api\/tournaments\/(\d+)\/draft\/picks$/,
    audit: { none: "a captain's pick: each is the draft's own record (pick_number, in order)" },
    // The captain on the clock, or whoever's running the draft: draft.ts decides
    action: "authenticated",
    changes: ["tournaments"],
    handle: async (c) => {
      const { memberId } = await memberIdIn(c);
      await pick(c.env.DB, id(c), memberId, c);
      return ok();
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
    handle: async (c) => (await undoPick(c.env.DB, id(c)), ok()),
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
    // The night of the draft: the captains can pick (ADR 0060)
    handle: async (c) => (await openDraft(c.env.DB, id(c)), ok()),
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
