<script lang="ts">
  // Home (ADR 0118): a slim hello with the Calendar's button, the locker room (the club's announcements, then what
  // you owe), then the calls to action (this Friday's card, always; are you in for the Kumite; your next fight), then
  // the feed: what needs you now, what's coming up, and for admins their own lines at the foot.
  import { untrack } from "svelte";
  import { shortName, shortNameOf } from "../lib/names";
  import { can } from "../access/actions";
  import { PLAYERS } from "../demo/data";
  import { chargesFor, owedBy } from "../demo/dues.svelte";
  import { granted, me } from "../demo/session.svelte";
  import { db } from "../demo/store.svelte";
  import Icon from "../app/shell/Icon.svelte";
  import mark from "../assets/cougars-mark.webp";
  import type { IconName } from "../app/shell/icons";
  import EventCard from "../lib/EventCard.svelte";
  import NextFight from "../lib/NextFight.svelte";
  import { formatDayDate, londonToday } from "../lib/dates";
  import { aged, leftOn } from "../lib/dues";
  import { signupOpen } from "../lib/signup";
  import { homeFeed, owedNotice, type UpcomingEvent, type When } from "../lib/home-feed";
  import DateBlock from "../lib/DateBlock.svelte";
  import { fill, slot } from "../lib/greetings";
  import {
    calendar,
    latestTournament,
    nextSession,
    sessionBookable,
    tournamentBookable,
  } from "../demo/schedule.svelte";
  import { pick, type Quip, type QuipKind } from "../lib/quips";
  import type { Bookable, Tournament } from "../demo/model";
  import { prefersReducedMotion } from "../app/motion";
  import { editionState } from "../lib/edition";
  import { checkForUpdates } from "../lib/live-updates.svelte";
  import Sheet from "../lib/Sheet.svelte";
  import DateField from "../lib/DateField.svelte";
  import { dismissAnnouncement, postAnnouncement, removeAnnouncement } from "../app/backend.svelte";
  import { askToNotify, mayAskToNotify } from "../app/native";
  import { slide } from "svelte/transition";

  // Who's in, out and waiting, live (ADR 0072): someone answering shows on the cards without a refresh
  $effect(() => checkForUpdates(["sessions", "tournaments"], { steady: true }));

  const perms = $derived(granted());
  const who = $derived(me());
  const today = londonToday();

  // Announcements (#85): an admin's note at the top, until its last day or until you say "Got it". Whoever may post
  // writes one in a sheet over Home (ADR 0065), from the + in the header, and can take one down from its note
  const poster = $derived(can(perms, "post:Announcement"));
  // "Got it": the button says so (a tick), then the note folds away, the page below closing up smoothly behind it
  let got = $state<Record<number, boolean>>({});
  function gotIt(id: number) {
    if (got[id]) return;
    got[id] = true;
    // Didn't reach the club: it's back (the club's read again), and so is the button
    setTimeout(
      () => dismissAnnouncement(id).then((r) => r === null && (got[id] = false)),
      prefersReducedMotion ? 0 : 650,
    );
  }
  // Past announcements stay a tap away once there have been some here, even after you've got the last one
  let hadNotes = $state(false);
  $effect(() => {
    if (db.announcements.length) hadNotes = true;
  });
  let announcing = $state(false);
  const inAWeek = () => new Date(Date.parse(`${londonToday()}T12:00:00Z`) + 7 * 86_400_000).toISOString().slice(0, 10);
  let note = $state({ title: "", body: "", link: "", endsOn: inAWeek() });
  async function announce(e: SubmitEvent) {
    e.preventDefault();
    if (await postAnnouncement(note)) {
      announcing = false;
      note = { title: "", body: "", link: "", endsOn: inAWeek() };
    }
  }

  // In the store app (ADR 0108): say what notifications are for before the phone asks, once; "Not now" is remembered.
  // It's an item in the feed, under the calls to action
  const NOT_NOW = "cougars.notify.not-now";
  let askNotify = $state(false);
  mayAskToNotify()
    .then((may) => (askNotify = may && !saidNotNow()))
    .catch(() => {});
  function saidNotNow() {
    try {
      return localStorage.getItem(NOT_NOW) === "1";
    } catch {
      return false;
    }
  }
  async function turnOnNotifications() {
    await askToNotify().catch(() => false);
    askNotify = false;
  }
  function notNow() {
    try {
      localStorage.setItem(NOT_NOW, "1");
    } catch {
      // A private window: it asks again next time
    }
    askNotify = false;
  }

  // What you owe (ADR 0007): a notice in the locker room, after the club's, with Settle up opening your tab; it
  // stays while you owe anything, and there's none when you're square
  const owing = $derived(
    owedNotice({
      pence: owedBy(who.id),
      kinds: chargesFor(who.id)
        .filter((c) => leftOn(c) > 0)
        .map((c) => c.kind),
    }),
  );

  // The soonest session of any training leads Home; the other trainings' next sessions go in the feed
  const nexts = $derived(
    db.series
      .filter((s) => s.active)
      .flatMap((series) => {
        const session = nextSession(series);
        return session ? [{ series, session, at: sessionBookable(session).startsAt }] : [];
      })
      .sort((a, b) => a.at.localeCompare(b.at)),
  );
  const series = $derived(nexts[0]?.series);
  const session = $derived(nexts[0]?.session);
  const booking = $derived(session && sessionBookable(session));
  const next = $derived(
    session ?? { id: 0, going: [] as number[], waitlist: [] as number[], out: undefined as number[] | undefined },
  );
  const day = $derived(series?.shortName ?? "week");
  // The next of each tournament series, not one that's done (by its games, lib/edition.ts)
  const tournaments = $derived(
    db.tournamentTypes
      .filter((t) => t.active)
      .flatMap((type) => {
        const t = latestTournament(type.id);
        return t && editionState(t) !== "done" ? [{ type, t }] : [];
      }),
  );
  // Taking sign-ups: a call to action up top, like Friday. The rest are in what's coming up
  const signingUp = $derived(tournaments.filter(({ t }) => signupOpen(t, today)));

  const isIn = $derived(next.going.includes(who.id));
  const waiting = $derived(next.waitlist.includes(who.id));
  const declined = $derived(next.out?.includes(who.id) ?? false);
  const answered = $derived(isIn || waiting || declined);
  // Out since the teams were made: still on one until a team maker decides (ADR 0076), but not yours to play on
  const myTeam = $derived(isIn ? db.teams[next.id]?.find((t) => t.players.includes(who.id)) : undefined);

  // Where you stand on an event: in, waiting, out, or not said
  const standingOn = (ev: Bookable) =>
    ev.entries.going.includes(who.id)
      ? "in"
      : ev.entries.waitlist.includes(who.id)
        ? "waitlist"
        : ev.entries.out?.includes(who.id)
          ? "out"
          : null;
  // Friday's card is always there, answered or not. A tournament's call to action stays a full card while it's
  // unanswered; one you'd already answered when you came is its row in what's coming up ("You're in"), so the asks
  // still open stand out. Answering here keeps the card for the rest of the visit: nothing jumps under your thumb
  // (no-layout-shift)
  let asked = $state<Record<string, boolean>>({});
  $effect(() => {
    const open = signingUp.map(({ t }) => tournamentBookable(t)).filter((ev) => !standingOn(ev));
    untrack(() => {
      for (const ev of open) if (!asked[ev.key]) asked[ev.key] = true;
    });
  });
  const askFull = (ev: Bookable) => !standingOn(ev) || !!asked[ev.key];

  // What's coming up, for the feed to pick from: everything on the club's agenda from today (not its reminders: a
  // draft night or a sign-up closing is in what needs you now), and each tournament series' next one, however far
  const upcomingEvent = (ev: Bookable): UpcomingEvent => {
    const standing = standingOn(ev);
    return {
      ...ev,
      standing,
      asking: !standing && ev.signup && !ev.cancelled && can(perms, "signup:Event"),
      signupOpensOn: ev.kind === "tournament" ? (ev.entries as Tournament).signupOpensOn : null,
    };
  };
  const events = $derived.by(() => {
    const all = [...calendar(today).filter((ev) => /^(session|tournament|oneoff):/.test(ev.key))];
    for (const { t } of tournaments) {
      const ev = tournamentBookable(t);
      if (!all.some((x) => x.key === ev.key)) all.push(ev);
    }
    return all.map(upcomingEvent);
  });
  // The cards up top: not repeated below
  const shown = $derived([
    ...(booking ? [booking.key] : []),
    ...signingUp
      .map(({ t }) => tournamentBookable(t))
      .filter(askFull)
      .map((ev) => ev.key),
  ]);

  // What the club is owed, for whoever sees Unpaid fees (read:Dues): the total, by how many, and how much of it is
  // in the worst bucket (over 90 days)
  const club = $derived.by(() => {
    if (!can(perms, "read:Dues")) return null;
    const rows = aged(db.charges, today);
    return {
      total: rows.reduce((s, r) => s + r.total, 0),
      people: rows.length,
      worst: rows.reduce((s, r) => s + r.amounts[3], 0),
    };
  });
  // The feed (lib/home-feed.ts): what needs you now, what's coming up, the admins' lines
  const feed = $derived(
    homeFeed({
      me: who.id,
      today,
      runsDrafts: can(perms, "run:Draft"),
      agenda: db.agenda,
      tournaments: db.tournaments,
      types: db.tournamentTypes,
      upcoming: tournaments,
      club,
      events,
      shown,
    }),
  );

  // Picked once per visit, from the time of day, a training night, or how often you've looked today. The count
  // is this device's only: a bit of fun, not a record.
  const VISITS_KEY = "team.home.visits";
  const visits = countVisit();
  function countVisit(): number {
    try {
      const saved = JSON.parse(localStorage.getItem(VISITS_KEY) ?? "null") as { day: string; n: number } | null;
      const n = saved?.day === today ? saved.n + 1 : 1;
      localStorage.setItem(VISITS_KEY, JSON.stringify({ day: today, n }));
      return n;
    } catch {
      return 1; // Private mode: no count, no nagging
    }
  }
  const roll = Math.random();
  const hello = $derived.by(() => {
    const set = lines(slot(new Date(), nexts[0]?.session.heldOn === londonToday(), visits));
    const line = set[Math.floor(roll * set.length)]?.text ?? "{name}";
    return fill(line, { name: shortName(who), visits, day: series?.shortName ?? "training night" });
  });

  // The locker room has a word for you until you answer, and another once you have.
  // Admins write the lines (Settings → Quips). One of each is picked per visit, so coming back after answering
  // still has a word for you, and it doesn't change under you.
  const lines = (kind: QuipKind) => db.quips.filter((q) => q.kind === kind && q.text.trim());
  const standing = {
    ask: pick(lines("ask")),
    in: pick(lines("in")),
    waitlist: pick(lines("waitlist")),
    out: pick(lines("out")),
  };
  let said: Quip | undefined = $state();
  const quip = $derived(
    said ?? (isIn ? standing.in : waiting ? standing.waitlist : declined ? standing.out : standing.ask),
  );
  function onanswer(status: "in" | "waitlist" | "out") {
    said = pick(lines(status));
  }
  // The message types itself out, a letter at a time, each time it changes.
  let typed = $state("");
  $effect(() => {
    const text = quip?.text ?? "";
    if (prefersReducedMotion) {
      typed = text;
      return;
    }
    typed = "";
    let i = 0;
    const timer = setInterval(() => {
      i += 1;
      typed = text.slice(0, i);
      if (i >= text.length) clearInterval(timer);
    }, 34);
    return () => clearInterval(timer);
  });
  const teammates = (ids: number[]) =>
    ids
      .filter((id) => id !== who.id)
      .slice(0, 3)
      .map((id) => shortNameOf(PLAYERS.find((p) => p.id === id)))
      .join(", ");
</script>

<!-- Under a card's title: the place, opening the map. Add to calendar (lib/ics.ts) is off for now -->
{#snippet placeLinks(ev: Bookable)}
  {#if ev.mapUrl}
    <a href={ev.mapUrl} target="_blank" rel="noopener noreferrer" aria-label="Directions to {ev.venue || 'the venue'}">
      <Icon name="pin" size={16} /><span class="label">{ev.venue || "Directions"}</span>
    </a>
  {/if}
{/snippet}

<!-- Once the teams are out, yours: along the foot of the lead card -->
{#snippet teamLine()}
  {#if myTeam && series}
    <a class="status" href="/training/{series.slug}">
      <Icon name="teams" size={18} />
      <span class="grow">You're on <strong>{myTeam.name}</strong> with {teammates(myTeam.players)}</span>
      <Icon name="chevronRight" size={18} />
    </a>
  {/if}
{/snippet}

<!-- One line of the feed: an icon, a line, a sub-line, and a chevron when it opens something -->
{#snippet item(o: { key?: string; href?: string; icon: IconName; text: string; sub: string; hot?: boolean; on?: When })}
  {#if o.href}
    <a class="item rise" class:hot={o.hot} class:dated={o.on} href={o.href}>
      {#if o.on}{@render when(o.on)}{:else}<span class="lead-col"><Icon name={o.icon} size={18} /></span>{/if}
      <span class="grow"><span class="item-text">{o.text}</span><span class="item-sub">{o.sub}</span></span>
      <Icon name="chevronRight" size={16} />
    </a>
  {:else}
    <!-- Just news: nothing to open -->
    <div class="item rise" class:dated={o.on} role="status">
      {#if o.on}{@render when(o.on)}{:else}<span class="lead-col"><Icon name={o.icon} size={18} /></span>{/if}
      <span class="grow"><span class="item-text">{o.text}</span><span class="item-sub">{o.sub}</span></span>
      <span class="badge red live">Live</span>
    </div>
  {/if}
{/snippet}

<!-- A row's date: the lead card's stacked block (lib/DateBlock), a size down, in a fixed column so every row's lines
     up; the screen reader hears it in the row's words -->
{#snippet when(on: When)}
  <span class="when" aria-hidden="true"><DateBlock at={on.at} season={on.season} tbc={on.tbc} small /></span>
{/snippet}

<!-- One row of what's coming up: the date on the left, then what it is and how you stand -->
{#snippet upcomingItem(r: (typeof feed.upcoming)[number])}
  <a class="item dated rise" href={r.href ?? "/calendar"}>
    {@render when(r.on)}
    <span class="grow">
      <span class="sr-only"
        >{r.on.season
          ? `${r.on.season.name} ${r.on.season.year}`
          : r.on.tbc
            ? "Date to be confirmed"
            : formatDayDate(r.on.at)}:</span
      >
      <span class="item-text">{r.text}</span><span class="item-sub">{r.sub}</span>
    </span>
    <Icon name="chevronRight" size={16} />
  </a>
{/snippet}

<div class="page">
  <!-- The hello: one line, with the Calendar and (for whoever posts) a new announcement on its right -->
  <header class="hello">
    <p class="kicker">Battersea Cougars</p>
    <div class="hello-row">
      <!-- The club's mark leads the hello on a phone, where it's nowhere else in the app (a desktop has it top left) -->
      <img class="mark" src={mark} alt="" width="40" height="40" />
      <h1 class="greeting">{hello}</h1>
      <div class="hello-side">
        <!-- The Calendar: a phone's tabs have the Club in its place, so it's here (a desktop's rail has it too) -->
        <a class="btn ghost icon" href="/calendar" aria-label="Calendar" title="Calendar"
          ><Icon name="calendar" size={18} /></a
        >
        {#if poster}
          <button
            class="btn ghost icon"
            aria-label="Post to the locker room"
            title="Post to the locker room"
            onclick={() => (announcing = true)}><Icon name="megaphone" size={18} /></button
          >
        {/if}
      </div>
    </div>
  </header>

  <!-- The locker room: the club's word (announcements), before anything else, until it ends or you're done with it;
       then what you owe, until you've paid -->
  {#if db.announcements.length || hadNotes || owing}
    <section class="notes" aria-labelledby="locker-room">
      <h2 class="feed-label room-label" id="locker-room">Locker room</h2>
      {#each db.announcements as a (a.id)}
        <article class="note rise" out:slide={{ duration: prefersReducedMotion ? 0 : 280 }}>
          <Icon name="megaphone" size={18} />
          <div class="grow">
            <h2 class="note-title">{a.title}</h2>
            {#if a.body}<p class="note-body">{a.body}</p>{/if}
            {#if a.link || poster}
              <div class="note-links">
                {#if a.link}<a href={a.link} target="_blank" rel="noopener noreferrer">Read more</a>{/if}
                {#if poster}<button class="link" onclick={() => removeAnnouncement(a.id)}>Take down</button>{/if}
              </div>
            {/if}
          </div>
          <button
            class="btn primary sm got-it"
            class:done={got[a.id]}
            aria-label="Got it: {a.title}"
            aria-pressed={!!got[a.id]}
            onclick={() => gotIt(a.id)}
            >{#if got[a.id]}<Icon name="check" size={16} />{/if}Got it</button
          >
        </article>
      {/each}
      {#if owing}
        <!-- Yours alone, no Got it: Settle up, where Got it sits -->
        <article class="note owing rise" out:slide={{ duration: prefersReducedMotion ? 0 : 280 }}>
          <Icon name="pound" size={18} />
          <div class="grow">
            <h2 class="note-title">{owing.text}</h2>
            <p class="note-body">{owing.sub}</p>
          </div>
          <a class="btn primary sm got-it" href={owing.href}>Settle up</a>
        </article>
      {/if}
      {#if db.announcements.length || hadNotes}
        <a class="past" href="/announcements">Everything from the locker room<Icon name="chevronRight" size={16} /></a>
      {/if}
    </section>
  {/if}

  <!-- The calls to action: this Friday's card, always (In and Out, the quip, your team once they're out); are you in
       for the Kumite while it's open. A tournament you'd answered before you came is its row in what's coming up -->
  {#if booking || feed.fights.length || signingUp.some(({ t }) => askFull(tournamentBookable(t)))}
    <div class="asks">
      {#if series && booking}
        <section>
          <h2 class="section-title">{answered ? `This ${day}` : `Are you in this ${day}?`}</h2>
          <!-- The locker room's word, swapped in place when you answer. Its room is fixed, so nothing moves. -->
          <p class="message" aria-live="polite">
            <span class="sr-only">{quip?.text ?? ""}</span>
            <span aria-hidden="true"
              >{typed}{#if quip}<span class="caret" class:done={typed === quip.text}></span>{/if}</span
            >
          </p>
          <!-- The night you came for: it makes an entrance, the rest of the page just rises -->
          <div class="lead">
            <EventCard
              event={booking}
              canSignUp={can(perms, "signup:Event")}
              feature
              beckon
              glance
              link
              place={false}
              footer={myTeam ? teamLine : undefined}
              {onanswer}
            >
              {#snippet links()}{@render placeLinks(booking)}{/snippet}
            </EventCard>
          </div>
        </section>
      {/if}
      {#each signingUp as { type, t } (type.id)}
        {@const ev = tournamentBookable(t)}
        {#if askFull(ev)}
          <section>
            <h2 class="section-title">
              {standingOn(ev) ? `The ${type.shortName}` : `Are you in for the ${type.shortName}?`}
            </h2>
            <EventCard event={ev} canSignUp={can(perms, "signup:Event")} feature beckon glance link place={false}>
              {#snippet links()}{@render placeLinks(ev)}{/snippet}
            </EventCard>
          </section>
        {/if}
      {/each}
      <!-- On a team with a fight to come: who, when, and the way to it, as the tournament's own page leads with it -->
      {#each feed.fights as f (f.t.id)}
        <section>
          <h2 class="section-title">Your next {f.type.shortName} fight</h2>
          <NextFight tournament={f.t} game={f.game} teamId={f.teamId} day />
        </section>
      {/each}
    </div>
  {/if}

  <!-- The feed: what needs you now (your move first, then what you owe), what's coming up with the calendar after it,
       the store app's one ask, and for admins their own lines at the foot -->
  <section class="feed" aria-label="What's going on">
    {#each feed.now as n (n.key)}{@render item(n)}{/each}
    {#if feed.upcoming.length}
      <h2 class="feed-label">Coming up</h2>
      {#each feed.upcoming as r (r.key)}{@render upcomingItem(r)}{/each}
    {/if}
    <a class="past" href="/calendar">See the calendar<Icon name="chevronRight" size={16} /></a>
    <!-- The store app's one ask (ADR 0108): what notifications are for, then the phone's own question -->
    {#if askNotify}
      <div class="item ask-notify rise">
        <span class="lead-col"><Icon name="bell" size={18} /></span>
        <span class="grow">
          <span class="item-text">Hear it first</span>
          <span class="item-sub">Teams out, a place coming up, a night off: a notification, as it happens.</span>
          <span class="note-links">
            <button class="btn primary sm" onclick={turnOnNotifications}>Turn on notifications</button>
            <button class="link" onclick={notNow}>Not now</button>
          </span>
        </span>
      </div>
    {/if}
  </section>

  <!-- For admins: what only they act on, out of everyone's way -->
  {#if feed.admin.length}
    <section class="feed" aria-labelledby="for-admins">
      <h2 class="feed-label" id="for-admins">For admins</h2>
      {#each feed.admin as n (n.key)}{@render item(n)}{/each}
    </section>
  {/if}

  <Sheet bind:open={announcing} title="Post to the locker room">
    <form class="form" onsubmit={announce}>
      <p class="hint">At the top of everyone's Home until its last day, or until they say Got it. Two at a time.</p>
      <label class="field"
        >Title <input
          class="input"
          bind:value={note.title}
          maxlength="80"
          placeholder="e.g. No training on the 24th"
          required
        /></label
      >
      <label class="field"
        >A line or two <textarea
          class="input"
          rows="2"
          maxlength="280"
          bind:value={note.body}
          placeholder="e.g. The hall's booked. Back on the 31st."></textarea></label
      >
      <label class="field"
        >Link (optional) <input class="input" type="url" bind:value={note.link} placeholder="https://" /></label
      >
      <div class="field">
        Last day <DateField id="note-ends" aria-label="Last day" required bind:value={note.endsOn} />
      </div>
      <button class="btn primary">Post it</button>
    </form>
  </Sheet>
</div>

<style>
  /* Bigger breaks between blocks than within them */
  .page {
    gap: var(--s-6);
  }
  @media (max-width: 900px) {
    .page {
      gap: var(--s-5);
    }
  }
  section,
  .asks {
    display: grid;
    gap: var(--s-3);
  }
  .asks {
    gap: var(--s-6);
  }

  /* The hello: one modest line, not a poster, so Friday's card is in the first screen of a phone. On a desktop the
     kicker keeps every page's eyebrow line (ADR 0065) */
  .hello {
    display: grid;
    grid-template-columns: minmax(0, 1fr);
    gap: var(--s-2);
  }
  .kicker {
    min-height: 1.5rem;
  }
  .hello-row {
    display: flex;
    align-items: center;
    gap: var(--s-3);
    min-height: var(--control-h-sm);
  }
  .greeting {
    flex: 1;
    min-width: 0;
    margin: 0;
    font-family: var(--font-display);
    font-size: clamp(1.35rem, 5.5vw, 2rem);
    font-style: italic;
    font-weight: 400;
    letter-spacing: 0.01em;
    line-height: 1.05;
    text-transform: uppercase;
    color: var(--fg);
    /* A long hello on a narrow phone takes a second line (the row's as tall as two, beside the mark), never "…" */
    display: -webkit-box;
    -webkit-box-orient: vertical;
    -webkit-line-clamp: 2;
    line-clamp: 2;
    overflow: hidden;
    text-wrap: balance;
  }
  .hello-side {
    display: flex;
    align-items: center;
    gap: var(--s-1);
    flex-shrink: 0;
  }
  .mark {
    display: none;
    flex-shrink: 0;
    width: 2.5rem;
    height: 2.5rem;
  }
  @media (max-width: 900px) {
    .kicker {
      display: none;
    }
    .mark {
      display: block;
    }
  }
  /* An announcement: the club's word, compact, on glass like the tables (ADR 0065), its icon in the brand's red;
     Got it on the right. Each keeps its own space below it (not the section's gap), so one folding away takes its
     space with it: nothing jumps */
  .notes {
    gap: 0;
  }
  /* Its label sits on the notes as the feed's labels sit on theirs */
  .feed-label.room-label {
    margin: 0 var(--s-1) var(--s-2);
  }
  .note {
    display: grid;
    grid-template-columns: auto minmax(0, 1fr) auto;
    align-items: start;
    gap: var(--s-3);
    margin-bottom: var(--s-2);
    padding: var(--s-3) var(--s-3) var(--s-3) var(--s-4);
    border-radius: var(--r-lg);
    background: var(--glass);
    backdrop-filter: var(--blur);
    -webkit-backdrop-filter: var(--blur);
    overflow: hidden;
  }
  .note > :global(svg) {
    margin-top: 0.4rem;
    color: var(--red-hot);
  }
  .note-title {
    margin: 0.3rem 0 0;
    color: var(--fg);
    font-size: var(--text-base);
    font-weight: 600;
    line-height: 1.3;
  }
  .note-body {
    margin: var(--s-1) 0 0;
    color: var(--fg-body);
    font-size: var(--text-sm);
    line-height: 1.45;
  }
  .note-links {
    display: flex;
    align-items: center;
    flex-wrap: wrap;
    gap: var(--s-4);
    margin-top: var(--s-2);
    min-width: 0;
    font-size: var(--text-sm);
  }
  .note-links a {
    color: var(--fg);
    text-decoration: underline;
    text-underline-offset: 3px;
  }
  /* The one main button on the note: wide enough for its tick, so saying it doesn't move a thing */
  .got-it {
    min-width: 6.25rem;
  }
  /* Got: the fill gives way to a tick in green, the words stay */
  .got-it.done,
  .got-it.done:hover {
    background: transparent;
    color: var(--green-ink);
    cursor: default;
  }
  .past {
    display: inline-flex;
    align-items: center;
    gap: var(--s-1);
    justify-self: start;
    min-height: var(--control-h-sm);
    color: var(--fg-muted);
    font-size: var(--text-sm);
  }
  .past:hover {
    color: var(--fg);
  }

  /* The lead card's entrance: it lands (up from below, blurred to sharp), then a single glint of rink light crosses
     it. Only this card: everything else on Home just rises. A transform and a filter, so nothing moves the page. */
  .lead {
    position: relative;
    border-radius: var(--r-xl);
    animation: lead-land 620ms var(--ease) both;
    /* In's pulse waits for the card to land and the glint to pass */
    --beckon-delay: 1300ms;
  }
  .lead::after {
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
    opacity: 0;
    animation: lead-glint 900ms 420ms var(--ease-in-out) both;
  }
  /* From all but invisible, not invisible: Chrome never counts what first paints at opacity 0 inside a running
     animation, so the card's content went uncounted until In's subliminal first repainted it 1.3s later, and that
     was the page's Largest Contentful Paint (ADR 0120). At 0.01 it counts from the frame it lands in, as it looks. */
  @keyframes lead-land {
    from {
      opacity: 0.01;
      transform: translateY(14px) scale(0.975);
      filter: blur(6px);
    }
    to {
      opacity: 1;
      transform: none;
      filter: none;
    }
  }
  @keyframes lead-glint {
    0% {
      opacity: 1;
      background-position: 120% 0;
    }
    100% {
      opacity: 1;
      background-position: -20% 0;
    }
  }
  @media (prefers-reduced-motion: reduce) {
    .lead,
    .lead::after {
      animation: none;
    }
  }
  /* The message: big enough to read as the club talking to you, right under its heading. Two lines' room on a
     phone, one on desktop, so a new one never moves anything. */
  .message {
    display: flex;
    align-items: flex-start;
    min-height: 2lh;
    margin: 0 var(--s-1);
    color: var(--fg);
    font-size: var(--text-lg);
    font-weight: 500;
    line-height: 1.25;
    letter-spacing: -0.01em;
    text-wrap: balance;
  }
  .caret {
    display: inline-block;
    width: 0.12em;
    height: 1em;
    margin-left: 0.08em;
    vertical-align: -0.12em;
    background: var(--red-hot);
    animation: blink 1s steps(1) infinite;
  }
  /* Blinking while it types, then a few blinks and gone */
  .caret.done {
    animation: caret-out 2.4s steps(1) forwards;
  }
  @keyframes caret-out {
    0%,
    20% {
      opacity: 1;
    }
    21%,
    40% {
      opacity: 0;
    }
    41%,
    60% {
      opacity: 1;
    }
    61%,
    100% {
      opacity: 0;
    }
  }
  @keyframes blink {
    50% {
      opacity: 0;
    }
  }
  @media (min-width: 901px) {
    .message {
      min-height: 1lh;
      white-space: nowrap;
    }
  }
  .status {
    display: flex;
    align-items: center;
    gap: var(--s-3);
    min-height: 3.25rem;
    padding: 0 var(--s-6);
    border: 0;
    background: none;
    color: var(--fg-muted);
    font-size: var(--text-sm);
    text-align: left;
    transition:
      color var(--t-fast) var(--ease-in-out),
      background-color var(--t-fast) var(--ease-in-out);
  }
  .status .grow {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .status strong {
    color: var(--fg);
    font-weight: 600;
  }
  .status:hover {
    color: var(--fg);
  }
  /* A phone: the card's own padding is smaller, so the footer's is too */
  @media (max-width: 600px) {
    .status {
      padding-inline: var(--s-4);
    }
  }

  /* The feed: one light row per thing, a fill and no edges; your move's icon in red, the colour only an accent */
  .feed {
    gap: var(--s-2);
  }
  /* The feed floats up into place: each row drifts up from a little lower and fades in, one after another, after the
     cards above have arrived. A transform and opacity, so nothing moves the page */
  .feed > :global(.rise) {
    animation: float-up 700ms calc(350ms + var(--float-at, 840ms)) cubic-bezier(0.16, 1, 0.3, 1) backwards;
  }
  .feed > :nth-child(1) {
    --float-at: 70ms;
  }
  .feed > :nth-child(2) {
    --float-at: 140ms;
  }
  .feed > :nth-child(3) {
    --float-at: 210ms;
  }
  .feed > :nth-child(4) {
    --float-at: 280ms;
  }
  .feed > :nth-child(5) {
    --float-at: 350ms;
  }
  .feed > :nth-child(6) {
    --float-at: 420ms;
  }
  .feed > :nth-child(7) {
    --float-at: 490ms;
  }
  .feed > :nth-child(8) {
    --float-at: 560ms;
  }
  .feed > :nth-child(9) {
    --float-at: 630ms;
  }
  .feed > :nth-child(10) {
    --float-at: 700ms;
  }
  .feed > :nth-child(11) {
    --float-at: 770ms;
  }
  .feed > :nth-child(12) {
    --float-at: 840ms;
  }
  @keyframes float-up {
    from {
      opacity: 0;
      transform: translateY(1.75rem);
    }
    to {
      opacity: 1;
      transform: none;
    }
  }
  @media (prefers-reduced-motion: reduce) {
    .feed > :global(.rise) {
      animation: none;
    }
  }
  .item {
    display: flex;
    align-items: center;
    gap: var(--s-3);
    min-height: 3.5rem;
    padding: var(--s-3) var(--s-4);
    border-radius: var(--r-lg);
    background: var(--surface-1);
    color: var(--fg);
  }
  a.item:hover {
    background: var(--surface-2);
  }
  .lead-col {
    color: var(--fg-muted);
  }
  .item.hot .lead-col {
    color: var(--red-hot);
  }
  .item > :global(svg:last-child) {
    flex-shrink: 0;
    color: var(--fg-muted);
  }
  .item .grow {
    display: grid;
    flex: 1;
    min-width: 0;
  }
  .item-text {
    font-weight: 600;
  }
  .item-sub {
    color: var(--fg-muted);
    font-size: var(--text-sm);
  }
  .ask-notify {
    align-items: flex-start;
  }
  .ask-notify .lead-col {
    margin-top: 0.15rem;
  }
  /* A quiet label over a group of the feed: Coming up, For admins */
  .feed-label {
    margin: var(--s-3) var(--s-1) 0;
    color: var(--fg-muted);
    font-size: var(--text-2xs);
    font-weight: 700;
    letter-spacing: var(--tracking-label);
    text-transform: uppercase;
  }
  /* The row's first column, the same width on every row: a date block (lib/DateBlock, a size down) or an icon in its
     middle, so every row's words start on one line */
  .when,
  .lead-col {
    display: grid;
    place-items: center;
    flex-shrink: 0;
    width: 2.75rem;
  }
</style>
