<script lang="ts">
  // The Draft open view of a tournament's page (ADR 0074): a captains' draft (ADR 0060), led one step at a time, one main button each for whoever runs it: Shuffle (the pick
  // order, drawn at random on the server; DraftOrder shuffles the names into it for whoever's watching), Open draft
  // (each captain hears where they pick), the picking, then Close draft & make fixtures in one tap; closed, it says
  // so, and Reopen is in Manage. The captains take turns, in snake order, picking from the members who said they're in
  // (captains are in automatically, never picked). The captain on the clock picks on their own phone: Pick marks a
  // player, End turn sends it. Whoever runs the draft can pick for them and undo the last pick. A team takes one
  // goalie. Teams are edited on the Teams page, not here.
  //
  // Laid out as a draft room: a ticker of picks across the top (the one on the clock brought forward with a badge),
  // then two views, Players and Teams: side by side on a wide screen, tabs on anything narrower. The players are a
  // plain list with a Pick on each row on your turn; a name opens the player's card. A captain's own team is the
  // first of the teams, badged "Your team", with their coming pick drawn in.
  import { goesBy, goesByOf, matchesName, shortNameOf, nameOfTeam, teamNamesOf } from "../lib/names";
  import SearchField from "../lib/SearchField.svelte";
  import EmptyState from "../lib/EmptyState.svelte";
  import { can } from "../access/actions";
  import { PLAYERS, type Player, type Position } from "../demo/data";
  import { granted, me } from "../demo/session.svelte";
  import Icon from "../app/shell/Icon.svelte";
  import PlayerCardZoom from "../lib/PlayerCardZoom.svelte";
  import { flip } from "svelte/animate";
  import { untrack } from "svelte";
  import { easeOut, fadeMs, flyMs, prefersReducedMotion } from "../app/motion";
  import { fade, fly, slide } from "svelte/transition";
  import TournamentPlayersDrawer from "../lib/TournamentPlayersDrawer.svelte";
  import TeamCrest from "../lib/TeamCrest.svelte";
  import DraftOrder from "../lib/DraftOrder.svelte";
  import DraftStep from "../lib/DraftStep.svelte";
  import { BACK_TO } from "../lib/step-back";
  import { canEnterRoom, enterRoom, roomOffered } from "../lib/draft-room";
  import Sheet from "../lib/Sheet.svelte";
  import { phone } from "../lib/viewport.svelte";
  import type { IconName } from "../app/shell/icons";
  import { teamTone } from "../lib/team-tones";
  import TeamLookSheet from "../lib/TeamLookSheet.svelte";
  import Drawer from "../lib/Drawer.svelte";
  import { editTournament } from "../lib/TournamentEditorPanel.svelte";
  import { currentTournament, typeById } from "../demo/schedule.svelte";
  import {
    closeDraft,
    draftPick,
    drawOrder,
    finishDraft,
    makeFixtures,
    clearFixtures,
    openDraft,
    reopenDraft,
    resetDraft,
    undoDraftPick,
  } from "../app/backend.svelte";
  import { checkForUpdates, everyHowOften, liveFeed } from "../lib/live-updates.svelte";
  import LiveNote from "../lib/LiveNote.svelte";
  import { formatDayDate, londonISO, londonToday } from "../lib/dates";
  import {
    MIN_TEAM_SIZE,
    myTurnLine,
    nextSlots,
    nth,
    onTheClock,
    orderDrawn,
    picksUntil,
    playersNeeded,
  } from "../lib/draft";
  import { teamsForPlayoffs } from "../lib/fixtures";
  import { navigate, router } from "../app/router.svelte";

  let {
    typeId,
    room = false,
    onpicking,
    onmanage,
  }: {
    typeId: number;
    /** In the draft room (pages/DraftRoom): its bar says whose turn, so the strip goes, and so does the way in. */
    room?: boolean;
    /** Told whether it's being picked (open, players left), so a phone's page makes room for it (ADR 0074). */
    onpicking?: (picking: boolean) => void;
    /** Told how to open its jobs (Manage the draft), or none, for the page header's Manage (ADR 0074). */
    onmanage?: (open: (() => void) | null) => void;
  } = $props();

  const perms = $derived(granted());
  const type = $derived(typeById(typeId)!);
  const tournament = $derived(currentTournament(typeId));
  const byId = (id: number) => PLAYERS.find((p) => p.id === id);
  const firstName = (id: number | null) => (id ? shortNameOf(byId(id)) : "");
  const ratings = $derived(can(perms, "read:Rating"));

  const teams = $derived(tournament?.teams ?? []);
  const picked = $derived(new Set(teams.flatMap((t) => t.players.map((p) => p.memberId))));
  const captains = $derived(new Set(teams.map((t) => t.captainMemberId)));
  // The draft's picks in the order they were made, each with the team that has the player now. Counted from the
  // stored pick numbers, as the server counts them: a player an admin put on directly isn't a pick (no number), and
  // one an admin moved keeps theirs, so whose turn it is matches the server's whatever's been edited
  const picks = $derived(
    teams
      .flatMap((t, team) =>
        t.players.flatMap((p) => (typeof p.pick === "number" ? [{ ...p, pick: p.pick, team }] : [])),
      )
      .sort((a, b) => a.pick - b.pick)
      .map((p, i) => ({ ...p, n: i + 1 })),
  );
  const made = $derived(picks.length);
  // Who's left: everyone who said they're in, but not the captains or anyone already picked
  const pool = $derived(
    (tournament?.going ?? []).filter((id) => !picked.has(id) && !captains.has(id)).flatMap((id) => byId(id) ?? []),
  );
  const phase = $derived(tournament?.draftState ?? "none");
  // Step 1 done: the pick order's drawn (ADR 0060)
  const drawn = $derived(orderDrawn(teams));
  // The draw as a moment (ADR 0060): before it, only the Draw the order card, the captains in it. A page that sees the
  // order arrive (whoever pressed Shuffle, and every captain watching, via the live updates) shuffles the names in the
  // card (DraftOrder); once they're stamped into place the card lets go, leaving the order as the page's order row,
  // and the Open the draft card, the players and the teams come in under it. A page opened after, or asking for less
  // motion, starts there. Back to undrawn (a reset), it waits for the next draw again
  let watchingDraw = $state(untrack(() => !orderDrawn(currentTournament(typeId)?.teams ?? [])));
  let drawShown = $state(false);
  $effect(() => {
    if (drawn) return;
    watchingDraw = true;
    drawShown = false;
  });
  const settled = $derived(drawn && (!watchingDraw || drawShown || prefersReducedMotion));
  // The players and teams come in last, after the card's let go and the next step's in
  const viewsIn = { duration: prefersReducedMotion ? 0 : 300, delay: prefersReducedMotion ? 0 : 560 };
  const open = $derived(phase === "open");
  const live = $derived(open && pool.length > 0);
  $effect(() => {
    onpicking?.(live);
  });
  // Everyone's picked, or closed: the picking's over, so the page is the teams (no ticker, no Next, no tabs), and it
  // scrolls as a page, not in a box
  const done = $derived((open && !pool.length) || phase === "closed");
  // The picks to come, one for each player left, as slots of the snake: the turn follows the pick numbers, so a pick
  // that came off (the player said they're out) is filled first, by its own team (#125). With no gaps, from `made`
  const slots = $derived(
    nextSlots(
      picks.map((p) => p.pick),
      pool.length,
    ),
  );
  const slot = $derived(slots[0] ?? made);
  const clock = $derived(teams.length ? onTheClock(teams.length, slot) : -1);
  const running = $derived(can(perms, "run:Draft"));
  const mine = $derived(clock >= 0 && teams[clock].captainMemberId === me().id);
  const canPick = $derived(open && (running || mine));
  // An admin puts in someone who didn't sign up (sign-up shut or not), until the draft closes and the teams are set
  const adding = $derived(can(perms, "update:Event") && phase !== "closed");
  let addingOpen = $state(false);
  // A team's name and logo: its captain or an admin, from its crest
  let lookOpen = $state(false);
  let lookIndex = $state(0);
  const canLook = (i: number) =>
    !!teams[i]?.id && (can(perms, "manage:Tournament") || teams[i].captainMemberId === me().id);

  // Your team: you're its captain, or you've been picked onto it
  const isMine = (i: number) =>
    teams[i].captainMemberId === me().id || teams[i].players.some((p) => p.memberId === me().id);
  const myTeam = $derived(teams.findIndex((_, i) => isMine(i)));
  // The teams in pick order, yours first
  const teamOrder = $derived([...(myTeam >= 0 ? [myTeam] : []), ...teams.map((_, i) => i).filter((i) => i !== myTeam)]);
  // How many picks until a team's turn (0: now); never, once the pool runs out first
  const turnIn = (i: number) => picksUntil(teams.length, slots, i);
  // A team's picks still to come, by their numbers in the whole draft (the draft room's empty rows)
  const laneSlots = (i: number) => slots.filter((slot) => onTheClock(teams.length, slot) === i).map((slot) => slot + 1);
  // Who picks after the one on the clock, and a captain's own place (round one's, from the order)
  const nextUp = $derived(teams.length && slots.length > 1 ? onTheClock(teams.length, slots[1]) : -1);
  // A captain's: their place and how soon they pick again (lib/draft.ts). Not for someone picked onto a team, nor an
  // admin who isn't a captain
  const myPlace = $derived.by(() => {
    const t = myTeam >= 0 ? teams[myTeam] : undefined;
    if (!t || t.captainMemberId !== me().id || typeof t.pick !== "number") return "";
    return myTurnLine(t.pick, picksUntil(teams.length, slots, myTeam));
  });
  const untilMine = $derived(myTeam < 0 || turnIn(myTeam) === Infinity ? -1 : turnIn(myTeam));
  const teamName = (i: number) => nameOfTeam(teams[i], teams, (id) => (id ? byId(id) : undefined));
  // The captains in the server's order: as named until the draft opens and draws it (ADR 0060)
  const order = $derived(
    teams.flatMap((t) =>
      t.captainMemberId
        ? [{ id: t.captainMemberId, name: goesByOf(byId(t.captainMemberId)), you: t.captainMemberId === me().id }]
        : [],
    ),
  );

  // Positions: what a team has, counting its captain; one goalie a team (ADR 0060)
  const membersOf = (i: number) =>
    [teams[i].captainMemberId, ...teams[i].players.map((p) => p.memberId)].flatMap((id) =>
      id ? (byId(id) ?? []) : [],
    );
  const tallyOf = (players: Player[]) => {
    const t: Record<Position, number> = { D: 0, F: 0, G: 0 };
    for (const p of players) t[p.position]++;
    return t;
  };
  const myTally = $derived(myTeam >= 0 ? tallyOf(membersOf(myTeam)) : null);
  const haveGoalie = $derived(!!myTally?.G);
  // The team on the clock has a goalie: the goalies' rows can't be picked for it
  const clockHasGoalie = $derived(clock >= 0 && membersOf(clock).some((p) => p.position === "G"));

  // The ticker: the picks just made (who was taken), then every pick to come, each with its team. Fixed-size chips,
  // so it scrolls but never grows; the one on the clock is kept in view
  const ticker = $derived.by(() => {
    // Not before it opens: the order's drawn then (DraftOrder), so there's no order to show
    if (!teams.length || (phase !== "open" && phase !== "closed") || done) return [];
    const out: { n: number; team: number; took?: string; by?: string }[] = [];
    // Nothing to show (nobody to pick, none picked): no ticker, not a row of empty places
    if (!made && !pool.length) return [];
    // Every pick so far (it scrolls back through them), then every one to come
    for (const p of picks)
      out.push({ n: p.n, team: p.team, took: p.memberId ? firstName(p.memberId) : p.name, by: pickerOf(p, p.team) });
    if (phase !== "closed")
      slots.forEach((slot, k) => out.push({ n: made + 1 + k, team: onTheClock(teams.length, slot) }));
    return out;
  });
  let tickerEl = $state<HTMLElement | undefined>();
  // Only the ticker scrolls: scrollIntoView would also move the page under you (it scrolls every scroller around it)
  // A pick slides it along; arriving, or the ticker changing size (the page settling, a phone's narrower chips), puts
  // the pick on the clock in the middle at once: a smooth scroll started while the page was still laying out stopped
  // short, leaving only the empty places in view
  const centre = (el: HTMLElement, smooth: boolean) => {
    const now = el.querySelector<HTMLElement>(".tick.up");
    if (!now) return;
    el.scrollTo({
      left: now.offsetLeft - (el.clientWidth - now.offsetWidth) / 2,
      behavior: smooth && !prefersReducedMotion ? "smooth" : "auto",
    });
  };
  // A pick landing while you watch: its chip lights up for a moment, so a new pick is noticed (not on arriving)
  let fresh = $state(0);
  let seenMade = -1;
  $effect(() => {
    const n = made;
    if (seenMade >= 0 && n > seenMade && !prefersReducedMotion) {
      fresh = n;
      const t = setTimeout(() => (fresh = 0), 1800);
      seenMade = n;
      return () => clearTimeout(t);
    }
    seenMade = n;
  });
  // It scrolls freely (swipe, trackpad, shift-wheel, arrow keys) through the picks made and every one to come. It
  // only follows the picks itself while you're at the current one, or haven't touched it: someone looking ahead isn't
  // yanked back by a pick landing. Away from it, Now (at the side it's on, over the edge) brings you back
  let atNow = true;
  let nowSide = $state<0 | -1 | 1>(0);
  function look() {
    const el = tickerEl;
    const now = el?.querySelector<HTMLElement>(".tick.up");
    if (!el || !now) return void (nowSide = 0);
    const mid = now.offsetLeft + now.offsetWidth / 2 - el.scrollLeft;
    atNow = Math.abs(mid - el.clientWidth / 2) < now.offsetWidth / 2;
    // Out of view: Now shows, on the side the current pick is
    nowSide = mid < now.offsetWidth / 2 ? -1 : mid > el.clientWidth - now.offsetWidth / 2 ? 1 : 0;
    // The chip in the middle: it's lifted as you scroll, as the current pick is when you're at it
    const middle = el.scrollLeft + el.clientWidth / 2;
    let best = Infinity;
    for (const chip of el.querySelectorAll<HTMLElement>(".tick")) {
      const off = Math.abs(chip.offsetLeft + chip.offsetWidth / 2 - middle);
      if (off < best) [best, focused] = [off, Number(chip.dataset.n)];
    }
    // Whether there's more either way (a desktop's chevrons)
    canLeft = el.scrollLeft > 2;
    canRight = el.scrollLeft + el.clientWidth < el.scrollWidth - 2;
  }
  let focused = $state<number | null>(null);
  const raised = $derived(focused ?? made + 1);
  let canLeft = $state(false);
  let canRight = $state(false);
  // A desktop's chevron: one pick along, so each click lifts the next
  function page(dir: -1 | 1) {
    const el = tickerEl;
    if (!el) return;
    const step = el.querySelector<HTMLElement>(".tick")?.offsetWidth ?? 160;
    const gap = parseFloat(getComputedStyle(el).columnGap) || 0;
    el.scrollBy({ left: dir * (step + gap), behavior: prefersReducedMotion ? "auto" : "smooth" });
  }
  // A mouse's wheel over it scrolls it sideways, while it can go that way; at its end the page scrolls as usual
  $effect(() => {
    const el = tickerEl;
    if (!el || !matchMedia("(hover: hover) and (pointer: fine)").matches) return;
    const wheel = (e: WheelEvent) => {
      if (Math.abs(e.deltaY) <= Math.abs(e.deltaX)) return;
      const more = e.deltaY > 0 ? el.scrollLeft + el.clientWidth < el.scrollWidth - 1 : el.scrollLeft > 0;
      if (!more) return;
      e.preventDefault();
      el.scrollBy({ left: e.deltaY });
    };
    el.addEventListener("wheel", wheel, { passive: false });
    return () => el.removeEventListener("wheel", wheel);
  });
  function backToNow() {
    if (!tickerEl) return;
    atNow = true;
    centre(tickerEl, true);
  }
  function tickerKeys(e: KeyboardEvent) {
    const el = tickerEl;
    if (!el) return;
    const step = el.querySelector<HTMLElement>(".tick:not(.up)")?.offsetWidth ?? 160;
    if (e.key === "ArrowRight" || e.key === "ArrowLeft") {
      e.preventDefault();
      el.scrollBy({
        left: (e.key === "ArrowRight" ? 1 : -1) * step,
        behavior: prefersReducedMotion ? "auto" : "smooth",
      });
    } else if (e.key === "Home") {
      e.preventDefault();
      backToNow();
    }
  }
  let centredAt = -1;
  $effect(() => {
    const el = tickerEl;
    if (!el) return;
    const n = made;
    if (centredAt < 0 || atNow) centre(el, centredAt >= 0 && n !== centredAt);
    centredAt = n;
    requestAnimationFrame(look);
  });
  $effect(() => {
    const el = tickerEl;
    if (!el) return;
    const ro = new ResizeObserver(() => {
      if (atNow) centre(el, false);
      look();
    });
    ro.observe(el);
    return () => ro.disconnect();
  });
  // The pick log: every pick so far, in order, who went where
  // A pick someone made for the captain (whoever runs the draft) says who: `by` is their name (ADR 0060)
  const pickerOf = (p: { pickedBy?: number | null }, team: number) =>
    p.pickedBy && p.pickedBy !== teams[team]?.captainMemberId ? shortNameOf(byId(p.pickedBy)) || "An admin" : "";
  const log = $derived(
    picks.map((p) => ({
      n: p.n,
      team: p.team,
      name: p.memberId ? goesByOf(byId(p.memberId)) || p.name : p.name,
      you: p.memberId === me().id,
      by: pickerOf(p, p.team),
    })),
  );
  // What just happened, for everyone on the page (the log's behind a button): the last pick, with its team
  const lastPick = $derived(log.at(-1) ?? null);
  const tickMeta = (t: { n: number; team: number; took?: string; by?: string }) => {
    if (t.n <= made) return `${t.n} · ${t.by ? `${t.by} took ` : t.took ? "took " : "picked"}${t.took ?? ""}`;
    const k = t.n - made - 1;
    if (t.team === myTeam) return `${t.n} · in ${k}`;
    return k === 1 ? `${t.n} · next` : `${t.n}`;
  };

  // Players: the pool, filtered by position
  type Filter = "all" | Position;
  let filter = $state<Filter>("all");
  // Find someone, as on Friday: their name, either one, any part of it. It works with the position chips (their
  // counts follow it) and stays as typed after a pick, so a captain can keep hunting; Esc or its × empties it
  let query = $state("");
  const found = $derived(query.trim() ? pool.filter((p) => matchesName(p, query)) : pool);
  const foundTally = $derived(tallyOf(found));
  const searching = $derived(phase !== "closed" && pool.length > 0);
  const shown = $derived(filter === "all" ? found : found.filter((p) => p.position === filter));
  // Just the pool, A to Z by the name they go by: who's good is the captain's call, not the app's
  const byName = (a: Player, b: Player) => goesBy(a).localeCompare(goesBy(b), "en", { sensitivity: "base" });
  const listed = $derived([...shown].sort(byName));
  // A goalie's row: greyed for you once you have one, and not offered to whoever's on the clock if they have one
  const dimmed = (p: Player) => p.position === "G" && haveGoalie;
  const pickable = (p: Player) => canPick && !(p.position === "G" && clockHasGoalie);
  const leftOut = $derived(phase === "closed" ? [...pool].sort(byName) : []);

  // A name turns the player's card over (PlayerCardZoom); Pick lives on the row
  let lifted = $state<{ id: number; el: HTMLElement } | null>(null);
  // Picking is two steps: Pick marks a player (tap another to change your mind), End turn sends it. Nobody else sees
  // it until then. A new pick on the clock, or the player going, clears it
  let chosen = $state<number | null>(null);
  $effect(() => {
    void made;
    chosen = null;
  });
  // Whoever runs the draft picking for the captain on the clock: the buttons say so (ADR 0060)
  const forOther = $derived(canPick && !mine);
  const forName = $derived(clock >= 0 ? firstName(teams[clock].captainMemberId) : "");
  const chosenPlayer = $derived(chosen !== null && canPick ? pool.find((p) => p.id === chosen) : undefined);
  let ending = $state(false);
  async function endTurn() {
    if (!tournament || !chosenPlayer || ending) return;
    ending = true;
    try {
      // The turn it's for: the slot on the clock as this page sees it (the server refuses it once that's moved on)
      await draftPick(tournament.id, chosenPlayer.id, slot);
    } finally {
      ending = false;
    }
  }

  // Two columns only where they fit (by the page's own width); anything narrower gets the phone's tabs, one view at
  // a time. No in-between layout
  let pageW = $state(0);
  const columns = $derived(pageW >= 960);
  // (Not before the page's width is known: a desktop would start as a phone, and its ticker scroll to the wrong place)
  const fit = $derived(pageW > 0 && !columns && live);
  type View = "players" | "teams";
  let view = $state<View>("players");
  // Switching tabs slides the new view in from the side it's on (no slide out: the old one just goes, so the page
  // never holds both and nothing below jumps)
  const ORDER: View[] = ["players", "teams"];
  let dir = $state(1);
  const show = (v: View) => {
    dir = ORDER.indexOf(v) >= ORDER.indexOf(view) ? 1 : -1;
    view = v;
  };

  const moveMs = prefersReducedMotion ? 0 : 360;
  // Opening it the first time takes enough to pick from: every team its captain and two more (lib/draft.ts)
  const needed = $derived(playersNeeded(teams.length));
  const short = $derived(!made && pool.length < needed);
  // The playoffs need this many teams (3rd v 4th: four); fewer captains and the fixtures can't be made, so say so first
  const playoffTeams = $derived(teamsForPlayoffs(tournament?.playoffs ?? []));
  const tooFew = $derived(teams.length < playoffTeams);
  const when = $derived(tournament?.draftOn ? formatDayDate(londonISO(tournament.draftOn, "12:00")) : "");
  // The strip says "today" on the day, rather than the date
  const whenSaid = $derived(tournament?.draftOn === londonToday() ? "today" : when);

  // The fixtures, and whether any game's started or has a result: then the teams are set and it can't reopen
  const games = $derived(tournament?.games ?? []);
  const played = $derived(games.some((g) => g.status !== "next" || g.homeGoals !== null));
  // The last step (ADR 0060): one tap closes the draft and makes the fixtures (fixtures already made are kept, as
  // they're between the same teams). Without enough teams for the playoffs, and none made, it can only close
  const makesFixtures = $derived(!games.length && !tooFew);
  const finishes = $derived(games.length > 0 || !tooFew);
  const finishLabel = $derived(makesFixtures ? "Close draft & make fixtures" : "Close the draft");
  // Fixtures made, the tournament's page moves on to Fixtures set by itself (ADR 0074): its own address shows the
  // status it's at, so whoever made them, from the draft's address, goes to it; captains watching stay where they are
  const home = $derived(`/tournaments/${type.slug}`);
  const finish = (leaveOut = false) =>
    tournament &&
    job(async () => {
      const making = makesFixtures;
      const done = await (finishes ? finishDraft(tournament.id, leaveOut) : closeDraft(tournament.id, leaveOut));
      if (done !== null && making && router.path !== home) navigate(home);
    });
  const fixturesNow = () =>
    tournament &&
    job(async () => {
      if ((await makeFixtures(tournament.id)) !== null && router.path !== home) navigate(home);
    });
  // Closing with members still to pick (Manage): say so, and ask before leaving them out
  let confirmLeaveOut = $state(false);
  async function close() {
    if (!tournament) return;
    if (pool.length && !confirmLeaveOut) return void (confirmLeaveOut = true);
    await finish(pool.length > 0);
    confirmLeaveOut = false;
    manageOpen = false;
  }
  // Start again: once there's a pick to take back. The fixtures stay (ADR 0060). Asked first, as it can't be undone
  const resettable = $derived(made > 0);
  let confirmReset = $state(false);
  async function reset() {
    if (!tournament) return;
    if (!confirmReset) return void (confirmReset = true);
    await resetDraft(tournament.id);
    confirmReset = false;
    manageOpen = false;
  }
  // Reopening a closed draft with fixtures asks what becomes of them (ADR 0060): kept (no match started), or cleared,
  // results and all, which is the only way once a match has started, and takes someone who edits the tournament. An
  // admin can also clear them without reopening. What's lost is counted from the matches the server sent
  let asking = $state<null | "reopen" | "clear">(null);
  const canClear = $derived(can(perms, "manage:Tournament"));
  const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
  const lost = $derived.by(() => {
    const results = games.filter((g) => g.homeGoals !== null).length;
    const goals = games.reduce((n, g) => n + (g.goals?.length ?? 0), 0);
    const counts = [results && plural(results, "result"), goals && plural(goals, "goal")].filter(Boolean);
    if (counts.length) return `${counts.join(" and ")} will be deleted.`;
    if (played) return "The match under way will be deleted, with its scoresheet.";
    return `${plural(games.length, "match", "matches")} will be deleted, none of them started.`;
  });
  const reopenWith = (fixtures: "keep" | "clear") =>
    tournament && job(() => reopenDraft(tournament.id, fixtures)).then(() => ((asking = null), (manageOpen = false)));
  const clearThem = () =>
    tournament && job(() => clearFixtures(tournament.id)).then(() => ((asking = null), (manageOpen = false)));
  // Whoever runs the draft, and admins adding players: their jobs behind one Manage button, a bottom sheet on a
  // phone and a side drawer on a desktop (the admin controls pattern). Closing with players left, or a reset, asks
  // there first
  interface Tool {
    icon: IconName;
    label: string;
    sub: string;
    run: () => void;
  }
  let manageOpen = $state(false);
  const tools = $derived.by(() => {
    if (!tournament) return [] as Tool[];
    const id = tournament.id;
    const list: Tool[] = [];
    // Closed: the quiet way back, asking about the fixtures when there are some; and clearing the fixtures alone
    if (phase === "closed") {
      if (running && (!played || canClear))
        list.push({
          icon: "undo",
          label: BACK_TO.teams,
          sub: !games.length
            ? "The captains carry on where they left off"
            : played
              ? "A match has started: reopening clears the fixtures"
              : "The captains carry on; keep the fixtures or clear them",
          run: () => (games.length ? (asking = "reopen") : void reopenWith("keep")),
        });
      if (canClear && games.length)
        list.push({
          icon: "x",
          label: "Clear the fixtures",
          sub: played ? "Results and all: make them again after" : "Make them again after",
          run: () => (asking = "clear"),
        });
      return list;
    }
    // Back a step of the draft's own (to the drawn order, to before the draw) is the header's Manage, the page's one
    // Back (lib/TournamentHead, ADR 0074), not one here as well
    if (running && open && made)
      list.push({
        icon: "undo",
        label: "Undo the last pick",
        sub: lastPick ? `${lastPick.name} goes back to the pool` : "",
        run: () => void undoDraftPick(id).then(() => (manageOpen = false)),
      });
    if (adding)
      list.push({
        icon: "userPlus",
        label: "Add player",
        sub: "Put in someone who didn't sign up",
        run: () => ((manageOpen = false), (addingOpen = true)),
      });
    if (running && open)
      list.push({
        icon: "check",
        label: finishLabel,
        sub: pool.length ? `${pool.length} still to pick` : "Everyone's picked: set the teams",
        run: () => void close(),
      });
    if (running && resettable)
      list.push({
        icon: "x",
        label: "Reset the draft",
        sub: "Every pick comes off, and the order",
        run: () => void reset(),
      });
    return list;
  });
  // Handed up to the header's Manage (Games). A block, not `() => onmanage?.(…)`: an effect that returns a function
  // has it run as its teardown, and the parent's `(open) => (draftJobs = open)` returned the opener, so every change
  // to the tools (a pick, a step back) opened this drawer by itself (lib/effects.test.ts)
  const openManage = () => (manageOpen = true);
  $effect(() => {
    onmanage?.(tools.length ? openManage : null);
  });
  $effect(() => {
    if (manageOpen) return;
    confirmLeaveOut = false;
    confirmReset = false;
    asking = null;
  });

  // Setting the order, starting the draft: one at a time
  let busy = $state(false);
  async function job(run: () => Promise<unknown>) {
    if (busy) return;
    busy = true;
    try {
      await run();
    } finally {
      busy = false;
    }
  }

  // While it's open, the other captains' picks show up as they're made, from the hub's stream (ADR 0072), with a
  // check on the admins' beat as the fallback (ADR 0072). A check is a Worker request and a few small queries
  // (session, roles, data version); a room of phones on one wifi stays inside the per-address limit (ADR 0055)
  // On the night, before it opens, the page follows too, so the draw arrives on every phone at once and shuffles in
  // (DraftOrder)
  const waiting = $derived(
    phase !== "open" && phase !== "closed" && teams.length >= 2 && (tournament?.draftOn ?? "") <= londonToday(),
  );
  $effect(() => {
    if (open || waiting) return checkForUpdates();
  });
  // The tournament's team names, which its crests are told apart among (logo.ts)
  const crestNames = $derived(teamNamesOf(teams, (id) => (id ? byId(id) : undefined)));
  // The draft room (ADR 0060): the way in for its captains and whoever runs it while it's open, lit for a captain
  // whose pick is now or close (lib/draft-room.ts)
  const enterable = $derived(!room && canEnterRoom(tournament, me().id, running));
  const offered = $derived(enterable && roomOffered(tournament, me().id));
</script>

<!-- A team's turn, as a badge: Picking, Next, In N -->
{#snippet turnBadge(i: number)}
  {@const k = turnIn(i)}
  {#if live && k === 0}<span class="badge red"><Icon name="clock" size={13} />Picking</span>
  {:else if live && k === 1}<span class="badge">Up next</span>
  {:else if live && k !== Infinity}<span class="badge num">In {k}</span>
  {/if}
{/snippet}

<!-- A team's players as rows: the captain, then its picks in order; `next` draws your coming pick already -->
{#snippet roster(i: number, next = false)}
  {@const t = teams[i]}
  <ol class="rows">
    {#if t.captainMemberId}
      {@const c = byId(t.captainMemberId)}
      <li class="row" class:you={t.captainMemberId === me().id}>
        <span class="c display" title="Captain" aria-label="Captain">C</span>
        <span class="name"
          >{goesByOf(c)}{#if t.captainMemberId === me().id}<small>you</small>{/if}</span
        >
        {#if c}<span class="pos" class:g={c.position === "G"}>{c.position}</span>{/if}
      </li>
    {/if}
    {#each t.players as p, n (p.memberId ?? p.name)}
      {@const m = p.memberId ? byId(p.memberId) : undefined}
      {@const by = pickerOf(p, i)}
      <li
        class="row"
        class:you={p.memberId === me().id}
        class:hit={!!query.trim() && !!m && matchesName(m, query)}
        animate:flip={{ duration: moveMs }}
      >
        <span class="n num">{n + 1}</span>
        <span class="name"
          >{goesByOf(m) || p.name}{#if p.memberId === me().id}<small>you</small>{/if}{#if by}<small
              class="by"
              title="{by} picked them for {teamName(i)}">{by}'s pick</small
            >{/if}</span
        >
        {#if m}<span class="pos" class:g={m.position === "G"}>{m.position}</span>{/if}
      </li>
    {/each}
    {#if room}
      <!-- The draft room: every pick still to come is its row already, so the team reads as a board and a pick
           landing fills its row, moving nothing -->
      {#each laneSlots(i) as pick, k (pick)}
        <li class="row slot">
          <span class="n num">{t.players.length + k + 1}</span>
          <span class="name num">pick {pick}</span>
        </li>
      {/each}
    {:else if next}
      <li class="row slot">
        <span class="n num">{t.players.length + 1}</span>
        <span class="name num">pick {made + turnIn(i) + 1}</span>
      </li>
    {/if}
  </ol>
{/snippet}

{#snippet playerRow(p: Player, action: boolean)}
  <div class="prow" class:dim={dimmed(p)}>
    <button class="nm" onclick={(e) => (lifted = { id: p.id, el: e.currentTarget })}>
      {goesBy(p)}{#if p.cougar}<small>Cougar</small>{/if}
    </button>
    <span class="ps" class:g={p.position === "G"}>{p.position}</span>
    <!-- Room for Pick is always kept, so the rows don't change when your turn comes -->
    <span class="act">
      {#if action && pickable(p)}
        {@const on = chosenPlayer?.id === p.id}
        <button
          class="btn sm pick"
          aria-pressed={on}
          aria-label={forOther ? `Pick ${goesBy(p)} for ${forName}` : undefined}
          title={forOther ? `Pick for ${forName}` : undefined}
          onclick={() => (chosen = on ? null : p.id)}
          >{#if on}<Icon name="check" size={14} />Picked{:else}Pick{/if}</button
        >
      {/if}
    </span>
  </div>
{/snippet}

{#snippet playersView()}
  <section class="players" aria-label="Players">
    {#if phase === "closed"}
      {#if leftOut.length}
        <p class="hint">Left out when the draft closed, still signed up. An admin can put them on a team.</p>
        <div class="plist">
          {#each leftOut as p (p.id)}{@render playerRow(p, false)}{/each}
        </div>
      {:else}
        <p class="hint">Everyone who signed up is on a team.</p>
      {/if}
    {:else if pool.length}
      <!-- The position filter: the app's filter chips, as Teammates has them, each with how many are left -->
      {#if columns}
        <!-- A desktop: the search on a row of its own over the chips, always there, so neither covers the other -->
        <div class="find-row">
          <SearchField bind:value={query} placeholder="Search players" label="Search players" />
        </div>
      {/if}
      <div class="filters" role="group" aria-label="Position">
        {#each [["all", "All", found.length, "teams"], ["F", "Forwards", foundTally.F, "stick"], ["D", "Defence", foundTally.D, "shield"], ["G", "Keepers", foundTally.G, "net"]] as const as [v, label, n, icon] (v)}
          <button class="filter" aria-pressed={filter === v} onclick={() => (filter = v)}
            ><Icon name={icon} size={16} />{label}<span class="count num">{n}</span></button
          >
        {/each}
      </div>
      <div class="plist" aria-label="Players left">
        {#each listed as p (p.id)}{@render playerRow(p, true)}{:else}<p class="hint none">No one matches.</p>{/each}
      </div>
    {:else if open}
      <p class="hint">
        {running ? "Everyone's picked." : "Everyone's picked. Whoever runs the draft closes it to set the teams."}
      </p>
    {:else}
      <p class="hint">Nobody's signed up yet.</p>
    {/if}
  </section>
{/snippet}

<!-- Find someone: a magnifier at the end of the row that widens into the field when you tap it (across the row, over
     the tabs, on a phone), as Friday's does -->
{#snippet finder()}
  <div class="finder">
    <SearchField bind:value={query} placeholder="Search players" label="Search players" collapsible />
  </div>
{/snippet}

{#snippet teamsView()}
  <section class="teams" aria-label="Teams">
    {#each teamOrder as i (teams[i].id ?? i)}
      {@const t = teams[i]}
      {@const yours = i === myTeam}
      <div class="panel" aria-label={yours ? "Your team" : undefined}>
        <header>
          <TeamCrest
            among={crestNames}
            name={teamName(i)}
            logo={t.logo}
            tone={teamTone(i)}
            onclick={canLook(i) ? () => ((lookIndex = i), (lookOpen = true)) : undefined}
          />
          <h3 class="display">{teamName(i)}</h3>
          <!-- Its place in the pick order (round one's), once drawn: the order lives here once the draft's open -->
          {#if typeof t.pick === "number" && phase !== "closed" && !yours}<span
              class="pickno num"
              title="Picks {nth(t.pick)} in round one">{nth(t.pick)}</span
            >{/if}
          {#if yours}
            <!-- Yours: said in words; Picking when it's your turn (the strip above says how long till then), and a
                 heads-up while you still need a goalie -->
            {#if open && !haveGoalie}<span class="badge amber"><Icon name="alert" size={13} />No goalie</span>{/if}
            {#if live && turnIn(i) === 0}<span class="badge red"><Icon name="clock" size={13} />Picking</span>
            {:else}<span class="badge">Your team</span>{/if}
          {:else}
            {@render turnBadge(i)}
          {/if}
        </header>
        {@render roster(i, yours && live && untilMine >= 0)}
      </div>
    {/each}
  </section>
{/snippet}

<!-- On a phone, once it's open, the page is the window's height and the players scroll inside it (.page.fit), so the
     list starts high and takes the rest -->
<div
  class="draft"
  class:fit
  class:room
  class:board-on={room && columns && live}
  class:on={open}
  bind:clientWidth={pageW}
>
  {#if !tournament || tournament.kind !== "draft"}
    <p class="hint">No draft coming up.</p>
  {:else if teams.length < 2}
    <!-- Nothing to draft yet: said plainly on the page, not in a box, with the one thing to do about it -->
    <EmptyState icon="draft" title="No captains yet">
      {can(perms, "manage:Tournament")
        ? "Name two or more captains and the draft can open. They pick the teams, a player at a time."
        : "The captains are named before draft night. They pick the teams, a player at a time."}
      {#snippet action()}
        {#if can(perms, "manage:Tournament")}
          <button class="btn outline" onclick={() => editTournament(tournament.id, { tab: "teams" })}
            ><Icon name="userPlus" size={18} />Name the captains</button
          >
        {/if}
      {/snippet}
    </EmptyState>
  {:else}
    <!-- Where you stand, as one badge, and the tools. Always the same height. How to pick is in Rules, not here. In
         the draft room its bar says it -->
    {#if !room}<div class="strip">
        {#if phase === "closed"}
          <span class="turn done">Draft closed</span>
        {:else if live}
          <!-- Who's picking, said plainly (an admin picking for them sees "Pick for …" on the button, not here); a tap
             brings the ticker back to their card -->
          <button
            type="button"
            class="turn as-btn"
            class:now={mine || canPick}
            title="Show in the ticker"
            onclick={backToNow}
            >{#if mine || canPick}<i class="dot"></i>{/if}{#if mine}Your pick{:else}<span class="clip"
                >{teamName(clock)} picking</span
              >{/if}</button
          >
        {:else if open}
          <span class="turn done">Everyone's picked</span>
        {:else if settled}
          <span class="turn">Order set</span>
        {:else}
          <span class="turn">{whenSaid ? `Draft ${whenSaid}` : "Draft date TBC"}</span>
        {/if}
        <div class="tools">
          {#if open && !fit && myPlace}<span class="mine num">{myPlace}</span>{/if}
          {#if open}
            <!-- Picks show up as they're made while the hub's stream is open; else on the admins' beat (ADR 0072) -->
            <span
              class="updates hint"
              title={liveFeed.on
                ? "Other captains' picks show up as they're made"
                : `Other captains' picks show up ${everyHowOften()}, to keep the club on the free plan`}
              ><Icon name={liveFeed.on ? "live" : "clock"} size={14} /><span class="lbl"><LiveNote /></span></span
            >
          {/if}
          <!-- Rules and Manage are the page header's (ADR 0074): the draft's jobs are in its Manage, the rules in
             Format & rules, the picks on the ticker and, once it's done, How the picks went -->
          {#if enterable}
            <!-- Into the draft room: the whole screen for the draft. Quiet, lit (no bigger) when your pick's close -->
            <button
              class="btn sm ghost room-in"
              class:soon={offered}
              aria-label="Enter the draft room"
              title="Enter the draft room: the whole screen"
              onclick={() => enterRoom(type.slug, navigate)}
              ><Icon name="expand" size={16} /><span class="lbl">Draft room</span></button
            >
          {/if}
        </div>
      </div>{/if}

    <!-- Before it starts: the captains, no numbers until the order's drawn, then shuffled into it for everyone on the
         page. The page leads whoever runs it one step at a time, one main button each (ADR 0060): Shuffle, then Open
         draft; the players and teams stay hidden until the order's drawn. Once it starts this folds away: the page is
         the draft, and the order's on the team cards -->
    {#if phase !== "open" && phase !== "closed"}
      <div class="before" out:slide={{ duration: prefersReducedMotion ? 0 : 280 }}>
        <!-- Step 1, Draw the order: a card in the middle with the captains in it, where the shuffle plays. Settled, the
             card lets go and the order stays put as the page's order row (lib/DraftStep quiet) -->
        <DraftStep {type} mark="draw" title="Draw the order" quiet={settled}>
          {#snippet body()}
            <DraftOrder {type} captains={order} {drawn} plain={!settled} onshown={() => (drawShown = true)} />
          {/snippet}
          {#if drawn}Drawing the order…
          {:else if running}Who picks first is drawn at random, for everyone watching.
          {:else}<strong>Draft not open yet.</strong> The pick order's drawn first, for everyone watching.{/if}
          {#snippet action()}
            {#if running}
              <!-- Kept while the names shuffle, so nothing moves until the card lets go -->
              <button class="btn primary" disabled={busy || drawn} onclick={() => job(() => drawOrder(tournament.id))}
                >{drawn ? "Shuffling…" : "Shuffle"}</button
              >
            {/if}
          {/snippet}
        </DraftStep>
        <!-- Step 2, Open the draft: in under the order once the draw has settled -->
        {#if settled}
          <div in:fly={{ y: 24, duration: prefersReducedMotion ? 0 : 360, delay: prefersReducedMotion ? 0 : 320 }}>
            <DraftStep {type} mark="open" title="Open the draft">
              {#if !running}<strong>Draft not open yet.</strong> It opens when whoever runs it says go.
              {:else if short}<span class="warn"
                  >A team's at least {MIN_TEAM_SIZE}: needs {needed} signed up, {pool.length} so far.</span
                >
              {:else if tooFew}<span class="warn"
                  >The playoffs need {playoffTeams} teams: choose fewer in the {type.shortName} settings.</span
                >
              {:else}Opening it tells each captain where they pick. Round one in this order, snaking back each round.{/if}
              {#snippet action()}
                {#if running}
                  <button
                    class="btn primary"
                    disabled={short || busy}
                    onclick={() => job(() => openDraft(tournament.id))}><Icon name="gong" size={18} />Open draft</button
                  >
                {/if}
              {/snippet}
            </DraftStep>
          </div>
        {/if}
      </div>
    {/if}

    <!-- The last step: everyone's picked, and one tap closes the draft and makes the fixtures -->
    {#if open && !pool.length}
      <DraftStep {type} mark="sealed" seal title="Seal the teams">
        {#if !running}<strong>Everyone's picked.</strong> Whoever runs the draft closes it to set the teams.
        {:else if tooFew && !games.length}<span class="warn"
            >The playoffs need {playoffTeams} teams: choose fewer in the {type.shortName} settings.</span
          >
        {:else}<strong>Everyone's picked.</strong>
          {makesFixtures ? "Close it to set the teams and make the fixtures." : "Close it to set the teams."}{/if}
        {#snippet action()}
          {#if running}
            <button class="btn primary" disabled={busy} onclick={() => finish()}
              ><Icon name="check" size={18} />{finishLabel}</button
            >
          {/if}
        {/snippet}
      </DraftStep>
    {/if}

    <!-- Closed: the teams are set. Fixtures not made yet (the playoffs needed more teams): that's the one step left -->
    {#if phase === "closed"}
      <div class="step" class:member={!running || !!games.length || tooFew}>
        <p class="ask">
          {games.length ? "The teams are set and the fixtures are out." : "The teams are set."}
          {#if running && !games.length && tooFew}<span class="warn"
              >The playoffs need {playoffTeams} teams: choose fewer in the {type.shortName} settings.</span
            >{/if}
        </p>
        {#if running && !games.length && !tooFew}
          <button class="btn primary" disabled={busy} onclick={fixturesNow}>Make the fixtures</button>
        {/if}
      </div>
    {/if}

    <!-- Under the turn, one small line kept while it's on: who's next (and, on a phone, a captain's own place). The
         last pick is the ticker's newest chip, which lights up as it lands -->
    {#if live && !room}
      <dl class="lines">
        <dt>Next</dt>
        <dd>
          {#if live && pool.length > 1}<span class="v">{nextUp === myTeam ? "You" : teamName(nextUp)}</span>{:else}<span
              class="k">{live ? "Nobody: this is the last pick" : "Everyone's picked"}</span
            >{/if}
          {#if fit && myPlace}<span class="mine num">{myPlace}</span>{/if}
        </dd>
      </dl>
    {/if}
    {#if live}
      <!-- For a screen reader: each pick as it lands, said whole (the ticker shows it) -->
      <p class="sr-only" aria-live="polite">
        {#if lastPick}{lastPick.by || teamName(lastPick.team)} picked {lastPick.name}{lastPick.by
            ? ` for ${teamName(lastPick.team)}`
            : ""}{/if}
      </p>
    {/if}

    <!-- The ticker: the picks just made, then every pick to come -->
    {#if ticker.length}
      <div class="ticker-wrap">
        <!-- svelte-ignore a11y_no_noninteractive_tabindex, a11y_no_noninteractive_element_interactions (a scroller the keyboard moves: arrows, Home for now) -->
        <div
          class="ticker"
          bind:this={tickerEl}
          aria-label="Picks: arrow keys look along, Home goes back to now"
          tabindex="0"
          role="region"
          onscroll={look}
          onkeydown={tickerKeys}
        >
          {#each ticker as t (t.n)}
            <div
              class="tick"
              class:done={t.n <= made}
              class:up={t.n === made + 1}
              class:fresh={t.n === fresh}
              class:now={live && t.n === made + 1}
              class:me={live && t.n === made + 1 && mine}
              class:lift={t.n === raised}
              data-n={t.n}
              style:--d={Math.min(Math.abs(t.n - raised), 2)}
              animate:flip={{ duration: moveMs }}
            >
              <TeamCrest
                among={crestNames}
                name={teamName(t.team)}
                logo={teams[t.team].logo}
                tone={teamTone(t.team)}
                size={fit ? "1.75rem" : room ? "2.75rem" : "2.25rem"}
              />
              <span class="who display"
                >{#if t.team === myTeam}<Icon name="user" size={12} />You{:else}<span class="clip"
                    >{teamName(t.team)}</span
                  >{/if}</span
              >
              {#if live && t.n === made + 1 && mine}<span class="badge red clock"><i class="dot"></i>Your pick</span>
              {:else if live && t.n === made + 1}<span class="badge clock">On the clock</span>
              {:else}<span class="meta num">{tickMeta(t)}</span>{/if}
            </div>
          {/each}
        </div>
        <!-- A pointer's way along: a chevron over each edge while there's more that way (not on a phone: swipe), one
             pick a click either way. With the current pick out of view, a red dot by the chevron on its side says
             which way it is -->
        {#each [-1, 1] as const as side (side)}
          {@const toNow = nowSide === side}
          <button
            class="edge"
            class:left={side < 0}
            class:right={side > 0}
            class:to-now={toNow}
            class:gone={!(side < 0 ? canLeft : canRight)}
            tabindex="-1"
            aria-label={side < 0 ? "Earlier picks" : "Picks to come"}
            title={toNow ? "The current pick is this way" : undefined}
            onclick={() => page(side)}><Icon name={side < 0 ? "chevronLeft" : "chevronRight"} size={22} /></button
          >
        {/each}
        <!-- A phone's way back to the current pick: a small round arrow in the edge's fade, on its side -->
        {#if nowSide}
          <button
            class="back-now"
            class:left={nowSide < 0}
            onclick={backToNow}
            transition:fade={{ duration: fadeMs }}
            aria-label="Back to now"
            title="Now"><Icon name={nowSide < 0 ? "chevronLeft" : "chevronRight"} size={16} /></button
          >
        {/if}
      </div>
    {/if}

    {#if !settled && phase !== "open" && phase !== "closed"}
      <!-- The players and teams wait for the order: the first thing on the night is the draw -->
    {:else if done}
      <!-- The picking's over: the teams, the whole page scrolling down them; anyone left out when it closed under them -->
      <div class="done-teams" in:fade={viewsIn}>
        {@render teamsView()}
        {#if leftOut.length}{@render playersView()}{/if}
      </div>
    {:else if room && columns}
      <!-- The draft room on a desktop: the window's height, the pool down the left and every team a column beside
           it, in pick order; each scrolls inside itself. The team on the clock is lit, yours marked -->
      <div class="board" in:fade={viewsIn} style:--lanes={teams.length}>
        <div class="lane-pool">{@render playersView()}</div>
        {#each teams as t, i (t.id ?? i)}
          <section
            class="lane"
            class:on-clock={live && i === clock}
            class:yours={i === myTeam}
            aria-label={teamName(i)}
          >
            <header>
              <TeamCrest
                among={crestNames}
                name={teamName(i)}
                logo={t.logo}
                tone={teamTone(i)}
                onclick={canLook(i) ? () => ((lookIndex = i), (lookOpen = true)) : undefined}
              />
              <h3 class="display">{teamName(i)}</h3>
            </header>
            <!-- Its badges on a line of their own, always there, so a turn coming round moves nothing -->
            <div class="lane-badges">
              {#if i === myTeam}<span class="badge">Your team</span>{/if}
              {#if i === myTeam && !haveGoalie}<span class="badge amber"><Icon name="alert" size={13} />No goalie</span
                >{/if}
              {@render turnBadge(i)}
            </div>
            <div class="lane-rows">{@render roster(i)}</div>
          </section>
        {/each}
      </div>
    {:else if !columns}
      <!-- Narrower than two columns: one view at a time; Teams warns while you still need a goalie -->
      <div class="tab-row" in:fade={viewsIn}>
        <div class="tablist" role="tablist" aria-label="Draft">
          <button role="tab" aria-selected={view === "players"} onclick={() => show("players")}>Players</button>
          <button role="tab" aria-selected={view === "teams"} onclick={() => show("teams")}
            >Teams{#if myTeam >= 0 && open && !haveGoalie}<span class="need" title="No goalie yet"
                ><Icon name="alert" size={13} />G</span
              >{/if}</button
          >
        </div>
        {#if searching}{@render finder()}{/if}
      </div>
      {#key view}
        <div class="pane" in:fly={{ x: 32 * dir, duration: flyMs, easing: easeOut, opacity: 0 }}>
          {#if view === "teams"}{@render teamsView()}
          {:else}{@render playersView()}{/if}
        </div>
      {/key}
    {:else}
      <div class="views" in:fade={viewsIn} class:filtered={phase !== "closed" && pool.length > 0}>
        <div class="col pool">{@render playersView()}</div>
        <div class="col side">{@render teamsView()}</div>
      </div>
    {/if}
  {/if}
</div>

<!-- End turn: a bar floating at the bottom once you've picked someone, over the page (so nothing moves), where your
     thumb is -->
{#if chosenPlayer}
  <div
    class="end-bar"
    role="region"
    aria-label="Your pick"
    transition:fly={{ y: 24, duration: flyMs, easing: easeOut, opacity: 0 }}
  >
    <div class="who-picked">
      <span class="eyebrow">{forOther ? `Picking for ${teamName(clock)}` : "Your pick"}</span>
      <span class="chosen-name">{goesBy(chosenPlayer)}<small>{chosenPlayer.position}</small></span>
    </div>
    <button class="btn ghost sm" onclick={() => (chosen = null)}>Change</button>
    <button class="btn primary end-turn" disabled={ending} onclick={endTurn}
      >{forOther ? `Pick for ${forName}` : "End turn"}<Icon name="chevronRight" size={18} /></button
    >
  </div>
{/if}

<!-- Manage: whoever runs the draft's jobs, thumb-sized. Closing with players left, or a reset, asks here first -->
{#snippet jobList()}
  {#if asking === "reopen" && !played}
    <!-- No match started: keeping the fixtures is the default; clearing them is there for whoever edits it -->
    <div class="confirm" role="alert">
      <p>
        Reopen the draft? The captains carry on where they left off. The fixtures are between the same teams, so they
        can stay.
      </p>
      <div class="confirm-keys">
        <button class="btn ghost" onclick={() => (asking = null)}>Not now</button>
        {#if canClear}
          <button class="btn ghost danger" disabled={busy} onclick={() => reopenWith("clear")}
            >Clear the fixtures</button
          >
        {/if}
        <button class="btn primary" disabled={busy} onclick={() => reopenWith("keep")}>Keep the fixtures</button>
      </div>
    </div>
  {:else if asking}
    <!-- A match has started (reopening clears them), or clearing them alone: what goes, said plainly first -->
    <div class="confirm" role="alert">
      <p>
        {#if asking === "reopen"}A match has started, so reopening the draft clears the fixtures. <strong>{lost}</strong
          > To change a team without that, use the Teams page.
        {:else}Clear the fixtures? <strong>{lost}</strong> You can make them again after.{/if}
      </p>
      <div class="confirm-keys">
        <button class="btn ghost" onclick={() => (asking = null)}
          >{asking === "reopen" ? "Keep it closed" : "Keep them"}</button
        >
        <button
          class="btn delete"
          disabled={busy}
          onclick={() => (asking === "reopen" ? reopenWith("clear") : clearThem())}
          >{asking === "reopen" ? "Clear the fixtures and reopen" : "Clear the fixtures"}</button
        >
      </div>
    </div>
  {:else if confirmLeaveOut || confirmReset}
    <div class="confirm" role="alert">
      <p>
        {#if confirmLeaveOut}{pool.length} still to pick. Close it and leave them out? They stay signed up.
        {:else}Start again? Every pick comes off, and the order's drawn again.{/if}
      </p>
      <div class="confirm-keys">
        <button class="btn ghost" onclick={() => ((confirmLeaveOut = false), (confirmReset = false))}
          >{confirmLeaveOut ? "Keep picking" : "Keep it"}</button
        >
        <button class="btn primary" onclick={confirmLeaveOut ? close : reset}
          >{confirmLeaveOut ? "Close it" : "Reset the draft"}</button
        >
      </div>
    </div>
  {:else}
    <div class="jobs">
      {#each tools as tool (tool.label)}
        <button class="job" onclick={tool.run}>
          <Icon name={tool.icon} size={22} />
          <span class="job-text"><strong>{tool.label}</strong><span>{tool.sub}</span></span>
          <Icon name="chevronRight" size={18} />
        </button>
      {/each}
    </div>
  {/if}
{/snippet}
{#if tools.length}
  {#if phone.current}
    <Sheet bind:open={manageOpen} title="Manage the draft">{@render jobList()}</Sheet>
  {:else}
    <Drawer bind:open={manageOpen} title="Manage the draft" sub={tournament?.name}>{@render jobList()}</Drawer>
  {/if}
{/if}

{#if lifted}
  {@const p = byId(lifted.id)}
  {#if p}
    <PlayerCardZoom
      player={p}
      source={lifted.el}
      you={p.id === me().id}
      showRating={ratings}
      bio={p.bio}
      onclose={() => (lifted = null)}
    />
  {/if}
{/if}

{#if tournament && lookOpen && teams[lookIndex]?.id}
  {@const t = teams[lookIndex]}
  <TeamLookSheet
    tournamentId={tournament.id}
    teamId={t.id!}
    name={t.name}
    logo={t.logo}
    fallback={nameOfTeam({ ...t, name: "" }, teams, (id) => (id ? byId(id) : undefined))}
    bind:open={lookOpen}
  />
{/if}

{#if tournament && adding}
  <TournamentPlayersDrawer
    tournamentId={tournament.id}
    going={tournament.going ?? []}
    {captains}
    sub="{tournament.name}{when ? ` · draft ${when}` : ''}"
    bind:open={addingOpen}
  />
{/if}

<style>
  /* Manage's jobs: a row each, filled, no lines */
  .jobs {
    display: grid;
    gap: var(--s-2);
  }
  .job {
    display: flex;
    align-items: center;
    gap: var(--s-4);
    min-height: 4.25rem;
    padding: var(--s-3) var(--s-4);
    border: 0;
    border-radius: var(--r-lg);
    background: var(--surface-2);
    color: var(--fg-muted);
    font: inherit;
    text-align: left;
    cursor: pointer;
  }
  .job:hover,
  .job:active {
    background: var(--surface-3);
  }
  .job-text {
    display: grid;
    flex: 1;
    gap: 0.15rem;
    min-width: 0;
  }
  .job-text strong {
    color: var(--fg);
    font-size: var(--text-md);
    font-weight: 600;
  }
  .job-text span {
    font-size: var(--text-sm);
  }
  .confirm {
    display: grid;
    gap: var(--s-4);
  }
  /* Clearing what can't come back: red words to offer it, and the one red fill is the tap that does it (as deleting a
     tournament or an account) */
  .danger {
    color: var(--red-hot);
  }
  .delete {
    background: var(--red);
    color: var(--on-red);
  }
  .delete:hover:not(:disabled) {
    background: var(--red-hot);
  }
  .confirm p {
    margin: 0;
    color: var(--fg-body);
  }
  .confirm-keys {
    display: flex;
    flex-wrap: wrap;
    justify-content: flex-end;
    gap: var(--s-3);
  }
  /* A team's place in the pick order, beside its name: small, in the numbers' face */
  .pickno {
    flex-shrink: 0;
    color: var(--fg-muted);
    font-size: var(--text-xs);
    font-weight: 700;
    letter-spacing: 0.04em;
    text-transform: uppercase;
  }
  /* A pick someone made for the captain: whose it was */
  .name small.by {
    color: var(--fg-subtle);
  }
  /* Who's next, and your place: one small line under the turn, always there while it's on */
  /* Next and Last: one small size, two weights (the words muted, the names in the body colour), labels in a column of
     their own so the names line up; a long line ends in an ellipsis */
  .lines {
    display: grid;
    grid-template-columns: 2.5rem minmax(0, 1fr);
    gap: 0.15rem var(--s-2);
    margin: 0;
    font-size: var(--text-sm);
    line-height: 1.35;
  }
  .lines dt {
    color: var(--fg-muted);
    font-weight: 400;
  }
  .lines dd {
    display: flex;
    gap: var(--s-2);
    min-width: 0;
    margin: 0;
    overflow: hidden;
    white-space: nowrap;
  }
  .lines .k {
    color: var(--fg-muted);
  }
  .lines .v {
    color: var(--fg-body);
    font-weight: 500;
  }
  /* A captain's place: quiet, at the end of the Next line on a phone, before the icons on a desktop */
  .mine {
    flex-shrink: 0;
    margin-left: auto;
    color: var(--fg-muted);
    font-size: var(--text-sm);
    font-variant-numeric: tabular-nums;
  }
  .tools .mine {
    align-self: center;
    margin: 0 var(--s-2) 0 0;
    line-height: 1;
  }
  .before {
    display: grid;
    gap: var(--s-3);
    min-width: 0;
  }
  /* A step of the night (ADR 0060). For whoever runs it, Shuffle, Open draft and Close draft & make fixtures are the
     moment: the line and the one main button centred in the page column, stacked, with room round them, the order
     above and the players below. Two lines are kept for the text, so the step changing moves nothing. Everyone
     else's step (and a closed draft's See the fixtures) is a line with what's next beside it */
  .step {
    display: flex;
    align-items: center;
    justify-content: flex-end;
    gap: var(--s-3);
    min-height: var(--control-h);
  }
  .step .ask {
    flex: 1;
    min-width: 0;
  }
  .step .warn {
    color: var(--tone-amber);
  }
  .step:not(.member) {
    flex-direction: column;
    justify-content: center;
    gap: var(--s-4);
    padding-block: var(--s-6) var(--s-8);
    text-align: center;
  }
  .step:not(.member) .ask {
    flex: none;
    max-width: 34rem;
    min-height: 2lh;
    margin: 0;
    text-wrap: balance;
  }
  .step:not(.member) .btn {
    min-width: 16rem;
  }
  @media (max-width: 599px) {
    .step:not(.member) .btn {
      width: 100%;
      max-width: 24rem;
      min-width: 0;
    }
  }

  /* A phone, the draft open: the window's height; the players (or the teams) take what's left and scroll inside, so
     the list starts high. Room at its foot for the End turn bar */
  /* While it's on, the blocks under the tabs sit closer: the lines under the turn pull up into the page's gap (the
     header and its tabs stay where they are) */
  .draft.on .lines {
    margin-top: calc(-1 * var(--s-3));
  }
  .draft.on .ticker {
    margin-top: calc(-1 * var(--s-2));
  }
  .draft.fit {
    gap: var(--s-2);
    padding-bottom: var(--s-3);
  }
  /* Tighter on a phone: the turn a size down and the line under it right under it, the ticker shorter, the tabs and
     chips a size smaller */
  .draft.fit .strip {
    min-height: 2.25rem;
  }
  .draft.fit .turn {
    height: 2.25rem;
    font-size: 1.2rem;
  }
  /* A long turn ("Team Charlie picking") gives way to the icons, cut with an ellipsis only when it runs out of
     room, rather than pushing them off */
  .draft.fit .strip .turn {
    flex-shrink: 1;
    min-width: 0;
    white-space: nowrap;
  }
  .draft.fit .strip .tools {
    flex-shrink: 0;
  }
  .draft.fit .lines {
    margin-top: 0;
  }
  .draft.fit .ticker {
    height: 4rem;
    padding-inline: calc(50% - 4.5rem);
  }
  .draft.fit .tick {
    width: 9rem;
    height: 3rem;
    padding: 0 var(--s-3) 0 var(--s-2);
    column-gap: var(--s-2);
  }
  .draft.fit .tick.lift {
    scale: 1.08;
  }
  .draft.fit .tablist > button {
    height: 2rem;
    font-size: 1rem;
  }
  .draft.fit .players {
    gap: var(--s-2);
  }
  .draft.fit .filter {
    height: 1.9rem;
    font-size: var(--text-xs);
  }
  .draft.fit > .pane {
    display: flex;
    flex: 0 1 auto;
    flex-direction: column;
    min-height: 0;
  }
  .draft.fit .players {
    display: flex;
    flex-direction: column;
    min-height: 0;
  }
  .draft.fit .players > * {
    flex-shrink: 0;
  }
  .draft.fit .plist,
  .draft.fit .teams {
    flex: 0 1 auto;
    min-height: 0;
    overflow-y: auto;
    overscroll-behavior: contain;
    padding-bottom: 5.5rem;
  }
  /* Never wider than the view: the shell clips sideways, so anything wider would be cut off, not scrolled */
  /* A view of the tournament's page (ADR 0074): the page gives the frame, this its column */
  .draft {
    display: grid;
    grid-template-columns: minmax(0, 1fr);
    gap: var(--s-5);
    padding-bottom: 6rem;
  }
  /* While it's picked on a phone, the view is the window's height left under the track, and the players scroll
     inside it */
  .draft.fit {
    display: flex;
    flex-direction: column;
    height: 100%;
    min-height: 0;
  }
  .draft.fit > :global(*) {
    flex-shrink: 0;
  }
  .ask {
    margin: 0 var(--s-2) 0 0;
    color: var(--fg-body);
    font-size: var(--text-sm);
  }
  .hint {
    margin: 0;
  }

  /* The strip: the big badge; on your turn, who you've picked and End turn at the end. Fixed height */
  .room-in {
    gap: var(--s-1);
    color: var(--fg-muted);
  }
  /* Your pick's close: the way in lit, the one red, no bigger */
  .room-in.soon {
    color: var(--red);
  }
  .updates {
    display: inline-flex;
    align-items: center;
    gap: var(--s-1);
    padding-inline: var(--s-2);
    font-size: var(--text-xs);
    white-space: nowrap;
  }
  .strip {
    display: flex;
    align-items: center;
    gap: var(--s-3);
    min-height: 2.6rem;
    min-width: 0;
  }

  /* End turn: floats at the bottom centre over the page, above the tabs on a phone; the page keeps room for it at
     the bottom so it never covers the last player */
  .end-bar {
    position: fixed;
    left: 50%;
    bottom: calc(var(--s-5) + env(safe-area-inset-bottom, 0px));
    z-index: 60;
    display: flex;
    align-items: center;
    gap: var(--s-3);
    width: min(30rem, calc(100vw - 2 * var(--gutter)));
    padding: var(--s-3) var(--s-3) var(--s-3) var(--s-5);
    border-radius: var(--r-xl);
    background: var(--surface-3);
    box-shadow: var(--shadow-pop);
    translate: -50% 0;
  }
  .who-picked {
    display: grid;
    flex: 1;
    gap: 0.15rem;
    min-width: 0;
  }
  .chosen-name {
    min-width: 0;
    overflow: hidden;
    color: var(--fg);
    font-size: var(--text-md);
    font-weight: 600;
    white-space: nowrap;
    text-overflow: ellipsis;
  }
  .chosen-name small {
    margin-left: var(--s-2);
    color: var(--fg-subtle);
    font-size: var(--text-xs);
    font-weight: 700;
  }
  /* End turn: the one red button on the page, the club's accent, so it can't be missed */
  .end-turn {
    gap: var(--s-1);
    padding-right: var(--s-3);
  }
  /* Where the draft stands, in the display face on the page: words, not a block (a filled block reads as a button) */
  /* The turn as a button: it looks like the label it is */
  .turn.as-btn {
    padding: 0;
    border: 0;
    background: none;
    cursor: pointer;
  }
  .turn {
    display: inline-flex;
    flex-shrink: 0;
    align-items: center;
    gap: var(--s-2);
    height: 2.6rem;
    color: var(--fg);
    font-family: var(--font-display);
    font-size: 1.35rem;
    line-height: 1;
    letter-spacing: 0.02em;
    text-transform: uppercase;
    white-space: nowrap;
  }
  /* Live (your pick, or picking for the team on the clock): red words and a pulsing dot, the VCR's REC light */
  .turn.now {
    color: var(--red-hot);
  }
  .dot {
    width: 0.5rem;
    height: 0.5rem;
    border-radius: 50%;
    background: var(--red-hot);
    animation: pulse 1.4s var(--ease-in-out) infinite;
  }
  .turn.done {
    color: var(--fg-muted);
  }

  /* The last pick: one line, the same height with or without one */
  /* The last pick: one small line, the same height with or without one */

  /* The ticker, as a carousel: the pick on the clock sits in the middle, larger and brought forward; the picks
     either side step back and fade with their distance (--d). Fixed sizes: it scrolls, never grows */
  .ticker {
    display: flex;
    align-items: center;
    position: relative;
    gap: var(--s-2);
    height: 5.5rem;
    margin-block: 0;
    padding-inline: calc(50% - 5.5rem);
    overflow-x: auto;
    /* Settles with a chip in the middle, so the one lifted is the one centred */
    scroll-snap-type: x proximity;
    scrollbar-width: none;
    mask-image: linear-gradient(90deg, transparent, #000 12%, #000 88%, transparent);
  }
  .tick {
    scroll-snap-align: center;
  }
  .ticker::-webkit-scrollbar {
    display: none;
  }
  .tick {
    position: relative;
    display: grid;
    grid-template-columns: auto minmax(0, 1fr);
    grid-template-rows: auto auto;
    column-gap: var(--s-3);
    row-gap: 0.2rem;
    align-content: center;
    align-items: center;
    flex: 0 0 auto;
    width: 11rem;
    height: 4rem;
    padding: 0 var(--s-4) 0 var(--s-3);
    border-radius: var(--r-md);
    background: var(--surface-2);
    opacity: calc(1 - var(--d, 0) * 0.18);
    scale: calc(0.94 - var(--d, 0) * 0.05);
    transition:
      scale var(--t-slow) var(--ease),
      opacity var(--t-slow) var(--ease),
      box-shadow var(--t-slow) var(--ease);
  }
  .tick :global(.crest) {
    grid-row: 1 / 3;
  }
  .who {
    display: flex;
    align-items: center;
    gap: 0.3rem;
    overflow: hidden;
    color: var(--fg);
    font-size: 0.95rem;
    white-space: nowrap;
    text-overflow: ellipsis;
  }
  /* A long team name ends in an ellipsis, not cut mid-letter (the flex row can't clip its own text) */
  .clip {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .meta {
    overflow: hidden;
    color: var(--fg-subtle);
    font-size: var(--text-2xs);
    white-space: nowrap;
    text-overflow: ellipsis;
  }
  /* On the clock: half as big again, a card reaching over the chips either side, and a badge that says so */
  /* The search, at the end of the tabs (a phone) or the chips (a desktop): it opens leftwards, over the tabs if it
     must, so the row's height never changes and nothing moves */
  .tab-row {
    position: relative;
  }
  .tab-row .tablist {
    padding-right: 3rem;
    transition: opacity var(--t) var(--ease);
  }
  .tab-row:has(:global(.search:focus-within), :global(.search.filled)) .tablist {
    opacity: 0;
  }
  .find-row {
    display: flex;
  }
  .find-row :global(.search) {
    width: 100%;
  }
  .finder {
    position: absolute;
    top: 50%;
    right: 0;
    display: flex;
    justify-content: flex-end;
    width: 100%;
    translate: 0 -50%;
    pointer-events: none;
    --open-width: 100%;
    --search-frost: var(--blur);
  }
  .finder > :global(*) {
    pointer-events: auto;
  }
  /* A player on a team who matches the search: their name lit */
  .row.hit {
    border-radius: var(--r-sm);
    background: color-mix(in srgb, var(--fg) 9%, transparent);
  }
  .row.hit .name {
    color: var(--fg);
  }
  .none {
    padding: var(--s-3) 0;
  }
  /* The ticker and, over its edge, Now: back to the current pick when you've looked away from it */
  .ticker-wrap {
    position: relative;
    min-width: 0;
  }
  .ticker:focus-visible {
    outline: 2px solid var(--focus, var(--fg-muted));
    outline-offset: 2px;
  }
  .back-now {
    position: absolute;
    top: 50%;
    right: var(--s-1);
    z-index: 2;
    display: grid;
    place-items: center;
    width: 1.75rem;
    height: 1.75rem;
    padding: 0;
    border: 0;
    border-radius: 50%;
    background: color-mix(in srgb, var(--surface-3) 70%, transparent);
    backdrop-filter: var(--blur);
    -webkit-backdrop-filter: var(--blur);
    color: var(--fg);
    opacity: 0.8;
    translate: 0 -50%;
  }
  .back-now.left {
    right: auto;
    left: var(--s-1);
  }
  /* The chevrons: only where there's a pointer. Just the chevron over the chips, half seen, firmer under the pointer;
     gone when there's nothing further that way */
  .edge {
    display: none;
  }
  @media (hover: hover) and (pointer: fine) {
    .edge {
      position: absolute;
      top: 0;
      bottom: 0;
      z-index: 2;
      display: grid;
      place-items: center;
      width: 2.75rem;
      padding: 0;
      border: 0;
      background: none;
      color: var(--fg);
      opacity: 0.45;
      cursor: pointer;
      transition: opacity var(--t-fast) var(--ease-in-out);
    }
    /* Out of the tab order (the ticker takes the arrow keys), so no focus ring on a click */
    .edge:focus,
    .edge:focus-visible {
      outline: none;
      box-shadow: none;
    }
    .edge:hover {
      opacity: 0.95;
    }
    /* Out past the ticker's faded ends, clear of the chips */
    .edge.left {
      left: -1rem;
    }
    .edge.right {
      right: -1rem;
    }
    .edge.gone {
      opacity: 0;
      pointer-events: none;
    }
    /* A pointer has the chevron for it: no round button */
    .back-now {
      display: none;
    }
    /* The chevron on the current pick's side: a small red dot by it says which way it is */
    .edge.to-now::after {
      content: "";
      position: absolute;
      top: calc(50% - 1.1rem);
      width: 0.4rem;
      height: 0.4rem;
      border-radius: 50%;
      background: var(--red-hot);
    }
    .edge.to-now {
      opacity: 0.8;
    }
  }
  /* The pick that just landed: a flash of the club's red round its chip, fading */
  .tick.fresh {
    animation: landed 1.6s var(--ease) both;
  }
  @keyframes landed {
    0%,
    30% {
      box-shadow: 0 0 0 2px var(--red-hot);
    }
    100% {
      box-shadow: 0 0 0 2px transparent;
    }
  }
  /* The chip in the middle, raised: the current pick when you're at it, or the one you've scrolled to */
  .tick.lift {
    z-index: 1;
    scale: 1.2;
    /* The home page's cards: the panel ground, a firm edge and a lit top */
    border-radius: var(--r-lg);
    background: var(--panel-bg);
    box-shadow:
      inset 0 1px 0 rgb(255 255 255 / 0.05),
      0 0 0 1px var(--border-strong);
  }
  /* The current pick: a red dot in its corner, always, so it's found wherever you've scrolled */
  .tick.now::before {
    content: "";
    position: absolute;
    top: 0.4rem;
    right: 0.4rem;
    width: 0.45rem;
    height: 0.45rem;
    border-radius: 50%;
    background: var(--red-hot);
  }
  /* On the clock: a faint lit edge, and now and then Home's lead glint (a breath of rink light) crosses it, so the
     eye finds it along the row. Only this card; under reduced motion just the edge and a still light */
  .tick.now {
    box-shadow:
      inset 0 1px 0 rgb(255 255 255 / 0.12),
      0 0 0 1px color-mix(in srgb, var(--fg) 14%, transparent);
  }
  .tick.now::after {
    content: "";
    position: absolute;
    inset: 0;
    border-radius: inherit;
    pointer-events: none;
    background: linear-gradient(
      105deg,
      transparent 35%,
      color-mix(in srgb, var(--fg) 9%, transparent) 48%,
      color-mix(in srgb, var(--fg) 3%, transparent) 54%,
      transparent 65%
    );
    background-size: 250% 100%;
    background-position: 120% 0;
    animation: tick-glint 4.5s 600ms var(--ease-in-out) infinite;
  }
  /* The glint crosses in the first second, then the card rests till the next */
  @keyframes tick-glint {
    0% {
      background-position: 120% 0;
    }
    22%,
    100% {
      background-position: -20% 0;
    }
  }
  /* Your turn: the REC light. The card's edge and the word You go red and the badge pulses; another team's turn
     stays neutral, so yours is never taken for theirs at a glance */
  .tick.now.me {
    background: color-mix(in srgb, var(--red-hot) 7%, var(--panel-bg));
    box-shadow:
      inset 0 1px 0 rgb(255 255 255 / 0.05),
      0 0 0 1px var(--red-hot),
      0 0 1.5rem color-mix(in srgb, var(--red-hot) 30%, transparent);
  }
  .tick.now.me .who {
    color: var(--red-hot);
  }
  .clock .dot {
    width: 0.35rem;
    height: 0.35rem;
    margin-right: 0.3rem;
    background: currentColor;
  }
  .clock {
    justify-self: start;
    height: 1.15rem;
    padding: 0 0.4rem;
    font-size: 0.6rem;
    letter-spacing: 0.04em;
    text-transform: uppercase;
  }

  /* Two views: Players, Teams. A desktop has them side by side; the teams stay in view. The pool is a name, a
     position and Pick: it needs no more than 30rem; the teams get the rest, side by side where there's room */
  .views {
    display: grid;
    grid-template-columns: minmax(0, 30rem) minmax(16rem, 1fr);
    gap: var(--s-6);
    align-items: start;
  }
  /* The teams start level with the first player, under the filter (a chip's height and the gap) */
  .views.filtered > .col:not(.pool) {
    /* (the search's row and the chips', and the gaps after them) */
    padding-top: calc(2.5rem + 2.25rem + 2 * var(--s-3));
  }
  .done-teams {
    display: grid;
    gap: var(--s-6);
  }
  .done-teams .teams,
  .views .teams {
    grid-template-columns: repeat(auto-fill, minmax(15rem, 1fr));
    align-items: start;
  }
  .pane {
    min-width: 0;
  }
  .col {
    min-width: 0;
  }
  .side {
    position: sticky;
    top: var(--s-5);
  }
  .tablist .need {
    display: inline-flex;
    align-items: center;
    gap: 0.15rem;
    margin-left: 0.4rem;
    color: var(--caution-ink);
    font-size: var(--text-2xs);
    font-weight: 700;
  }

  /* A team is its name and a list: no panel behind it (dark on dark said nothing). The row is what lights up */
  .panel {
    display: grid;
    gap: var(--s-2);
    min-width: 0;
  }
  /* The header sits clear of the rows and the column's edges: the same inset as the rows, room above */
  .panel header {
    display: flex;
    align-items: center;
    gap: var(--s-3);
    min-width: 0;
    min-height: 3rem;
    padding: var(--s-2) var(--s-2) var(--s-1);
  }
  .panel header .badge {
    gap: 0.3rem;
    flex-shrink: 0;
  }
  .panel h3 {
    flex: 1;
    min-width: 0;
    margin: 0;
    overflow: hidden;
    color: var(--fg);
    font-size: 1.25rem;
    white-space: nowrap;
    text-overflow: ellipsis;
  }
  .teams {
    display: grid;
    gap: var(--s-6);
  }

  /* A team's players: compact rows */
  .rows {
    display: grid;
    gap: 0;
    margin: 0;
    padding: 0;
    list-style: none;
  }
  .row {
    display: flex;
    align-items: center;
    gap: var(--s-2);
    min-height: 2.5rem;
    padding: 0 var(--s-2);
    border-radius: var(--r-md);
    font-size: var(--text-sm);
    transition: background-color var(--t-fast) var(--ease);
  }
  .row:hover {
    background: var(--surface-2);
  }
  .row.slot .name {
    color: var(--fg-subtle);
    font-weight: 400;
  }
  .name small {
    margin-left: var(--s-2);
    color: var(--fg-subtle);
    font-size: var(--text-2xs);
    font-weight: 600;
    letter-spacing: var(--tracking-label);
    text-transform: uppercase;
  }
  .n {
    width: 1.1rem;
    color: var(--fg-subtle);
    font-size: var(--text-xs);
    text-align: center;
  }
  /* The captain: a red C where the pick number would be */
  .c {
    flex-shrink: 0;
    width: 1.1rem;
    color: var(--red-hot);
    font-size: 0.95rem;
    text-align: center;
  }
  .name {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    color: var(--fg);
    font-weight: 500;
    white-space: nowrap;
    text-overflow: ellipsis;
  }
  .pos {
    color: var(--fg-subtle);
    font-size: var(--text-2xs);
    font-weight: 700;
  }

  /* The players: a ranked list, as a draft room does it; tiers as bands; Pick on the row on your turn */
  .players {
    display: grid;
    gap: var(--s-3);
    min-width: 0;
  }
  /* A chip's count, quieter than its word */
  .filter .count {
    color: var(--fg-subtle);
    font-size: var(--text-xs);
    font-weight: 600;
  }
  .filter[aria-pressed="true"] .count {
    color: var(--fg-muted);
  }
  /* A phone keeps the four on one line: tighter chips sharing the width */
  @media (max-width: 600px) {
    .players .filters {
      flex-wrap: nowrap;
      gap: var(--s-1);
    }
    .players .filter {
      flex: 1 1 auto;
      justify-content: center;
      gap: var(--s-1);
      padding: 0 var(--s-2);
    }
  }
  /* Tight rows, so more of the pool is in view at once; flush with the filter and the page's edge. No row fill: the
     Pick button lights up for the row you point at */
  .plist {
    display: grid;
  }
  .prow {
    display: grid;
    grid-template-columns: minmax(0, 1fr) 1.6rem 5.5rem;
    align-items: center;
    gap: var(--s-3);
    min-height: 2.25rem;
  }
  .prow.dim {
    opacity: 0.4;
  }
  .nm {
    min-width: 0;
    padding: 0;
    overflow: hidden;
    border: 0;
    background: none;
    color: var(--fg);
    font: inherit;
    font-weight: 500;
    text-align: left;
    white-space: nowrap;
    text-overflow: ellipsis;
    cursor: pointer;
  }
  .nm small {
    margin-left: var(--s-2);
    color: var(--fg-subtle);
    font-size: var(--text-2xs);
    font-weight: 600;
    letter-spacing: 0.04em;
  }
  .ps {
    display: inline-grid;
    justify-self: end;
    place-items: center;
    width: 1.6rem;
    height: 1.4rem;
    border-radius: var(--r-sm);
    background: color-mix(in srgb, var(--fg) 8%, transparent);
    color: var(--fg-muted);
    font-size: var(--text-2xs);
    font-weight: 700;
  }
  .act {
    display: flex;
    justify-content: flex-end;
  }
  /* Pick: the app's small button, quiet in the list. It goes blue only under the pointer, not when the row is: the
     row has two actions (the name opens the card), and the button lighting up for the row said the wrong one */
  .pick {
    min-width: 4.5rem;
    height: 1.9rem;
    border-color: var(--border-strong);
    font-weight: 600;
  }
  .pick:hover:not(:disabled),
  .pick:focus-visible,
  .pick[aria-pressed="true"] {
    border-color: var(--action);
    background: var(--action);
    color: var(--on-action);
  }
  .pick:focus-visible {
    outline: 2px solid var(--ring);
    outline-offset: 2px;
  }
  .tools {
    display: flex;
    flex-shrink: 0;
    gap: var(--s-1);
    margin-left: auto;
  }

  @media (max-width: 900px) {
    .end-bar {
      bottom: calc(var(--tab-h) + var(--s-3));
    }
    .tools .lbl {
      display: none;
    }
    .tick {
      width: 9.5rem;
    }
    .ticker {
      padding-inline: calc(50% - 4.75rem);
    }
  }

  @media (prefers-reduced-motion: reduce) {
    .dot {
      animation: none;
    }
    /* Still: the light resting across the middle of the card */
    .tick.now::after {
      animation: none;
      background-position: 50% 0;
    }
  }
  /* The draft room (pages/DraftRoom): the window's height, nothing below it. Picked on a phone it's the page's fit
     view, but the pool or the teams take every bit of height left; on a desktop it's the board */
  .draft.room {
    padding-bottom: 0;
  }
  .draft.room.fit,
  .draft.board-on {
    display: flex;
    flex-direction: column;
    height: 100%;
    min-height: 0;
  }
  .draft.board-on > :global(*) {
    flex-shrink: 0;
  }
  .draft.room.fit > .pane,
  .draft.room.fit .players {
    flex: 1 1 auto;
  }
  .draft.room.fit .plist,
  .draft.room.fit .teams {
    flex: 1 1 auto;
    align-content: start;
  }
  /* The picks along the top, a size up: there's the room for it */
  .draft.room:not(.fit) .ticker {
    height: 7rem;
    padding-inline: calc(50% - 7.5rem);
  }
  .draft.room:not(.fit) .tick {
    width: 15rem;
    height: 5.25rem;
  }
  .draft.room:not(.fit) .who {
    font-size: 1.15rem;
  }
  /* The board: the pool down the left, then a column per team, each to the window's foot and scrolling inside */
  .board {
    display: grid;
    flex: 1 1 auto;
    grid-template-columns: minmax(25rem, 1.4fr) repeat(var(--lanes), minmax(0, 1fr));
    gap: var(--s-4);
    min-height: 0;
  }
  .lane-pool {
    display: flex;
    flex-direction: column;
    min-width: 0;
    min-height: 0;
  }
  /* The search and the chips stay at the top of the pool; the players scroll under them */
  .board .players {
    display: flex;
    flex: 1 1 auto;
    flex-direction: column;
    min-height: 0;
  }
  .board .players > * {
    flex-shrink: 0;
  }
  .board .plist {
    flex: 1 1 auto;
    align-content: start;
    min-height: 0;
    padding-bottom: 6rem;
    overflow-y: auto;
    overscroll-behavior: contain;
  }
  /* The four chips on one line, sharing the pool's width */
  .board .filters {
    flex-wrap: nowrap;
    gap: var(--s-1);
  }
  .board .filter {
    flex: 1 1 auto;
    justify-content: center;
    gap: var(--s-1);
    padding: 0 var(--s-2);
  }
  /* Bigger rows: easy to hit on a laptop or a tablet held up in the room */
  .board .prow {
    min-height: 3rem;
    font-size: var(--text-md);
  }
  .lane {
    display: flex;
    flex-direction: column;
    min-width: 0;
    min-height: 0;
    padding: var(--s-2);
    border-radius: var(--r-lg);
    transition: background-color var(--t-slow) var(--ease);
  }
  /* On the clock: its column lifted (a fill, not a colour), its badge the red */
  .lane.on-clock {
    background: var(--surface-2);
  }
  .lane header {
    display: flex;
    align-items: center;
    gap: var(--s-2);
    min-width: 0;
    min-height: 3rem;
    padding: 0 var(--s-1);
  }
  .lane h3 {
    flex: 1;
    min-width: 0;
    margin: 0;
    overflow: hidden;
    color: var(--fg);
    font-size: 1.2rem;
    white-space: nowrap;
    text-overflow: ellipsis;
  }
  .lane-badges {
    display: flex;
    flex-shrink: 0;
    gap: var(--s-1);
    min-height: 1.75rem;
    padding: 0 var(--s-1) var(--s-2);
    overflow: hidden;
    white-space: nowrap;
  }
  .lane-badges .badge {
    gap: 0.3rem;
    flex-shrink: 0;
  }
  .lane-rows {
    flex: 1 1 auto;
    min-height: 0;
    padding-bottom: 6rem;
    overflow-y: auto;
    overscroll-behavior: contain;
  }
</style>
