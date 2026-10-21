<script lang="ts">
  // Where a tournament's draft stands, on its landing page: its date up front, as the event card has it, then that
  // it's coming, on, or closed, and its captains as discs in their teams' colours. Its captains and whoever runs it get
  // a way in, and a captain hears when it's their pick. Everyone else just hears the news: the draft itself is the
  // captains' business (ADR 0060). Closed is loud: the teams are set, and that's the way to them.
  import { goesBy } from "./names";
  import { initials } from "./initials";
  import { teamTone } from "./team-tones";
  import { can } from "../access/actions";
  import { PLAYERS } from "../demo/data";
  import type { Tournament, TournamentType } from "../demo/model";
  import { granted, me } from "../demo/session.svelte";
  import Icon from "../app/shell/Icon.svelte";
  import { dateBadge, formatDayDate, londonISO } from "./dates";
  import { draftTurn } from "./draft";
  import { editTournament } from "./TournamentEditorPanel.svelte";

  let { type, tournament }: { type: TournamentType; tournament: Tournament } = $props();

  const perms = $derived(granted());
  const teams = $derived(tournament.teams);
  const mine = $derived(teams.findIndex((t) => t.captainMemberId === me().id));
  const running = $derived(can(perms, "run:Draft"));
  const inside = $derived(mine >= 0 || running);
  const state = $derived(tournament.draftState);
  const turn = $derived(draftTurn(tournament, mine));
  // The captains, in pick order once the draft's opened and drawn it (before then, in no order): a disc each, in their team's colour (the same as its crest below)
  const captains = $derived(
    teams.map((t, i) => {
      const p = PLAYERS.find((p) => p.id === t.captainMemberId);
      const name = p ? goesBy(p) : "To be named";
      return { key: t.id ?? i, name, initials: p ? initials(name) : "?", tone: teamTone(i), you: i === mine };
    }),
  );
  const when = $derived(tournament.draftOn ? formatDayDate(londonISO(tournament.draftOn, "12:00")) : "");

  const badge = $derived(tournament.draftOn ? dateBadge(londonISO(tournament.draftOn, "12:00")) : null);

  // The headline, a line under it if there's more to say, and the badge: in words, so nobody needs the colour
  const view = $derived.by(() => {
    // No captains yet: the draft's day still leads (or TBC), and that the captains are still to come
    if (!teams.length)
      return { title: when ? `Draft ${when}` : "Draft date TBC", sub: "Captains to be named.", badge: "" };
    if (state === "open") {
      if (mine >= 0 && turn.left && turn.until === 0)
        return { title: "It's your pick", sub: "You're on the clock. Don't keep them waiting.", badge: "Live" };
      if (mine >= 0 && turn.left)
        return {
          title: "The draft is on",
          sub: turn.until < Infinity ? `You pick in ${turn.until}.` : "Your picks are done.",
          badge: "Live",
        };
      if (!turn.left && inside)
        return { title: "Everyone's picked", sub: "It closes to set the teams.", badge: "Live" };
      return {
        title: "The draft is on",
        sub: inside ? `${turn.picks} picked, ${turn.left} to go.` : "The teams are out when they're done.",
        badge: "Live",
      };
    }
    return {
      title: when ? `Draft ${when}` : "Draft date TBC",
      // The order means nothing until the draft opens and draws it (ADR 0060)
      sub: "Order drawn when the draft starts.",
      badge: "",
    };
  });
  // Your pick: the way in takes the accent, like End turn; otherwise it's a quiet outline on the card
  const yours = $derived(state === "open" && mine >= 0 && turn.left > 0 && turn.until === 0);
</script>

{#if state === "closed"}
  <!-- Closed: the teams are set, and it says so -->
  <a class="draft panel glass closed" href="/tournaments/{type.slug}/teams">
    <span class="stamp display">Closed</span>
    <span class="text">
      <span class="shout display">The draft is done</span>
      {@render discs()}
    </span>
    <span class="see">See the teams<Icon name="chevronRight" size={16} /></span>
  </a>
{:else}
  <div class="draft panel glass">
    <!-- The draft's date, as the event card shows one -->
    <div class="date">
      {#if badge}
        <span class="eyebrow">{badge.weekday}</span>
        <span class="display day">{badge.day}</span>
        <span class="eyebrow">{badge.month}</span>
      {:else}
        <span class="eyebrow">Date</span>
        <span class="display day">TBC</span>
        <span class="eyebrow">&nbsp;</span>
      {/if}
    </div>
    <div class="text">
      <p class="title">
        {view.title}
        {#if view.badge === "Live"}<span class="badge red live">Live</span>
        {:else if view.badge}<span class="badge">{view.badge}</span>{/if}
      </p>
      {#if view.sub}<p class="sub">{view.sub}</p>{/if}
      {@render discs()}
    </div>
    {#if inside && teams.length && state !== "none"}
      <a class="btn sm" class:outline={!yours} class:primary={yours} href="/tournaments/{type.slug}/draft"
        >Go to the draft</a
      >
    {:else if !teams.length && can(perms, "manage:Tournament")}
      <button class="btn sm outline" onclick={() => editTournament(tournament.id, { tab: "teams" })}
        >Add the captains</button
      >
    {/if}
  </div>
{/if}

<!-- The captains: initials in a disc, the name on hover and for a screen reader -->
{#snippet discs()}
  {#if captains.length}
    <span class="captains" role="list" aria-label="Captains">
      {#each captains as c (c.key)}
        <span class="captain" class:you={c.you} role="listitem" title={c.name} aria-label={c.name} style:--tone={c.tone}
          >{c.initials}</span
        >
      {/each}
    </span>
  {/if}
{/snippet}

<style>
  .draft {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--s-3) var(--s-5);
    padding: var(--s-5) var(--s-6);
    color: var(--fg-muted);
  }
  /* The date, as the event card has it: weekday, day, month, a rule beside it */
  .date {
    display: grid;
    justify-items: center;
    gap: 0.1rem;
    min-width: 3.25rem;
    padding-right: var(--s-4);
    border-right: 1px solid var(--border);
    text-align: center;
  }
  .day {
    color: var(--fg);
    font-size: 1.9rem;
  }
  /* Closed: a stamp and a shout */
  .closed {
    color: var(--fg-muted);
    border-color: var(--border-strong);
  }
  .closed:hover {
    background: var(--surface-2);
  }
  .stamp {
    padding: 0.35rem 0.8rem 0.25rem;
    border: 3px solid var(--fg);
    border-radius: var(--r-sm);
    color: var(--fg);
    font-size: 1.6rem;
    letter-spacing: 0.08em;
    rotate: -6deg;
  }
  .shout {
    color: var(--fg);
    font-size: clamp(1.6rem, 4vw, 2.2rem);
    font-style: italic;
  }
  .see {
    display: inline-flex;
    align-items: center;
    gap: var(--s-1);
    font-size: var(--text-sm);
  }
  .closed:hover .see {
    color: var(--fg);
  }
  .text {
    display: grid;
    align-content: center;
    flex: 1;
    gap: 0.15rem;
    min-width: 12rem;
  }
  .title {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--s-2);
    margin: 0;
    color: var(--fg);
    font-weight: 600;
  }
  .sub {
    margin: 0;
    font-size: var(--text-sm);
  }
  .captains {
    display: flex;
    flex-wrap: wrap;
    gap: var(--s-2);
    margin-top: var(--s-2);
  }
  /* A disc per captain, in their team's colour, as the crests are: tinted, the initials in the colour */
  .captain {
    display: grid;
    place-items: center;
    width: 2.25rem;
    height: 2.25rem;
    border-radius: var(--r-pill);
    background: color-mix(in srgb, var(--tone) 18%, var(--surface-2));
    color: var(--tone);
    font-size: var(--text-xs);
    font-weight: 700;
    letter-spacing: 0.02em;
  }
  /* You: a ring, so it doesn't rest on the colour */
  .captain.you {
    box-shadow: 0 0 0 2px var(--fg);
  }
</style>
