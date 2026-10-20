// Talking to the team app's Worker (apps/team/worker/api/api.ts). Every change goes to D1 first; its reply carries the
// parts of the club it touched (`changed`), which replace those parts of the app's working copy
// (demo/store.svelte.ts), so what you see is what's stored. Screens change the copy at once for a quick answer, then
// the reply brings back what the server decided (the waitlist, say). The whole club is read when the app opens, when
// it comes back into view (only if something changed, ADR 0053), and after a failed change.
import type { MemberRow, Role } from "../demo/data";
import {
  applySlices,
  hydrate,
  MEMBERS,
  ONE_OFFS,
  QUIPS,
  ANNOUNCEMENTS,
  ROLES,
  SERIES,
  SESSIONS,
  TEAMS,
  TOURNAMENTS,
  TOURNAMENT_TYPES,
  VENUES,
  AGENDA,
  SETTINGS,
  CHARGES,
  CREDITS,
  PAYMENTS,
  SUBSCRIPTION_FEES,
} from "../demo/data";
import type { Position, Slices } from "../demo/data";
import type { Quip, QuipKind } from "../lib/quips";
import type { Team } from "../lib/balance";
import { api, bootstrapIfChanged, brake, getBootstrap } from "./api";
import type { Tournament, TournamentType, TrainingSeries, Venue } from "../demo/model";
import { db } from "../demo/store.svelte";

/** The last save's outcome, shown briefly by the shell. */
export const saving = $state({ busy: 0, message: "", failed: false });

// Each slice of the club, copied into the store from demo/data.ts once it's in place there
const COPY: Record<keyof Slices, () => void> = {
  everydayRole: () => {},
  members: () => {
    db.members = structuredClone(MEMBERS);
  },
  roles: () => {
    db.roles = structuredClone(ROLES);
  },
  venues: () => {
    db.venues = structuredClone(VENUES);
  },
  series: () => {
    db.series = structuredClone(SERIES);
  },
  sessions: () => {
    db.sessions = structuredClone(SESSIONS);
    db.teams = structuredClone(TEAMS);
  },
  tournamentTypes: () => {
    db.tournamentTypes = structuredClone(TOURNAMENT_TYPES);
  },
  tournaments: () => {
    db.tournaments = structuredClone(TOURNAMENTS);
  },
  clubEvents: () => {
    db.oneOffs = structuredClone(ONE_OFFS);
  },
  quips: () => {
    db.quips = structuredClone(QUIPS);
  },
  announcements: () => {
    db.announcements = structuredClone(ANNOUNCEMENTS);
  },
  agenda: () => {
    db.agenda = structuredClone(AGENDA);
  },
  charges: () => {
    db.charges = structuredClone(CHARGES);
  },
  credits: () => {
    db.credits = structuredClone(CREDITS);
  },
  payments: () => {
    db.payments = structuredClone(PAYMENTS);
  },
  subscriptionFees: () => {
    db.fees = structuredClone(SUBSCRIPTION_FEES);
  },
  // Only when it's changed: live pages' checks follow it, and would otherwise start again after every refresh
  settings: () => {
    if (db.settings.liveRefreshSeconds !== SETTINGS.liveRefreshSeconds) db.settings = structuredClone(SETTINGS);
  },
};
const copyAll = () => Object.values(COPY).forEach((copy) => copy());

/** Put what a change sent back in place; nothing else is touched. */
function apply(changed: Slices) {
  applySlices(changed);
  for (const key of Object.keys(changed) as (keyof Slices)[]) COPY[key]?.();
}

/** Reload the whole club into the app. */
export async function refresh() {
  hydrate(await getBootstrap());
  copyAll();
}

/** Anyone else's changes, if there are any: a small check (no club data read) when there aren't (ADR 0053). */
export async function refreshIfChanged() {
  // A background check: skipped while the brake says wait (ADR 0055)
  if (!brake.mayCheck()) return;
  const b = await bootstrapIfChanged();
  if (!b) return;
  hydrate(b);
  copyAll();
}

/**
 * Pulled down to refresh: what others changed, now. You asked, so it doesn't wait out the background checks' pause
 * after a failure (the brake still counts it, and still stops it once the day's allowance is spent); it says when it
 * can't reach the club, and is quiet when it can.
 */
export async function pullToRefresh() {
  try {
    const b = await bootstrapIfChanged();
    if (!b) return;
    hydrate(b);
    copyAll();
  } catch (e) {
    say(e instanceof Error ? e.message : "Couldn't refresh.", true);
  }
}

// Back to the app (another tab, the phone unlocked): what others changed meanwhile. Not in the middle of a save,
// whose own reply is on its way.
if (typeof document !== "undefined")
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible" && !saving.busy) refreshIfChanged().catch(() => {});
  });

let clearing: ReturnType<typeof setTimeout> | undefined;
function say(message: string, failed: boolean) {
  Object.assign(saving, { message, failed });
  clearTimeout(clearing);
  clearing = setTimeout(() => (saving.message = ""), failed ? 6000 : 2200);
}

/**
 * Send a change, then put what it touched in place (the whole club, if the reply doesn't say). Says `done` ("Saved") or what went wrong; an empty `done` stays quiet on success,
 * for taps that show their own result. Returns the server's reply, or null if it failed.
 */
export async function save<T>(change: () => Promise<T>, done = "Saved"): Promise<T | null> {
  // A new save: the last one's note gives way to this one's
  if (done) saving.message = "";
  saving.busy++;
  try {
    const result = await change();
    const changed = (result as { changed?: Slices } | null)?.changed;
    if (changed) apply(changed);
    else await refresh();
    if (done) say(done, false);
    return result;
  } catch (e) {
    say(e instanceof Error ? e.message : "Couldn't save.", true);
    await refresh().catch(() => {});
    return null;
  } finally {
    saving.busy--;
  }
}

// ─── The changes the screens make ───

// Sign-ups. A Bookable's key says which kind of event it is (demo/schedule.svelte.ts).
const ENTRY_PATHS: Record<string, string> = { session: "sessions", tournament: "tournaments", oneoff: "club-events" };
function entryPath(key: string) {
  const [kind, id] = key.split(":");
  return `/api/${ENTRY_PATHS[kind]}/${id}`;
}
/** You say in or out. */
export const answerFor = (key: string, answer: "in" | "out") =>
  save(() => api("POST", `${entryPath(key)}/answer`, { answer }), "");
/** An admin puts someone in a session, or takes them off. */
export const setPlayer = (sessionId: number, memberId: number, inIt: boolean) =>
  save(() => api("POST", `/api/sessions/${sessionId}/players`, { memberId, in: inIt }), inIt ? "Added" : "Taken off");
/** The team maker lets someone waiting in, over the limit if need be (ADR 0076). */
export const letIn = (sessionId: number, memberId: number, name: string) =>
  save(() => api("POST", `/api/sessions/${sessionId}/let-in`, { memberId }), `${name} is in`);
/** An admin puts someone in a tournament (sign-up shut or not), or takes them off. */
export const setTournamentPlayer = (tournamentId: number, memberId: number, inIt: boolean) =>
  save(
    () => api("POST", `/api/tournaments/${tournamentId}/players`, { memberId, in: inIt }),
    inIt ? "Added" : "Taken off",
  );
/** Publish a session's teams: everyone sees them. */
export const publishTeams = (sessionId: number, teams: Team[], done = "Teams saved") =>
  save(() => api("POST", `/api/sessions/${sessionId}/teams`, { teams }), done);
/** Take a session's teams down; the sign-ups stay. */
export const removeTeams = (sessionId: number) =>
  save(() => api("DELETE", `/api/sessions/${sessionId}/teams`), "Teams cleared");
/** Start a session again: no sign-ups, no teams. */
export const resetSession = (sessionId: number) =>
  save(() => api("POST", `/api/sessions/${sessionId}/reset`), "Session reset");
/** Your own phone, position and bio. */
export const saveProfile = (p: { position: Position; phone: string; bio: string; webName: string }) =>
  save(() => api("PUT", "/api/me", p));
/** The role the app opens as (ADR 0024); null for your full role. */
export const saveEverydayRole = (roleId: number | null) => save(() => api("PUT", "/api/me/everyday-role", { roleId }));
/** Another member's everyday role, or null for their full role (ADR 0024). */
export const setMemberEveryday = (memberId: number, roleId: number | null) =>
  save(() => api("PUT", `/api/members/${memberId}/everyday-role`, { roleId }));
/** Your plan for next quarter, until it starts: the server checks the date (ADR 0007). */
export const choosePlan = (quarter: string, quarterly: boolean) =>
  save(() => api("PUT", "/api/me/plan", { quarter, quarterly }), "Plan saved");
/** Make someone a Quarterly Member from today, or end it (ADR 0007). */
export const setQuarterly = (memberId: number, quarterly: boolean) =>
  save(() => api("POST", `/api/members/${memberId}/quarterly`, { quarterly }));
/** A member's attendance for a year, for an admin: every session held so far, answered or not. */
export interface AttendanceRow {
  sessionId: number;
  heldOn: string;
  series: string;
  signup: "in" | "waitlist" | "out" | null;
  attended: boolean | null;
  walkIn: boolean;
  cancelled: boolean;
}
export const attendanceOf = (memberId: number, year?: string) =>
  api<AttendanceRow[]>("GET", `/api/members/${memberId}/attendance${year ? `?year=${year}` : ""}`);
/** How often live pages check for updates, for everyone (ADR 0072). */
export const saveSettings = (settings: { liveRefreshSeconds: number }) =>
  save(() => api("PUT", "/api/settings", settings));

/** Home's announcements (#85): post one, take one down, or dismiss one for yourself. */
export const postAnnouncement = (a: { title: string; body: string; link: string; endsOn: string }) =>
  save(() => api<{ id: number }>("POST", "/api/announcements", a), "Posted");
export const removeAnnouncement = (id: number) => save(() => api("DELETE", `/api/announcements/${id}`), "Taken down");
export const dismissAnnouncement = (id: number) => {
  db.announcements = db.announcements.filter((a) => a.id !== id);
  return save(() => api("POST", `/api/announcements/${id}/dismiss`), "");
};

/** Home's quips. */
export const addQuip = (kind: QuipKind, text: string) =>
  save(() => api<{ id: number }>("POST", "/api/quips", { kind, text }), "Added");
export const saveQuip = (q: Quip) => save(() => api("PUT", `/api/quips/${q.id}`, { text: q.text }));
export const deleteQuip = (id: number) => save(() => api("DELETE", `/api/quips/${id}`), "Removed");

/** The register: here or not. */
export const markHere = (sessionId: number, memberId: number, here: boolean) =>
  save(() => api("POST", `/api/sessions/${sessionId}/register`, { memberId, here }), "");

/** A member's attendance, many Fridays at once: one request, so their charges are worked out once. */
export const markAttendance = (memberId: number, marks: { sessionId: number; here: boolean }[]) =>
  save(() => api("PUT", `/api/members/${memberId}/attendance`, { marks }), "");

/** An admin adds someone to the club; the app emails them a link to itself (ADR 0069). */
export const addMember = async (name: string, email: string, position: string) => {
  const r = await save(
    () => api<{ id: number; emailed: boolean }>("POST", "/api/members", { name, email, position }),
    "",
  );
  if (r)
    say(
      r.emailed
        ? `${name.split(" ")[0]}'s in. We've emailed them a link.`
        : `${name.split(" ")[0]}'s in, but the email didn't go: send them the link yourself.`,
      !r.emailed,
    );
  return r;
};

/** What an import file would do (worker/members/members.import.ts): who'd be added, who's in already, what's wrong. */
export interface ImportCheck {
  add: {
    row: number;
    name: string;
    email: string | null;
    position: Position;
    rating: number;
    cougar: boolean;
    roles: string[];
  }[];
  skip: { row: number; name: string; why: string }[];
  problems: { row: number; name: string; why: string }[];
}
/** Checks a CSV or roster JSON without changing anything. Throws what's wrong with the file as a whole. */
export const checkImport = (file: string) => api<ImportCheck>("POST", "/api/members/import", { file });
/** Adds everyone the file would add, all at once; nobody is emailed. */
export const importMembers = async (file: string) => {
  const r = await save(
    () => api<{ added: string[]; skipped: number }>("POST", "/api/members/import", { file, apply: true }),
    "",
  );
  if (r) say(`${r.added.length} member${r.added.length === 1 ? "" : "s"} added.`, false);
  return r;
};

export const saveMember = (m: MemberRow) =>
  save(() =>
    api("PUT", `/api/members/${m.player.id}`, {
      name: m.player.name,
      webName: m.player.webName ?? "",
      position: m.player.position,
      rating: m.player.rating,
      cougar: m.player.cougar,
      status: m.status,
      roles: m.roles,
    }),
  );

/** An admin deletes the account of a member who asked (#30): the server keeps only what the club must, unnamed. */
export const eraseMember = (memberId: number) =>
  save(() => api("DELETE", `/api/members/${memberId}`), "Account deleted");

/** An admin sets a member's email (what they sign in with) and phone. */
export const saveContact = (memberId: number, email: string, phone: string) =>
  save(() => api("PUT", `/api/members/${memberId}/contact`, { email, phone }));

export const saveRole = (r: Role) =>
  save(() => api("PUT", `/api/roles/${r.id}`, { name: r.name, description: r.description, actions: r.actions }));
export const addRole = (name: string) =>
  save(
    () => api<{ id: number }>("POST", "/api/roles", { name, description: "", actions: ["read:Event"] }),
    "Role added",
  );

/** A saved venue (ADR 0030). */
const venueBody = (v: Venue) => ({ name: v.name, address: v.address, mapUrl: v.mapUrl, active: v.active });
export const createVenue = (v: Venue) =>
  save(() => api<{ id: number }>("POST", "/api/venues", venueBody(v)), "Venue saved");
export const updateVenue = (v: Venue) => save(() => api("PUT", `/api/venues/${v.id}`, venueBody(v)));

const seriesBody = (s: TrainingSeries) => ({
  name: s.name,
  shortName: s.shortName,
  icon: s.icon,
  tone: s.tone,
  repeatEvery: s.repeatEvery,
  weekdays: s.weekdays,
  startsOn: s.startsOn,
  endsOn: s.endsOn,
  startTime: s.startTime,
  endTime: s.endTime,
  venueId: s.venueId,
  venue: s.venue,
  mapUrl: s.mapUrl,
  capacity: s.capacity,
  goalieCapacity: s.goalieCapacity ?? null,
  public: s.public,
  active: s.active,
  fees: s.fees,
});
// ─── Dues (ADR 0007) ───
/** A payment recorded by mistake, taken back from the ledger. */
export const removePayment = (paymentId: number) =>
  save(() => api("DELETE", `/api/payments/${paymentId}`), "Taken back");
/** Money in (a lump sum): it pays what they owe oldest first, and anything left over is credit for what's next. */
export const recordPayment = (memberId: number, pence: number, via: "transfer" | "cash", receivedOn?: string) =>
  save(() => api("POST", `/api/members/${memberId}/payments`, { pence, via, receivedOn }), "Payment recorded");
/** An adjustment, with why: pence above nothing adds to what they owe, below takes some off (ADR 0007). */
export const adjustDues = (memberId: number, pence: number, reason: string, on: string) =>
  save(() => api("POST", `/api/members/${memberId}/adjustments`, { pence, reason, on }), "Adjusted");
/** Work a member's dues out again from who came and the fees as they are now. */
export const recalculateDues = (memberId: number) =>
  save(() => api("POST", `/api/members/${memberId}/recalculate`), "Dues recalculated");
/** A member owes for a quarter ("2026-Q3"): at the quarterly rate then, unless an amount is given. */
export const chargeQuarter = (memberId: number, quarter: string, pence?: number) =>
  save(() => api("POST", `/api/members/${memberId}/charges`, { quarter, pence }), "Charged");
/** A quarter charged by hand by mistake. */
export const removeCharge = (chargeId: number) => save(() => api("DELETE", `/api/charges/${chargeId}`), "Taken off");
/** The quarterly rate from a date. */
export const setSubscriptionFee = (pence: number, from: string) =>
  save(() => api("POST", "/api/subscription-fees", { pence, from }), "Rate set");

export const createSeries = (s: TrainingSeries) =>
  save(() => api<{ id: number; slug: string }>("POST", "/api/series", seriesBody(s)), "Training added");
export const updateSeries = (s: TrainingSeries) => save(() => api("PUT", `/api/series/${s.id}`, seriesBody(s)));
/** The next 12 weeks of a training's sessions, past the last one made. */
export const moreSessions = (seriesId: number) => save(() => api("POST", `/api/series/${seriesId}/more`), "");
export const setCancelled = (sessionId: number, cancelled: boolean) =>
  save(
    () => api("POST", `/api/sessions/${sessionId}/cancelled`, { cancelled }),
    cancelled ? "Session cancelled" : "Session restored",
  );

const typeBody = (t: TournamentType) => ({
  name: t.name,
  shortName: t.shortName,
  icon: t.icon,
  tone: t.tone,
  pointsWin: t.pointsWin,
  pointsDraw: t.pointsDraw,
  pointsLoss: t.pointsLoss,
  gameMinutes: t.gameMinutes,
  kind: t.kind,
  active: t.active,
  defaultFeePence: t.defaultFeePence,
  defaultStartTime: t.defaultStartTime,
  defaultEndTime: t.defaultEndTime,
  awards: t.awards,
  playoffs: t.playoffs,
  venueId: t.venueId,
  location: t.location,
  mapUrl: t.mapUrl,
});
export const createTournamentType = (t: TournamentType) =>
  save(() => api<{ id: number; slug: string }>("POST", "/api/tournament-types", typeBody(t)), "Tournament added");
export const updateTournamentType = (t: TournamentType) =>
  save(() => api("PUT", `/api/tournament-types/${t.id}`, typeBody(t)));

const tournamentBody = (t: Tournament) => ({
  typeId: t.typeId,
  name: t.name,
  venueId: t.venueId,
  location: t.location,
  mapUrl: t.mapUrl,
  heldOn: t.heldOn,
  startTime: t.startTime,
  endTime: t.endTime,
  capacity: t.capacity,
  status: t.status,
  feePence: t.feePence,
  season: t.season,
  public: t.public,
  signupOpensOn: t.signupOpensOn,
  signupClosesOn: t.signupClosesOn,
  draftOn: t.draftOn,
  pointsWin: t.pointsWin,
  pointsDraw: t.pointsDraw,
  pointsLoss: t.pointsLoss,
  gameMinutes: t.gameMinutes,
  kind: t.kind,
  awards: t.awards,
  playoffs: t.playoffs,
  teams: t.teams,
});
/** The captain on the clock (or whoever's running the draft) picks a member. */
export const draftPick = (tournamentId: number, memberId: number) =>
  save(() => api("POST", `/api/tournaments/${tournamentId}/draft/picks`, { memberId }), "Picked");
/** Whoever's running the draft takes back the last pick. */
export const undoDraftPick = (tournamentId: number) =>
  save(() => api("DELETE", `/api/tournaments/${tournamentId}/draft/picks/last`), "Pick undone");
/** Whoever runs the draft starts it again: the picks go; sign-ups, captains and fixtures stay (ADR 0060). */
export const resetDraft = (tournamentId: number) =>
  save(() => api("POST", `/api/tournaments/${tournamentId}/draft/reset`, {}), "The draft is reset");
/** An admin puts a member on a team directly (a replacement): moved from another, or put in the tournament. */
export const putOnTeam = (tournamentId: number, teamId: number, memberId: number) =>
  save(() => api("POST", `/api/tournaments/${tournamentId}/teams/${teamId}/players`, { memberId }), "On the team");
/** ...or takes them off it: still signed up, back in the pool. */
export const takeOffTeam = (tournamentId: number, teamId: number, memberId: number) =>
  save(() => api("DELETE", `/api/tournaments/${tournamentId}/teams/${teamId}/players/${memberId}`), "Off the team");
/** A team's name and logo: its captain or an admin. */
export const setTeamLook = (tournamentId: number, teamId: number, name: string, logo: string | null) =>
  save(() => api("PUT", `/api/tournaments/${tournamentId}/teams/${teamId}/look`, { name, logo }));
/** Whoever runs the draft opens it (ADR 0060): the captains can pick. */
export const openDraft = (tournamentId: number) =>
  save(() => api("POST", `/api/tournaments/${tournamentId}/draft/open`, {}), "The draft is open");
/** ...and closes it: everyone's picked, or the rest are left out on purpose. The teams are then set. */
export const closeDraft = (tournamentId: number, leaveOut = false) =>
  save(() => api("POST", `/api/tournaments/${tournamentId}/draft/close`, { leaveOut }), "The draft is closed");
/** The round robin and its playoffs, once the teams are set (ADR 0061). */
export const makeFixtures = (tournamentId: number) =>
  save(() => api("POST", `/api/tournaments/${tournamentId}/fixtures`), "Fixtures made");
/** A game's final score; the last group result fills the playoffs. */
export const scoreGame = (tournamentId: number, gameId: number, homeGoals: number, awayGoals: number) =>
  save(() => api("PUT", `/api/tournaments/${tournamentId}/games/${gameId}`, { homeGoals, awayGoals }), "Result saved");
// Scoring a game as it's played (ADR 0061): whoever holds the scoresheet
const gamePath = (tournamentId: number, gameId: number) => `/api/tournaments/${tournamentId}/games/${gameId}`;
/** Start scoring (take the scoresheet), or let it go (whoever holds it, or an admin). */
export const holdScoresheet = (tournamentId: number, gameId: number, action: "claim" | "release") =>
  save(
    () => api("POST", `${gamePath(tournamentId, gameId)}/scorer`, { action }),
    action === "claim" ? "You're keeping score" : "Scoresheet's free",
  );
/** The clock: start (or start again), pause, or full time (the score's the result). */
export const clockGame = (tournamentId: number, gameId: number, action: "start" | "pause" | "end") =>
  save(() => api("POST", `${gamePath(tournamentId, gameId)}/clock`, { action }), action === "end" ? "Full time" : "");
/** Who won a tournament's awards, the whole list (ADR 0044). */
export const setWinners = (
  tournamentId: number,
  winners: { award: string; teamId: number | null; memberId: number | null }[],
) => save(() => api("PUT", `/api/tournaments/${tournamentId}/winners`, { winners }), "Awards saved");
/** The time left on the clock, by the scorekeeper's watch: paused, or running on from there. */
export const setGameClock = (tournamentId: number, gameId: number, leftMs: number) =>
  save(() => api("POST", `${gamePath(tournamentId, gameId)}/clock`, { action: "set", leftMs }), "Clock set");
/** A goal as it goes in: its team, who scored, who assisted. */
export const addGoal = (
  tournamentId: number,
  gameId: number,
  goal: { teamId: number; scorerId: number | null; assistId: number | null; atMs?: number | null },
) => save(() => api("POST", `${gamePath(tournamentId, gameId)}/goals`, goal), "Goal");
/** Any goal off a finished game: an admin putting the result right. */
export const removeGoal = (tournamentId: number, gameId: number, goalId: number) =>
  save(() => api("DELETE", `${gamePath(tournamentId, gameId)}/goals/${goalId}`), "Goal taken off");
/** The last goal comes off. */
export const undoGoal = (tournamentId: number, gameId: number) =>
  save(() => api("DELETE", `${gamePath(tournamentId, gameId)}/goals/last`), "Goal taken back");

export const createTournament = (t: Tournament) =>
  save(() => api<{ id: number }>("POST", "/api/tournaments", tournamentBody(t)), "Date added");
export const updateTournament = (t: Tournament) =>
  save(() => api("PUT", `/api/tournaments/${t.id}`, tournamentBody(t)));
/** Gone, with its teams, sign-ups, games and awards. */
export const deleteTournament = (id: number) => save(() => api("DELETE", `/api/tournaments/${id}`), "Deleted");

/** A one-off event as the app sends it. */
export interface ClubEventBody {
  title: string;
  startsAt: string;
  endsAt: string;
  venueId: number | null;
  venue: string;
  mapUrl: string;
  description: string;
  public: boolean;
  signup: boolean;
  capacity: number | null;
}
export const createClubEvent = (e: ClubEventBody) =>
  save(() => api<{ id: number }>("POST", "/api/club-events", e), "Added to the calendar");
export const updateClubEvent = (id: number, e: ClubEventBody) => save(() => api("PUT", `/api/club-events/${id}`, e));
export const setClubEventCancelled = (id: number, cancelled: boolean) =>
  save(() => api("POST", `/api/club-events/${id}/cancelled`, { cancelled }), cancelled ? "Cancelled" : "Back on");
