<script lang="ts">
  // A training series' next session. Before the teams: who's in, in order, and your answer. Once there are teams,
  // they're the page: anyone who signed up after them first (an admin slots them in or remakes them), then the
  // teams, then sign-up. A team maker's changes to the teams are saved as they're made (ADR 0076). Ratings drive the teams but only admins see them (read:Rating), as in the old app.
  import { goesBy, shortName } from "../lib/names";
  import SearchField from "../lib/SearchField.svelte";
  import PageHeader from "../lib/PageHeader.svelte";
  import { can } from "../access/actions";
  import { PLAYERS, TEAM_NAMES, TEAM_ORDER, type Player } from "../demo/data";
  import { granted, me } from "../demo/session.svelte";
  import { db } from "../demo/store.svelte";
  import Icon from "../app/shell/Icon.svelte";
  import EventCard from "../lib/EventCard.svelte";
  import Person from "../lib/Person.svelte";
  import PlayerCard from "../lib/PlayerCard.svelte";
  import PlayerCardZoom from "../lib/PlayerCardZoom.svelte";
  import RegisterDrawer from "../lib/RegisterDrawer.svelte";
  import { publishTeams, removeTeams, resetSession, saving, setPlayer } from "../app/backend.svelte";
  import EditorPanel from "../lib/EditorPanel.svelte";
  import TrainingEditor from "../lib/TrainingEditor.svelte";
  import Sheet from "../lib/Sheet.svelte";
  import Drawer from "../lib/Drawer.svelte";
  import { listScroll } from "../lib/list-scroll";
  import { phone } from "../lib/viewport.svelte";
  import { cardMoveMs, deal, easeOut, prefersReducedMotion, sift } from "../app/motion";
  import { flip } from "svelte/animate";
  import { clock, formatDayDate } from "../lib/dates";
  import { describeRule } from "../lib/recurrence";
  import { makeTeams, slotIn, type Team } from "../lib/balance";
  import { shuffleAndDeal, type Show } from "../lib/shuffle";
  import { onDestroy, tick } from "svelte";
  import { SvelteSet } from "svelte/reactivity";
  import EmptyState from "../lib/EmptyState.svelte";
  import { nextSession, resolve, seriesById, seriesPlace, sessionBookable } from "../demo/schedule.svelte";

  let { seriesId }: { seriesId: number } = $props();

  const perms = $derived(granted());
  // The last series found: while this page slides out, the next page's params (no seriesId) arrive here too
  const last: { series?: ReturnType<typeof seriesById> } = {};
  const series = $derived((last.series = seriesById(seriesId) ?? last.series)!);
  const session = $derived(nextSession(series));
  const info = $derived(session && resolve(session, series));
  const usual = $derived(seriesPlace(series));
  const who = $derived(me());
  const ratings = $derived(can(perms, "read:Rating"));
  const next = $derived(
    session ?? { id: 0, going: [] as number[], waitlist: [] as number[], out: undefined as number[] | undefined },
  );
  // Who's said they're out, in the order they said it
  const outs = $derived(next.out ?? []);
  const byId = (id: number): Player => PLAYERS.find((p) => p.id === id)!;

  let registering = $state(false);
  // The card that's been picked up, and where it lies on the page
  let lifted = $state<{ id: number; el: HTMLElement; n?: number } | null>(null);

  // Take someone off the session (from their card): off the list and any team, and the waitlist moves up
  function removeFromSession(id: number) {
    const s = session;
    if (!s) return;
    void setPlayer(s.id, id, false);
    const wasIn = s.going.includes(id);
    s.going = s.going.filter((x) => x !== id);
    s.waitlist = s.waitlist.filter((x) => x !== id);
    s.walkIns = s.walkIns?.filter((x) => x !== id);
    s.noShows = s.noShows?.filter((x) => x !== id);
    if (wasIn && s.waitlist.length && (!info?.capacity || s.going.length < info.capacity)) {
      s.going = [...s.going, s.waitlist[0]];
      s.waitlist = s.waitlist.slice(1);
    }
    const out = db.teams[s.id];
    if (out) {
      for (const t of out) t.players = t.players.filter((x) => x !== id);
      void publishTeams(s.id, out);
    }
  }

  // The plain list, or players as trading cards. The list unless you've picked cards; remembered per device.
  const VIEW_KEY = "team.training.view";
  let view = $state<"cards" | "list">(readView());
  function readView(): "cards" | "list" {
    try {
      return localStorage.getItem(VIEW_KEY) === "cards" ? "cards" : "list";
    } catch {
      return "list";
    }
  }
  function setView(v: "cards" | "list") {
    view = v;
    try {
      localStorage.setItem(VIEW_KEY, v);
    } catch {
      // Private mode: the choice just isn't remembered.
    }
  }
  // Who's coming, a tab at a time: in, waiting, out. Once there are teams they're the in list, so just the other two
  let tab = $state<"in" | "waiting" | "out">("in");
  // Find someone on the night: their name, first or last, on every list (the tabs count who matches)
  let query = $state("");
  let infoOpen = $state(false);
  const matches = (id: number) => {
    const q = query.trim().toLowerCase();
    if (!q) return true;
    const p = byId(id);
    return [goesBy(p), p.name].some((n) => n.toLowerCase().includes(q));
  };
  const matching = (ids: number[]) => ids.filter(matches);
  const teams = $derived(db.teams[next.id] ?? null);
  // Your team first, then the old app's order: Cougars, Black, White, then the rest.
  const ordered = $derived(
    teams
      ? [...teams].sort(
          (a, b) =>
            Number(b.players.includes(who.id)) - Number(a.players.includes(who.id)) ||
            (TEAM_ORDER[a.name] ?? 9) - (TEAM_ORDER[b.name] ?? 9),
        )
      : null,
  );
  const onTeam = $derived(new Set(teams?.flatMap((t) => t.players) ?? []));
  // Signed up after the teams were made: still in, waiting to be slotted onto a team.
  const unplaced = $derived(teams ? next.going.filter((id) => !onTeam.has(id)) : []);
  // Said they're out since the teams were made: still on a published team until a team maker remakes the teams or
  // keeps them as they are (ADR 0076)
  const left = $derived(teams ? [...onTeam].filter((id) => !next.going.includes(id)) : []);
  const hasLeft = (id: number) => left.includes(id);
  // The teams without them: where keeping, slotting in and moving start from
  const withoutLeavers = () =>
    (teams ?? []).map((t) => ({ name: t.name, players: t.players.filter((id) => next.going.includes(id)) }));
  const spaces = $derived(info?.capacity ? Math.max(0, info.capacity - next.going.length) : null);

  // Every change to the teams is saved as it's made, and everyone sees it (ADR 0076): no draft to publish, so
  // nothing waits on a button scrolled out of sight
  function commit(list: Team[], done?: string) {
    db.teams[next.id] = list;
    void publishTeams(next.id, list, done);
  }
  // Make or remake the teams, with a show for whoever pressed it (lib/shuffle.ts): everyone's card into one deck, a
  // riffle, then dealt out onto the new teams. The teams are saved as the deal starts; a tap skips to the end.
  let deck = $state<number[] | null>(null);
  let deckCards: HTMLElement[] = $state([]);
  const undealt = new SvelteSet<number>();
  let show: Show | null = null;
  let pending: Team[] | null = null;
  let gathering = $state(false);
  async function generate() {
    const made = makeTeams(next.going.map(byId), TEAM_NAMES);
    if (show) return;
    if (prefersReducedMotion) return commit(made);
    // Bring the players into view first, so their cards start from where you can see them
    query = "";
    if (!teams) tab = "in";
    showIfHidden(teams ? ".teams-head" : ".list-head");
    await tick();
    const ids = made.flatMap((t) => t.players);
    const from = ids.map((id) => playerRect(id));
    pending = made;
    deck = ids;
    // Picked up: the players leave the page as their cards fly into the deck (their places kept)
    for (const t of teams ?? []) for (const id of t.players) undealt.add(id);
    gathering = true;
    await tick();
    // Dealt as they were made: round by round, the order turning each round
    const order: number[] = [];
    const rounds = Math.max(...made.map((t) => t.players.length));
    for (let r = 0; r < rounds; r++)
      for (const t of r % 2 ? [...made].reverse() : made)
        if (t.players[r] !== undefined) order.push(ids.indexOf(t.players[r]));
    show = shuffleAndDeal({
      cards: deckCards,
      from,
      deck: deckPoint(),
      order,
      reveal: async () => {
        for (const id of ids) undealt.add(id);
        if (pending) commit(pending);
        pending = null;
        await tick();
        showIfHidden(".teams-head");
      },
      target: (i) => document.querySelector(`.team [data-player="${ids[i]}"]`),
      landed: (i) => undealt.delete(ids[i]),
    });
    await show.finished;
    show = null;
    deck = null;
    gathering = false;
    undealt.clear();
  }
  // Scrolled to only when it's off screen: on a desktop the teams are usually in view already, and a needless scroll
  // docks the page header (lib/PageHeader.svelte), swapping the toolbar under you
  function showIfHidden(selector: string) {
    const el = document.querySelector(selector);
    if (!el) return;
    const { top, bottom } = el.getBoundingClientRect();
    const chrome = parseFloat(getComputedStyle(el).scrollMarginTop) || 0;
    if (top >= chrome && bottom <= window.innerHeight) return;
    el.scrollIntoView({ block: "start" });
  }
  // The pile: over the middle of the teams (or of Who's in) where that's on screen, else the window's middle
  function deckPoint() {
    const r = document.querySelector(".teams-grid, .whos-in")?.getBoundingClientRect();
    if (!r) return undefined;
    const top = Math.max(r.top, 0);
    const bottom = Math.min(r.bottom, window.innerHeight);
    return bottom - top > 160 ? { x: r.left + r.width / 2, y: (top + bottom) / 2 } : undefined;
  }
  // Where a player is on the page now: their row on a team, or their card or row under Who's in (in sign-up order)
  function playerRect(id: number): DOMRect | null {
    const el =
      document.querySelector(`.team [data-player="${id}"]`) ??
      document.querySelector(`.whos-in > :is(.cards, .list) > :nth-child(${next.going.indexOf(id) + 1})`);
    const r = el?.getBoundingClientRect();
    return r && r.bottom > 0 && r.top < window.innerHeight ? r : null;
  }
  // Leaving mid-show: the teams still get saved
  onDestroy(() => {
    show?.skip();
    if (pending) commit(pending);
  });
  function portal(node: HTMLElement) {
    document.body.append(node);
    return { destroy: () => node.remove() };
  }
  // A team maker moves a player between teams, or onto one from Not on a team (from ""); it's saved there and then
  const arranging = $derived(can(perms, "generate:Teams") && can(perms, "publish:Teams"));
  function move(id: number, fromName: string, toName: string) {
    if (fromName === toName) return;
    const list = withoutLeavers();
    const from = list.find((t) => t.name === fromName);
    const to = list.find((t) => t.name === toName);
    if ((fromName && !from) || !to) return;
    if (from) from.players = from.players.filter((p) => p !== id);
    to.players = [...to.players, id];
    commit(list, `${shortName(byId(id))} to ${to.name}`);
  }
  const nextTeam = (name: string) => {
    const i = ordered?.findIndex((t) => t.name === name) ?? -1;
    // From Not on a team: the first team
    return ordered && i >= 0 ? ordered[(i + 1) % ordered.length].name : (ordered?.[0]?.name ?? name);
  };

  // Dragging a player by their grip: pointer events, so it works with a finger as well as a mouse. The row follows
  // the pointer; the team under it lights up; letting go there moves them.
  let drag = $state<{ id: number; from: string; x: number; y: number; dx: number; dy: number; w: number } | null>(null);
  let over = $state<string | null>(null);
  let dragged = $state(false);
  function grab(e: PointerEvent, id: number, from: string) {
    if (e.button !== 0) return;
    const row = (e.currentTarget as HTMLElement).closest(".row") as HTMLElement;
    const r = row.getBoundingClientRect();
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    drag = { id, from, x: e.clientX, y: e.clientY, dx: e.clientX - r.left, dy: e.clientY - r.top, w: r.width };
    dragged = false;
  }
  function follow(e: PointerEvent) {
    if (!drag) return;
    if (Math.hypot(e.clientX - drag.x, e.clientY - drag.y) > 4) dragged = true;
    drag.x = e.clientX;
    drag.y = e.clientY;
    const el = document.elementFromPoint(e.clientX, e.clientY)?.closest<HTMLElement>("[data-team]");
    over = el?.dataset.team ?? null;
  }
  function drop() {
    if (drag && dragged && over) move(drag.id, drag.from, over);
    drag = null;
    over = null;
  }
  // Enter or Space on the grip: on to the next team, for keyboards and screen readers. A click or a tap does
  // nothing (detail is 0 only for a keyboard's click): a finger resting on the grip mustn't send someone away.
  function nudge(e: MouseEvent, id: number, from: string) {
    if (dragged) return void (dragged = false);
    if (e.detail === 0) move(id, from, nextTeam(from));
  }
  // Signed up after the teams were made: onto the teams as they are, each to the weaker side
  function slot() {
    if (teams) commit(slotIn(withoutLeavers(), unplaced.map(byId), (id) => byId(id)));
  }
  // The teams as they are, without whoever's out: nobody new to place
  function keep() {
    commit(withoutLeavers());
  }
  const firstNames = (ids: number[]) => {
    const names = ids.map((id) => (id === who.id ? "you" : shortName(byId(id))));
    const list = names.length > 1 ? `${names.slice(0, -1).join(", ")} and ${names.at(-1)}` : names[0];
    return list.charAt(0).toUpperCase() + list.slice(1);
  };
  const rating = (ids: number[]) => ids.reduce((s, id) => s + byId(id).rating, 0);

  // Manage: an admin's tools for this session, in one place (a sheet on a phone, a side drawer on a desktop). The
  // ones that can't be undone take a second tap, which lapses after a few seconds.
  let manageOpen = $state(false);
  let confirming = $state<"teams" | "remake" | "reset" | null>(null);
  let lapse: ReturnType<typeof setTimeout> | undefined;
  // Making teams from who's in, once someone's in: the one button always on show for a team maker
  const canGenerate = $derived(arranging && next.going.length > 0);
  const canManage = $derived(
    can(perms, "manage:Training") ||
      (!!session &&
        (can(perms, "update:Event") || can(perms, "record:Attendance") || (!!teams && can(perms, "publish:Teams")))),
  );
  // The training's own settings (days, times, place, fee), opened over this page (ADR 0065)
  let settingsOpen = $state(false);
  // A tool that opens something else, or runs at once: the sheet gets out of the way first
  function go(run: () => void) {
    manageOpen = false;
    run();
  }
  function twice(which: "teams" | "remake" | "reset", run: () => void) {
    clearTimeout(lapse);
    if (confirming !== which) {
      confirming = which;
      lapse = setTimeout(() => (confirming = null), 4000);
      return;
    }
    confirming = null;
    manageOpen = false;
    run();
  }
  // Taking the teams away: each team falls away in turn before Who's in rises in their place; then it's saved
  let clearing = $state(false);
  async function clearTeams() {
    if (!teams || prefersReducedMotion) return;
    clearing = true;
    await new Promise((r) => setTimeout(r, 420 + 70 * (teams?.length ?? 0)));
    clearing = false;
  }
  async function takeDown() {
    await clearTeams();
    delete db.teams[next.id];
    void removeTeams(next.id);
  }
  async function reset() {
    const s = session;
    if (!s) return;
    await clearTeams();
    delete db.teams[s.id];
    s.going = [];
    s.waitlist = [];
    s.walkIns = [];
    s.noShows = [];
    void resetSession(s.id);
  }
</script>

<!-- A row turns the player's card over, growing from their initials -->
{#snippet player(id: number, n?: number)}
  {@const p = byId(id)}
  <button
    class="row"
    class:you={id === who.id && !hasLeft(id)}
    class:gone={hasLeft(id)}
    class:undealt={undealt.has(id)}
    data-player={id}
    aria-label="{goesBy(p)}: see their card"
    onclick={(e) => (lifted = { id, el: e.currentTarget.querySelector(".avatar") ?? e.currentTarget, n })}
  >
    {#if n !== undefined}<span class="n num">{n}</span>{/if}
    <Person player={p} showRating={ratings} />
    {#if hasLeft(id)}<span class="badge">Out</span>
    {:else if id === who.id}<span class="you-stamp">You</span>{/if}
    {#if p.cougar}<span class="badge red">Cougar</span>{/if}
  </button>
{/snippet}

<!-- Numbered by sign-up order, whatever the search leaves showing -->
<!-- A search deals cards in and folds them away, or sifts rows; the rest glide to their places (as on Teammates) -->
{#snippet players(all: number[], numbered = false)}
  {@const ids = matching(all)}
  {#if !ids.length}
    <p class="hint">No one matches.</p>
  {:else if view === "cards"}
    <div class="cards scroll-fill">
      {#each ids as id (id)}
        {@const i = all.indexOf(id)}
        <div class="slot" animate:flip={{ duration: cardMoveMs, easing: easeOut }} in:deal out:deal={{ out: true }}>
          <PlayerCard
            player={byId(id)}
            n={numbered ? i + 1 : undefined}
            you={id === who.id}
            showRating={ratings}
            lifted={lifted?.id === id}
            onopen={(el) => (lifted = { id, el, n: numbered ? i + 1 : undefined })}
          />
        </div>
      {/each}
    </div>
  {:else}
    <div class="list tight scroll-fill">
      {#each ids as id (id)}
        <div class="slot" animate:flip={{ duration: cardMoveMs, easing: easeOut }} in:sift out:sift={{ out: true }}>
          {@render player(id, numbered ? all.indexOf(id) + 1 : undefined)}
        </div>
      {/each}
    </div>
  {/if}
{/snippet}

<!-- A team maker's row: a grip to drag them to a team (from "" when they're not on one yet) -->
{#snippet arrangeRow(id: number, from: string)}
  <div
    class="row arrange"
    class:lifting={drag?.id === id && dragged}
    class:gone={hasLeft(id)}
    class:undealt={undealt.has(id)}
    data-player={id}
  >
    <button
      class="grip"
      aria-label="Move {goesBy(byId(id))}: drag to a team, or press Enter for the next team"
      onpointerdown={(e) => grab(e, id, from)}
      onpointermove={follow}
      onpointerup={drop}
      onpointercancel={() => ((drag = null), (over = null))}
      onclick={(e) => nudge(e, id, from)}
    >
      <Icon name="grip" size={20} />
    </button>
    <Person player={byId(id)} showRating={ratings} />
    {#if hasLeft(id)}<span class="badge">Out</span>
    {:else if id === who.id}<span class="you-stamp">You</span>{/if}
    {#if byId(id).cougar}<span class="badge red">Cougar</span>{/if}
  </div>
{/snippet}

<!-- Every week on Fri · 7:30pm–9:30pm · the place, a tap opening the map -->
{#snippet usually()}
  {describeRule(series)} · {clock(series.startTime)}–{clock(series.endTime)}{#if usual}&nbsp;· <a
      href={usual.mapUrl}
      target="_blank"
      rel="noopener noreferrer">{usual.name}</a
    >{/if}
{/snippet}

<div class="page">
  <!-- When and where it usually is: the line under the title on a desktop; a phone has no room to spare, so it's
       behind the info button in the bar -->
  <PageHeader title={series.name} sub={phone.current ? undefined : usually}>
    {#snippet actions()}
      {#if phone.current}
        <button
          class="btn sm ghost icon"
          aria-haspopup="dialog"
          aria-label="About {series.shortName}"
          title="About"
          onclick={() => (infoOpen = true)}><Icon name="info" size={18} /></button
        >
      {/if}
      <!-- Make teams is the one job on show: it's the night's job for whoever makes the teams, not only an admin.
           Everything else is behind one quiet button (ADR 0065): a sheet on a phone, a side drawer on a desktop -->
      <!-- Remaking replaces teams everyone can see, so it takes a second tap; the label swaps in place, the width
           held so nothing in the bar moves -->
      {#if session && canGenerate}
        <button
          class="btn sm primary make"
          class:keep-label={confirming === "remake"}
          onclick={() => (teams ? twice("remake", generate) : generate())}
          ><Icon name="teams" size={16} />
          {!teams ? "Make teams" : confirming === "remake" ? "Tap again" : "Remake teams"}</button
        >
      {/if}
      {#if canManage}
        <button
          class="btn sm ghost icon"
          aria-haspopup="dialog"
          aria-label="Manage {series.shortName}"
          title="Manage"
          onclick={() => (manageOpen = true)}><Icon name="settings" size={18} /></button
        >
      {/if}
    {/snippet}
  </PageHeader>

  {#snippet signUp(warn = false)}
    <!-- This week's session and your answer; the counts are on the tabs below. When the teams no longer match who's
         in, the warning comes first -->
    {#if warn}{@render lateWarning()}{/if}
    <EventCard
      event={sessionBookable(session!)}
      canSignUp={can(perms, "signup:Event")}
      beckon
      roster={false}
      place={false}
    />
  {/snippet}

  {#snippet lateWarning()}
    <!-- The teams no longer match who's in: someone came in after them, or said they're out since -->
    <div class="late">
      <span class="late-icon"><Icon name="alert" size={22} /></span>
      <p class="late-text">
        <span class="eyebrow"
          >{[unplaced.length ? `${unplaced.length} not on a team` : "", left.length ? `${left.length} dropped out` : ""]
            .filter(Boolean)
            .join(" · ")}</span
        >
        <span>
          {#if unplaced.length}<strong>{firstNames(unplaced)}</strong>
            {unplaced.length === 1 && unplaced[0] !== who.id ? "is" : "are"} in, but signed up after the teams were made.{/if}
          {#if left.length}<strong>{firstNames(left)}</strong>
            {left.length === 1 && left[0] !== who.id ? "has" : "have"} said they're out since.{/if}
          {#if !can(perms, "generate:Teams")}The teams may change.{/if}
        </span>
      </p>
      {#if can(perms, "generate:Teams")}
        <div class="late-acts">
          <button class="btn sm outline" onclick={generate}>Remake teams</button>
          {#if unplaced.length}
            <button class="btn sm primary" onclick={slot}>Slot them in</button>
          {:else}
            <button class="btn sm primary" onclick={keep}>Keep the teams</button>
          {/if}
        </div>
      {/if}
    </div>
  {/snippet}

  <!-- Find someone: a magnifier at the end of the row that widens into the field when you tap it (across the row,
       over the tabs, on a phone) -->
  {#snippet search()}
    <div class="finder">
      <SearchField bind:value={query} placeholder="Search players" label="Search players" collapsible />
    </div>
  {/snippet}

  <!-- Who's coming as tabs, so Out is a tap away, not a scroll: In (before the teams), Waiting, Out -->
  {#snippet roster(withIn: boolean)}
    {@const shown = !withIn && tab === "in" ? "waiting" : tab}
    <div class="roster-bar list-tabs">
      <div class="tablist" role="tablist" aria-label="Who's coming">
        {#each [...(withIn ? [["in", "In", matching(next.going).length]] : []), ["waiting", "Waiting", matching(next.waitlist).length], ["out", "Out", matching(outs).length]] as [id, label, count] (id)}
          <button
            role="tab"
            aria-selected={shown === id}
            aria-controls="roster-panel"
            onclick={() => (tab = id as typeof tab)}>{label} <span class="num count-{id}">{count}</span></button
          >
        {/each}
      </div>
      {#if withIn}{@render search()}{/if}
    </div>
    <div id="roster-panel" class="list-box" role="tabpanel">
      {#if shown === "in"}
        {#if next.going.length}
          <div class="whos-in" class:gathered={gathering}>{@render players(next.going, true)}</div>
        {:else}
          <p class="hint">Nobody yet. If you ain't first, you last. Teams come out after sign-up closes.</p>
        {/if}
      {:else if shown === "waiting"}
        {#if next.waitlist.length}{@render players(next.waitlist, true)}{:else}<p class="hint">
            Nobody's waiting.
          </p>{/if}
      {:else if outs.length}
        {@render players(outs)}
      {:else}
        <p class="hint">Nobody's said they're out.</p>
      {/if}
    </div>
  {/snippet}

  {#if !session}
    <EmptyState icon="calendar" title="No sessions coming up">
      An admin sets the dates under Settings → Training.
    </EmptyState>
  {:else}
    {#if info && (info.place?.name !== usual?.name || info.startTime !== series.startTime)}
      <p class="note">
        This week: {formatDayDate(sessionBookable(session).startsAt)}, {clock(info.startTime)} at {info.place?.name ??
          "somewhere new"}.
      </p>
    {/if}

    {#if !ordered}
      <!-- Before the teams: who's in, in order -->
      {@render signUp()}
      <div class="list-head">
        <div class="head-line">
          <h2 class="section-title">Who's coming</h2>
          {#if spaces !== null}<span class="spaces num">{spaces} {spaces === 1 ? "space" : "spaces"} left</span>{/if}
        </div>
        {#if next.going.length || next.waitlist.length || outs.length}
          <div class="seg sm" role="group" aria-label="Show players as">
            <button aria-pressed={view === "cards"} onclick={() => setView("cards")}
              ><Icon name="teams" size={16} />Cards</button
            >
            <button aria-pressed={view === "list"} onclick={() => setView("list")}
              ><Icon name="list" size={16} />List</button
            >
          </div>
        {/if}
      </div>
      <!-- The page scrolls until the tabs reach the top, then on through the rows, the box under the tabs showing
           them pass (lib/list-scroll.ts) -->
      <div class="roster rise hybrid" use:listScroll>
        <div class="stuck">{@render roster(true)}</div>
        <div class="list-spacer"></div>
      </div>
    {:else}
      <!-- Once there are teams: anyone missing from them first, then sign-up and your answer, then the teams -->
      {@render signUp(unplaced.length > 0 || left.length > 0)}

      <!-- The teams' own heading, and for a team maker how to move someone -->
      <div class="teams-head" class:clearing>
        <h2 class="section-title">The teams</h2>
        {@render search()}
        {#if arranging}
          <p class="hint move-hint">Drag a player to another team to move them. Everyone sees it straight away.</p>
        {/if}
      </div>

      <div class="teams-grid" class:clearing>
        {#each ordered as team, t (team.name)}
          {@const mine = team.players.includes(who.id)}
          <section
            style:--t={t}
            class="team rise"
            class:mine
            class:over={over === team.name && drag?.from !== team.name}
            data-team={team.name}
          >
            <header>
              <h2 class="display">{team.name}</h2>
              {#if mine}<span class="badge green">Your team</span>{/if}
              <span class="hint num count">
                {team.players.length}
                {team.players.length === 1 ? "player" : "players"}{ratings ? ` · rating ${rating(team.players)}` : ""}
              </span>
            </header>
            <div class="list">
              {#each matching(team.players) as id (id)}
                {#if arranging}
                  {@render arrangeRow(id, team.name)}
                {:else}
                  {@render player(id)}
                {/if}
              {/each}
            </div>
          </section>
        {/each}
      </div>

      {#if unplaced.length}
        <!-- In, but signed up after the teams were made (a walk-in, say): nobody's forgotten. A team maker drags them
             onto a team, or slots them all in from the warning above -->
        <section class="unplaced">
          <h2 class="section-title">Not on a team</h2>
          {#if arranging}
            <p class="hint">Signed up after the teams were made. Drag them onto a team, or slot them all in.</p>
            <div class="list">
              {#each unplaced as id (id)}{@render arrangeRow(id, "")}{/each}
            </div>
          {:else}
            <p class="hint">Signed up after the teams were made. They'll be put on a team.</p>
            {@render players(unplaced)}
          {/if}
        </section>
      {/if}

      {#if drag && dragged}
        <!-- The row being dragged, following the pointer -->
        <div
          class="row ghost-row"
          style:left="{drag.x - drag.dx}px"
          style:top="{drag.y - drag.dy}px"
          style:width="{drag.w}px"
          aria-hidden="true"
        >
          <Icon name="grip" size={20} />
          <Person player={byId(drag.id)} showRating={ratings} />
        </div>
      {/if}

      {#if next.waitlist.length || outs.length}
        <section class="not-playing">
          <h2 class="section-title">Not playing</h2>
          <div class="roster">{@render roster(false)}</div>
        </section>
      {/if}
    {/if}
  {/if}
</div>

{#snippet manageTools()}
  <div class="tools">
    {#if can(perms, "manage:Training")}
      <button class="tool" onclick={() => go(() => (settingsOpen = true))}>
        <Icon name="settings" size={22} />
        <span class="tool-text"
          ><strong>Training settings</strong><span>Its days, times, place and fee, for every session.</span></span
        >
        <Icon name="chevronRight" size={18} />
      </button>
    {/if}
    {#if session && can(perms, "record:Attendance")}
      <button class="tool" onclick={() => go(() => (registering = true))}>
        <Icon name="userPlus" size={22} />
        <span class="tool-text"
          ><strong>Add player</strong><span>Someone who turned up, or signing up for someone.</span></span
        >
        <Icon name="chevronRight" size={18} />
      </button>
    {/if}
    {#if session && teams && can(perms, "publish:Teams")}
      <button class="tool" class:armed={confirming === "teams"} onclick={() => twice("teams", takeDown)}>
        <Icon name="x" size={22} />
        <span class="tool-text"
          ><strong>{confirming === "teams" ? "Tap again to take them down" : "Remove the teams"}</strong><span
            >Back to before they were made. Who's in stays.</span
          ></span
        >
      </button>
    {/if}
    {#if session && can(perms, "update:Event")}
      <button class="tool" class:armed={confirming === "reset"} onclick={() => twice("reset", reset)}>
        <Icon name="undo" size={22} />
        <span class="tool-text"
          ><strong>{confirming === "reset" ? "Tap again to reset" : "Reset this session"}</strong><span
            >Nobody in, nobody waiting, no teams. Can't be undone.</span
          ></span
        >
      </button>
    {/if}
  </div>
{/snippet}

{#if phone.current}
  <Sheet bind:open={infoOpen} title={series.name}>
    <p class="usually">{@render usually()}</p>
  </Sheet>
{/if}

{#if canManage}
  {#if phone.current}
    <Sheet bind:open={manageOpen} title="Manage {series.shortName}">{@render manageTools()}</Sheet>
  {:else}
    <Drawer
      bind:open={manageOpen}
      title="Manage {series.shortName}"
      sub={session ? formatDayDate(sessionBookable(session).startsAt) : undefined}>{@render manageTools()}</Drawer
    >
  {/if}
{/if}

{#if settingsOpen}
  <EditorPanel
    eyebrow="Training · {describeRule(series)}"
    title={series.name}
    icon={series.icon}
    tone={series.tone}
    onclose={() => (settingsOpen = false)}
  >
    <TrainingEditor seriesId={series.id} />
    {#snippet footer()}
      <button class="btn primary" type="submit" form="training-form" disabled={saving.busy > 0}>Save</button>
    {/snippet}
  </EditorPanel>
{/if}

{#if deck}
  <!-- The show: the cards over the page, centred on the window; a tap or Escape skips it -->
  <div class="deck-layer" use:portal role="presentation" onpointerdown={() => show?.skip()}>
    {#each deck as id, i (id)}
      <div class="deck-card" bind:this={deckCards[i]}>
        <div class="deck-card-in"><PlayerCard player={byId(id)} you={id === who.id} showRating={ratings} /></div>
      </div>
    {/each}
  </div>
{/if}
<svelte:window onkeydown={(e) => e.key === "Escape" && show?.skip()} />

{#if session && can(perms, "record:Attendance")}
  <RegisterDrawer {seriesId} bind:open={registering} />
{/if}

{#if lifted}
  {@const id = lifted.id}
  <PlayerCardZoom
    player={byId(id)}
    source={lifted.el}
    n={lifted.n}
    you={id === who.id}
    showRating={ratings}
    bio={byId(id).bio}
    removeLabel={can(perms, "update:Event") ? `Remove from ${series.shortName}` : undefined}
    onremove={() => removeFromSession(id)}
    detailsHref={can(perms, "manage:Member") ? `/more/teammates/${id}` : undefined}
    onclose={() => (lifted = null)}
  />
{/if}

<style>
  .list-head {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    justify-content: space-between;
    gap: var(--s-3);
  }
  .list-head .section-title {
    margin: 0;
  }
  .make {
    min-width: 9.5rem;
  }
  /* The make-teams show (lib/shuffle.ts): cards over everything, each placed by its centre on the window's */
  .deck-layer {
    position: fixed;
    inset: 0;
    z-index: 95;
    overflow: hidden;
  }
  .deck-card {
    position: absolute;
    top: 50%;
    left: 50%;
    width: 5.5rem;
    opacity: 0;
  }
  .deck-card-in {
    translate: -50% -50%;
  }
  /* The teams taken away: each falls a little and fades, one after the other */
  .teams-grid.clearing .team {
    animation: team-leave 360ms cubic-bezier(0.7, 0, 0.84, 0) both;
    animation-delay: calc(var(--t) * 70ms);
  }
  .teams-head.clearing {
    animation: team-leave 360ms cubic-bezier(0.7, 0, 0.84, 0) both;
  }
  @keyframes team-leave {
    to {
      opacity: 0;
      transform: translateY(1.5rem) scale(0.98);
    }
  }
  .whos-in.gathered {
    visibility: hidden;
  }
  /* A new row waits, its space kept, until its card lands on it */
  .row.undealt {
    opacity: 0;
  }
  .row {
    transition:
      opacity var(--t) var(--ease),
      background-color var(--t-fast) var(--ease-in-out);
  }
  /* Who's coming: one line a player, the name and their position side by side, so a full night fits on a screen */
  /* Before the teams, one scroller, the page: it scrolls first (the card goes by) until Who's coming's tabs and
     search reach the top (under the docked toolbar on a desktop), where they stay, in the open, with the list's box
     under them exactly the height left (--list-h); then it scrolls on through the rows that don't fit (--list-extra,
     the spacer), the box showing them pass (lib/list-scroll.ts). So a wheel anywhere, or one swipe, scrolls the
     lot, the page scrolls the same however short the list, and the tabs never let go (ADR 0065) */
  .roster.hybrid {
    position: relative; /* (the stuck block's offsetTop is measured from here) */
    display: block; /* (not the grid and its gap: the spacer follows the stuck block exactly) */
  }
  /* A phone's bar hiding as you scroll down (#83): the table sticks higher, into the bar's room, and its box grows
     by as much (so its bottom stays put) while the spacer gives that much back (so the page's length doesn't change
     and the table is never pushed off the top), but never below nothing: a short list keeps the page long enough
     for the table to reach the top. All three glide together, with the bar */
  .hybrid .stuck,
  .hybrid .list-box,
  .hybrid .list-spacer {
    transition:
      top var(--t) var(--ease),
      height var(--t) var(--ease);
  }
  :global(.bar-tucked) .hybrid .stuck {
    top: calc(-1 * var(--bar-h, 0px));
  }
  :global(.bar-tucked) .hybrid .list-box {
    height: calc(var(--list-h, 0px) + var(--bar-h, 0px));
  }
  :global(.bar-tucked) .hybrid .list-spacer {
    height: max(0px, calc(var(--list-extra, 0px) - var(--bar-h, 0px)));
  }
  /* A little room under the box (not the page's usual deep margin), and the box keeps its own rounded glass edge,
     so its bottom always reads as the table's end, never a row cut off over a strip */
  .page:has(> .hybrid) {
    padding-bottom: var(--s-4);
  }
  /* The tabs are the table's own header row: the glass edge wraps them and the rows, a hairline between. Nothing
     passes behind them (the box clips its rows just under them), so the header stays transparent */
  .hybrid .stuck {
    position: sticky;
    top: 0;
    z-index: 3;
    display: grid;
    border: 1px solid color-mix(in srgb, var(--fg) 7%, transparent);
    border-radius: var(--r-lg);
    background: color-mix(in srgb, var(--fg) 3%, transparent);
    backdrop-filter: var(--blur);
    -webkit-backdrop-filter: var(--blur);
  }
  .hybrid .roster-bar {
    padding: var(--s-1) var(--s-2) var(--s-1) var(--s-1);
    border-bottom: 1px solid color-mix(in srgb, var(--fg) 7%, transparent);
  }
  @media (min-width: 901px) {
    :global(.page:has(> .page-toolbar)) .hybrid .stuck {
      top: calc(var(--s-4) * 2 + 2.25rem);
    }
  }
  .hybrid .list-box {
    height: var(--list-h, auto);
    overflow: hidden;
    border-radius: 0 0 calc(var(--r-lg) - 1px) calc(var(--r-lg) - 1px);
  }
  .hybrid .list-box > .hint {
    margin: 0;
    padding: var(--s-4);
  }
  /* Cards stand in the box with room round them, so the box's edge never clips a card's outline or lift */
  .hybrid .list-box :global(.cards) {
    padding: var(--s-3);
  }
  .hybrid .list-box :global(.list) {
    border: 0;
    border-radius: 0;
    background: none;
    backdrop-filter: none;
    -webkit-backdrop-filter: none;
  }
  .hybrid .list-spacer {
    height: var(--list-extra, 0px);
  }
  /* Each row in a slot of its own (so it can move): the hairline goes between slots */
  .tight > .slot + .slot {
    border-top: 1px solid var(--border);
  }
  .tight .row {
    min-height: 2.75rem;
    padding: var(--s-2) var(--s-4);
  }
  .tight .row :global(.avatar) {
    width: 1.75rem;
    height: 1.75rem;
    font-size: 0.625rem;
  }
  .tight .row :global(.grow) {
    display: flex;
    align-items: baseline;
    gap: var(--s-2);
    min-width: 0;
  }
  .tight .row :global(.sub) {
    flex-shrink: 0;
    font-size: var(--text-xs);
  }
  /* The tabs, and the search at the end of their row */
  .roster-bar {
    position: relative;
    display: flex;
    align-items: center;
    gap: var(--s-3);
  }
  .roster-bar .tablist {
    flex: 1;
    min-width: 0;
  }
  /* The search, at the end of the row: it opens leftwards, over the tabs if it must (a phone), so nothing moves */
  .finder {
    position: absolute;
    top: 50%;
    right: 0;
    display: flex;
    justify-content: flex-end;
    width: 100%;
    translate: 0 -50%;
    pointer-events: none;
    --open-width: 16rem;
  }
  .finder > :global(*) {
    pointer-events: auto;
  }
  .roster-bar .tablist {
    padding-right: 3rem;
  }
  @media (max-width: 900px) {
    /* The tabs fade while the search lies over them, so it reads clean on any phone */
    .roster-bar .tablist {
      transition: opacity var(--t) var(--ease);
    }
    .roster-bar:has(:global(.search:focus-within), :global(.search.filled)) .tablist {
      opacity: 0;
    }
    .finder {
      --open-width: 100%;
      --search-frost: blur(14px) saturate(1.2);
    }
  }
  .usually {
    margin: 0;
    color: var(--fg-muted);
    line-height: 1.5;
  }
  .usually a {
    color: var(--fg);
    text-decoration: underline;
    text-underline-offset: 3px;
  }
  /* A phone: Cards and List as icons only (their words stay for screen readers) */
  @media (max-width: 900px) {
    .list-head .seg > button {
      gap: 0;
      font-size: 0;
    }
  }
  .roster {
    display: grid;
    gap: var(--s-3);
  }
  .not-playing {
    display: grid;
    gap: var(--s-3);
  }
  .teams-head {
    scroll-margin-top: calc(var(--chrome-h, 0px) + var(--s-4));
  }
  .list-head {
    scroll-margin-top: calc(var(--chrome-h, 0px) + var(--s-4));
  }
  .tools {
    display: grid;
    gap: var(--s-2);
  }
  .tool {
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
  }
  .tool:active {
    background: var(--surface-3);
  }
  /* The second tap's the real one: said in red, the only red here */
  .tool.armed {
    box-shadow: inset 0 0 0 1.5px var(--red-hot);
  }
  .tool.armed strong {
    color: var(--red-hot);
  }
  .tool-text {
    display: grid;
    flex: 1;
    gap: 0.15rem;
    min-width: 0;
  }
  .tool-text strong {
    color: var(--fg);
    font-size: var(--text-md);
    font-weight: 600;
  }
  .tool-text span {
    font-size: var(--text-sm);
  }
  /* Moving players: a grip to drag by, the team you're over lit, the row following the pointer */
  .grip {
    display: grid;
    place-items: center;
    width: 2.25rem;
    height: 2.75rem;
    margin: calc(-1 * var(--s-2)) 0 calc(-1 * var(--s-2)) calc(-1 * var(--s-2));
    padding: 0;
    border: 0;
    border-radius: var(--r-sm);
    background: none;
    color: var(--fg-subtle);
    cursor: grab;
    touch-action: none;
  }
  .grip:hover {
    color: var(--fg);
  }
  /* Out since the teams were made: still there, faded, until a team maker decides */
  .gone > :global(.avatar),
  .gone > :global(.grow) {
    opacity: 0.45;
  }
  .gone > :global(.grow) {
    text-decoration: line-through;
  }
  .lifting {
    opacity: 0.35;
  }
  .team.over .list {
    outline: 2px solid var(--green);
    outline-offset: 2px;
  }
  .ghost-row {
    position: fixed;
    z-index: 100;
    border-radius: var(--r-md);
    background: var(--surface-3);
    box-shadow: var(--shadow-pop);
    cursor: grabbing;
    pointer-events: none;
  }
  /* Not on a team: under the teams, its heading as theirs, the rows at a team's width */
  .unplaced {
    margin-top: var(--s-6);
  }
  .unplaced .list {
    max-width: 40rem;
  }
  /* The teams side by side where there's room, each a column of rows */
  .teams-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(min(100%, 20rem), 1fr));
    gap: var(--s-6);
    align-items: start;
  }
  .team {
    display: grid;
    gap: var(--s-3);
  }
  header {
    display: flex;
    align-items: center;
    gap: var(--s-3);
    padding: 0 var(--s-1);
  }
  h2.display {
    font-size: 1.6rem;
  }
  .count {
    margin-left: auto;
  }
  .mine .list {
    border-color: var(--green-border);
  }
  .row.you {
    background: color-mix(in srgb, var(--green) 7%, transparent);
    color: var(--fg);
    font-weight: 600;
  }
  .cards {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(6.4rem, 1fr));
    gap: var(--s-3);
  }
  @media (min-width: 901px) {
    .cards {
      grid-template-columns: repeat(auto-fill, minmax(8rem, 1fr));
      gap: var(--s-4);
    }
  }
  /* The teams are out: a line on Who's in that goes to them */
  .teams-head {
    position: relative;
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    justify-content: space-between;
    gap: var(--s-2) var(--s-3);
  }
  .teams-head .section-title {
    display: flex;
    align-items: center;
    gap: var(--s-3);
    margin: 0;
  }
  .move-hint {
    flex-basis: 100%;
    margin: 0;
  }
  /* Someone's missing from the teams: the first thing on the page, in amber */
  /* The numbers set the slot's height; the warning lies over them, unseen numbers underneath, so the slot is the
     same height either way */
  /* What's left this week, at the end of the tabs */
  /* In and Out counts in their accents, as on Home's card and the buttons: colour in the figure, never a fill */
  .count-in {
    color: var(--green-ink);
  }
  .count-out {
    color: var(--red-ink);
  }
  .head-line {
    display: flex;
    align-items: baseline;
    gap: var(--s-3);
    min-width: 0;
  }
  .spaces {
    flex: none;
    color: var(--fg-muted);
    font-size: var(--text-sm);
    white-space: nowrap;
  }
  .late {
    display: flex;
    align-items: center;
    gap: var(--s-4);
    overflow: hidden;
    padding: var(--s-3) var(--s-5);
    border-radius: var(--r-lg);
    background: color-mix(in srgb, var(--caution) 10%, var(--surface-1));
    color: var(--fg-muted);
  }
  .late-icon {
    display: grid;
    place-items: center;
    width: 2.75rem;
    height: 2.75rem;
    flex-shrink: 0;
    border-radius: 50%;
    background: color-mix(in srgb, var(--caution) 22%, transparent);
    color: var(--caution-ink);
  }
  .late-text {
    display: grid;
    flex: 1;
    gap: 0.15rem;
    min-width: 0;
    margin: 0;
  }
  /* The sentence: two lines at most, so the warning stays a line or two above the session */
  .late-text > span:last-child {
    display: -webkit-box;
    overflow: hidden;
    -webkit-box-orient: vertical;
    -webkit-line-clamp: 2;
    line-clamp: 2;
  }
  .late-text .eyebrow {
    overflow: hidden;
    color: var(--caution-ink);
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .late strong {
    color: var(--fg);
  }
  .late-acts {
    display: flex;
    flex-shrink: 0;
    gap: var(--s-2);
  }
  /* A phone: no icon, the words cut to one line, the two buttons beside them */
  @media (max-width: 900px) {
    .late {
      gap: var(--s-3);
      padding: var(--s-3) var(--s-4);
    }
    .late-icon {
      display: none;
    }
    .late-text > span:last-child {
      -webkit-line-clamp: 1;
      line-clamp: 1;
    }
  }
  .n {
    width: 1.25rem;
    color: var(--fg-subtle);
    font-size: var(--text-sm);
    text-align: right;
  }
</style>
