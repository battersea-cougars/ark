<script lang="ts">
  // One session, tournament or social, with In/Out ("Roster", picked 2026-10-07). The header says what and when, with
  // how soon it is and where you stand on the right. Below it, the question people bring to the card, who's going:
  // their faces and first names, the count and spaces left, and In and Out at the end of that row, so you answer
  // next to the people you'd be playing with. Every kind carries its own icon and colour (set by an admin per
  // training and tournament type), so the calendar reads at a glance. Nothing moves when you answer.
  import { goesByOf } from "./names";
  import type { Snippet } from "svelte";
  import type { Bookable } from "../demo/model";
  import { impersonating, me } from "../demo/session.svelte";
  import { answerFor } from "../app/backend.svelte";
  import Icon from "../app/shell/Icon.svelte";
  import { PLAYERS } from "../demo/data";
  import { dateBadge, formatTime, londonToday } from "./dates";
  import { initials } from "./initials";
  import { phone } from "./viewport.svelte";
  import { crossfade } from "svelte/transition";
  import { easeOut, prefersReducedMotion } from "../app/motion";

  let {
    event,
    canSignUp = true,
    feature = false,
    compact = false,
    onanswer,
    footer,
    beckon = false,
    roster = true,
    glance = false,
    link = false,
    place = true,
    links,
  }: {
    event: Bookable;
    canSignUp?: boolean;
    feature?: boolean;
    /** Calendar rows: the title links to its page, and the date gets a bar in the type's colour. */
    compact?: boolean;
    /** Called after a tap on In or Out with where the member ended up. */
    onanswer?: (status: "in" | "waitlist" | "out") => void;
    /** A link row along the bottom of the card (Home: where you stand, and the way to the teams). */
    footer?: Snippet;
    /** The session you're being asked about (Home's next one, a training's page): until you're in, In pulses once,
     * and again if you say out. */
    beckon?: boolean;
    /** Who's going and the count; off where the page lists them itself (a training's Who's in). */
    roster?: boolean;
    /** Home's lead: when on the right; the faces with in, out and spaces left in a line; In and Out a size up,
     * saying where you stand once pressed. No names, no place in the queue. */
    glance?: boolean;
    /** The whole card opens the event's page (its buttons and footer links still work on their own). */
    link?: boolean;
    /** Where it is; off where the page's header already says (a training's page). */
    place?: boolean;
    /** Quiet links under the title (Home: the place, opening the map, and Add to calendar). */
    links?: Snippet;
  } = $props();

  const KIND = { training: "Training", tournament: "Tournament", social: "Social" } as const;

  const entries = $derived(event.entries);
  const badge = $derived(dateBadge(event.startsAt));
  const id = $derived(me().id);
  // Viewing as someone is read-only (ADR 0024): you see their answer, you can't change it.
  const locked = $derived(impersonating());
  // Three answers and none: in (or waitlisted), out, or not said yet, when neither button is pressed.
  const inIt = $derived(entries.going.includes(id));
  const waiting = $derived(entries.waitlist.includes(id));
  const out = $derived(entries.out?.includes(id) ?? false);
  const full = $derived(event.capacity != null && entries.going.length >= event.capacity);

  // Who's going: the first five faces, in sign-up order, and first names (you first in both, when you're in)
  const nameOf = (pid: number) => goesByOf(PLAYERS.find((p) => p.id === pid));
  // Home's lead on a phone shows fewer, so the faces and counts stay on one line and the buttons never move
  const tight = $derived(glance && phone.current);
  const faces = $derived(
    (inIt ? [id, ...entries.going.filter((x) => x !== id)] : entries.going).slice(0, tight ? 3 : 5),
  );
  const others = $derived(entries.going.filter((x) => x !== id));
  const names = $derived(
    others
      .slice(0, 3)
      .map((x) => nameOf(x).split(" ")[0])
      .filter(Boolean),
  );
  const rest = $derived(others.length - names.length);
  // "You, Aman, Chris" (then "and 4 more", a link to the full list), and "7 / 21 in · 14 spaces · 2 waiting": built here, so a formatter can't eat a space
  const crowd = $derived([inIt ? "You" : "", ...names].filter(Boolean).join(", "));
  const spaces = $derived(event.capacity ? Math.max(0, event.capacity - entries.going.length) : null);
  const linked = $derived(link && !!event.href);
  const hours = $derived(
    event.timeText
      ? event.timeText
      : event.season
        ? "Day and time to be confirmed"
        : event.dateTbc
          ? "Date and time to be confirmed"
          : `${formatTime(event.startsAt)}–${formatTime(event.endsAt)}`,
  );
  const tally = $derived(
    [
      `${event.capacity ? ` / ${event.capacity}` : ""} in`,
      spaces === null ? "" : `${spaces} ${spaces === 1 ? "space" : "spaces"}`,
      entries.waitlist.length ? `${entries.waitlist.length} waiting` : "",
    ]
      .filter(Boolean)
      .join(" · "),
  );

  // How soon, in days on London's calendar: Today, Tomorrow, In 3 days, In 2 weeks
  const soon = $derived.by(() => {
    if (event.dateTbc || event.cancelled) return "";
    const day = (iso: string) => Date.parse(`${iso}T12:00:00Z`) / 86_400_000;
    const n = Math.round(day(londonToday(new Date(event.startsAt))) - day(londonToday()));
    if (n < 0) return "";
    return n === 0 ? "Today" : n === 1 ? "Tomorrow" : n < 14 ? `In ${n} days` : `In ${Math.floor(n / 7)} weeks`;
  });

  // Not in yet, whether unanswered or out: In pulses once to ask, and again if you say out
  const beckoning = $derived(beckon && canSignUp && event.signup && !inIt && !waiting && !locked);

  // Faces slide, never pop: each has a slot in its row (a translate, so the row's neighbours glide along when one
  // arrives), and yours travels from the in row to the out row and back when you change your answer. A face with
  // nowhere to come from or go to (the sixth sign-up dropping behind the +n) just fades where it is. Only on a
  // change, never as the card first shows
  const [send, receive] = crossfade({
    duration: prefersReducedMotion ? 0 : 420,
    easing: easeOut,
    fallback: () => ({
      duration: prefersReducedMotion ? 0 : 240,
      css: (t: number) => `opacity: ${t}`,
    }),
  });
  const STEP = 1.7; // rem: a face's width less its overlap
  const outIds = $derived(entries.out ?? []);
  const outFaces = $derived((out ? [id, ...outIds.filter((x) => x !== id)] : outIds).slice(0, tight ? 1 : 3));

  // The card answers at once; the server's word (in, or the waitlist) arrives with the refresh.
  function setIn(going: boolean) {
    if (locked) return;
    // Tapping the answer you've already given changes nothing: no call to the server, no new quip on Home
    if (going ? inIt || waiting : out) return;
    void answerFor(event.key, going ? "in" : "out");
    const wasIn = inIt;
    entries.going = entries.going.filter((x) => x !== id);
    entries.waitlist = entries.waitlist.filter((x) => x !== id);
    entries.out = (entries.out ?? []).filter((x) => x !== id);
    if (!going) {
      entries.out = [...entries.out, id];
      // Someone drops out: the first on the waitlist moves up.
      if (wasIn && entries.waitlist.length && event.capacity && entries.going.length < event.capacity) {
        entries.going = [...entries.going, entries.waitlist[0]];
        entries.waitlist = entries.waitlist.slice(1);
      }
      onanswer?.("out");
      return;
    }
    if (full) {
      entries.waitlist = [...entries.waitlist, id];
      onanswer?.("waitlist");
    } else {
      entries.going = [...entries.going, id];
      onanswer?.("in");
    }
  }
</script>

<!-- A row of faces, yours first, then +n for the rest. Each sits in its slot by a translate, so changes slide -->
{#snippet faceRow(ids: number[], total: number, kind: "in" | "out")}
  {@const items = [
    ...ids.map((pid) => ({ key: `${pid}`, pid })),
    ...(total > ids.length ? [{ key: `more-${kind}`, pid: 0 }] : []),
  ]}
  <span
    class="faces {kind}"
    class:empty={!items.length}
    aria-hidden="true"
    style:width="{items.length ? (items.length - 1) * STEP + 2 : 0}rem"
  >
    {#each items as it, i (it.key)}
      <span
        class:you={it.pid === id}
        class:more={!it.pid}
        class:num={!it.pid}
        style:translate="{i * STEP}rem 0"
        in:receive={{ key: it.key }}
        out:send={{ key: it.key }}>{it.pid ? initials(nameOf(it.pid)) : `+${total - ids.length}`}</span
      >
    {/each}
  </span>
{/snippet}

<article
  class="event panel glass {event.kind}"
  class:feature
  class:compact
  class:linked
  class:glance
  class:cancelled={event.cancelled}
  style:--tone="var(--tone-{event.tone})"
>
  <div class="top">
    <div class="date">
      {#if event.season}
        <!-- Just a season so far: the season over its year -->
        <span class="eyebrow">{event.season.name}</span>
        <span class="display day">'{String(event.season.year).slice(2)}</span>
        <span class="eyebrow">&nbsp;</span>
      {:else if event.dateTbc}
        <!-- Not confirmed: the date it has only decides where it sorts, so it isn't shown -->
        <span class="eyebrow">Date</span>
        <span class="display day">TBC</span>
        <span class="eyebrow">&nbsp;</span>
      {:else}
        <span class="eyebrow">{badge.weekday}</span>
        <span class="display day">{badge.day}</span>
        <span class="eyebrow">{badge.month}</span>
      {/if}
    </div>
    <!-- What matters first: which session (icon and name) and when. Where is a quiet second line. -->
    <div class="what">
      <div class="head">
        <span class="chip" title={KIND[event.kind]}><Icon name={event.icon} size={18} /></span>
        <h3>
          {#if linked}<a class="stretch" href={event.href}>{event.title}<Icon name="chevronRight" size={16} /></a
            >{:else if compact && event.href}<a href={event.href}>{event.title}</a>{:else}{event.title}{/if}
        </h3>
      </div>
      {#if links}<div class="links wide-links">{@render links()}</div>{/if}
      {#if glance}
        <!-- A phone: when goes under the title, so the card has no row just for it -->
        <p class="when phone-when">
          <span class="time num">{hours}</span>{#if soon}<span class="soon">{soon}</span>{/if}
          {#if links}<span class="links">{@render links()}</span>{/if}
        </p>
      {:else}
        <p class="when">
          <span class="time num">{hours}</span>
          {#if place && event.venue}<span class="venue"><Icon name="pin" size={13} />{event.venue}</span>{/if}
          {#if soon}<span class="soon">{soon}</span>{/if}
        </p>
      {/if}
    </div>
    <!-- How soon, and where you stand: a fixed slot, so answering swaps the badge in place -->
    <div class="side">
      <!-- At a glance, what a member checks first: have I answered, and how many are coming. The badge's slot is
           always filled, so it never appears from nowhere. -->
      {#if event.cancelled}
        <span class="badge">Cancelled</span>
      {:else if glance}
        <!-- Home's lead: when, on the right (under the title on a phone) -->
        <span class="time num">{hours}</span>
        {#if soon}<span class="soon">{soon}</span>{/if}
      {:else if event.signup}
        {#if inIt}<span class="badge green num">You're in · number {entries.going.indexOf(id) + 1}</span>
        {:else if waiting}<span class="badge amber num">Waitlist · number {entries.waitlist.indexOf(id) + 1}</span>
        {:else if out}<span class="badge red">You're out</span>
        {:else}<span class="badge">Not answered yet</span>{/if}
        {#if roster && !glance}<span class="tally num"><strong>{entries.going.length}</strong>{tally}</span>{/if}
      {/if}
    </div>
  </div>

  {#if event.signup}
    <!-- Two rows at every width: who's going, then your answer -->
    <div class="going">
      {#if glance}
        <!-- Who's coming, as faces, and the counts people check in one line beside them: in, out, places left (and
             the queue, once there is one) -->
        <div class="crowd">
          <span class="group">
            {@render faceRow(faces, entries.going.length, "in")}
            <span class="count in num"><strong>{entries.going.length}</strong> in</span>
          </span>
          <span class="group">
            {@render faceRow(outFaces, outIds.length, "out")}
            <span class="count out num"><strong>{outIds.length}</strong> out</span>
          </span>
          {#if spaces !== null}
            <span class="count num"
              ><strong>{spaces}</strong> {tight ? "" : spaces === 1 ? "space " : "spaces "}left</span
            >
          {/if}
          {#if entries.waitlist.length}
            <span class="count num"><strong>{entries.waitlist.length}</strong> waiting</span>
          {/if}
        </div>
      {:else if roster}
        <div class="crowd">
          {@render faceRow(faces, entries.going.length, "in")}
          <span class="who">
            {#if !entries.going.length}
              Nobody yet. First in, first on the list.
            {:else}
              {crowd}{#if rest > 0}&nbsp;{#if event.href}<a href={event.href}>and {rest} more</a>{:else}and {rest} more{/if}{/if}
            {/if}
          </span>
        </div>
      {/if}
      <div class="reply">
        {#if canSignUp}
          <div class="answer" role="group" aria-label="Are you in?">
            <button
              class="yes"
              class:beckon={beckoning && !out}
              class:beckon-again={beckoning && out}
              aria-pressed={inIt || waiting}
              disabled={locked}
              onclick={() => setIn(true)}
            >
              {#if inIt}<Icon name="check" size={glance ? 18 : 16} />{/if}
              {#if glance}{inIt ? "I'm in" : waiting ? "On the waitlist" : full ? "Join waitlist" : "In"}
              {:else}{waiting ? "Waitlist" : full && !inIt ? "Join waitlist" : "In"}{/if}
            </button>
            <button class="no" aria-pressed={out} disabled={locked} onclick={() => setIn(false)}>
              {#if out}<Icon name="x" size={glance ? 18 : 16} />{/if}{glance && out ? "I'm out" : "Out"}
            </button>
          </div>
        {/if}
      </div>
    </div>
  {/if}
  {#if footer}<div class="foot">{@render footer()}</div>{/if}
</article>

<style>
  /* The card is a container, so it lays itself out by its own width: a phone, a calendar row, a wide desktop */
  .event {
    container-type: inline-size;
    display: grid;
    /* The column is the card's width, never its content's: nothing inside can push past the edge */
    grid-template-columns: minmax(0, 1fr);
    gap: var(--s-5);
    padding: var(--s-5) var(--s-6);
  }
  .event.cancelled {
    opacity: 0.55;
  }
  .event.cancelled h3 {
    text-decoration: line-through;
  }
  .event.feature {
    border-color: var(--border-strong);
    background: var(--panel-bg);
  }
  .feature h3 {
    font-size: var(--text-lg);
  }

  /* ─── Header: date, what and when, how soon and your status ─── */
  .top {
    display: flex;
    align-items: flex-start;
    gap: var(--s-4);
  }
  .date {
    position: relative;
    display: grid;
    justify-items: center;
    gap: 0.1rem;
    min-width: 3.25rem;
    padding-right: var(--s-4);
    border-right: 1px solid var(--border);
    text-align: center;
  }
  .day {
    font-size: 1.9rem;
    color: var(--fg);
  }
  /* Calendar rows: the divider beside the date takes the type's colour, so a month reads at a glance */
  .compact .date {
    border-right-color: transparent;
  }
  .compact .date::after {
    content: "";
    position: absolute;
    top: 0.2rem;
    bottom: 0.2rem;
    right: -1px;
    width: 2px;
    border-radius: 2px;
    background: var(--tone);
    box-shadow: 0 0 10px color-mix(in srgb, var(--tone) 55%, transparent);
  }
  .what {
    flex: 1;
    display: grid;
    gap: var(--s-2);
    min-width: 0;
  }
  .head {
    display: flex;
    align-items: center;
    gap: var(--s-3);
  }
  /* The type's icon in its colour */
  .chip {
    display: grid;
    place-items: center;
    flex: none;
    width: 2rem;
    height: 2rem;
    border-radius: var(--r-sm);
    background: color-mix(in srgb, var(--tone) 16%, transparent);
    color: var(--tone);
  }
  h3 {
    min-width: 0;
    font-size: var(--text-md);
    font-weight: 600;
    line-height: 1.2;
    color: var(--fg);
  }
  .compact h3 a:hover {
    text-decoration: underline;
    text-underline-offset: 3px;
  }
  /* A card that opens its page: the title's link covers the card, and what you can tap inside sits above it */
  .event.linked {
    position: relative;
    transition:
      background-color var(--t) var(--ease-in-out),
      border-color var(--t) var(--ease-in-out),
      box-shadow var(--t) var(--ease-in-out);
  }
  /* Hovered: glass. A sheen down from the lit top edge over a breath of the club's red, the edge catching it */
  /* Anywhere on the card, the place and calendar links too; not over In and Out, which do their own thing */
  .event.linked:hover:not(:has(.answer:hover)) {
    border-color: color-mix(in srgb, var(--red) 22%, var(--border-strong));
    background:
      linear-gradient(180deg, rgb(255 255 255 / 0.06), rgb(255 255 255 / 0.01) 55%, transparent),
      color-mix(in srgb, var(--red) 3%, var(--panel-bg));
    backdrop-filter: var(--blur);
    -webkit-backdrop-filter: var(--blur);
    box-shadow: inset 0 1px 0 rgb(255 255 255 / 0.12);
  }
  /* Inline, so a title that wraps keeps its arrow after the last word */
  .stretch :global(svg) {
    display: inline-block;
    margin-left: var(--s-1);
    color: var(--fg-subtle);
    vertical-align: -0.1em;
  }
  .stretch::after {
    content: "";
    position: absolute;
    inset: 0;
    border-radius: inherit;
  }
  .linked .answer,
  .linked .foot {
    position: relative;
    z-index: 1;
  }
  .when {
    display: flex;
    flex-wrap: wrap;
    align-items: baseline;
    gap: 0.15rem var(--s-3);
  }
  .time {
    font-size: var(--text-md);
    font-weight: 500;
    color: var(--fg);
  }
  .venue {
    display: inline-flex;
    align-items: center;
    gap: var(--s-1);
    font-size: var(--text-xs);
    color: var(--fg-subtle);
  }
  .side {
    display: grid;
    justify-items: end;
    gap: var(--s-2);
    flex-shrink: 0;
    text-align: right;
  }
  /* Your answer: the first thing on the card to read, so a size up from an ordinary badge */
  .side .badge {
    height: 1.875rem;
    padding: 0 var(--s-3);
    font-size: var(--text-sm);
  }
  /* How soon: the time's size, muted, on the time's baseline */
  .soon {
    color: var(--fg-muted);
    font-size: var(--text-md);
    font-weight: 500;
    white-space: nowrap;
  }
  .reply {
    display: flex;
  }

  /* ─── Who's going, and your answer at the end of the row ─── */
  /* Two rows, at every width: who's going (faces, names, the count), then your answer. No box of its own: the
     card is the box. */
  .going {
    display: grid;
    gap: var(--s-4);
  }
  /* As tall as the faces even when there are none, so the first sign-up doesn't push the buttons down */
  .crowd {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--s-2) var(--s-3);
    min-height: 2rem;
  }
  /* Faces overlap a little, each placed in its slot (see faceRow), later ones on top, the +n last of all */
  .faces {
    position: relative;
    flex-shrink: 0;
    height: 2rem;
    transition: width var(--t) var(--ease);
  }
  .faces > span {
    position: absolute;
    top: 0;
    left: 0;
    display: grid;
    place-items: center;
    width: 2rem;
    height: 2rem;
    border-radius: 50%;
    background: var(--surface-3);
    box-shadow: 0 0 0 2px var(--surface-1);
    color: var(--fg-muted);
    font-size: 0.6875rem;
    font-weight: 700;
    letter-spacing: 0.02em;
    transition: translate 420ms var(--ease);
  }
  .faces > .you {
    background: color-mix(in srgb, var(--green) 30%, var(--surface-1));
    color: var(--fg);
  }
  .faces > .more {
    background: var(--surface-2);
    color: var(--fg-subtle);
  }
  /* Out: quieter faces, their initials in the club's red */
  .faces.out > span {
    background: var(--surface-2);
    color: var(--red-ink);
  }
  .faces.out > .you {
    background: color-mix(in srgb, var(--red) 28%, var(--surface-1));
    color: var(--fg);
  }
  .faces.out > .more {
    color: var(--fg-subtle);
  }
  /* A row of faces with its count beside it, kept together when the line wraps */
  .group {
    display: inline-flex;
    align-items: center;
    gap: var(--s-2);
  }
  .group .faces.empty {
    margin-right: calc(-1 * var(--s-2));
  }
  .count {
    color: var(--fg-muted);
    font-size: var(--text-sm);
    white-space: nowrap;
  }
  .count strong {
    color: var(--fg);
    font-weight: 600;
  }
  /* In and Out in their accents, as on the buttons: colour in the words, never a fill */
  .count.in {
    color: var(--green-ink);
  }
  .count.out {
    color: var(--red-ink);
  }
  .count:is(.in, .out) strong {
    color: inherit;
  }
  .who {
    flex: 1 1 10rem;
    min-width: 0;
    overflow: hidden;
    color: var(--fg-muted);
    font-size: var(--text-sm);
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .who a {
    color: var(--fg);
    font-weight: 500;
    text-decoration: underline;
    text-decoration-color: color-mix(in srgb, var(--fg) 35%, transparent);
    text-underline-offset: 3px;
    transition: text-decoration-color var(--t-fast) var(--ease-in-out);
  }
  .who a:hover {
    text-decoration-color: currentColor;
  }
  /* Home's lead: In and Out a size up, the one thing to do here */
  /* Home's lead: a little more room inside than other cards */
  .event.glance {
    padding: var(--s-6);
  }
  .glance .crowd {
    column-gap: var(--s-5);
  }
  .glance .side {
    gap: var(--s-1);
  }
  .glance .answer {
    width: min(100%, 22rem);
  }
  /* Under the title: the place and Add to calendar, quiet links apart by space alone */
  .links {
    display: flex;
    flex-wrap: wrap;
    gap: var(--s-1) var(--s-5);
  }
  .links :global(:is(a, button)) {
    position: relative;
    z-index: 1;
    display: inline-flex;
    align-items: center;
    gap: var(--s-2);
    min-height: 2rem;
    padding: 0;
    border: 0;
    background: none;
    color: var(--fg-muted);
    font-size: var(--text-sm);
    transition: color var(--t-fast) var(--ease-in-out);
  }
  .links :global(:is(a, button):hover) {
    color: var(--fg);
  }
  .glance .answer > button {
    min-height: 3rem;
    font-size: var(--text-md);
  }
  .tally {
    color: var(--fg-muted);
    font-size: var(--text-sm);
    white-space: nowrap;
  }
  .tally strong {
    color: var(--fg);
    font-family: var(--font-display);
    font-size: 1.35rem;
    font-weight: 400;
    line-height: 1;
    margin-right: 0.1em;
  }
  /* Two compact tiles, the same before and after you answer: a light fill until pressed, then In lights up green
     with a tick, Out goes red with a cross. Fixed widths, so the label changing never moves them. */
  /* The second row: two compact tiles on the left, under the faces */
  .answer {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: var(--s-2);
    width: min(100%, 18rem);
  }
  .answer > button {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: var(--s-1);
    min-width: 6.5rem;
    min-height: 2.5rem;
    padding: 0 var(--s-3);
    border: 0;
    border-radius: var(--r-md);
    background: color-mix(in srgb, var(--fg) 10%, transparent);
    color: var(--fg);
    font-size: var(--text-sm);
    font-weight: 600;
    white-space: nowrap;
    transition: background-color var(--t-fast) var(--ease-in-out);
  }
  .answer > button:hover:not(:disabled):not([aria-pressed="true"]) {
    background: color-mix(in srgb, var(--fg) 16%, transparent);
  }
  .answer > button:disabled {
    cursor: not-allowed;
    opacity: 0.6;
  }
  .answer > .yes[aria-pressed="true"] {
    background: color-mix(in srgb, var(--green) 18%, transparent);
    color: var(--green-ink);
  }
  /* Out, chosen: the mirror of In, in the club's red, so it can't be mistaken for "not answered yet" */
  .answer > .no[aria-pressed="true"] {
    background: color-mix(in srgb, var(--red) 24%, transparent);
    color: var(--red-ink);
  }
  /* The session you're asked about, while you're not in: In pulses once, a soft ring. A shadow, so nothing moves. */
  .answer > .yes.beckon,
  .answer > .yes.beckon-again {
    animation: beckon 1.2s var(--beckon-delay, 300ms) var(--ease-in-out) 1 both;
  }
  @keyframes beckon {
    0%,
    100% {
      box-shadow: 0 0 0 0 color-mix(in srgb, var(--green) 0%, transparent);
    }
    50% {
      box-shadow: 0 0 0 5px color-mix(in srgb, var(--green) 28%, transparent);
      background: color-mix(in srgb, var(--green) 14%, color-mix(in srgb, var(--fg) 10%, transparent));
    }
  }
  @media (prefers-reduced-motion: reduce) {
    .answer > .yes.beckon,
    .answer > .yes.beckon-again {
      animation: none;
    }
  }
  .foot {
    margin: 0 calc(-1 * var(--s-6)) calc(-1 * var(--s-5));
    border-top: 1px solid var(--border);
  }

  /* ─── Narrow (a phone, a calendar row on a phone): your answer and the count drop to a row of their own under the
     title, so the title keeps the width; the names drop under the faces, the buttons fill the row ─── */
  .phone-when {
    display: none;
  }
  @container (max-width: 34rem) {
    /* Home's lead on a phone: when under the title, a size down (how soon dropped), with the place and the calendar as icons at the
       end of its row; the faces and counts on one line */
    .glance .wide-links,
    .glance .side {
      display: none;
    }
    .glance .phone-when {
      display: flex;
      flex-wrap: nowrap;
      align-items: center;
      column-gap: var(--s-2);
    }
    .glance .phone-when .time {
      font-size: var(--text-sm);
    }
    /* No room for how soon beside the icons: the date says it */
    .glance .phone-when .soon {
      display: none;
    }
    .glance .phone-when .links {
      flex-wrap: nowrap;
      gap: 0;
      margin-left: auto;
    }
    .glance .crowd {
      flex-wrap: nowrap;
      column-gap: var(--s-4);
      overflow: hidden;
    }
    /* Home's links under the title: icons only, so the header stays short */
    .links :global(.label) {
      position: absolute;
      width: 1px;
      height: 1px;
      overflow: hidden;
      clip-path: inset(50%);
      white-space: nowrap;
    }
    .links :global(:is(a, button)) {
      justify-content: center;
      min-width: 2rem;
    }
    .top {
      flex-wrap: wrap;
      row-gap: var(--s-4);
    }
    .side {
      display: flex;
      flex-basis: 100%;
      align-items: center;
      justify-content: space-between;
      text-align: left;
    }
    .side:not(:has(*)) {
      display: none;
    }
    /* Home's lead has no place on its line, so how soon still fits */
    .event:not(.glance) .soon {
      display: none;
    }
    .who {
      flex-basis: calc(100% - 11rem);
    }
    .answer {
      width: 100%;
    }
    .answer > button {
      min-width: 0;
    }
  }
  /* The card's own padding can't follow its container (a container query only reaches what's inside), so a phone
     sets it */
  @media (max-width: 600px) {
    .event {
      padding: var(--s-4) var(--s-4) var(--s-5);
    }
    .foot {
      margin: 0 calc(-1 * var(--s-4)) calc(-1 * var(--s-5));
    }
    .event.glance {
      padding: var(--s-5) var(--s-4);
    }
  }
</style>
