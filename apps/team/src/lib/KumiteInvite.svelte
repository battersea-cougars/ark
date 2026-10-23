<script lang="ts">
  // The Kumite's sign-up, as an invitation (ADR 0074): in Bloodsport the Kumite is underground and by invitation only,
  // so a member who hasn't answered gets a sealed card, its wax seal the club's red (招, "invite": lib/motif.ts), the
  // day, the time and the place, and Accept or Decline (the same calls as Friday's In and Out). Accepting breaks the
  // seal (the halves crack apart and fall; reduced motion: at once) and the card becomes your fighter's pass: your
  // number (your place in the sign-up order, lib/fighters.ts), your name on it like a poster, the Kumite's kanji, the
  // day, and Withdraw (with a confirm). On the waitlist it's a reserve's pass; declined, a quiet line and Accept.
  // Every face is stacked in the one cell, so the card is always the size of the biggest and nothing moves.
  import type { Tournament, TournamentType } from "../demo/model";
  import { impersonating, me } from "../demo/session.svelte";
  import { answerFor } from "../app/backend.svelte";
  import { PLAYERS } from "../demo/data";
  import { tournamentBookable } from "../demo/schedule.svelte";
  import { formatDayDate, timeRange } from "./dates";
  import { fighterLabel, fighterNo, fighterOf } from "./fighters";
  import { kanjiFor } from "./motif";
  import Kanji from "./Kanji.svelte";
  import Icon from "../app/shell/Icon.svelte";
  import { prefersReducedMotion } from "../app/motion";
  import { tick } from "svelte";

  let { tournament: t, type }: { tournament: Tournament; type: TournamentType } = $props();

  const id = $derived(me().id);
  // Viewing as someone is read-only (ADR 0024): their card, without the buttons doing anything
  const locked = $derived(impersonating());
  const fighter = $derived(fighterOf(t, id));
  const face = $derived(!fighter ? "sealed" : fighter.is === "declined" ? "declined" : "pass");
  const name = $derived(PLAYERS.find((p) => p.id === id)?.name ?? "");
  const event = $derived(tournamentBookable(t));
  const day = $derived(
    event.season
      ? `${event.season.name[0].toUpperCase()}${event.season.name.slice(1)} ${event.season.year}`
      : formatDayDate(event.startsAt),
  );
  const hours = $derived(event.dateTbc ? "Date to be confirmed" : timeRange(event.startsAt, event.endsAt));
  const full = $derived(t.capacity != null && t.going.length >= t.capacity);
  const left = $derived(t.capacity != null ? Math.max(0, t.capacity - t.going.length) : null);
  const tally = $derived(
    full
      ? "The card's full: accept and you're a reserve"
      : `${t.going.length} in` + (left !== null ? ` · ${left} ${left === 1 ? "place" : "places"} left` : ""),
  );

  // The seal breaking: a moment's animation, then the pass is just there
  let breaking = $state(false);
  let confirming = $state(false);
  let passAt = $state<HTMLElement>();

  // The card answers at once, as Friday's does (lib/EventCard); the server's word arrives with the refresh. In takes
  // a place if there's one, else the reserves; out lets the first reserve in
  async function answer(going: boolean) {
    if (locked) return;
    const inIt = t.going.includes(id) || t.waitlist.includes(id);
    if (going ? inIt : t.out?.includes(id)) return;
    void answerFor(`tournament:${t.id}`, going ? "in" : "out");
    const wasIn = t.going.includes(id);
    t.going = t.going.filter((x) => x !== id);
    t.waitlist = t.waitlist.filter((x) => x !== id);
    t.out = (t.out ?? []).filter((x) => x !== id);
    confirming = false;
    if (!going) {
      t.out = [...t.out, id];
      const up = wasIn && t.capacity != null && t.going.length < t.capacity ? t.waitlist[0] : undefined;
      if (up !== undefined) {
        t.going = [...t.going, up];
        t.waitlist = t.waitlist.slice(1);
      }
      return;
    }
    if (!prefersReducedMotion) {
      breaking = true;
      setTimeout(() => (breaking = false), 900);
    }
    if (t.capacity != null && t.going.length >= t.capacity) t.waitlist = [...t.waitlist, id];
    else t.going = [...t.going, id];
    // The buttons you pressed are gone: your pass takes the focus
    await tick();
    passAt?.focus({ preventScroll: true });
  }
</script>

<article
  class="invite {face}"
  class:breaking
  class:reserve={fighter?.is === "reserve"}
  aria-label="Your invitation to the {type.shortName}"
>
  <!-- The sealed invitation: who it's from, what, when and where, and the two answers -->
  <div class="face sealed-face" class:on={face === "sealed"} inert={face !== "sealed"}>
    <span class="eyebrow">By invitation only</span>
    <h2 class="display title">You've been invited to the {type.shortName}</h2>
    <p class="when">
      <span class="num">{day}</span><span class="num">{hours}</span>{#if event.venue}<span
          ><Icon name="pin" size={14} />{event.venue}</span
        >{/if}
    </p>
    <p class="tally num">{tally}</p>
    <div class="answers">
      <button class="btn primary" disabled={locked} onclick={() => answer(true)}>Accept</button>
      <button class="btn ghost" disabled={locked} onclick={() => answer(false)}>Decline</button>
    </div>
  </div>

  <!-- The fighter's pass (or a reserve's): the number, the name like a poster, the day; Withdraw, with a confirm -->
  <div class="face pass-face" class:on={face === "pass"} inert={face !== "pass"}>
    <span class="watermark" lang="ja" aria-hidden="true">{kanjiFor(type, "onTheMat")}</span>
    <div class="pass-top" bind:this={passAt} tabindex="-1">
      <span class="eyebrow">{fighter?.is === "reserve" ? "Reserve's pass" : "Your pass"}</span>
      <span class="sr-only">{fighterLabel(fighter)}</span>
      <span class="number" aria-hidden="true"
        ><span class="no-label">{fighter?.is === "reserve" ? "Reserve No." : "You're in · No."}</span><span
          class="no display num">{fighter && fighter.is !== "declined" ? fighterNo(fighter.no) : "00"}</span
        ></span
      >
    </div>
    <span class="seal-stamp"><Kanji text={kanjiFor(type, "onTheMat")} seal /></span>
    <strong class="name display">{name}</strong>
    <p class="when">
      <span class="num">{day}</span><span class="num">{hours}</span>{#if event.venue}<span
          ><Icon name="pin" size={14} />{event.venue}</span
        >{/if}
    </p>
    <div class="answers">
      {#if confirming}
        <span class="ask">Give up your place?</span>
        <button class="btn sm outline leave" disabled={locked} onclick={() => answer(false)}>Withdraw</button>
        <button class="btn sm ghost" onclick={() => (confirming = false)}>Keep it</button>
      {:else}
        <span class="ask quiet"
          >{fighter?.is === "reserve" ? "A place comes up, it's yours." : "See you on the mat."}</span
        >
        <button class="btn sm ghost" disabled={locked} onclick={() => (confirming = true)}>Withdraw</button>
      {/if}
    </div>
  </div>

  <!-- Declined: said quietly, with the way back -->
  <div class="face declined-face" class:on={face === "declined"} inert={face !== "declined"}>
    <span class="eyebrow">By invitation only</span>
    <h2 class="display title quiet">You declined.</h2>
    <p class="when">
      <span class="num">{day}</span><span class="num">{hours}</span>{#if event.venue}<span
          ><Icon name="pin" size={14} />{event.venue}</span
        >{/if}
    </p>
    <p class="tally num">Changed your mind? {full ? "You'd be a reserve." : "There's still a place."}</p>
    <div class="answers">
      <button class="btn outline" disabled={locked} onclick={() => answer(true)}>Accept</button>
    </div>
  </div>

  <!-- The wax seal, on the invitation until it's broken; as you accept it cracks in two and the halves fall away -->
  {#if face !== "pass" || breaking}
    <span class="seal" class:dim={face === "declined"} aria-hidden="true">
      <span class="half l"><span class="wax" lang="ja">{kanjiFor(type, "invite")}</span></span>
      <span class="half r"><span class="wax" lang="ja">{kanjiFor(type, "invite")}</span></span>
    </span>
  {/if}
</article>

<style>
  /* A dark card, no outline: the seal is its colour. Every face in the one cell */
  .invite {
    position: relative;
    display: grid;
    grid-template-columns: minmax(0, 1fr);
    overflow: hidden;
    padding: var(--s-6);
    border-radius: var(--r-lg);
    background:
      radial-gradient(120% 90% at 100% 0%, rgb(255 255 255 / 0.035), transparent 60%),
      linear-gradient(165deg, #141210, #0b0a09);
    box-shadow: inset 0 1px 0 rgb(255 255 255 / 0.05);
    isolation: isolate;
  }
  .face {
    position: relative;
    grid-area: 1 / 1;
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    gap: var(--s-3);
    min-width: 0;
    opacity: 0;
    visibility: hidden;
    transition:
      opacity 220ms ease,
      visibility 0s linear 220ms;
  }
  .face.on {
    opacity: 1;
    visibility: visible;
    transition: opacity 320ms ease;
  }
  /* The seal cracks first; the pass shows as its halves fall */
  .breaking .pass-face.on {
    transition-delay: 360ms;
  }
  .eyebrow {
    color: var(--fg-muted);
    font-size: var(--text-xs);
    font-weight: 600;
    letter-spacing: var(--tracking-label);
    text-transform: uppercase;
  }
  .title {
    max-width: 18ch;
    margin: 0;
    padding-right: 5.5rem;
    color: var(--fg);
    font-size: clamp(1.9rem, 6vw, 2.6rem);
    line-height: 0.98;
  }
  .title.quiet {
    color: var(--fg-muted);
  }
  .when {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--s-1) var(--s-4);
    margin: 0;
    color: var(--fg);
    font-weight: 500;
  }
  .when span {
    display: inline-flex;
    align-items: center;
    gap: var(--s-1);
  }
  .when span:last-child:not(:nth-child(2)) {
    color: var(--fg-muted);
    font-weight: 400;
  }
  .tally {
    margin: 0;
    color: var(--fg-muted);
    font-size: var(--text-sm);
  }
  .answers {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--s-2) var(--s-3);
    margin-top: auto;
    padding-top: var(--s-2);
  }
  .sealed-face .answers .btn {
    min-width: 7.5rem;
  }

  /* ─── The pass ─── */
  .pass-top {
    display: grid;
    gap: var(--s-1);
    outline: none;
  }
  .pass-top:focus-visible {
    outline: 2px solid var(--focus, var(--fg));
    outline-offset: 4px;
  }
  .number {
    display: flex;
    align-items: baseline;
    gap: var(--s-3);
  }
  .no-label {
    color: var(--fg-muted);
    font-family: var(--font-display);
    font-size: 1.25rem;
    letter-spacing: 0.04em;
    text-transform: uppercase;
  }
  .no {
    color: var(--fg);
    font-size: clamp(3.75rem, 14vw, 5rem);
    line-height: 0.85;
  }
  .reserve .no,
  .reserve .name {
    color: var(--fg-muted);
  }
  .name {
    max-width: 100%;
    color: var(--fg);
    font-size: clamp(1.7rem, 6vw, 2.4rem);
    font-weight: 400;
    line-height: 1;
    letter-spacing: 0.02em;
    text-transform: uppercase;
    overflow-wrap: anywhere;
  }
  /* 組手 down the right of the pass, faint, like the poster's */
  .watermark {
    position: absolute;
    top: -0.5rem;
    right: -0.25rem;
    color: rgb(255 255 255 / 0.035);
    font-family: var(--font-kanji);
    font-size: 6.5rem;
    font-weight: 900;
    line-height: 1;
    writing-mode: vertical-rl;
    pointer-events: none;
    z-index: -1;
  }
  .seal-stamp {
    position: absolute;
    top: 0.25rem;
    right: 0.25rem;
  }
  .reserve .seal-stamp {
    opacity: 0.55;
  }
  .ask {
    color: var(--fg);
    font-size: var(--text-sm);
    font-weight: 600;
  }
  .ask.quiet {
    color: var(--fg-muted);
    font-weight: 400;
  }
  .btn.leave {
    color: var(--red-hot);
  }

  /* ─── The wax seal: the club's red, its edge uneven, a ring pressed into it, 招 in it ─── */
  .seal {
    position: absolute;
    top: var(--s-5);
    right: var(--s-5);
    width: 4.75rem;
    height: 4.75rem;
    pointer-events: none;
    transition: opacity 220ms ease;
  }
  .seal.dim {
    opacity: 0.35;
  }
  .half {
    position: absolute;
    inset: 0;
  }
  /* Split along a crack, so breaking it is just the halves going their ways */
  .half.l {
    clip-path: polygon(0 0, 54% 0, 46% 28%, 58% 52%, 47% 74%, 53% 100%, 0 100%);
  }
  .half.r {
    clip-path: polygon(54% 0, 100% 0, 100% 100%, 53% 100%, 47% 74%, 58% 52%, 46% 28%);
  }
  .wax {
    display: grid;
    place-items: center;
    width: 100%;
    height: 100%;
    border-radius: 47% 53% 50% 50% / 52% 46% 54% 48%;
    background: radial-gradient(
      circle at 36% 30%,
      color-mix(in srgb, var(--red) 82%, white) 0,
      var(--red) 34%,
      color-mix(in srgb, var(--red) 62%, black) 100%
    );
    box-shadow:
      inset 0 0 0 0.3rem color-mix(in srgb, var(--red) 70%, black),
      inset 0 0 0 0.42rem color-mix(in srgb, var(--red) 88%, white),
      0 0.35rem 0.9rem rgb(0 0 0 / 0.45);
    color: color-mix(in srgb, var(--primary) 88%, var(--red));
    font-family: var(--font-kanji);
    font-size: 2.05rem;
    font-weight: 900;
    line-height: 1;
    transform: rotate(-8deg);
  }
  .breaking .seal {
    animation: press 140ms ease-out;
  }
  .breaking .half.l {
    animation: fall-l 640ms 120ms cubic-bezier(0.4, 0, 0.9, 0.6) forwards;
  }
  .breaking .half.r {
    animation: fall-r 640ms 120ms cubic-bezier(0.4, 0, 0.9, 0.6) forwards;
  }
  @keyframes press {
    50% {
      transform: scale(1.08);
    }
  }
  @keyframes fall-l {
    0% {
      transform: none;
    }
    18% {
      transform: translate(-0.2rem, 0) rotate(-4deg);
      opacity: 1;
    }
    100% {
      transform: translate(-1.4rem, 3.5rem) rotate(-34deg);
      opacity: 0;
    }
  }
  @keyframes fall-r {
    0% {
      transform: none;
    }
    18% {
      transform: translate(0.25rem, 0) rotate(5deg);
      opacity: 1;
    }
    100% {
      transform: translate(1.2rem, 4rem) rotate(28deg);
      opacity: 0;
    }
  }

  @media (max-width: 600px) {
    .invite {
      padding: var(--s-5);
    }
    .seal {
      top: var(--s-4);
      right: var(--s-4);
      width: 4rem;
      height: 4rem;
    }
    .wax {
      font-size: 1.7rem;
    }
    .title {
      padding-right: 4.25rem;
    }
  }
  @media (prefers-reduced-motion: reduce) {
    .face,
    .face.on,
    .seal {
      transition: none;
    }
  }
</style>
