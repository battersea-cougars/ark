<script lang="ts">
  import { goesBy, shortName, shortNameOf } from "../lib/names";
  import { initials } from "../lib/initials";
  import { can } from "../access/actions";
  import { PLAYERS, referenceFor } from "../demo/data";
  import { owedBy } from "../demo/dues.svelte";
  import { granted, me } from "../demo/session.svelte";
  import { db } from "../demo/store.svelte";
  import Icon from "../app/shell/Icon.svelte";
  import EventCard from "../lib/EventCard.svelte";
  import { formatDayDate, formatTime, londonToday, pounds } from "../lib/dates";
  import { BUCKETS, aged } from "../lib/dues";
  import { signupOpen } from "../lib/signup";
  import { draftTurn } from "../lib/draft";
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

  // Announcements (#85): an admin's note at the top, until its last day or until you say "Got it". Whoever may post
  // writes one in a sheet over Home (ADR 0065), and can take one down from its card
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

  // In the store app (ADR 0108): say what notifications are for before the phone asks, once; "Not now" is remembered
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

  const who = $derived(me());
  // The soonest session of any training leads Home; the other trainings' next sessions follow, then the next
  // tournament of each type.
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
  const others = $derived(nexts.slice(1));
  const booking = $derived(session && sessionBookable(session));
  const next = $derived(
    session ?? { id: 0, going: [] as number[], waitlist: [] as number[], out: undefined as number[] | undefined },
  );
  const day = $derived(series?.shortName ?? "week");
  const tournaments = $derived(
    db.tournamentTypes
      .filter((t) => t.active)
      .map((type) => ({ type, t: latestTournament(type.id) }))
      // The next one, not one that's done (by its games, lib/edition.ts)
      .filter((x) => x.t && editionState(x.t) !== "done"),
  );
  // Each series' next one is teased up top (a tentative date or a season is enough: people know to keep it free)
  const later = $derived(
    others.map((o) => sessionBookable(o.session)).sort((x, y) => x.startsAt.localeCompare(y.startsAt)),
  );
  // For you (ADR 0060, 0042): a captain's draft, the draft an admin runs, a sign-up about to close you haven't answered
  type Nudge = {
    key: string;
    href?: string;
    text: string;
    sub: string;
    hot: boolean;
    icon?: "draft" | "teams" | "pound";
  };
  const nth = (n: number) => `${n}${n === 1 ? "st" : n === 2 ? "nd" : n === 3 ? "rd" : "th"}`;
  const today = londonToday();
  const nudges = $derived(
    db.agenda
      .filter((r) => r.day >= today && (r.kind === "draft" || r.kind === "signup_closes"))
      .flatMap((r): Nudge[] => {
        const t = db.tournaments.find((x) => x.id === r.sourceId);
        const type = t && db.tournamentTypes.find((y) => y.id === t.typeId);
        if (!t || !type) return [];
        const when = r.allDay ? formatDayDate(r.startsAt) : `${formatDayDate(r.startsAt)} at ${formatTime(r.startsAt)}`;
        if (r.kind === "signup_closes") {
          if (!signupOpen(t, londonToday()) || t.going.includes(who.id) || t.waitlist.includes(who.id)) return [];
          return [
            {
              key: r.key,
              href: `/tournaments/${type.slug}`,
              text: `Sign-up for ${t.name} closes ${when}`,
              sub: "Are you in?",
              hot: false,
            },
          ];
        }
        const draft = `/tournaments/${type.slug}/draft`;
        const mine = t.teams.findIndex((x) => x.captainMemberId === who.id);
        // Picks, as the server counts them: a player an admin put on by hand isn't one
        // An open draft has a card of its own (liveDrafts), whatever day it was meant for
        if (t.draftState === "open") return [];
        if (mine >= 0) {
          return [
            {
              key: r.key,
              href: draft,
              text: `Draft ${when}`,
              sub: `${t.name} · you pick ${nth(mine + 1)}`,
              hot: false,
            },
          ];
        }
        if (!can(perms, "run:Draft")) return [];
        return [
          {
            key: r.key,
            href: draft,
            text: `Draft ${when}`,
            sub: `${t.name} · open it when the captains are ready`,
            hot: false,
          },
        ];
      }),
  );
  // A draft that's open, for its captains and whoever runs it: on until it's closed, however long that takes. A
  // captain hears when it's their pick, or how many picks away it is
  const liveDrafts = $derived(
    tournaments.flatMap(({ type, t }): Nudge[] => {
      if (!t || t.kind !== "draft" || t.draftState !== "open") return [];
      const mine = t.teams.findIndex((x) => x.captainMemberId === who.id);
      if (mine < 0 && !can(perms, "run:Draft")) return [];
      const href = `/tournaments/${type.slug}/draft`;
      const key = `draft-open:${t.id}`;
      const { left, until } = draftTurn(t, mine);
      if (!left)
        return [
          { key, href, text: "Everyone's picked", sub: `${t.name} · the draft closes to set the teams`, hot: false },
        ];
      if (mine < 0)
        return [{ key, href, text: "The draft's open", sub: `${t.name} · close it once everyone's picked`, hot: true }];
      if (until === 0)
        return [{ key, href, text: "It's your pick", sub: `${t.name} draft · you're on the clock`, hot: true }];
      return [
        {
          key,
          href,
          text: "The draft's open",
          sub: until < Infinity ? `${t.name} · you pick in ${until}` : `${t.name} · your picks are done`,
          hot: false,
        },
      ];
    }),
  );
  // Everyone else (ADR 0060): the draft is the captains' business, so a member hears that it's on, with nothing to
  // open; once it's closed, the teams are out, and that's a link to them
  const draftNews = $derived(
    can(perms, "run:Draft")
      ? []
      : tournaments.flatMap(({ type, t }): Nudge[] => {
          if (!t || t.kind !== "draft" || t.teams.some((x) => x.captainMemberId === who.id)) return [];
          if (t.draftState === "open")
            return [
              {
                key: `draft-on:${t.id}`,
                text: `The ${t.name} draft is on`,
                sub: "The captains are picking. You'll see the teams when they're done.",
                hot: false,
              },
            ];
          if (t.draftState === "closed" && t.teams.some((x) => x.players.length))
            return [
              {
                key: `teams-out:${t.id}`,
                href: `/tournaments/${type.slug}/teams`,
                text: "The teams are out",
                sub: `${t.name} · see who you're playing with`,
                hot: false,
                icon: "teams",
              },
            ];
          return [];
        }),
  );
  const isIn = $derived(next.going.includes(who.id));
  const waiting = $derived(next.waitlist.includes(who.id));
  const declined = $derived(next.out?.includes(who.id) ?? false);
  const answered = $derived(isIn || waiting || declined);
  // Out since the teams were made: still on one until a team maker decides (ADR 0076), but not yours to play on
  const myTeam = $derived(isIn ? db.teams[next.id]?.find((t) => t.players.includes(who.id)) : undefined);
  const owed = $derived(owedBy(who.id));
  // Dues, on Home, only once something's really late (a Misconduct: over 60 days). Before that the pound badge on
  // the Dues tab says it, and the session leads (ADR 0007)
  const late = $derived(
    aged(
      db.charges.filter((c) => c.memberId === who.id),
      today,
    )[0],
  );
  const nag = $derived(owed > 0 && (late?.oldest ?? 0) >= 2);
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
  // For you: one spot under the lead card for everything else that wants your attention, your move first. Slim
  // rows, never cards, so however many there are the session still leads the page.
  const forYou = $derived.by((): Nudge[] => {
    const rows: Nudge[] = [];
    if (nag)
      rows.push({
        key: "dues",
        href: "/me/tab",
        text: `You owe the club ${pounds(owed)}`,
        sub: `Some of it's over 60 days · reference ${referenceFor(who.id)}`,
        hot: true,
        icon: "pound",
      });
    rows.push(...liveDrafts, ...nudges, ...draftNews);
    if (club && club.total > 0)
      rows.push({
        key: "club-dues",
        href: "/settings/overdue",
        text: `Owed to the club ${pounds(club.total)}`,
        sub: `${club.people} ${club.people === 1 ? "person" : "people"}${club.worst > 0 ? ` · ${pounds(club.worst)} ${BUCKETS[3]} (over 90 days)` : ""}`,
        hot: false,
        icon: "pound",
      });
    return rows.sort((a, b) => Number(b.hot) - Number(a.hot));
  });
  // The squad, one tap from Home (Teammates: everyone's card, by position, searchable); on a phone it's otherwise
  // under You. A few faces, the count and the Cougars among them.
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
    const today = londonToday();
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

<div class="page">
  <header class="hello">
    <!-- Your badge: the last tab on a phone (your profile), the corner on a desktop -->
    <div class="hello-top">
      <p class="kicker">Battersea Cougars</p>
    </div>
    <h1 class="display poster">{hello}</h1>
    {#if poster}
      <button class="btn ghost sm announce-btn" onclick={() => (announcing = true)}
        ><Icon name="plus" size={16} />Announcement</button
      >
    {/if}
  </header>

  <!-- Announcements: the club's word, before anything else, until it ends or you're done with it -->
  {#if db.announcements.length || hadNotes}
    <section class="notes" aria-label="Announcements">
      {#each db.announcements as a (a.id)}
        <article class="note rise" out:slide={{ duration: prefersReducedMotion ? 0 : 280 }}>
          <div class="note-main">
            <Icon name="megaphone" size={18} />
            <div class="grow">
              <h2 class="note-title">{a.title}</h2>
              {#if a.body}<p class="note-body">{a.body}</p>{/if}
            </div>
          </div>
          <div class="note-foot">
            <div class="note-links">
              {#if a.link}<a href={a.link} target="_blank" rel="noopener noreferrer">Read more</a>{/if}
              {#if poster}<button class="link" onclick={() => removeAnnouncement(a.id)}>Take down</button>{/if}
            </div>
            <button
              class="btn primary got-it"
              class:done={got[a.id]}
              aria-label="Got it: {a.title}"
              aria-pressed={!!got[a.id]}
              onclick={() => gotIt(a.id)}
              >{#if got[a.id]}<Icon name="check" size={18} />{/if}Got it</button
            >
          </div>
        </article>
      {/each}
      <a class="past" href="/more/announcements">Past announcements<Icon name="chevronRight" size={16} /></a>
    </section>
  {/if}

  <!-- The store app's one ask (ADR 0108): what notifications are for, then the phone's own question -->
  {#if askNotify}
    <section class="notes" aria-label="Notifications">
      <article class="note rise">
        <Icon name="bell" size={18} />
        <div class="grow">
          <h2 class="note-title">Hear it first</h2>
          <p class="note-body">Teams out, a place coming up, a night off: a notification, as it happens.</p>
          <div class="note-links">
            <button class="btn primary sm" onclick={turnOnNotifications}>Turn on notifications</button>
            <button class="link" onclick={notNow}>Not now</button>
          </div>
        </div>
      </article>
    </section>
  {/if}

  {#if series && session && booking}
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

  {#if forYou.length}
    <section aria-labelledby="for-you">
      <h2 class="section-title" id="for-you">For you</h2>
      <div class="nudges">
        {#each forYou as n (n.key)}
          {#if n.href}
            <a class="nudge rise" class:hot={n.hot} href={n.href}>
              <Icon name={n.icon ?? "draft"} size={18} />
              <span class="grow"><span class="nudge-text">{n.text}</span><span class="nudge-sub">{n.sub}</span></span>
              <Icon name="chevronRight" size={16} />
            </a>
          {:else}
            <!-- Just news: nothing to open -->
            <div class="nudge rise" role="status">
              <Icon name={n.icon ?? "draft"} size={18} />
              <span class="grow"><span class="nudge-text">{n.text}</span><span class="nudge-sub">{n.sub}</span></span>
              <span class="badge red live">Live</span>
            </div>
          {/if}
        {/each}
      </div>
    </section>
  {/if}

  <!-- The squad: the way to everyone's card, not buried under You -->
  {#if squad.length > 1}
    <section aria-labelledby="squad">
      <h2 class="section-title" id="squad">Teammates</h2>
      <div class="list">
        <a class="row" href="/more/teammates">
          <span class="faces" aria-hidden="true">
            {#each squad.slice(0, 4) as p (p.id)}<span class="avatar">{initials(goesBy(p))}</span>{/each}
          </span>
          <span class="grow">
            <span class="title">Everyone who plays</span>
            <span class="sub">{squad.length} players{cougars ? ` · ${cougars} Cougars` : ""}</span>
          </span>
          <Icon name="chevronRight" size={18} />
        </a>
      </div>
    </section>
  {/if}

  <!-- The next of each tournament series, teased: when (or the season), signing up, and the way to its page -->
  {#each tournaments as { type, t } (type.id)}
    {#if t}
      {@const ev = tournamentBookable(t)}
      <section>
        <h2 class="section-title">The next {type.shortName}</h2>
        <!-- Like the lead card: the whole card opens the tournament's page (the draft, the teams, last time's
             champions) -->
        <EventCard event={ev} canSignUp={can(perms, "signup:Event")} feature glance link place={false}>
          {#snippet links()}{@render placeLinks(ev)}{/snippet}
        </EventCard>
      </section>
    {/if}
  {/each}

  <!-- Everything after the lead session, in date order: other trainings, then tournaments as they come -->
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

  {#if later.length}
    <section>
      <h2 class="section-title">Later</h2>
      {#each later as ev (ev.key)}
        <EventCard event={ev} canSignUp={can(perms, "signup:Event")} compact link />
      {/each}
    </section>
  {/if}
</div>

<style>
  /* A few of the squad's faces, overlapping, in the row to Teammates */
  .faces {
    display: flex;
    flex-shrink: 0;
  }
  .faces .avatar {
    width: 2rem;
    height: 2rem;
    box-shadow: 0 0 0 2px var(--bg);
    background: var(--surface-3);
    font-size: 0.68rem;
  }
  .faces .avatar + .avatar {
    margin-left: -0.35rem;
  }
  .hello {
    display: grid;
    gap: var(--s-3);
    padding-top: var(--s-2);
  }
  .hello-top {
    display: flex;
    align-items: center;
    min-height: 1.5rem;
  }
  @media (min-width: 901px) {
    /* Your badge is in the corner, so the kicker is just an eyebrow: the title lands where every page's does */
    .hello {
      padding-top: 0;
    }
    .hello-top {
      margin-bottom: calc(var(--s-2) - var(--s-3));
    }
  }
  .hello h1 {
    font-size: clamp(2.6rem, 10vw, 3.4rem);
    letter-spacing: 0.005em;
  }
  /* Phones are short of height: the greeting gets straight to it (no kicker, a smaller poster), and Friday's card
     comes up into the first screen */
  @media (max-width: 900px) {
    .hello {
      padding-top: 0;
    }
    .hello-top {
      display: none;
    }
    .hello h1 {
      font-size: clamp(1.9rem, 8vw, 2.4rem);
    }
  }
  section {
    display: grid;
    gap: var(--s-3);
  }
  .hello {
    position: relative;
  }
  .announce-btn {
    justify-self: start;
  }
  /* An announcement: the club's word, on glass like the tables (ADR 0065), its icon in the brand's red. Each keeps
     its own space below it (not the section's gap), so one folding away takes its space with it: nothing jumps */
  .notes {
    gap: 0;
  }
  .note {
    display: grid;
    gap: var(--s-3);
    margin-bottom: var(--s-3);
    padding: var(--s-4);
    background: var(--glass);
    backdrop-filter: var(--blur);
    -webkit-backdrop-filter: var(--blur);
    overflow: hidden;
  }
  .note-main {
    display: flex;
    align-items: flex-start;
    gap: var(--s-3);
  }
  .note-main > .grow {
    flex: 1;
    min-width: 0;
  }
  .note-main > :global(svg) {
    flex-shrink: 0;
    margin-top: 0.15rem;
    color: var(--red-hot);
  }
  .note-title {
    margin: 0;
    color: var(--fg);
    font-size: var(--text-base);
    font-weight: 600;
  }
  .note-body {
    margin: var(--s-1) 0 0;
    color: var(--fg-body);
    line-height: 1.45;
  }
  /* The links on the left, "Got it" on the right: under a thumb on a phone */
  .note-foot {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--s-3);
  }
  /* A desktop has the room: "Got it" sits beside what it says, not under it */
  @media (min-width: 901px) {
    .note {
      grid-template-columns: minmax(0, 1fr) auto;
      align-items: center;
      gap: var(--s-5);
    }
  }
  .note-links {
    display: flex;
    align-items: center;
    gap: var(--s-4);
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
    min-width: 7.5rem;
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
  /* Bigger breaks between blocks than within them */
  .page {
    gap: var(--s-8);
  }
  @media (max-width: 900px) {
    .page {
      gap: var(--s-6);
    }
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
  /* For you: a nudge per thing to do, quiet unless it's your move now */
  .nudges {
    display: grid;
    gap: var(--s-2);
  }
  .nudge {
    display: flex;
    align-items: center;
    gap: var(--s-3);
    padding: var(--s-3) var(--s-4);
    border-radius: var(--r-lg);
    background: var(--surface-1);
    color: var(--fg);
  }
  a.nudge:hover {
    background: var(--surface-2);
  }
  .nudge.hot {
    background: var(--red-wash);
  }
  .nudge.hot :global(svg:first-child) {
    color: var(--red-hot);
  }
  .nudge .grow {
    display: grid;
  }
  .nudge-text {
    font-weight: 600;
  }
  .nudge-sub {
    color: var(--fg-muted);
    font-size: var(--text-sm);
  }
</style>
