<script lang="ts">
  // A captains' draft (ADR 0060). An admin opens it on the night, which draws the pick order at random (DraftOrder
  // shuffles the names into it for whoever's watching); the captains take turns, in snake order, picking
  // from the members who said they're in (captains are in automatically, never picked). The captain on the clock picks
  // on their own phone: Pick marks a player, End turn sends it (ADR 0060). Whoever runs the draft can pick for them,
  // undo the last pick, close it, reopen it (ADR 0060). A team takes one goalie (ADR 0060). Teams are edited on the
  // Teams page, not here.
  //
  // Laid out as a draft room: a ticker of picks across the top (the one on the clock brought forward with a badge),
  // then two views, Players and Teams: side by side on a wide screen, tabs on anything narrower. The players are a
  // plain list with a Pick on each row on your turn; a name opens the player's card. A captain's own team is the
  // first of the teams, badged "Your team", with their coming pick drawn in.
  import { goesBy, goesByOf, shortNameOf, nameOfTeam } from "../lib/names";
  import EmptyState from "../lib/EmptyState.svelte";
  import { can } from "../access/actions";
  import { PLAYERS, type Player, type Position } from "../demo/data";
  import { granted, me } from "../demo/session.svelte";
  import Icon from "../app/shell/Icon.svelte";
  import PlayerCardZoom from "../lib/PlayerCardZoom.svelte";
  import { flip } from "svelte/animate";
  import { easeOut, flyMs, prefersReducedMotion } from "../app/motion";
  import { fly, slide } from "svelte/transition";
  import TournamentPlayersDrawer from "../lib/TournamentPlayersDrawer.svelte";
  import TeamCrest from "../lib/TeamCrest.svelte";
  import DraftOrder from "../lib/DraftOrder.svelte";
  import Sheet from "../lib/Sheet.svelte";
  import { phone } from "../lib/viewport.svelte";
  import type { IconName } from "../app/shell/icons";
  import { teamTone } from "../lib/team-tones";
  import TeamLookSheet from "../lib/TeamLookSheet.svelte";
  import Drawer from "../lib/Drawer.svelte";
  import TournamentHead from "../lib/TournamentHead.svelte";
  import { editTournament } from "../lib/TournamentEditorPanel.svelte";
  import { currentTournament, typeById } from "../demo/schedule.svelte";
  import {
    closeDraft,
    draftPick,
    drawOrder,
    makeFixtures,
    openDraft,
    resetDraft,
    undoDraftPick,
  } from "../app/backend.svelte";
  import { checkForUpdates, everyHowOften, liveFeed } from "../lib/live-updates.svelte";
  import LiveNote from "../lib/LiveNote.svelte";
  import { formatDayDate, londonISO, londonToday } from "../lib/dates";
  import { MIN_TEAM_SIZE, nth, onTheClock, orderDrawn, playersNeeded } from "../lib/draft";
  import { teamsForPlayoffs } from "../lib/fixtures";
  import { navigate } from "../app/router.svelte";

  let { typeId }: { typeId: number } = $props();

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
  const open = $derived(phase === "open");
  const live = $derived(open && pool.length > 0);
  const clock = $derived(teams.length ? onTheClock(teams.length, made) : -1);
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
  const turnIn = (i: number) => {
    for (let k = 0; k < pool.length; k++) if (onTheClock(teams.length, made + k) === i) return k;
    return Infinity;
  };
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
  const poolTally = $derived(tallyOf(pool));
  // The team on the clock has a goalie: the goalies' rows can't be picked for it
  const clockHasGoalie = $derived(clock >= 0 && membersOf(clock).some((p) => p.position === "G"));

  // The ticker: the picks just made (who was taken), then every pick to come, each with its team. Fixed-size chips,
  // so it scrolls but never grows; the one on the clock is kept in view
  const SHOWN_BEFORE = 3;
  const ticker = $derived.by(() => {
    // Not before it opens: the order's drawn then (DraftOrder), so there's no order to show
    if (!teams.length || (phase !== "open" && phase !== "closed") || (phase === "closed" && !made)) return [];
    const out: { n: number; team: number; took?: string; by?: string; ghost?: boolean }[] = [];
    // Nothing to show (nobody to pick, none picked): no ticker, not a row of empty places
    if (!made && !pool.length) return [];
    // Before the first few picks, empty places keep the next one in the middle; the picks fill them in
    if (phase !== "closed")
      for (let n = Math.min(picks.length, SHOWN_BEFORE) - SHOWN_BEFORE + 1; n <= 0; n++)
        out.push({ n, team: -1, ghost: true });
    for (const p of picks.slice(-SHOWN_BEFORE))
      out.push({ n: p.n, team: p.team, took: p.memberId ? firstName(p.memberId) : p.name, by: pickerOf(p, p.team) });
    if (phase !== "closed")
      for (let n = made + 1; n <= made + pool.length; n++) out.push({ n, team: onTheClock(teams.length, n - 1) });
    return out;
  });
  let tickerEl = $state<HTMLElement | undefined>();
  // Only the ticker scrolls: scrollIntoView would also move the page under you (it scrolls every scroller around it)
  $effect(() => {
    void made;
    const now = tickerEl?.querySelector<HTMLElement>(".tick.up");
    if (!tickerEl || !now) return;
    tickerEl.scrollTo({
      left: now.offsetLeft - (tickerEl.clientWidth - now.offsetWidth) / 2,
      behavior: prefersReducedMotion ? "auto" : "smooth",
    });
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
  // In a drawer from the strip, by round
  let logOpen = $state(false);
  // The rules, in a drawer beside it
  let rulesOpen = $state(false);
  const rounds = $derived.by(() => {
    const out: { round: number; picks: typeof log }[] = [];
    for (const l of log) {
      const r = Math.ceil(l.n / teams.length);
      if (out.at(-1)?.round !== r) out.push({ round: r, picks: [] });
      out.at(-1)!.picks.push(l);
    }
    return out;
  });
  const tickMeta = (t: { n: number; team: number; took?: string; by?: string }) => {
    if (t.n <= made) return `${t.n} · ${t.by ? `${t.by} took ` : t.took ? "took " : "picked"}${t.took ?? ""}`;
    const k = t.n - made - 1;
    if (t.team === myTeam) return `${t.n} · in ${k}`;
    return k === 1 ? `${t.n} · next` : `${t.n}`;
  };

  // Players: the pool, filtered by position
  type Filter = "all" | Position;
  let filter = $state<Filter>("all");
  const shown = $derived(filter === "all" ? pool : pool.filter((p) => p.position === filter));
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
      await draftPick(tournament.id, chosenPlayer.id);
    } finally {
      ending = false;
    }
  }

  // Two columns only where they fit (by the page's own width); anything narrower gets the phone's tabs, one view at
  // a time. No in-between layout
  let pageW = $state(0);
  const columns = $derived(pageW >= 960);
  const fit = $derived(!columns && open);
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

  // Closing with members still to pick: say so, and ask before leaving them out
  let confirmLeaveOut = $state(false);
  async function close() {
    if (!tournament) return;
    if (pool.length && !confirmLeaveOut) return void (confirmLeaveOut = true);
    await closeDraft(tournament.id, pool.length > 0);
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
    if (!tournament || phase === "closed") return [] as Tool[];
    const id = tournament.id;
    const list: Tool[] = [];
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
        label: "Close the draft",
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
  $effect(() => {
    if (manageOpen) return;
    confirmLeaveOut = false;
    confirmReset = false;
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

  async function fixtures() {
    if (tournament && (await makeFixtures(tournament.id))) navigate(`/tournaments/${type.slug}/schedule`);
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
      <li class="row" class:you={p.memberId === me().id} animate:flip={{ duration: moveMs }}>
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
    {#if next}
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
      <div class="filters" role="group" aria-label="Position">
        {#each [["all", "All", pool.length, "teams"], ["F", "Forwards", poolTally.F, "stick"], ["D", "Defence", poolTally.D, "shield"], ["G", "Keepers", poolTally.G, "net"]] as const as [v, label, n, icon] (v)}
          <button class="filter" aria-pressed={filter === v} onclick={() => (filter = v)}
            ><Icon name={icon} size={16} />{label}<span class="count num">{n}</span></button
          >
        {/each}
      </div>
      <div class="plist" aria-label="Players left">
        {#each listed as p (p.id)}{@render playerRow(p, true)}{/each}
      </div>
    {:else if open}
      <p class="hint">Everyone's picked. Whoever runs the draft closes it to set the teams.</p>
    {:else}
      <p class="hint">Nobody's signed up yet.</p>
    {/if}
  </section>
{/snippet}

{#snippet teamsView()}
  <section class="teams" aria-label="Teams">
    {#each teamOrder as i (teams[i].id ?? i)}
      {@const t = teams[i]}
      {@const yours = i === myTeam}
      <div class="panel" aria-label={yours ? "Your team" : undefined}>
        <header>
          <TeamCrest
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
<div class="page full draft" class:fit bind:clientWidth={pageW}>
  {#if tournament}
    <TournamentHead {type} {tournament} title="Draft" compact={phone.current && open} />
  {/if}

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
    <!-- A closed draft's next steps, on the page: reopen it, make the fixtures. Everything else whoever runs it does
         is behind Manage, out of the picker's way (the admin controls pattern) -->
    {#if running && phase === "closed"}
      <div class="controls run">
        <button class="btn sm outline" onclick={() => openDraft(tournament.id)}>Reopen</button>
        {#if !tournament.games?.length && tooFew}
          <p class="ask warn">The playoffs need {playoffTeams} teams: choose fewer in the {type.shortName} settings</p>
        {:else if !tournament.games?.length}
          <button class="btn primary sm" onclick={fixtures}>Make the fixtures</button>
        {/if}
      </div>
    {/if}

    <!-- Where you stand, as one badge, and the tools. Always the same height. How to pick is in Rules, not here -->
    <div class="strip">
      {#if phase === "closed"}
        <span class="turn done">Teams set</span>
        {#if tournament.games?.length}<a class="btn ghost sm" href="/tournaments/{type.slug}/schedule"
            >See the fixtures</a
          >{/if}
      {:else if live}
        {#if mine}<span class="turn now"><i class="dot"></i>Your pick</span>
        {:else if canPick}<span class="turn now"><i class="dot"></i>Picking for {teamName(clock)}</span>
        {:else}<span class="turn"><span class="clip">{teamName(clock)}</span>&nbsp;picking</span>{/if}
      {:else if open}
        <span class="turn done">Everyone's picked</span>
      {:else if drawn}
        <span class="turn">Order set</span>
      {:else}
        <span class="turn">{whenSaid ? `Draft ${whenSaid}` : "Draft date TBC"}</span>
      {/if}
      <div class="tools">
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
        <button class="btn ghost sm" onclick={() => (rulesOpen = true)} aria-label="Rules"
          ><Icon name="whistle" size={16} /><span class="lbl">Rules</span></button
        >
        <button class="btn ghost sm" onclick={() => (logOpen = true)} aria-label="Pick log"
          ><Icon name="list" size={16} /><span class="lbl">Pick log</span></button
        >
        {#if tools.length}
          <button class="btn ghost sm" aria-haspopup="dialog" onclick={() => (manageOpen = true)} aria-label="Manage"
            ><Icon name="settings" size={16} /><span class="lbl">Manage</span></button
          >
        {/if}
      </div>
    </div>
    <!-- Under it, one line kept while it's on: who's next, and a captain's own place (round one's, from the order) and
         how long till their turn -->
    {#if open}
      <p class="upnext">
        {#if live && pool.length > 1}<span
            >Next: <strong
              >{onTheClock(teams.length, made + 1) === myTeam
                ? "you"
                : teamName(onTheClock(teams.length, made + 1))}</strong
            ></span
          >{/if}
        {#if myTeam >= 0 && typeof teams[myTeam].pick === "number"}<span class="mine"
            >You pick {nth(teams[myTeam].pick!)}{#if live && untilMine > 1}, up in {untilMine}{:else if live && untilMine < 0},
              your picks are done{/if}</span
          >{/if}
      </p>
    {/if}

    <!-- Before it starts: the captains, no numbers until the order's set, then shuffled into it for everyone on the
         page. Whoever runs it sets the order, then starts the draft. Once it starts this folds away: the page is the
         draft, and the order's on the team cards -->
    {#if phase !== "open" && phase !== "closed"}
      <div class="before" out:slide={{ duration: prefersReducedMotion ? 0 : 280 }}>
        <DraftOrder {type} captains={order} {drawn} />
        {#if running}
          <!-- One line, the same height whichever button it holds, so setting the order moves nothing -->
          <div class="start">
            {#if !drawn}
              <p class="ask">Who picks first is drawn at random, for everyone watching.</p>
              <button class="btn primary sm" disabled={busy} onclick={() => job(() => drawOrder(tournament.id))}
                >Set the order</button
              >
            {:else}
              {#if short}
                <p class="ask">A team's at least {MIN_TEAM_SIZE}: needs {needed} signed up, {pool.length} so far</p>
              {:else if tooFew}
                <p class="ask warn">
                  The playoffs need {playoffTeams} teams: choose fewer in the {type.shortName} settings
                </p>
              {:else}
                <p class="ask">The captains pick in this order, snaking back each round.</p>
              {/if}
              <button
                class="btn primary sm"
                disabled={short || busy}
                onclick={() => job(() => openDraft(tournament.id))}>Start the draft</button
              >
            {/if}
          </div>
        {/if}
      </div>
    {/if}

    <!-- The last pick, as one line everyone sees: the team's crest and name, then who they took. Always one line
         high, so a pick arriving moves nothing; the new one flies in -->
    {#if open || (phase === "closed" && made)}
      <div class="last" aria-live="polite">
        {#if lastPick}
          {#key lastPick.n}
            <span class="last-pick" in:fly={{ y: 6, duration: flyMs, easing: easeOut }}>
              <TeamCrest
                name={teamName(lastPick.team)}
                logo={teams[lastPick.team].logo}
                tone={teamTone(lastPick.team)}
                size="1.75rem"
              />
              {#if lastPick.by}
                <!-- Whoever ran the draft picked for the captain: said as theirs, for that team (ADR 0060) -->
                <span class="lt display">{lastPick.by}</span>
                <span class="hint">picked</span>
                <span class="lp"
                  >{lastPick.name}{#if lastPick.you}<small>you</small>{/if}</span
                >
                <span class="hint">for</span>
                <span class="lt display">{teamName(lastPick.team)}</span>
              {:else}
                <span class="lt display">{teamName(lastPick.team)}</span>
                <span class="hint">picked</span>
                <span class="lp"
                  >{lastPick.name}{#if lastPick.you}<small>you</small>{/if}</span
                >
              {/if}
            </span>
          {/key}
        {:else}
          <span class="hint">Nobody's picked yet.</span>
        {/if}
      </div>
    {/if}

    <!-- The ticker: the picks just made, then every pick to come -->
    {#if ticker.length}
      <div class="ticker" bind:this={tickerEl} aria-label="Picks">
        {#each ticker as t (t.n)}
          <!-- An empty place (before the first picks) is the chip's shape with nothing in it -->
          <div
            class="tick"
            class:ghost={t.ghost}
            class:done={!t.ghost && t.n <= made}
            class:up={t.n === made + 1}
            class:now={live && t.n === made + 1}
            class:me={live && t.n === made + 1 && mine}
            style:--d={Math.min(Math.abs(t.n - (made + 1)), 4)}
            animate:flip={{ duration: moveMs }}
            aria-hidden={t.ghost ? "true" : undefined}
          >
            {#if !t.ghost}
              <TeamCrest name={teamName(t.team)} logo={teams[t.team].logo} tone={teamTone(t.team)} size="2.25rem" />
              <span class="who display"
                >{#if t.team === myTeam}<Icon name="user" size={12} />You{:else}<span class="clip"
                    >{teamName(t.team)}</span
                  >{/if}</span
              >
              {#if live && t.n === made + 1 && mine}<span class="badge red clock"><i class="dot"></i>Your pick</span>
              {:else if live && t.n === made + 1}<span class="badge clock">On the clock</span>
              {:else}<span class="meta num">{tickMeta(t)}</span>{/if}
            {/if}
          </div>
        {/each}
      </div>
    {/if}

    {#if !columns}
      <!-- Narrower than two columns: one view at a time; Teams warns while you still need a goalie -->
      <div class="tablist" role="tablist" aria-label="Draft">
        <button role="tab" aria-selected={view === "players"} onclick={() => show("players")}>Players</button>
        <button role="tab" aria-selected={view === "teams"} onclick={() => show("teams")}
          >Teams{#if myTeam >= 0 && open && !haveGoalie}<span class="need" title="No goalie yet"
              ><Icon name="alert" size={13} />G</span
            >{/if}</button
        >
      </div>
      {#key view}
        <div class="pane" in:fly={{ x: 32 * dir, duration: flyMs, easing: easeOut, opacity: 0 }}>
          {#if view === "teams"}{@render teamsView()}
          {:else}{@render playersView()}{/if}
        </div>
      {/key}
    {:else}
      <div class="views" class:filtered={phase !== "closed" && pool.length > 0}>
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

{#if tournament}
  <Drawer bind:open={rulesOpen} title="Draft rules" sub="{teams.length} captains · snake order">
    <ol class="rules">
      <li>
        <strong>The order's drawn.</strong>
        <span>Who picks first is drawn at random before it opens, not the order the captains were named in.</span>
      </li>
      <li>
        <strong>Snake order.</strong>
        <span
          >Captains pick one at a time. Each round the order flips, so whoever picks last picks first next round.</span
        >
      </li>
      <li>
        <strong>Captains are already on their teams.</strong>
        <span>Nobody can pick a captain. Everyone else who said they're in is up for grabs.</span>
      </li>
      <li>
        <strong>One goalie a team.</strong>
        <span>Once you've got one, the rest are off the menu. No hoarding.</span>
      </li>
      <li>
        <strong>Pick, then end your turn.</strong>
        <span>Tap Pick to choose; change your mind as often as you like. Nobody sees it until you press End turn.</span>
      </li>
      <li>
        <strong>Whoever runs the draft can step in.</strong>
        <span>They can pick for a captain who's gone quiet and undo the last pick if someone fat-fingers it.</span>
      </li>
      <li>
        <strong>Nobody left behind.</strong>
        <span>Anyone not picked when the draft closes stays signed up, and an admin can put them on a team.</span>
      </li>
    </ol>
  </Drawer>

  <Drawer bind:open={logOpen} title="Pick log" sub="{made} {made === 1 ? 'pick' : 'picks'} so far">
    {#if rounds.length}
      <div class="log">
        {#each rounds as r (r.round)}
          <section>
            <h4 class="eyebrow">Round {r.round}</h4>
            <ol>
              {#each r.picks as l (l.n)}
                <li>
                  <span class="n num">{l.n}</span>
                  <span class="lp"
                    >{l.name}{#if l.you}<small>you</small>{/if}</span
                  >
                  <span class="lt">{l.by ? `${l.by} for ${teamName(l.team)}` : teamName(l.team)}</span>
                </li>
              {/each}
            </ol>
          </section>
        {/each}
      </div>
    {:else}
      <p class="hint">Nobody's picked yet. Brick not hit back.</p>
    {/if}
  </Drawer>
{/if}

<!-- Manage: whoever runs the draft's jobs, thumb-sized. Closing with players left, or a reset, asks here first -->
{#snippet jobList()}
  {#if confirmLeaveOut || confirmReset}
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
  .confirm p {
    margin: 0;
    color: var(--fg-body);
  }
  .confirm-keys {
    display: flex;
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
  .upnext {
    display: flex;
    align-items: center;
    gap: var(--s-4);
    min-height: 1.5rem;
    margin: calc(-1 * var(--s-2)) 0 0;
    overflow: hidden;
    color: var(--fg-muted);
    font-size: var(--text-sm);
    white-space: nowrap;
  }
  .upnext strong {
    color: var(--fg);
    font-weight: 600;
  }
  .upnext .mine {
    margin-left: auto;
    color: var(--fg-body);
    font-weight: 600;
  }
  .before {
    display: grid;
    gap: var(--s-3);
    min-width: 0;
  }
  .start {
    display: flex;
    align-items: center;
    justify-content: flex-end;
    gap: var(--s-3);
    min-height: var(--control-h-sm);
  }
  .start .ask {
    flex: 1;
    min-width: 0;
  }

  /* A phone, the draft open: the window's height; the players (or the teams) take what's left and scroll inside, so
     the list starts high. Room at its foot for the End turn bar */
  .draft.fit {
    padding-bottom: var(--s-3);
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
  .draft {
    grid-template-columns: minmax(0, 1fr);
    padding-bottom: 6rem;
  }
  .run {
    display: flex;
    flex-wrap: wrap;
    gap: var(--s-2);
  }
  .controls {
    justify-content: flex-end;
  }
  .controls {
    align-items: center;
    min-height: var(--control-h-sm);
  }
  .ask {
    margin: 0 var(--s-2) 0 0;
    color: var(--fg-body);
    font-size: var(--text-sm);
  }
  .ask.warn {
    color: var(--tone-amber);
  }
  .hint {
    margin: 0;
  }

  /* The strip: the big badge; on your turn, who you've picked and End turn at the end. Fixed height */
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
  .last {
    display: flex;
    align-items: center;
    min-height: 2.25rem;
    min-width: 0;
  }
  .last-pick {
    display: inline-flex;
    align-items: center;
    gap: var(--s-2);
    min-width: 0;
  }
  .last-pick .lt {
    font-size: 1.15rem;
    line-height: 1;
    letter-spacing: 0.02em;
    text-transform: uppercase;
    white-space: nowrap;
  }
  .last-pick .lp {
    overflow: hidden;
    font-weight: 600;
    white-space: nowrap;
    text-overflow: ellipsis;
  }
  .last-pick small {
    margin-left: var(--s-1);
    color: var(--fg-muted);
    font-size: var(--text-xs);
    font-weight: 400;
  }

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
    scrollbar-width: none;
    mask-image: linear-gradient(90deg, transparent, #000 12%, #000 88%, transparent);
  }
  /* An empty place before the first picks: the chip's shape, faint, with nothing in it */
  .tick.ghost {
    background: color-mix(in srgb, var(--surface-2) 75%, transparent);
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
  .tick.now {
    z-index: 1;
    scale: 1.2;
    /* The home page's cards: the panel ground, a firm edge and a lit top */
    border-radius: var(--r-lg);
    background: var(--panel-bg);
    box-shadow:
      inset 0 1px 0 rgb(255 255 255 / 0.05),
      0 0 0 1px var(--border-strong);
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
    padding-top: calc(2.25rem + var(--s-3));
  }
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
  .name small,
  .lp small {
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

  /* The pick log, in its drawer: a round, then its picks, the player over the team */
  .log {
    display: grid;
    gap: var(--s-6);
  }
  .log section {
    display: grid;
    gap: var(--s-2);
  }
  .log h4 {
    margin: 0;
  }
  .log ol {
    display: grid;
    gap: var(--s-1);
    margin: 0;
    padding: 0;
    list-style: none;
  }
  .log li {
    display: grid;
    grid-template-columns: 1.6rem minmax(0, 1fr);
    column-gap: var(--s-3);
    align-items: center;
    padding: var(--s-2) 0;
  }
  .log .n {
    grid-row: 1 / 3;
    width: auto;
    font-size: var(--text-sm);
  }
  .lp {
    overflow: hidden;
    color: var(--fg);
    font-weight: 500;
    white-space: nowrap;
    text-overflow: ellipsis;
  }
  .lt {
    overflow: hidden;
    color: var(--fg-muted);
    font-size: var(--text-xs);
    white-space: nowrap;
    text-overflow: ellipsis;
  }
  .tools {
    display: flex;
    flex-shrink: 0;
    gap: var(--s-1);
    margin-left: auto;
  }
  .rules {
    display: grid;
    gap: var(--s-4);
    margin: 0;
    padding: 0;
    list-style: none;
    counter-reset: rule;
  }
  .rules li {
    display: grid;
    grid-template-columns: 1.6rem minmax(0, 1fr);
    gap: 0.15rem var(--s-3);
    counter-increment: rule;
  }
  .rules li::before {
    content: counter(rule);
    grid-row: 1 / 3;
    color: var(--red-hot);
    font-family: var(--font-display);
    font-size: 1.25rem;
    line-height: 1.2;
  }
  .rules strong {
    color: var(--fg);
    font-weight: 600;
  }
  .rules span {
    color: var(--fg-muted);
    font-size: var(--text-sm);
    line-height: 1.5;
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
  }
</style>
