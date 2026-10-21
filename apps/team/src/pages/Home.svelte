<script lang="ts">
  // Home (ADR 0118): a slim hello with what you owe, the club's announcements, then the calls to action (are you in
  // this Friday, are you in for the Kumite), then a feed of everything else, Teammates at the very end.
  import { untrack } from "svelte";
  import { goesBy, shortName, shortNameOf } from "../lib/names";
  import { initials } from "../lib/initials";
  import { can } from "../access/actions";
  import { PLAYERS } from "../demo/data";
  import { owedBy } from "../demo/dues.svelte";
  import { granted, me } from "../demo/session.svelte";
  import { db } from "../demo/store.svelte";
  import Icon from "../app/shell/Icon.svelte";
  import type { IconName } from "../app/shell/icons";
  import EventCard from "../lib/EventCard.svelte";
  import { formatDayDate, formatTime, londonToday, pounds } from "../lib/dates";
  import { aged } from "../lib/dues";
  import { signupOpen } from "../lib/signup";
  import { homeFeed } from "../lib/home-feed";
  import { fill, slot } from "../lib/greetings";
  import { latestTournament, nextSession, sessionBookable, tournamentBookable } from "../demo/schedule.svelte";
  import { pick, type Quip, type QuipKind } from "../lib/quips";
  import type { Bookable } from "../demo/model";
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

  // What you owe (ADR 0007): a quiet chip in the header, opening your tab; nothing when you're square
  const owed = $derived(owedBy(who.id));

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
  const later = $derived(
    nexts
      .slice(1)
      .map((o) => sessionBookable(o.session))
      .sort((x, y) => x.startsAt.localeCompare(y.startsAt)),
  );
  // The next of each tournament series, not one that's done (by its games, lib/edition.ts)
  const tournaments = $derived(
    db.tournamentTypes
      .filter((t) => t.active)
      .flatMap((type) => {
        const t = latestTournament(type.id);
        return t && editionState(t) !== "done" ? [{ type, t }] : [];
      }),
  );
  // Taking sign-ups: a call to action up top, like Friday. The rest are teased in the feed
  const signingUp = $derived(tournaments.filter(({ t }) => signupOpen(t, today)));
  const teased = $derived(tournaments.filter(({ t }) => !signupOpen(t, today)));

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
  // A call to action stays a full card while it's unanswered; one you'd already answered when you came is a line
  // saying so, so the asks still open stand out. Answering here keeps the card for the rest of the visit: nothing
  // jumps under your thumb (no-layout-shift)
  let asked = $state<Record<string, boolean>>({});
  $effect(() => {
    const open = [booking, ...signingUp.map(({ t }) => tournamentBookable(t))].filter(
      (ev): ev is Bookable => !!ev && !standingOn(ev),
    );
    untrack(() => {
      for (const ev of open) if (!asked[ev.key]) asked[ev.key] = true;
    });
  });
  const askFull = (ev: Bookable) => !standingOn(ev) || !!asked[ev.key];

  // A one-line event: where you stand and what it is, then when
  const STANDING = { in: "You're in", waitlist: "You're on the waitlist", out: "You're out" } as const;
  function whenOf(ev: Bookable) {
    if (ev.cancelled) return "Cancelled";
    if (ev.season) return `${ev.season.name[0].toUpperCase()}${ev.season.name.slice(1)} ${ev.season.year}`;
    if (ev.dateTbc) return "Date to be confirmed";
    return `${formatDayDate(ev.startsAt)} · ${ev.timeText || `${formatTime(ev.startsAt)}–${formatTime(ev.endsAt)}`}`;
  }
  function eventLine(ev: Bookable) {
    const s = standingOn(ev);
    const asking = !s && ev.signup && !ev.cancelled && can(perms, "signup:Event");
    return {
      text: s ? `${STANDING[s]} · ${ev.title}` : ev.title,
      sub: asking ? `${whenOf(ev)} · Are you in?` : whenOf(ev),
    };
  }

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
  // The feed (lib/home-feed.ts): drafts, sign-ups closing, teams out, the club's dues, your move first
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
    }),
  );

  // The squad, one tap from Home (Teammates: everyone's card, by position, searchable): the feed's last line
  const squad = $derived(
    db.members
      .filter((m) => m.status === "active")
      .map((m) => m.player)
      .sort((a, b) => goesBy(a).localeCompare(goesBy(b))),
  );
  const cougars = $derived(squad.filter((p) => p.cougar).length);

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
{#snippet item(o: { key?: string; href?: string; icon: IconName; text: string; sub: string; hot?: boolean })}
  {#if o.href}
    <a class="item rise" class:hot={o.hot} href={o.href}>
      <Icon name={o.icon} size={18} />
      <span class="grow"><span class="item-text">{o.text}</span><span class="item-sub">{o.sub}</span></span>
      <Icon name="chevronRight" size={16} />
    </a>
  {:else}
    <!-- Just news: nothing to open -->
    <div class="item rise" role="status">
      <Icon name={o.icon} size={18} />
      <span class="grow"><span class="item-text">{o.text}</span><span class="item-sub">{o.sub}</span></span>
      <span class="badge red live">Live</span>
    </div>
  {/if}
{/snippet}

{#snippet eventItem(ev: Bookable, sub?: string)}
  {@const l = eventLine(ev)}
  {@render item({ href: ev.href, icon: ev.icon, text: l.text, sub: sub ?? l.sub })}
{/snippet}

<div class="page">
  <!-- The hello: one line, with what you owe and (for whoever posts) a new announcement on its right -->
  <header class="hello">
    <p class="kicker">Battersea Cougars</p>
    <div class="hello-row">
      <h1 class="greeting">{hello}</h1>
      <div class="hello-side">
        {#if owed > 0}
          <a class="owed" href="/me/tab" aria-label="You owe the club {pounds(owed)}: your tab">
            <Icon name="pound" size={16} /><span class="num">{pounds(owed)}</span> to pay<Icon
              name="chevronRight"
              size={14}
            />
          </a>
        {/if}
        {#if poster}
          <button
            class="btn ghost icon"
            aria-label="Post an announcement"
            title="Post an announcement"
            onclick={() => (announcing = true)}><Icon name="megaphone" size={18} /></button
          >
        {/if}
      </div>
    </div>
  </header>

  <!-- Announcements: the club's word, before anything else, until it ends or you're done with it -->
  {#if db.announcements.length || hadNotes}
    <section class="notes" aria-label="Announcements">
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
      <a class="past" href="/more/announcements">Past announcements<Icon name="chevronRight" size={16} /></a>
    </section>
  {/if}

  <!-- The calls to action: are you in this Friday, are you in for the Kumite. Open asks are full cards; one you'd
       answered before you came is a line saying where you stand, after them -->
  {#if (booking && askFull(booking)) || signingUp.some(({ t }) => askFull(tournamentBookable(t)))}
    <div class="asks">
      {#if series && booking && askFull(booking)}
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
    </div>
  {/if}

  <!-- The feed: where you stand on what you've answered, then what's for you (your move first), the rest of the
       schedule, the store app's one ask, and the squad last -->
  <section class="feed" aria-label="What's going on">
    {#if booking && !askFull(booking)}
      {@render eventItem(booking, myTeam ? `On ${myTeam.name} with ${teammates(myTeam.players)}` : undefined)}
    {/if}
    {#each signingUp as { type, t } (type.id)}
      {@const ev = tournamentBookable(t)}
      {#if !askFull(ev)}{@render eventItem(ev)}{/if}
    {/each}
    {#each feed as n (n.key)}{@render item(n)}{/each}
    {#each later as ev (ev.key)}{@render eventItem(ev)}{/each}
    {#each teased as { type, t } (type.id)}
      {@const ev = tournamentBookable(t)}
      {@render item({ href: ev.href, icon: ev.icon, text: `The next ${type.shortName}`, sub: eventLine(ev).sub })}
    {/each}
    <!-- The store app's one ask (ADR 0108): what notifications are for, then the phone's own question -->
    {#if askNotify}
      <div class="item ask-notify rise">
        <Icon name="bell" size={18} />
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
    <!-- The squad: the way to everyone's card, not buried under You -->
    {#if squad.length > 1}
      <a class="item quiet rise" href="/more/teammates">
        <span class="faces" aria-hidden="true">
          {#each squad.slice(0, 3) as p (p.id)}<span class="avatar">{initials(goesBy(p))}</span>{/each}
        </span>
        <span class="grow">
          <span class="item-text">Teammates</span>
          <span class="item-sub">{squad.length} players{cougars ? ` · ${cougars} Cougars` : ""}</span>
        </span>
        <Icon name="chevronRight" size={16} />
      </a>
    {/if}
  </section>

  <Sheet bind:open={announcing} title="Post an announcement">
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
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .hello-side {
    display: flex;
    align-items: center;
    gap: var(--s-1);
    flex-shrink: 0;
  }
  @media (max-width: 900px) {
    .kicker {
      display: none;
    }
  }
  /* What you owe: a quiet chip, its pound in the brand's red as the only colour; it opens your tab */
  .owed {
    display: inline-flex;
    align-items: center;
    gap: var(--s-1);
    height: var(--control-h-sm);
    padding: 0 var(--s-2) 0 var(--s-3);
    border-radius: var(--r-sm);
    background: color-mix(in srgb, var(--fg) 8%, transparent);
    color: var(--fg-body);
    font-size: var(--text-sm);
    font-weight: 500;
    white-space: nowrap;
    transition: background-color var(--t-fast) var(--ease-in-out);
  }
  .owed:hover {
    background: color-mix(in srgb, var(--fg) 13%, transparent);
    color: var(--fg);
  }
  .owed .num {
    color: var(--fg);
    font-weight: 600;
  }
  .owed > :global(svg:first-child) {
    color: var(--red-hot);
  }
  .owed > :global(svg:last-child) {
    color: var(--fg-muted);
  }

  /* An announcement: the club's word, compact, on glass like the tables (ADR 0065), its icon in the brand's red;
     Got it on the right. Each keeps its own space below it (not the section's gap), so one folding away takes its
     space with it: nothing jumps */
  .notes {
    gap: 0;
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
  @keyframes lead-land {
    from {
      opacity: 0;
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
  .item > :global(svg:first-child) {
    flex-shrink: 0;
    color: var(--fg-muted);
  }
  .item.hot > :global(svg:first-child) {
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
  .ask-notify > :global(svg:first-child) {
    margin-top: 0.15rem;
  }
  /* Teammates, last: on the page itself, no fill till you point at it */
  .item.quiet {
    background: none;
  }
  .item.quiet:hover {
    background: var(--surface-1);
  }
  /* A few of the squad's faces, overlapping, in the row to Teammates */
  .faces {
    display: flex;
    flex-shrink: 0;
  }
  .faces .avatar {
    width: 1.75rem;
    height: 1.75rem;
    box-shadow: 0 0 0 2px var(--bg);
    background: var(--surface-3);
    font-size: 0.62rem;
  }
  .faces .avatar + .avatar {
    margin-left: -0.35rem;
  }
</style>
