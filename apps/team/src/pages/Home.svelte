<script lang="ts">
  // Home is a feed (ADR 0118): a slim hello (with a loud icon while you've something overdue), the locker room (the
  // club's announcements), then the hero: the club's next event, whatever it is, your part in it shown on its card
  // (your match, In and Out, or You're out); then what's coming up after it, what needs you, the admins' lines, and what
  // you owe at the foot.
  import { untrack } from "svelte";
  import { nameOfTeam, shortName, shortNameOf, teamNamesOf } from "../lib/names";
  import { can } from "../access/actions";
  import { PLAYERS } from "../demo/data";
  import { chargesFor, owedBy } from "../demo/dues.svelte";
  import { granted, me } from "../demo/session.svelte";
  import { db } from "../demo/store.svelte";
  import Icon from "../app/shell/Icon.svelte";
  import mark from "../assets/cougars-mark.webp";
  import type { IconName } from "../app/shell/icons";
  import EventCard from "../lib/EventCard.svelte";
  import TeamCrest from "../lib/TeamCrest.svelte";
  import { clock, formatDayDate, londonToday, pounds } from "../lib/dates";
  import { kickOff, slotMinutes } from "../lib/fixtures";
  import { teamTone } from "../lib/team-tones";
  import { aged, leftOn, overdue } from "../lib/dues";
  import {
    homeFeed,
    owedNotice,
    whenSaid,
    type Fight,
    type Lead,
    type UpcomingEvent,
    type When,
  } from "../lib/home-feed";
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
  import type { Bookable, TrainingSession, Tournament } from "../demo/model";
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
  // When Home was opened: what's over by then isn't next
  const openedAt = new Date().toISOString();

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

  // In the store app (ADR 0108), or a browser with Web Push (#24): say what notifications are for before the phone
  // asks, once; "Not now" is remembered. On an iPhone in a Safari tab, how to get them instead: the app on the Home
  // Screen. It's an item in the feed, under the calls to action
  const NOT_NOW = "cougars.notify.not-now";
  let askNotify = $state<"ask" | "homeScreen" | false>(false);
  mayAskToNotify()
    .then((may) => (askNotify = !saidNotNow() && may))
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

  // What you owe (ADR 0007): at Home's foot, with Settle up opening your tab, while you owe anything. What's overdue
  // (a charge whose day has passed, lib/dues.ts) is also a loud icon in the hello, opening the same tab
  const late = $derived(overdue(db.charges, who.id, today));
  const owing = $derived(
    owedNotice({
      pence: owedBy(who.id),
      kinds: chargesFor(who.id)
        .filter((c) => leftOn(c) > 0)
        .map((c) => c.kind),
      overdue: late,
    }),
  );

  // Each training's next session: the hello knows a training night by it
  const nexts = $derived(
    db.series
      .filter((s) => s.active)
      .flatMap((series) => {
        const session = nextSession(series);
        return session ? [{ series, session, at: sessionBookable(session).startsAt }] : [];
      })
      .sort((a, b) => a.at.localeCompare(b.at)),
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

  const typeOf = (t: Tournament) => db.tournamentTypes.find((x) => x.id === t.typeId);
  // Where you stand on an event: in, waiting, out, or not said
  const standingOn = (ev: Bookable) =>
    ev.entries.going.includes(who.id)
      ? "in"
      : ev.entries.waitlist.includes(who.id)
        ? "waitlist"
        : ev.entries.out?.includes(who.id)
          ? "out"
          : null;

  // What's on, for the feed to pick the lead and the rows from: everything on the club's agenda from today (not its
  // reminders: a draft night or a sign-up closing is in what needs you now), and each tournament series' next one,
  // however far
  const upcomingEvent = (ev: Bookable): UpcomingEvent => {
    const standing = standingOn(ev);
    return {
      ...ev,
      standing,
      asking: !standing && ev.signup && !ev.cancelled && can(perms, "signup:Event"),
      signupOpensOn: ev.kind === "tournament" ? (ev.entries as Tournament).signupOpensOn : null,
    };
  };
  const bookables = $derived.by(() => {
    const all = [...calendar(today).filter((ev) => /^(session|tournament|oneoff):\d+$/.test(ev.key))];
    for (const { t } of tournaments) {
      const ev = tournamentBookable(t);
      if (!all.some((x) => x.key === ev.key)) all.push(ev);
    }
    return all;
  });
  const events = $derived(bookables.map(upcomingEvent));

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
  // The lead is picked once a visit (lib/home-feed.ts leadOf) and stays while it's on: answering Out on it doesn't
  // swap the card under your thumb (no-layout-shift)
  let pinned = $state<string>();
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
      now: openedAt,
      pinned,
    }),
  );

  $effect(() => {
    const key = feed.lead?.key;
    untrack(() => {
      if (key && !pinned) pinned = key;
    });
  });
  const lead = $derived(feed.lead);
  const notIn = $derived(lead?.kind === "event" && lead.role === "notIn");
  // An event's hero: its card (EventCard) wants the whole of it. One you're not in has nothing to answer; a
  // tournament's opens its Fight Card once the matches are out
  const leadEvent = $derived.by(() => {
    if (lead?.kind !== "event") return undefined;
    const ev = bookables.find((b) => b.key === lead.key);
    if (!ev || !notIn) return ev;
    const t = ev.kind === "tournament" ? (ev.entries as Tournament) : undefined;
    const slug = t && typeOf(t)?.slug;
    return { ...ev, signup: false, href: slug && t.games?.length ? `/tournaments/${slug}/schedule` : ev.href };
  });
  // A tournament you're not in, its sign-up closed: the card says you're out, where In and Out would be
  const outOfIt = $derived(notIn && leadEvent?.kind === "tournament");
  // A training night's lead: the locker room's word over it, and your team along its foot once the teams are out
  const session = $derived(
    leadEvent?.kind === "training" && !notIn ? (leadEvent.entries as TrainingSession) : undefined,
  );
  const series = $derived(session && db.series.find((x) => x.id === session.seriesId));
  const day = $derived(series?.shortName ?? "week");
  const isIn = $derived(!!session?.going.includes(who.id));
  const waiting = $derived(!!session?.waitlist.includes(who.id));
  const declined = $derived(session?.out?.includes(who.id) ?? false);
  const answered = $derived(isIn || waiting || declined);
  // Out since the teams were made: still on one until a team maker decides (ADR 0076), but not yours to play on
  const myTeam = $derived(isIn && session ? db.teams[session.id]?.find((t) => t.players.includes(who.id)) : undefined);
  // Your next match, as the lead says it: its card (when, where), you, them (a playoff's place until the
  // table fills it), which game, where
  const nth = (n: number | null) => (n === 1 ? "1st" : n === 2 ? "2nd" : n === 3 ? "3rd" : `${n}th`);
  function matchOf({ type, t, game, teamId }: Fight) {
    const person = (id: number | null) => PLAYERS.find((p) => p.id === id);
    const side = (id: number | null, seed: number | null) => {
      const i = t.teams.findIndex((x) => x.id === id);
      return {
        id,
        name: i >= 0 ? nameOfTeam(t.teams[i], t.teams, person) : nth(seed),
        logo: t.teams[i]?.logo ?? null,
        tone: teamTone(i),
      };
    };
    const home = side(game.homeTeamId, game.homeSeed);
    const away = side(game.awayTeamId, game.awaySeed);
    const where = tournamentBookable(t);
    const live = game.status === "live";
    const at = clock(kickOff(t.startTime, slotMinutes(t), game.position));
    return {
      // The tournament on the schedule, as the card frames it: the match's time (On now while it's played) for the
      // night's, its page for the tournament's, and nothing to answer
      event: {
        ...where,
        signup: false,
        timeText: live ? "On now" : at,
        href: `/tournaments/${type.slug}/games/${game.id}${live ? "/live" : ""}`,
      },
      ours: game.awayTeamId === teamId ? away : home,
      them: game.awayTeamId === teamId ? home : away,
      crests: teamNamesOf(t.teams, person),
      game: game.name || `Game ${game.position}`,
    };
  }
  // What the lead's heading asks or says
  const leadTitle = (l: Lead) => {
    if (l.kind === "draft") return l.item.text;
    if (l.kind === "fight")
      return l.fight.game.status === "live"
        ? `You're on: the ${l.fight.type.shortName}`
        : `Your next ${l.fight.type.shortName} match`;
    const ev = l.event;
    const said = !!ev.standing;
    // Not yours: what's on and when, plainly ("The Kumite's this Friday")
    if (l.role === "notIn") {
      const t = ev.kind === "tournament" ? (leadEvent?.entries as Tournament) : undefined;
      const name = (t && typeOf(t)?.shortName) ?? ev.title;
      return `${t ? "The " : ""}${name}'s ${whenSaid(ev.startsAt, today)}`;
    }
    if (ev.kind === "training") {
      // This Friday, next Friday (the one after one you're out of), or further off, its date
      const ahead =
        (Date.parse(`${londonToday(new Date(ev.startsAt))}T12:00:00Z`) - Date.parse(`${today}T12:00:00Z`)) / 86_400_000;
      const when = ahead < 7 ? `this ${day}` : ahead < 14 ? `next ${day}` : `on ${formatDayDate(ev.startsAt)}`;
      return answered ? when[0].toUpperCase() + when.slice(1) : `Are you in ${when}?`;
    }
    if (ev.kind === "tournament") {
      const name = typeOf(leadEvent?.entries as Tournament)?.shortName;
      return name ? (said ? `The ${name}` : `Are you in for the ${name}?`) : said ? "Up next" : `Are you in?`;
    }
    return said ? "Up next" : "Are you in?";
  };

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
    return fill(line, { name: shortName(who), visits, day: nexts[0]?.series.shortName ?? "training night" });
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

<!-- A tournament you're not in: you're out, as the card says it of a night you said Out of; nothing to answer -->
{#snippet outBody()}
  <span class="out-line"><span class="badge red">You're out</span></span>
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
        <!-- Something overdue: loud, in the club's red, opening your tab (what you owe is at the foot of Home) -->
        {#if late > 0}
          <a
            class="btn ghost icon overdue"
            href="/me/tab"
            aria-label="{pounds(late)} overdue: your tab"
            title="{pounds(late)} overdue"
            ><Icon name="pound" size={20} /><span class="overdue-badge" aria-hidden="true">!</span></a
          >
        {/if}
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

  <!-- The locker room: the club's word (announcements), before anything else, until it ends or you're done with it -->
  {#if db.announcements.length || hadNotes}
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
      <a class="past" href="/announcements">Everything from the locker room<Icon name="chevronRight" size={16} /></a>
    </section>
  {/if}

  <!-- The hero: the club's next event, whatever it is, as the same card with only the icon and the words changing. An
       event's card (In and Out; a training night with the locker room's quip and your team along its foot; or, not in
       it, You're out in their place), your next match, or a draft you're a captain in -->
  {#if lead}
    <section aria-labelledby="lead-title">
      <h2 class="section-title" id="lead-title">{leadTitle(lead)}</h2>
      {#if leadEvent}
        {#if session}
          <!-- The locker room's word, swapped in place when you answer. Its room is fixed, so nothing moves. -->
          <p class="message" aria-live="polite">
            <span class="sr-only">{quip?.text ?? ""}</span>
            <span aria-hidden="true"
              >{typed}{#if quip}<span class="caret" class:done={typed === quip.text}></span>{/if}</span
            >
          </p>
        {/if}
        <!-- The thing you came for: it makes an entrance, the rest of the page just rises -->
        <div class="lead">
          <EventCard
            event={leadEvent}
            canSignUp={can(perms, "signup:Event")}
            feature
            beckon
            glance
            link
            place={false}
            footer={myTeam ? teamLine : undefined}
            onanswer={session ? onanswer : undefined}
            body={outOfIt ? outBody : undefined}
          >
            {#snippet links()}{@render placeLinks(leadEvent)}{/snippet}
          </EventCard>
        </div>
      {:else if lead.kind === "fight"}
        {@const live = lead.fight.game.status === "live"}
        {@const m = matchOf(lead.fight)}
        <!-- On a team with a match to come: the Friday card's frame (its date, the type's icon, the place), the match's
             time in place of the night's, and you v them in place of In and Out. The whole card opens the match (on
             now, its live page) -->
        <div class="lead">
          <EventCard event={m.event} feature glance link place={false}>
            {#snippet links()}{@render placeLinks(m.event)}{/snippet}
            {#snippet body()}
              <span class="match-sides">
                {#each [m.ours, m.them] as s, k (k)}
                  {#if k === 1}<span class="match-v">v</span>{/if}
                  <span class="match-side" class:ours={k === 0}>
                    {#if s.id}<TeamCrest
                        among={m.crests}
                        name={s.name}
                        logo={s.logo}
                        tone={s.tone}
                        size="1.75rem"
                      />{/if}
                    <span class="match-name display">{s.name}</span>
                  </span>
                {/each}
              </span>
              <span class="match-meta">
                {#if live}<span class="match-live">Live</span>{/if}{m.game}
              </span>
            {/snippet}
          </EventCard>
        </div>
      {:else if lead.kind === "draft"}
        {@const d = lead.item}
        <!-- A draft you're a captain in: on now, or its day; the way into it -->
        <div class="lead lead-plain lead-draft">
          {#if d.on}<DateBlock at={d.on.at} />{:else}<span class="lead-icon"><Icon name="draft" size={28} /></span>{/if}
          <p class="lead-line">
            <strong>{d.sub.split(" · ")[0]}</strong><span>{d.sub.split(" · ").slice(1).join(" · ")}</span>
          </p>
          <div class="lead-actions">
            <a class="btn primary" href={d.href}>{d.hot ? "Make your pick" : "Open the draft"}</a>
          </div>
        </div>
      {/if}
    </section>
  {/if}

  <!-- Coming up: the next things after the hero, in date order, then the calendar -->
  <section class="feed" aria-labelledby="coming-up">
    {#if feed.upcoming.length}
      <h2 class="feed-label" id="coming-up">Coming up</h2>
      {#each feed.upcoming as r (r.key)}{@render upcomingItem(r)}{/each}
    {/if}
    <a class="past" href="/calendar">See the calendar<Icon name="chevronRight" size={16} /></a>
  </section>

  <!-- What needs you (your move first), and the store app's one ask -->
  {#if feed.now.length || askNotify}
    <section class="feed" aria-label="What needs you">
      {#each feed.now as n (n.key)}{@render item(n)}{/each}
      <!-- The one ask (ADR 0108): what notifications are for, then the phone's (or browser's) own question; on an iPhone
         in a Safari tab, the way to them -->
      {#if askNotify}
        <div class="item ask-notify rise">
          <span class="lead-col"><Icon name="bell" size={18} /></span>
          <span class="grow">
            <span class="item-text">Hear it first</span>
            {#if askNotify === "homeScreen"}
              <span class="item-sub"
                >On iPhone, add the app to your Home Screen (Share, then Add to Home Screen) and turn them on there.</span
              >
              <span class="note-links"><button class="link" onclick={notNow}>Got it</button></span>
            {:else}
              <span class="item-sub">Teams out, a place coming up, a night off: a notification, as it happens.</span>
              <span class="note-links">
                <button class="btn primary sm" onclick={turnOnNotifications}>Turn on notifications</button>
                <button class="link" onclick={notNow}>Not now</button>
              </span>
            {/if}
          </span>
        </div>
      {/if}
    </section>
  {/if}

  <!-- For admins: what only they act on, out of everyone's way -->
  {#if feed.admin.length}
    <section class="feed" aria-labelledby="for-admins">
      <h2 class="feed-label" id="for-admins">For admins</h2>
      {#each feed.admin as n (n.key)}{@render item(n)}{/each}
    </section>
  {/if}

  <!-- What you owe, at the foot while you owe anything: Settle up opens your tab -->
  {#if owing}
    <section class="notes" aria-labelledby="your-tab">
      <h2 class="feed-label room-label" id="your-tab">Your tab</h2>
      <article class="note owing rise">
        <Icon name="pound" size={18} />
        <div class="grow">
          <h2 class="note-title">{owing.text}</h2>
          <p class="note-body">{owing.sub}</p>
        </div>
        <a class="btn primary sm got-it" href={owing.href}>Settle up</a>
      </article>
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
  section {
    display: grid;
    gap: var(--s-3);
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
  /* A lead that isn't an event's card (your fight, a draft): on the page, not a panel; it lands like the card, without
     the glint, which is the card's */
  .lead-plain {
    display: grid;
    gap: var(--s-3);
  }
  .lead-plain::after {
    display: none;
  }
  /* Not in it: You're out, where In and Out would be */
  .out-line {
    display: flex;
    align-items: center;
  }
  /* Overdue: the hello's loud icon, the pound in the club's red with a small red badge on its corner */
  .overdue {
    position: relative;
    color: var(--red-hot);
  }
  .overdue:hover {
    color: var(--red-hot);
  }
  .overdue-badge {
    position: absolute;
    top: 0.1rem;
    right: 0.1rem;
    display: grid;
    place-items: center;
    width: 1rem;
    height: 1rem;
    border-radius: 50%;
    background: var(--red-hot);
    color: var(--primary);
    font-size: 0.7rem;
    font-weight: 800;
    line-height: 1;
  }
  /* Your next match, in the card: you v them, crests by the names, yours in the club's red (an accent, not a fill);
     which game, quiet, a red Live before it while it's played */
  .match-live {
    display: inline-flex;
    align-items: center;
    gap: var(--s-1);
    margin-right: var(--s-3);
    color: var(--red-hot);
    font-weight: 700;
    letter-spacing: 0.06em;
    text-transform: uppercase;
  }
  .match-live::before {
    content: "";
    width: 0.5rem;
    height: 0.5rem;
    border-radius: 50%;
    background: currentColor;
    animation: pulse 1.4s var(--ease-in-out) infinite;
  }
  /* You v them in a line, closing up from the left; a long name takes the next line whole, crest and all */
  .match-sides {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--s-2);
  }
  .match-side {
    display: flex;
    align-items: center;
    gap: var(--s-2);
    min-width: 0;
    max-width: 100%;
  }
  .match-name {
    min-width: 0;
    font-size: var(--text-md);
    line-height: 1.1;
    text-transform: uppercase;
    overflow-wrap: anywhere;
  }
  .ours .match-name {
    color: var(--red-hot);
  }
  .match-v {
    color: var(--fg-muted);
    font-size: var(--text-sm);
    font-style: italic;
  }
  .match-meta {
    display: flex;
    align-items: center;
    gap: var(--s-1) var(--s-3);
    min-width: 0;
    color: var(--fg-muted);
    font-size: var(--text-sm);
  }
  .lead-actions {
    display: flex;
    flex-wrap: wrap;
    gap: var(--s-2);
  }
  /* A phone: the main button across, under your thumb */
  @media (max-width: 600px) {
    .lead-actions .btn.primary {
      flex: 1 1 12rem;
    }
  }
  .lead-draft {
    grid-template-columns: auto minmax(0, 1fr);
    align-items: center;
    column-gap: var(--s-4);
  }
  .lead-draft .lead-actions {
    grid-column: 1 / -1;
  }
  .lead-icon {
    display: grid;
    place-items: center;
    width: 3.25rem;
    height: 3.25rem;
    color: var(--red-hot);
  }
  .lead-line {
    display: grid;
    gap: 0.15rem;
    margin: 0;
    color: var(--fg-muted);
    line-height: 1.3;
  }
  .lead-line strong {
    color: var(--fg);
    font-size: var(--text-lg);
    font-weight: 600;
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
