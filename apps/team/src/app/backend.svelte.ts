// Talking to the team app's Worker (apps/team/worker/api/api.ts). Every change goes to D1 first; its reply carries the
// parts of the club it touched (`changed`), which replace those parts of the app's working copy
// (demo/store.svelte.ts), so what you see is what's stored. Screens change the copy at once for a quick answer, then
// the reply brings back what the server decided (the waitlist, say). The whole club is read when the app opens, when
// it comes back into view (only if something changed, ADR 0053), and after a failed change; a live page reads just
// the parts the hub says changed (`copy`, catch-up.ts, ADR 0072).
import type { MemberRow, Role } from "../demo/data";
import {
  applySlices,
  hydrate,
  MEMBERS,
  NOTIFICATIONS,
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
  REMINDERS,
  SUBSCRIPTION_FEES,
} from "../demo/data";
import type { Bootstrap, Position, Slices } from "../demo/data";
import type { Quip, QuipKind } from "../lib/quips";
import type { Topic } from "../lib/notification-topics";
import type { Team } from "../lib/balance";
import { api, bootstrapIfChanged, brake, getBootstrap, readSlices, versionOf } from "./api";
import { ClubCopy } from "./catch-up";
import type { Tournament, TournamentType, TrainingSeries, Venue } from "../demo/model";
import { db } from "../demo/store.svelte";
import { startSession } from "../demo/session.svelte";

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
  reminders: () => {
    db.reminders = structuredClone(REMINDERS);
  },
  subscriptionFees: () => {
    db.fees = structuredClone(SUBSCRIPTION_FEES);
  },
  notifications: () => {
    db.notifications = structuredClone(NOTIFICATIONS);
  },
  // Only when it's changed: live pages' checks follow it, and would otherwise start again after every refresh
  settings: () => {
    if (JSON.stringify(db.settings) !== JSON.stringify(SETTINGS)) db.settings = structuredClone(SETTINGS);
  },
};
const copyAll = () => Object.values(COPY).forEach((copy) => copy());

/** Put what a change sent back in place; nothing else is touched. */
function apply(changed: Slices) {
  applySlices(changed);
  for (const key of Object.keys(changed) as (keyof Slices)[]) COPY[key]?.();
}

/** The whole club in place, and the data version it's at. */
function whole(b: Bootstrap) {
  hydrate(b);
  copyAll();
  copy.wholeAt(versionOf(b) ?? 0);
}

/** When the whole club was last read or found unchanged: a live page opening just after doesn't ask again. */
export const checked = { at: 0 };

/**
 * The app's copy of the club, kept up as live pages hear of changes (ADR 0072): just the parts that changed, one read
 * at a time after a short random wait, nothing while the app's out of view.
 */
export const copy = new ClubCopy({
  // A background read, like a check: not while the brake says wait (ADR 0055); the page's beat catches up after
  readParts: (names) => (brake.mayCheck() ? readSlices(names) : Promise.reject(new Error("resting"))),
  readWhole: () => (brake.mayCheck() ? refreshIfChanged() : Promise.reject(new Error("resting"))),
  apply: (slices) => apply(slices as Slices),
  visible: () => document.visibilityState === "visible",
});

/** The club's data, in place before the app mounts (main.ts): the store, and who you are in it. */
export function start(b: Bootstrap) {
  whole(b);
  checked.at = Date.now();
  startSession();
}

/** Reload the whole club into the app. */
export async function refresh() {
  whole(await getBootstrap());
  checked.at = Date.now();
}

/** Anyone else's changes, if there are any: a small check (no club data read) when there aren't (ADR 0053). */
export async function refreshIfChanged() {
  // A background check: skipped while the brake says wait (ADR 0055)
  if (!brake.mayCheck()) return;
  const b = await bootstrapIfChanged(copy.held);
  checked.at = Date.now();
  if (b) whole(b);
}

/**
 * Pulled down to refresh: what others changed, now. You asked, so it doesn't wait out the background checks' pause
 * after a failure (the brake still counts it, and still stops it once the day's allowance is spent); it says when it
 * can't reach the club, and is quiet when it can.
 */
export async function pullToRefresh() {
  try {
    const b = await bootstrapIfChanged(copy.held);
    checked.at = Date.now();
    if (b) whole(b);
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
    // Its parts, read after the change: as new as the version it made, unless something newer is in already
    const version = versionOf(result);
    if (changed) apply(version ? (copy.partsAt(version, changed) as Slices) : changed);
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
/** Where someone is on a session now, as the server says after a change (ADR 0030). */
type Placed = { signup: "in" | "waitlist" | "out" | null };
/** An admin puts someone in a session (in if there's room, else waiting: ADR 0030), or takes them off. */
export const setPlayer = async (sessionId: number, memberId: number, inIt: boolean) => {
  const r = await save(() => api<Placed>("POST", `/api/sessions/${sessionId}/players`, { memberId, in: inIt }), "");
  if (r) say(!inIt ? "Taken off" : r.signup === "waitlist" ? "Full: on the waiting list" : "Added", false);
  return r;
};
/** The team maker lets someone waiting in, over the limit if need be (ADR 0076). */
export const letIn = (sessionId: number, memberId: number, name: string) =>
  save(() => api("POST", `/api/sessions/${sessionId}/let-in`, { memberId }), `${name} is in`);
/** Several in or off at once: the Add player drawer's Done. */
export const setTournamentPlayers = (tournamentId: number, players: { memberId: number; in: boolean }[]) =>
  save(() => api("POST", `/api/tournaments/${tournamentId}/players`, { players }), "Saved");
/** Publish a session's teams: everyone sees them. */
export const publishTeams = (sessionId: number, teams: Team[], done = "Teams saved") =>
  save(() => api("POST", `/api/sessions/${sessionId}/teams`, { teams }), done);
/** Take a session's teams down; the sign-ups stay. */
export const removeTeams = (sessionId: number) =>
  save(() => api("DELETE", `/api/sessions/${sessionId}/teams`), "Teams cleared");
/** Start a session again: no sign-ups, no teams. */
export const resetSession = (sessionId: number) =>
  save(() => api("POST", `/api/sessions/${sessionId}/reset`), "Session reset");
/** One kind of notification on or off, for you (ADR 0108). Quiet: the switch is its own answer. */
export const chooseNotification = (topic: Topic, on: boolean) =>
  save(() => api("PUT", "/api/me/notifications", { [topic]: on }), "");
/** Your own phone, position, bio, the name you go by and your default Kumite team name. */
export const saveProfile = (p: {
  position: Position;
  phone: string;
  bio: string;
  webName: string;
  /** Left out: as it is */
  kumiteTeamName?: string;
}) => save(() => api("PUT", "/api/me", p));
/** Your profile photo (ADR 0123), shrunk on your phone (lib/photo.ts); null takes it down. */
export const savePhoto = (photo: string | null) =>
  save(() => api("PUT", "/api/me/photo", { photo }), photo ? "Photo saved" : "Photo removed");
/** A code to the address you want to sign in with (ADR 0023): what to say, and the code itself on your own machine. Quiet: the form says. */
export const askEmailCode = (email: string) =>
  save(() => api<{ message: string; devCode?: string }>("POST", "/api/me/email", { email }), "");
/** The code from the new address: it's your sign-in email from now on. */
export const confirmEmailCode = (code: string) =>
  save(() => api<{ email: string }>("POST", "/api/me/email/confirm", { code }), "Email changed");
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

/** Home's announcements (#85): post one, take one down, or say "Got it" to one (for yourself). */
export const postAnnouncement = (a: { title: string; body: string; link: string; endsOn: string }) =>
  save(() => api<{ id: number }>("POST", "/api/announcements", a), "Posted");
export const removeAnnouncement = (id: number) => save(() => api("DELETE", `/api/announcements/${id}`), "Taken down");
export const dismissAnnouncement = (id: number) => {
  db.announcements = db.announcements.filter((a) => a.id !== id);
  return save(() => api("POST", `/api/announcements/${id}/dismiss`), "");
};
/** One announcement, looking back (worker/announcements pastAnnouncements). */
export interface PastAnnouncement {
  id: number;
  title: string;
  body: string;
  link: string | null;
  endsOn: string;
  createdAt: string;
  by: string | null;
  gotIt: boolean;
}
/** Every announcement, newest first, a page at a time: `before` is the last one you have. */
export const pastAnnouncements = (before?: number) =>
  api<{ announcements: PastAnnouncement[]; more: boolean }>(
    "GET",
    before ? `/api/announcements?before=${before}` : "/api/announcements",
  );

/** Home's quips. */
export const addQuip = (kind: QuipKind, text: string) =>
  save(() => api<{ id: number }>("POST", "/api/quips", { kind, text }), "Added");
export const saveQuip = (q: Quip) => save(() => api("PUT", `/api/quips/${q.id}`, { text: q.text }));
export const deleteQuip = (id: number) => save(() => api("DELETE", `/api/quips/${id}`), "Removed");

/** The register: here or not. Someone added to a full night waits for the team maker's Let in (ADR 0030), and the
 * note says so, naming them. */
export const markHere = async (sessionId: number, memberId: number, here: boolean, name = "") => {
  const r = await save(() => api<Placed>("POST", `/api/sessions/${sessionId}/register`, { memberId, here }), "");
  if (here && r?.signup === "waitlist") say(`Full: ${name ? `${name}'s` : "they're"} on the waiting list`, false);
  return r;
};

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
    /** This quarter's plan (ADR 0007): a goalie is always on the Keeper plan. */
    plan: "quarterly" | "payg" | "keeper";
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
      // Only once there's one to say: left out, it stays as it is
      ...(m.player.kumiteTeamName != null && { kumiteTeamName: m.player.kumiteTeamName }),
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

/** An admin signs a member out on every browser and phone (#72): they sign in again with a code. */
export const signOutMember = (memberId: number) =>
  save(() => api("POST", `/api/members/${memberId}/sign-out`), "Signed out everywhere");

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
  signupOpensDays: s.signupOpensDays ?? null,
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
/** The club's bank details (ADR 0007): where members pay, on their Dues page and in reminders. */
export const saveBank = (bank: { name: string; sortCode: string; account: string }) =>
  save(() => api("PUT", "/api/settings/bank", bank), "Bank details saved");

/** Who'd be reminded of what they owe, and what one says (ADR 0007): a read, not a change. */
export interface ReminderPreview {
  ready: boolean;
  people: {
    memberId: number;
    name: string;
    email: boolean;
    pence: number;
    charges: number;
    stage: 0 | 1 | 2 | 3;
    lastAt: string | null;
    held: boolean;
  }[];
  letter: { memberId: number; subject: string; text: string } | null;
}
export const previewReminders = (memberId?: number) =>
  api<ReminderPreview>("GET", `/api/dues/reminders${memberId ? `?member=${memberId}` : ""}`);
/** Email them what they owe: everyone who owes, or these. Anyone reminded this week is held back. */
export const sendReminders = (memberIds?: number[]) =>
  save(
    () =>
      api<{ queued: number; held: number; noEmail: number }>(
        "POST",
        "/api/dues/reminders",
        memberIds ? { memberIds } : {},
      ),
    "",
  );

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
  penaltyRule: t.penaltyRule,
  periods: t.periods,
  defaultPenaltyMinutes: t.defaultPenaltyMinutes,
  breakMinutes: t.breakMinutes,
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
  afterVenueId: t.afterVenueId,
  afterTime: t.afterTime,
  afterNote: t.afterNote,
  houseRules: t.houseRules,
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
  penaltyRule: t.penaltyRule,
  periods: t.periods,
  defaultPenaltyMinutes: t.defaultPenaltyMinutes,
  breakMinutes: t.breakMinutes,
  kind: t.kind,
  awards: t.awards,
  playoffs: t.playoffs,
  teams: t.teams,
  afterMode: t.afterMode,
  afterVenueId: t.afterVenueId,
  afterTime: t.afterTime,
  afterNote: t.afterNote,
});
/** The captain on the clock (or whoever's running the draft) picks a member, for the turn after `turn` picks. */
export const draftPick = (tournamentId: number, memberId: number, turn: number) =>
  save(() => api("POST", `/api/tournaments/${tournamentId}/draft/picks`, { memberId, turn }), "Picked");
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
/** Step 1 (ADR 0060): the captains' pick order, drawn at random on the server, once (Shuffle). */
export const drawOrder = (tournamentId: number) =>
  save(() => api("POST", `/api/tournaments/${tournamentId}/draft/draw`, {}), "Order set");
/** Step 2: whoever runs the draft opens it (Open draft); each captain hears it, with their place. Or reopens it. */
export const openDraft = (tournamentId: number) =>
  save(() => api("POST", `/api/tournaments/${tournamentId}/draft/open`, {}), "The draft is open");
/** ...and closes it: everyone's picked, or the rest are left out on purpose. The teams are then set. */
export const closeDraft = (tournamentId: number, leaveOut = false) =>
  save(() => api("POST", `/api/tournaments/${tournamentId}/draft/close`, { leaveOut }), "The draft is closed");
/** Whoever runs the draft reopens a closed one, keeping the fixtures or clearing them, results and all (ADR 0060). */
export const reopenDraft = (tournamentId: number, fixtures: "keep" | "clear") =>
  save(
    () => api("POST", `/api/tournaments/${tournamentId}/draft/reopen`, { fixtures }),
    fixtures === "clear" ? "The draft is open again, the fixtures cleared" : "The draft is open again",
  );
/** One step of a tournament's workflow back, from the step it's at (lib/step-back.ts, ADR 0074). */
export const stepBack = (tournamentId: number, from: string, said: string) =>
  save(() => api("POST", `/api/tournaments/${tournamentId}/step-back`, { from }), said);
/** An admin clears the fixtures, results and all, to be made again (ADR 0061). */
export const clearFixtures = (tournamentId: number) =>
  save(() => api("DELETE", `/api/tournaments/${tournamentId}/fixtures`), "Fixtures cleared");
/** Everyone's picked (or the rest left out): one tap closes the draft and makes the fixtures (ADR 0060). */
export const finishDraft = (tournamentId: number, leaveOut = false) =>
  save(
    () => api("POST", `/api/tournaments/${tournamentId}/draft/finish`, { leaveOut }),
    "The draft is closed and the fixtures are out",
  );
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
/** A period's over (ADR 0061): the next starts paused at full length. Said twice, nothing more happens. */
export const nextPeriod = (tournamentId: number, gameId: number, period: number) =>
  save(() => api("POST", `${gamePath(tournamentId, gameId)}/clock`, { action: "period", period }), "");
/** Who won a tournament's awards, the whole list (ADR 0044). */
export const setWinners = (
  tournamentId: number,
  winners: { award: string; teamId: number | null; memberId: number | null }[],
) => save(() => api("PUT", `/api/tournaments/${tournamentId}/winners`, { winners }), "Awards saved");
/** The next award revealed at the after-party (ADR 0074): `next`, its place in the list, the one shown face down. */
export const revealAward = (tournamentId: number, next: number) =>
  save(() => api("POST", `/api/tournaments/${tournamentId}/awards/reveal`, { next }), "");
/** The time left on the clock, by the scorekeeper's watch: paused, or running on from there. */
export const setGameClock = (tournamentId: number, gameId: number, leftMs: number) =>
  save(() => api("POST", `${gamePath(tournamentId, gameId)}/clock`, { action: "set", leftMs }), "Clock set");
/** A goal as it goes in: its team, who scored, who assisted. */
export const addGoal = (
  tournamentId: number,
  gameId: number,
  goal: {
    teamId: number;
    scorerId: number | null;
    assistId: number | null;
    atMs?: number | null;
    period?: number | null;
  },
) => save(() => api("POST", `${gamePath(tournamentId, gameId)}/goals`, goal), "Goal");
/** Any goal off a finished game: an admin putting the result right. */
export const removeGoal = (tournamentId: number, gameId: number, goalId: number) =>
  save(() => api("DELETE", `${gamePath(tournamentId, gameId)}/goals/${goalId}`), "Goal taken off");
/** The last goal comes off. */
export const undoGoal = (tournamentId: number, gameId: number) =>
  save(() => api("DELETE", `${gamePath(tournamentId, gameId)}/goals/last`), "Goal taken back");
/** A penalty as it's called (or, for an admin after the game, at the time they say): team, who, minutes, what for. */
export const addPenalty = (
  tournamentId: number,
  gameId: number,
  penalty: {
    teamId: number;
    memberId: number | null;
    minutes: number;
    infraction: string;
    atMs?: number | null;
    period?: number | null;
  },
) => save(() => api("POST", `${gamePath(tournamentId, gameId)}/penalties`, penalty), "Penalty");
/** Any penalty off a finished game: an admin putting it right. */
export const removePenalty = (tournamentId: number, gameId: number, penaltyId: number) =>
  save(() => api("DELETE", `${gamePath(tournamentId, gameId)}/penalties/${penaltyId}`), "Penalty taken off");
/** The last penalty comes off. */
export const undoPenalty = (tournamentId: number, gameId: number) =>
  save(() => api("DELETE", `${gamePath(tournamentId, gameId)}/penalties/last`), "Penalty taken back");

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

// ─── Something already on then (ADR 0122) ───

/** Something on the calendar a new time is over (worker/calendar/clashes.ts). */
export interface Clash {
  source: "session" | "tournament" | "club_event";
  /** Null for a training night its rule gives that isn't made yet. */
  id: number | null;
  seriesId: number | null;
  title: string;
  day: string;
  startsAt: string;
  endsAt: string;
  canCancel: boolean;
  signedUp: number;
}
/** What's on between these two times; `except` is the thing being edited ("tournament:5"). */
export async function findClashes(w: { startsAt: string; endsAt: string; except?: string }) {
  const q = [`startsAt=${encodeURIComponent(w.startsAt)}`, `endsAt=${encodeURIComponent(w.endsAt)}`];
  if (w.except) q.push(`except=${encodeURIComponent(w.except)}`);
  return (await api<{ clashes: Clash[] }>("GET", `/api/calendar/clashes?${q.join("&")}`)).clashes;
}
/**
 * Call off what the admin chose, after their save went in: each by its own cancel (the members told, nobody charged),
 * a training night past the weeks made ahead made first. How many went off.
 */
export async function cancelClashes(chosen: Clash[]) {
  let off = 0;
  for (const c of chosen) {
    if (c.source === "club_event" && c.id) {
      if ((await setClubEventCancelled(c.id, true)) !== null) off++;
    } else if (c.source === "session") {
      const id =
        c.id ??
        (await save(() => api<{ id: number }>("POST", `/api/series/${c.seriesId}/sessions`, { heldOn: c.day }), ""))
          ?.id;
      if (id && (await setCancelled(id, true)) !== null) off++;
    }
  }
  return off;
}
