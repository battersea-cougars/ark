<script lang="ts">
  // A training series' next session. Before the teams: who's in, in order, and your answer. Once there are teams,
  // they're the page: anyone who signed up after them first (an admin slots them in or remakes them), then the
  // teams, then sign-up. A team maker's changes to the teams are saved as they're made (ADR 0076). Ratings drive the teams but only admins see them (read:Rating), as in the old app.
  import { goesBy, shortName } from "../lib/names";
  import SearchField from "../lib/SearchField.svelte";
  import PageHeader from "../lib/PageHeader.svelte";
  import { can } from "../access/actions";
  import { PLAYERS, POSITION_ICONS, POSITIONS, TEAM_NAMES, TEAM_ORDER, type Plan, type Player } from "../demo/data";
  import { rosterGroups } from "../lib/roster-groups";
  import { nextUp, placesLeft } from "../lib/places";
  import { granted, me } from "../demo/session.svelte";
  import { db } from "../demo/store.svelte";
  import Icon from "../app/shell/Icon.svelte";
  import EventCard from "../lib/EventCard.svelte";
  import Person from "../lib/Person.svelte";
  import PlayerCard from "../lib/PlayerCard.svelte";
  import PlayerCardZoom from "../lib/PlayerCardZoom.svelte";
  import RegisterDrawer from "../lib/RegisterDrawer.svelte";
  import { letIn, publishTeams, removeTeams, resetSession, saving, setPlayer } from "../app/backend.svelte";
  import EditorPanel from "../lib/EditorPanel.svelte";
  import TrainingEditor from "../lib/TrainingEditor.svelte";
  import Sheet from "../lib/Sheet.svelte";
  import Drawer from "../lib/Drawer.svelte";
  import { listScroll } from "../lib/list-scroll";
  import { checkForUpdates } from "../lib/live-updates.svelte";
  import { phone } from "../lib/viewport.svelte";
  import { cardMoveMs, deal, easeOut, prefersReducedMotion, sift } from "../app/motion";
  import { flip } from "svelte/animate";
  import { clock, clockRange, formatDayDate } from "../lib/dates";
  import { describeRule } from "../lib/recurrence";
  import { lineUp, makeTeams, slotIn, strength, type Team } from "../lib/balance";
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
  // Quarterly skaters: above those paying as they go, in and waiting (ADR 0030), badged so the order reads; and those
  // who said they're out, for whoever sees who's out
  const ahead = $derived(new Set(session?.quarterly ?? []));
  // Their plan, for grouping the lists (lib/roster-groups.ts): keepers by their position, skaters as the session says
  const planIn = (id: number): Plan =>
    byId(id).position === "G" ? "Keeper" : ahead.has(id) ? "Subscription" : "Pay as you go";
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
    // The first waiting on their side moves up: a keeper's place to a keeper, a skater's to a skater (lib/places.ts)
    const up = wasIn && info ? nextUp(id, s.going, s.waitlist, info) : undefined;
    if (up !== undefined) {
      s.going = [...s.going, up];
      s.waitlist = s.waitlist.filter((x) => x !== up);
    }
    const out = db.teams[s.id];
    if (out) {
      for (const t of out) t.players = t.players.filter((x) => x !== id);
      void publishTeams(s.id, out);
    }
  }

  // The team maker lets someone waiting in, over the limit (ADR 0076): in at once here, in their place once it's saved
  function admit(id: number) {
    const s = session;
    if (!s || !s.waitlist.includes(id)) return;
    s.waitlist = s.waitlist.filter((x) => x !== id);
    s.going = [...s.going, id];
    void letIn(s.id, id, shortName(byId(id)));
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
  // Places left, the skaters' (keepers' counted apart, said only where the series sets them, lib/places.ts); below
  // nothing once the team maker has let someone in over the limit ("1 over")
  const places = $derived(info ? placesLeft(next.going, info) : { skaters: null, keepers: null });
  const spaces = $derived(places.skaters);
  const keeperSpaces = $derived(places.keepers);

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
  // Where a player is on the page now: their row on a team, or their card or row under Who's in
  function playerRect(id: number): DOMRect | null {
    const el =
      document.querySelector(`.team [data-player="${id}"]`) ?? document.querySelector(`.whos-in [data-player="${id}"]`);
    const r = el?.getBoundingClientRect();
    return r && r.bottom > 0 && r.top < window.innerHeight ? r : null;
  }
  // Leaving mid-show: the teams still get saved
  onDestroy(() => {
    show?.skip();
    if (pending) commit(pending);
  });
  // Where a card grows from: the row's initials, or the row itself where they're hidden (a phone's one-line rows)
  const zoomFrom = (row: HTMLElement) => {
    const avatar = row.querySelector<HTMLElement>(".avatar");
    return avatar?.offsetParent ? avatar : row;
  };
  function portal(node: HTMLElement) {
    document.body.append(node);
    return { destroy: () => node.remove() };
  }
  // A team maker moves a player between teams, or onto one from Not on a team (from ""); it's saved there and then
  const arranging = $derived(can(perms, "generate:Teams") && can(perms, "publish:Teams"));
  // Who's in, out and waiting, and the teams, live (ADR 0072): made, moved or cleared, everyone on the page sees it
  // without a refresh. Not for a team maker once the teams are out (a refresh mid-drag would upset them): what they
  // see is what they've just saved. A boolean, so a change to the teams doesn't reopen the stream.
  const following = $derived(!ordered || !arranging);
  $effect(() => {
    if (following) return checkForUpdates(["sessions"], { steady: true });
  });
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
  // the pointer; the team under it lights up and its head counts them in; letting go there moves them. Near the top
  // or bottom of the screen the page scrolls, so a team out of sight can still be reached.
  let drag = $state<{ id: number; from: string; x: number; y: number; dx: number; dy: number; w: number } | null>(null);
  let over = $state<string | null>(null);
  let dragged = $state(false);
  let edgeScroll = 0;
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
    findOver();
    if (dragged && !edgeScroll) edgeScroll = requestAnimationFrame(scrollAtEdge);
  }
  function findOver() {
    if (!drag) return;
    const el = document.elementFromPoint(drag.x, drag.y)?.closest<HTMLElement>("[data-team]");
    over = el?.dataset.team ?? null;
  }
  /** Within a band at the top (under the bar) or the bottom (over the team maker's bar and the tabs), the page
     scrolls, faster the nearer the edge; the team under the finger is found again as the page moves under it */
  function scrollAtEdge() {
    edgeScroll = 0;
    if (!drag || !dragged) return;
    const view = document.querySelector<HTMLElement>(".view");
    if (!view) return;
    const v = view.getBoundingClientRect();
    const top = v.top + (parseFloat(getComputedStyle(view).paddingTop) || 0);
    const dock = document.querySelector(".maker-dock")?.getBoundingClientRect().top;
    const tabs = document.querySelector("nav.tabs")?.getBoundingClientRect().top;
    const bottom = Math.min(v.bottom, dock ?? Infinity, tabs ?? Infinity);
    const band = 72;
    const speed = (into: number) => Math.ceil(14 * Math.min(1, Math.max(0, into) / band) ** 2);
    const step =
      drag.y < top + band ? -speed(top + band - drag.y) : drag.y > bottom - band ? speed(drag.y - (bottom - band)) : 0;
    if (step) {
      view.scrollTop += step;
      findOver();
    }
    edgeScroll = requestAnimationFrame(scrollAtEdge);
  }
  function endDrag() {
    cancelAnimationFrame(edgeScroll);
    edgeScroll = 0;
    drag = null;
    over = null;
  }
  function drop() {
    if (drag && dragged && over) move(drag.id, drag.from, over);
    endDrag();
  }
  // A team's players as its head counts them: while a player's dragged over it, with them; from the team they're
  // leaving, without them
  const heading = (team: Team) => {
    if (!drag || !dragged || !over || over === drag.from) return team.players;
    if (team.name === over) return [...team.players, drag.id];
    if (team.name === drag.from) return team.players.filter((x) => x !== drag!.id);
    return team.players;
  };
  // The way without dragging: a tap on a team maker's row asks which team (a sheet), with each team's numbers
  // (who stays set while the sheet slides away, so it doesn't empty as it goes)
  let moving = $state<{ id: number; from: string } | null>(null);
  let moveOpen = $state(false);
  function askMove(id: number, from: string) {
    moving = { id, from };
    moveOpen = true;
  }
  function moveTo(name: string) {
    if (!moving) return;
    moveOpen = false;
    move(moving.id, moving.from, name);
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

  // Manage: an admin's tools for this session, in one place (a sheet on a phone, a side drawer on a desktop). The
  // ones that can't be undone take a second tap, which lapses after a few seconds.
  let manageOpen = $state(false);
  let confirming = $state<"remake" | "reset" | null>(null);
  let lapse: ReturnType<typeof setTimeout> | undefined;
  // Make teams: the team maker's call to action, always there for them (greyed until someone's in), so nothing
  // moves when the first person signs up. On a phone it sits in a bar above the tabs, where the thumb is; on a
  // desktop at the right of the toolbar. Once the teams are out it's Remake teams, with Clear teams beside it.
  const maker = $derived(!!session && arranging);
  const canGenerate = $derived(maker && next.going.length > 0);
  const canManage = $derived(
    can(perms, "manage:Training") || (!!session && (can(perms, "update:Event") || can(perms, "record:Attendance"))),
  );
  // The training's own settings (days, times, place, fee), opened over this page (ADR 0065)
  let settingsOpen = $state(false);
  // A tool that opens something else, or runs at once: the sheet gets out of the way first
  function go(run: () => void) {
    manageOpen = false;
    run();
  }
  function twice(which: "remake" | "reset", run: () => void) {
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
  // Clear teams: it throws the team maker's work away, so it asks first, in a sheet
  let clearAsk = $state(false);
  async function takeDown() {
    clearAsk = false;
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
{#snippet player(id: number, n?: number, queue = true)}
  {@const p = byId(id)}
  <button
    class="row"
    class:you={id === who.id && !hasLeft(id)}
    class:gone={hasLeft(id)}
    class:undealt={undealt.has(id)}
    data-player={id}
    aria-label="{goesBy(p)}: see their card"
    onclick={(e) => (lifted = { id, el: zoomFrom(e.currentTarget), n })}
  >
    {#if n !== undefined}<span class="n num">{n}</span>{/if}
    <Person player={p} bare />
    {#if hasLeft(id)}<span class="badge">Out</span>
    {:else if id === who.id}<span class="you-stamp">You</span>{/if}
    {#if p.cougar}<span class="badge red">Cougar</span>{/if}
    {#if queue && ahead.has(id)}{@render quarterlyBadge()}{/if}
  </button>
{/snippet}

<!-- Where they play, at the end of a team maker's row (not Who's coming: the list's groups say keepers): the position's icon and letter on a phone (F, D,
     K), its word on a desktop; the word is always there for screen readers. A badge, no colour: the words say it -->
{#snippet positionBadge(p: Player)}
  <span class="badge pos" title={POSITIONS[p.position]}
    ><Icon name={POSITION_ICONS[p.position]} size={12} /><span class="pos-letter" aria-hidden="true"
      >{POSITIONS[p.position][0]}</span
    ><span class="pos-word">{POSITIONS[p.position]}</span></span
  >
{/snippet}

<!-- A Quarterly Member: ahead in the queue (ADR 0030), said in a word at every width -->
{#snippet quarterlyBadge()}
  <span class="badge plan" title="Quarterly Member: ahead in the queue"
    >Quarterly<span class="sr-only"> Member, ahead in the queue</span></span
  >
{/snippet}

<!-- A search deals cards in and folds them away, or sifts rows; the rest glide to their places (as on Teammates) -->
<!-- `n`: each one's number, if they're numbered; `letting`: the waiting list, for the team maker: each with Let in
     beside them; `badged`: the Quarterly badge, where the list doesn't already say so -->
{#snippet players(ids: number[], n: (id: number) => number | undefined, letting = false, badged = true)}
  {#if view === "cards"}
    <div class="cards scroll-fill">
      {#each ids as id (id)}
        <div
          class="slot"
          data-player={id}
          animate:flip={{ duration: cardMoveMs, easing: easeOut }}
          in:deal
          out:deal={{ out: true }}
        >
          <PlayerCard
            player={byId(id)}
            n={n(id)}
            you={id === who.id}
            quarterly={badged && ahead.has(id)}
            lifted={lifted?.id === id}
            onopen={(el) => (lifted = { id, el, n: n(id) })}
          />
          {#if letting}{@render letInButton(id, true)}{/if}
        </div>
      {/each}
    </div>
  {:else}
    <div class="list tight scroll-fill">
      {#each ids as id (id)}
        <div class="slot" animate:flip={{ duration: cardMoveMs, easing: easeOut }} in:sift out:sift={{ out: true }}>
          {#if letting}
            <div class="letting">
              {@render player(id, n(id), badged)}
              {@render letInButton(id)}
            </div>
          {:else}
            {@render player(id, n(id), badged)}
          {/if}
        </div>
      {/each}
    </div>
  {/if}
{/snippet}

<!-- A tab of Who's coming, by plan: Quarterly, Pay as you go, Keepers, each under its heading and count (whoever the
     search leaves). Skaters numbered by their place in the queue (Quarterly first, then sign-up order), keepers on
     their own, their places counted apart (lib/roster-groups.ts). The headings scroll with the rows; a group the
     search empties folds away, the rest gliding up -->
{#snippet byPlan(all: number[], numbered = false, letting = false)}
  {@const { groups, numbers } = rosterGroups(all, planIn)}
  {@const shown = groups.map((g) => ({ ...g, ids: matching(g.ids) })).filter((g) => g.ids.length)}
  {#if !shown.length}
    <p class="hint">No one matches.</p>
  {:else}
    <div class="plans">
      {#each shown as g (g.title)}
        <section
          class="plan-group"
          aria-label={g.title}
          animate:flip={{ duration: cardMoveMs, easing: easeOut }}
          in:sift
          out:sift={{ out: true }}
        >
          <h3 class="plan-head eyebrow">{g.title} <span class="num">{g.ids.length}</span></h3>
          {@render players(g.ids, (id) => (numbered ? numbers.get(id) : undefined), letting, false)}
        </section>
      {/each}
    </div>
  {/if}
{/snippet}

{#snippet letInButton(id: number, block = false)}
  <button class="btn sm outline let-in" class:block aria-label="Let {goesBy(byId(id))} in" onclick={() => admit(id)}
    >Let in</button
  >
{/snippet}

<!-- A team maker's row: a grip to drag them to a team (from "" when they're not on one yet), and the rest of the row
     a tap that asks where to move them (the way without dragging). One line, so a team of seven fits a phone -->
{#snippet arrangeRow(id: number, from: string)}
  {@const p = byId(id)}
  <div
    class="row arrange"
    class:you={id === who.id && !hasLeft(id)}
    class:lifting={drag?.id === id && dragged}
    class:gone={hasLeft(id)}
    class:undealt={undealt.has(id)}
    data-player={id}
  >
    <button
      class="grip"
      aria-label="Move {goesBy(p)}: drag to a team, or press Enter for the next team"
      onpointerdown={(e) => grab(e, id, from)}
      onpointermove={follow}
      onpointerup={drop}
      onpointercancel={endDrag}
      onclick={(e) => nudge(e, id, from)}
    >
      <Icon name="grip" size={20} />
    </button>
    <button class="pick" aria-label="{goesBy(p)}: move to another team" onclick={() => askMove(id, from)}>
      {@render rowBody(p)}
    </button>
  </div>
{/snippet}

<!-- What a team maker's row says: who, their marks, where they play, and their rating -->
{#snippet rowBody(p: Player)}
  <Person player={p} bare />
  {#if hasLeft(p.id)}<span class="badge">Out</span>
  {:else if p.id === who.id}<span class="you-stamp">You</span>{/if}
  {#if p.cougar}<span class="badge red">Cougar</span>{/if}
  {@render positionBadge(p)}
  {#if ratings}<span class="rating num" title="Rating">{p.rating}</span>{/if}
{/snippet}

<!-- Every week on Fri · 7:30pm–9:30pm · the place, a tap opening the map -->
{#snippet usually()}
  {describeRule(series)} · {clockRange(series.startTime, series.endTime)}{#if usual}&nbsp;· <a
      href={usual.mapUrl}
      target="_blank"
      rel="noopener noreferrer">{usual.name}</a
    >{/if}
{/snippet}

<!-- A phone's session card, under its title: where (a tap opens the map) and how often -->
{#snippet usualLinks()}
  {#if info?.place?.mapUrl || info?.place?.name}
    <a
      href={info.place.mapUrl}
      target="_blank"
      rel="noopener noreferrer"
      aria-label="Directions to {info.place.name || 'the venue'}"><Icon name="pin" size={16} />{info.place.name}</a
    >
  {/if}
  <span class="often"><Icon name="calendar" size={16} />{describeRule(series)}</span>
{/snippet}

<!-- Make teams, Remake teams: remaking replaces teams everyone can see, so it takes a second tap; the label swaps in
     place, the width held so nothing moves -->
{#snippet makeButton(size: string)}
  <button
    class="btn primary make {size}"
    class:keep-label={confirming === "remake"}
    disabled={!canGenerate || !!deck}
    onclick={() => (teams ? twice("remake", generate) : generate())}
    ><Icon name="teams" size={size === "sm" ? 16 : 18} />
    {!teams ? "Make teams" : confirming === "remake" ? "Tap again to remake" : "Remake teams"}</button
  >
{/snippet}

<div class="page" class:has-dock={maker && phone.current}>
  <!-- When and where it usually is: the line under the title on a desktop. A phone has no room to spare up there, and
       no foot (the list's header sticks and the rows scroll under it to the end), so its session card says where,
       with the map, and how often it's on -->
  <PageHeader title={series.name} sub={phone.current ? undefined : usually}>
    {#snippet actions()}
      <!-- Make teams is the one job on show: it's the night's job for whoever makes the teams, not only an admin.
           Everything else is behind one quiet button (ADR 0065): a sheet on a phone, a side drawer on a desktop.
           On a phone, Make teams is in the bar at the bottom (makerDock), not up here -->
      {#if maker && !phone.current}
        {#if teams}
          <button class="btn sm ghost" onclick={() => (clearAsk = true)}>Clear teams</button>
        {/if}
        {@render makeButton("sm")}
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
      links={phone.current ? usualLinks : undefined}
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
          <div class="whos-in" class:gathered={gathering}>{@render byPlan(next.going, true)}</div>
        {:else}
          <p class="hint">Nobody yet. If you ain't first, you last. Teams come out after sign-up closes.</p>
        {/if}
      {:else if shown === "waiting"}
        {#if next.waitlist.length}{@render byPlan(next.waitlist, true, arranging)}{:else}<p class="hint">
            Nobody's waiting.
          </p>{/if}
      {:else if outs.length}
        {@render byPlan(outs)}
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
          <!-- The skaters' places left, and the keepers' where the series sets them: one under the other on a phone -->
          {#if spaces !== null || keeperSpaces !== null}<span class="spaces num"
              >{#if spaces !== null}<span
                  >{spaces < 0 ? `${-spaces} over` : `${spaces} ${spaces === 1 ? "space" : "spaces"} left`}</span
                >{/if}{#if keeperSpaces !== null}<span class="keepers"
                  >{keeperSpaces < 0
                    ? `${-keeperSpaces} ${keeperSpaces === -1 ? "keeper" : "keepers"} over`
                    : `${keeperSpaces} for ${keeperSpaces === 1 ? "a keeper" : "keepers"}`}</span
                >{/if}</span
            >{/if}
        </div>
        {#if next.going.length || next.waitlist.length || outs.length}
          <div class="seg sm" role="group" aria-label="Show players as">
            <button aria-pressed={view === "cards"} onclick={() => setView("cards")}
              ><Icon name="cards" size={16} />Cards</button
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
          <p class="hint move-hint">
            Drag a player by the grip to another team, or tap them to pick one. Everyone sees it straight away.
          </p>
        {/if}
      </div>

      <div class="teams-grid" class:clearing>
        {#each ordered as team, t (team.name)}
          {@const mine = team.players.includes(who.id)}
          {@const head = strength(heading(team), byId)}
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
              <!-- How many and how strong, for a team maker as they drag (the team they're over counts the player
                   in already); figures in fixed-width digits so the line never moves -->
              <span
                class="count num"
                class:preview={!!drag && dragged && (over === team.name || drag.from === team.name)}
              >
                <span><strong>{head.players}</strong> {head.players === 1 ? "player" : "players"}</span>
                {#if ratings}<span title="Average rating (total {head.total})"
                    ><strong>{head.average ?? "–"}</strong> avg</span
                  >{/if}
              </span>
            </header>
            <div class="list tight">
              {#each lineUp(matching(team.players), byId, ratings) as id (id)}
                {#if arranging}
                  {@render arrangeRow(id, team.name)}
                {:else}
                  <!-- On a team the queue's behind them: no Quarterly badge -->
                  {@render player(id, undefined, false)}
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
            <div class="list tight">
              {#each unplaced as id (id)}{@render arrangeRow(id, "")}{/each}
            </div>
          {:else}
            <p class="hint">Signed up after the teams were made. They'll be put on a team.</p>
            {#if matching(unplaced).length}{@render players(matching(unplaced), () => undefined)}{:else}<p class="hint">
                No one matches.
              </p>{/if}
          {/if}
        </section>
      {/if}

      {#if drag && dragged}
        <!-- The row being dragged, following the pointer -->
        <div
          class="row ghost-row tight"
          style:left="{drag.x - drag.dx}px"
          style:top="{drag.y - drag.dy}px"
          style:width="{drag.w}px"
          aria-hidden="true"
        >
          <span class="grip"><Icon name="grip" size={20} /></span>
          {@render rowBody(byId(drag.id))}
          <!-- Where letting go puts them -->
          <span class="to" class:on={!!over && over !== drag.from}
            ><Icon name="chevronRight" size={14} />{over && over !== drag.from ? over : ""}</span
          >
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

{#if maker && phone.current}
  <!-- The team maker's bar, above the tabs where the thumb is. The page keeps room for it at the bottom
       (.has-dock), so it covers nothing, and it's there from the start, so nothing moves when the teams come out -->
  <div class="maker-dock" role="region" aria-label="Teams">
    {#if teams}
      <button class="btn outline clear" onclick={() => (clearAsk = true)}>Clear</button>
    {/if}
    {@render makeButton("")}
  </div>
{/if}

{#if maker && teams}
  <Sheet bind:open={clearAsk} title="Clear the teams?">
    <p class="ask">
      Everyone goes back to Who's in, on no team, and everyone sees it straight away. Who's in stays as it is.
    </p>
    {#snippet footer()}
      <button class="btn ghost" type="button" onclick={() => (clearAsk = false)}>Keep them</button>
      <button class="btn clear-yes" type="button" onclick={takeDown}>Clear teams</button>
    {/snippet}
  </Sheet>
{/if}

{#if arranging && teams}
  <!-- Move a player without dragging: their teams with each one's numbers, theirs marked; their card a tap away -->
  <Sheet
    bind:open={moveOpen}
    title={moving ? `Move ${goesBy(byId(moving.id))}` : "Move"}
    sub={moving
      ? `${POSITIONS[byId(moving.id).position]}${ratings ? ` · rating ${byId(moving.id).rating}` : ""}`
      : undefined}
  >
    {#if moving}
      {@const m = moving}
      <div class="tools">
        {#each ordered ?? [] as team (team.name)}
          {@const head = strength(team.players, byId)}
          {@const theirs = team.name === m.from}
          <button class="tool" disabled={theirs} onclick={() => moveTo(team.name)}>
            <Icon name="teams" size={22} />
            <span class="tool-text"
              ><strong>{theirs ? `On ${team.name}` : `To ${team.name}`}</strong><span class="num"
                >{head.players}
                {head.players === 1 ? "player" : "players"}{ratings && head.average !== null
                  ? ` · avg ${head.average}`
                  : ""}</span
              ></span
            >
            {#if !theirs}<Icon name="chevronRight" size={18} />{/if}
          </button>
        {/each}
        <button
          class="tool"
          onclick={() => {
            const row = document.querySelector<HTMLElement>(`[data-player="${m.id}"]`);
            const el = row && zoomFrom(row);
            moveOpen = false;
            if (el) lifted = { id: m.id, el };
          }}
        >
          <Icon name="cards" size={22} />
          <span class="tool-text"><strong>See their card</strong><span>Who they are, and their bio.</span></span>
          <Icon name="chevronRight" size={18} />
        </button>
      </div>
    {/if}
  </Sheet>
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
    showRating={ratings && onTeam.has(id)}
    bio={byId(id).bio}
    removeLabel={can(perms, "update:Event") ? `Remove from ${series.shortName}` : undefined}
    onremove={() => removeFromSession(id)}
    detailsHref={can(perms, "manage:Member") ? `/club/${id}` : undefined}
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
  /* The team maker's bar on a phone: solid like the tabs it sits on, the main button filling what's left */
  .maker-dock {
    position: fixed;
    right: 0;
    bottom: var(--tab-h);
    left: 0;
    z-index: 4;
    display: flex;
    gap: var(--s-2);
    height: var(--dock-h);
    padding: var(--s-2) var(--gutter);
    background: var(--bg);
  }
  .maker-dock .make {
    flex: 1;
  }
  .maker-dock .clear {
    min-width: 6rem;
  }
  .page,
  .maker-dock {
    --dock-h: 3.75rem;
  }
  /* The save note ("Teams cleared") shows over the bar, not under it (app/shell/Shell.svelte) */
  :global(:root:has(.maker-dock)) {
    --above-tabs: 3.75rem;
  }
  /* Room at the bottom for the bar, so the last rows scroll clear of it (lib/list-scroll.ts sizes the list by it) */
  .page.has-dock {
    padding-bottom: calc(var(--s-10) + var(--dock-h));
  }
  .page.has-dock:has(> .hybrid) {
    padding-bottom: calc(var(--s-4) + var(--dock-h));
  }
  .ask {
    margin: 0;
    color: var(--fg-muted);
    line-height: 1.5;
  }
  /* The armed "are you sure": the one red fill (ADR 0084) */
  .clear-yes {
    background: var(--red);
    color: var(--on-red);
  }
  .clear-yes:hover:not(:disabled) {
    background: var(--red-hot);
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
  /* Before the teams, one scroller, the page (.hybrid in app.css, lib/list-scroll.ts): the tabs and search are the
     table's header row */
  .hybrid .roster-bar {
    padding: var(--s-1) var(--s-2) var(--s-1) var(--s-1);
    background: var(--rule) bottom / 100% 1px no-repeat;
  }
  /* Cards stand in the box with room round them, so the box's edge never clips a card's outline or lift */
  .hybrid .list-box :global(.cards) {
    padding: var(--s-3);
  }
  /* Who's coming by plan: each group's heading small caps in the muted ink with its count, in the rows' own
     inset, on the page's glass (no bar, no line); it scrolls with the rows. Space, not a rule, between groups */
  .plans {
    display: flow-root;
  }
  .plan-head {
    display: flex;
    align-items: baseline;
    gap: var(--s-2);
    margin: 0;
    padding: var(--s-3) var(--row-pad, var(--s-3)) var(--s-1);
  }
  .plan-group + .plan-group .plan-head {
    padding-top: var(--s-5);
  }
  .plan-head .num {
    color: var(--fg);
  }
  .hybrid .plan-group :global(.cards) {
    padding-top: var(--s-2);
  }
  .plan-group:has(.cards) .plan-head {
    padding-inline: var(--s-3);
  }
  /* Each row in a slot of its own (so it can move): the hairline goes between slots */
  .tight > .slot + .slot {
    padding-top: 1px;
    background: var(--rule) top / 100% 1px no-repeat;
  }
  .tight .row {
    min-height: 2.75rem;
    padding: var(--s-2) var(--row-pad);
  }
  .tight .row :global(.avatar),
  .ghost-row :global(.avatar) {
    width: 1.75rem;
    height: 1.75rem;
    font-size: 0.625rem;
  }
  .tight .row :global(.grow),
  .ghost-row :global(.grow) {
    display: flex;
    align-items: baseline;
    gap: var(--s-2);
    min-width: 0;
  }
  .tight .row :global(.sub) {
    flex-shrink: 0;
    font-size: var(--text-xs);
  }
  /* A tight row's badges (Cougar, Quarterly) a size down, so a name keeps its room */
  .tight .row .badge,
  .ghost-row .badge {
    height: 1.25rem;
    padding: 0 var(--s-1);
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
  /* A phone's session card: how often it's on, quiet beside the place's map link (EventCard's .links) */
  .often {
    display: inline-flex;
    align-items: center;
    gap: var(--s-2);
    min-height: 2rem;
    color: var(--fg-muted);
    font-size: var(--text-sm);
  }
  .often :global(svg) {
    flex: none;
  }
  /* Where they play: the last thing on the row, one width, so the column lines up and scans; the icon and letter on a
     phone, the word on a desktop */
  .badge.pos {
    flex: none;
    justify-content: center;
    min-width: 1.75rem;
  }
  .badge.pos :global(svg) {
    display: none;
    flex: none;
    color: var(--fg-subtle);
  }
  .pos-word {
    display: none;
  }
  @media (min-width: 901px) {
    .badge.pos {
      justify-content: flex-start;
      min-width: 5.25rem;
    }
    .badge.pos :global(svg) {
      display: block;
    }
    .pos-letter {
      display: none;
    }
    .pos-word {
      display: inline;
    }
  }
  /* A phone's one-line rows: no initials, so the name keeps its room beside its badges (the number, or the grip,
     starts the row) */
  @media (max-width: 900px) {
    .tight .row :global(.avatar),
    .ghost-row :global(.avatar) {
      display: none;
    }
  }
  /* Quarterly: a word at every width, so it reads at a glance; tinted like a badge, no colour */
  .badge.plan {
    flex: none;
  }
  /* The team maker's figure, after the position: fixed width, so a two- or three-digit rating never nudges the row */
  .rating {
    flex: none;
    width: 1.75rem;
    color: var(--fg-muted);
    font-size: var(--text-sm);
    text-align: right;
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
  /* Waiting, for the team maker: the row, then Let in at its end (in the row's padding, so the row is no taller) */
  .letting {
    display: flex;
    align-items: center;
    padding-right: var(--row-pad, var(--s-3));
  }
  .letting > .row {
    flex: 1;
    min-width: 0;
  }
  .cards .let-in {
    margin-top: var(--s-2);
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
  /* Move: the team they're on, said but not offered */
  .tool:disabled {
    background: none;
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
  /* Moving players: a grip to drag by, the full height of the row and a thumb wide; the rest of the row a tap that
     asks where to; the team you're over lit, the row following the pointer */
  .tight .row.arrange {
    gap: 0;
    padding: 0 var(--row-pad) 0 0;
  }
  .pick {
    display: flex;
    flex: 1;
    align-items: center;
    gap: var(--s-3);
    min-width: 0;
    min-height: 2.75rem;
    padding: 0;
    border: 0;
    background: none;
    color: inherit;
    font: inherit;
    text-align: left;
    cursor: pointer;
  }
  .arrange:has(.pick:hover) {
    background: var(--row-hover);
  }
  .pick :global(.grow) {
    flex: 1;
  }
  .grip {
    display: grid;
    flex: none;
    place-items: center;
    width: 2.75rem;
    height: 2.75rem;
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
  /* While someone's dragged, the team they'd land on lights: its rows a tint, its edge a ring (the one place a line
     helps: it's where to let go), its head's figures counting them in */
  .team .list {
    transition:
      box-shadow var(--t-fast) var(--ease-in-out),
      background-color var(--t-fast) var(--ease-in-out);
  }
  .team.over .list {
    background-color: color-mix(in srgb, var(--green) 9%, var(--glass, transparent));
    box-shadow: inset 0 0 0 2px var(--green);
  }
  .count.preview strong {
    color: var(--green-ink);
  }
  .ghost-row {
    position: fixed;
    z-index: 100;
    min-height: 2.75rem;
    padding: 0 var(--row-pad) 0 0;
    border-radius: var(--r-md);
    background: var(--surface-3);
    box-shadow: var(--shadow-pop);
    cursor: grabbing;
    pointer-events: none;
  }
  .ghost-row .grip {
    color: var(--fg);
  }
  /* Where letting go puts them, on the dragged row itself (its room kept, so the row doesn't change as it moves) */
  .to {
    display: inline-flex;
    flex: none;
    align-items: center;
    gap: var(--s-1);
    width: 5.5rem;
    overflow: hidden;
    color: var(--green-ink);
    font-size: var(--text-sm);
    font-weight: 600;
    white-space: nowrap;
    visibility: hidden;
  }
  .to.on {
    visibility: visible;
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
  /* How many and how strong: the figures stand out, the words quiet */
  .count {
    display: inline-flex;
    gap: var(--s-3);
    margin-left: auto;
    color: var(--fg-muted);
    font-size: var(--text-sm);
    white-space: nowrap;
  }
  .count strong {
    color: var(--fg);
    font-size: var(--text-md);
    font-weight: 700;
    transition: color var(--t-fast) var(--ease-in-out);
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
  /* The search at the end of the title's line, not the middle of the block (the hint under it ran beneath it) */
  .teams-head .finder {
    top: 0;
    translate: none;
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
    display: inline-flex;
    flex: none;
    flex-direction: column;
    color: var(--fg-muted);
    font-size: var(--text-sm);
    line-height: 1.25;
    white-space: nowrap;
  }
  @media (min-width: 601px) {
    .spaces {
      flex-direction: row;
      gap: var(--s-3);
    }
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
