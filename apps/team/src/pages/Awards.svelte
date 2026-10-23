<script lang="ts">
  // The awards (ADR 0074, 0044): a page of their own, a stage. One card, centred, big: the award now, sealed (its
  // name, and "?" for who took it), then revealed. Whoever runs it has one button under the card: Confirm the awards
  // (the drawer) till they're confirmed, then Reveal (The champions for the finale), then Next award, which dissolves
  // the card as the next one zooms in, sealed. Everyone else's place under it says Waiting for the reveal, and their
  // vote's there till the awards are confirmed. Every phone follows each step live (the live hub), each playing the
  // same beat from the change of state (lib/afters beatOf; the timing, lib/award-reveal.css); opened late or
  // reloaded, it's just where it is. The stage's room is the finale's from the start, so nothing round it moves, and
  // nothing scrolls. After the last, once its beat's landed: the champions up on the stage (wherever they're listed),
  // the way back to the Kumite's page under them, every other award a smaller card in a grid (lib/AwardsWon), face
  // up, then the final table and the day's results.
  import { untrack } from "svelte";
  import Icon from "../app/shell/Icon.svelte";
  import { nextAward, revealAward } from "../app/backend.svelte";
  import { can } from "../access/actions";
  import { granted } from "../demo/session.svelte";
  import { PLAYERS } from "../demo/data";
  import { currentTournament, typeById } from "../demo/schedule.svelte";
  import { isDone } from "@cougars/shared/results";
  import { checkForUpdates } from "../lib/live-updates.svelte";
  import { enterAwards } from "../lib/AwardsDrawer.svelte";
  import TournamentHead from "../lib/TournamentHead.svelte";
  import AwardStage from "../lib/AwardStage.svelte";
  import CastYourVote from "../lib/CastYourVote.svelte";
  import AwardsWon from "../lib/AwardsWon.svelte";
  import FinalResults from "../lib/FinalResults.svelte";
  import { beatOf, cueOf, isFinale, revealOf, toConfirmOf, type Card } from "../lib/afters";
  import "../lib/award-reveal.css";

  let { typeId }: { typeId: number } = $props();

  const type = $derived(typeById(typeId)!);
  const t = $derived(currentTournament(typeId));
  const manage = $derived(can(granted(), "manage:Tournament"));
  const done = $derived(!!t && isDone(t.status, t.games ?? []));
  const reveal = $derived(t ? revealOf(t) : null);
  const cue = $derived(reveal && done ? cueOf(reveal, manage) : null);
  const back = $derived({ href: `/tournaments/${type.slug}` });

  // Everyone follows the reveal as it happens (ADR 0072)
  $effect(() => {
    if (done && !reveal?.all) return checkForUpdates();
  });

  // The card on the stage, and the beat its last change plays: the reveal, or the next card coming in as the last
  // dissolves. Opened late, or a step missed: no beat, it's just where it is
  let shown = $state<Card>(untrack(() => reveal?.drum ?? { at: 0, face: "sealed" }));
  let beat = $state<"reveal" | "next" | null>(null);
  let leaving = $state<number | null>(null);
  let timer: ReturnType<typeof setTimeout> | undefined;
  $effect.pre(() => {
    const now = reveal?.drum;
    if (!now) return;
    untrack(() => {
      if (now.at === shown.at && now.face === shown.face) return;
      beat = beatOf(shown, now);
      leaving = beat === "next" ? shown.at : null;
      shown = now;
      clearTimeout(timer);
      // The dissolving card goes once it's faded (lib/award-reveal.css --dissolve-ms, with room to spare)
      if (leaving !== null) timer = setTimeout(() => (leaving = null), 900);
    });
  });
  $effect(() => () => clearTimeout(timer));

  const awards = $derived(reveal?.awards ?? []);
  const finale = (i: number) => !!awards[i] && isFinale(awards[i]);
  const hasFinale = $derived(awards.some((a) => isFinale(a)));
  const championsAt = $derived(awards.findIndex((a) => isFinale(a)));

  // The end: every one's out and the last beat's landed (the button's place coming back says so). Opened late or
  // reloaded, it's there at once; live, the grid and the table fade in after it
  let ended = $state(untrack(() => !!reveal?.all));
  let fresh = $state(false);
  let fallback: ReturnType<typeof setTimeout> | undefined;
  $effect(() => {
    if (!reveal?.all || ended) return;
    // A step missed (no beat): it's just there
    if (!beat) return untrack(() => void (ended = true));
    // Should the beat never run (no animations at all), the end still comes
    fallback = setTimeout(land, 12000);
    return () => clearTimeout(fallback);
  });
  function land() {
    if (ended || !reveal?.all) return;
    clearTimeout(fallback);
    ended = true;
    fresh = true;
    // The last out wasn't the champions: it dissolves as they come back up
    if (championsAt >= 0 && shown.at !== championsAt) {
      leaving = shown.at;
      beat = "next";
      clearTimeout(timer);
      timer = setTimeout(() => (leaving = null), 900);
    }
  }
  // The card on the stage: the champions once it's ended (none without them), till then the one shown
  const onStage = $derived(ended ? championsAt : shown.at);

  // One tap, one step: the tap says where it saw the card, so a double tap (or a second phone) moves it once
  let busy = $state(false);
  async function go() {
    if (busy || !t || !reveal) return;
    busy = true;
    try {
      if (cue === "reveal" || cue === "champions") await revealAward(t.id, reveal.revealed);
      else if (cue === "next") await nextAward(t.id, reveal.revealed);
    } finally {
      busy = false;
    }
  }
  const BUTTON = {
    reveal: { label: "Reveal", icon: "medal" },
    champions: { label: "The champions", icon: "trophy" },
    next: { label: "Next award", icon: "chevronRight" },
  } as const;

  // Before they're confirmed, for whoever runs it: the votes so far and what's still to choose
  const positionOf = (id: number) => PLAYERS.find((p) => p.id === id)?.position;
  const toConfirm = $derived(t ? toConfirmOf(t, { positionOf }) : "");
</script>

<div class="page">
  <TournamentHead {type} tournament={t ?? undefined} title="The awards" {back} />

  {#if !t || !reveal || !awards.length}
    <p class="note">No awards this time.</p>
  {:else if !done}
    <p class="note">The awards come out at the after-party, once the last match is played.</p>
  {:else}
    <div class="awards award-reveal" class:finale={finale(onStage)}>
      <!-- The stage: the finale's room from the start, the card centred in it; the last card dissolves here as the
           next comes in. Once it's ended, the champions' (none without them) -->
      {#if !ended || championsAt >= 0}
        <div class="stage" class:tall={hasFinale}>
          {#if leaving !== null && awards[leaving]}
            {#key `out:${leaving}`}
              <AwardStage
                {type}
                tournament={t}
                award={awards[leaving]}
                at={leaving}
                count={awards.length}
                face="up"
                finale={finale(leaving)}
                leaving
              />
            {/key}
          {/if}
          {#key onStage}
            <AwardStage
              {type}
              tournament={t}
              award={awards[onStage]}
              at={onStage}
              count={awards.length}
              face={ended ? "up" : shown.face}
              numbered={!ended}
              finale={finale(onStage)}
              {beat}
              onreveal={cue === "reveal" || cue === "champions" ? go : undefined}
            />
          {/key}
        </div>
      {/if}

      {#if !ended}
        <!-- Under the card: whoever runs it, the one button; everyone else, where it's at. Its room kept; it's dimmed
             while a beat plays, and its waking after the last beat is the end -->
        <div class="cue" class:after-beat={!!beat} class:after-next={beat === "next"} aria-live="polite">
          {#key `${shown.at}:${shown.face}`}
            <div class="cue-in" onanimationstart={(e) => e.target === e.currentTarget && land()}>
              {#if cue === "confirm"}
                <p class="cue-line">{toConfirm || "Check them"}. Confirming closes voting.</p>
                <button class="btn primary" onclick={() => enterAwards(t.id)}
                  ><Icon name="medal" size={18} />Confirm the awards</button
                >
              {:else if cue === "reveal" || cue === "champions" || cue === "next"}
                <button class="btn primary" class:big={cue === "champions"} disabled={busy} onclick={go}
                  ><Icon name={BUTTON[cue].icon} size={18} />{BUTTON[cue].label}</button
                >
              {:else if cue === "waiting"}
                <p class="cue-line">Waiting for the reveal</p>
              {/if}
            </div>
          {/key}
        </div>

        <!-- Their vote, till the awards are confirmed (only for those who played) -->
        <CastYourVote {type} tournament={t} />
      {:else}
        <!-- The end: the way back to the Kumite's page in the button's place; every other award face up, in the
             admin's order; then the final table and the day's results -->
        <div class="end" class:fresh>
          <p class="cue">
            <a class="btn outline" href={back.href}><Icon name="chevronLeft" size={18} />The {type.shortName}</a>
          </p>
          <AwardsWon {type} tournament={t} hero={false} />
          <FinalResults {type} tournament={t} />
        </div>
      {/if}
    </div>
  {/if}
</div>

<style>
  /* The pub after the last match: brass on the carbon */
  .awards {
    --brass: #d9a84e;
    --brass-ink: #f0c879;
    display: grid;
    grid-template-columns: minmax(0, 1fr);
    gap: var(--s-5);
  }
  .note {
    color: var(--fg-muted);
  }
  /* The stage: one card centred in a room the finale's size, so nothing round it moves */
  .stage {
    display: grid;
    place-items: center;
    width: min(100%, 32rem);
    height: 17rem;
    margin-inline: auto;
  }
  .stage.tall {
    height: 22rem;
  }
  /* Under the card: the button, or a line, in a room kept for both */
  .cue {
    display: grid;
    place-items: center;
    min-height: 5.5rem;
    text-align: center;
  }
  .cue-in {
    display: grid;
    justify-items: center;
    gap: var(--s-2);
  }
  /* Dimmed while the beat plays, lit once it's landed (lib/award-reveal.css --beat-ms): it stays put, and a tap
     waits for the moment */
  .after-beat .cue-in {
    animation: award-wake 240ms var(--beat-ms) both;
  }
  .after-next .cue-in {
    animation-delay: var(--next-beat-ms);
  }
  .cue-line {
    max-width: 30rem;
    margin: 0;
    color: var(--fg-muted);
  }
  .cue .btn {
    gap: var(--s-2);
    min-width: 11rem;
  }
  .cue .btn.big {
    min-width: 14rem;
    font-size: var(--text-lg);
  }
  /* The end, under the champions: the grid, the table, the results */
  .end {
    display: grid;
    grid-template-columns: minmax(0, 1fr);
    gap: var(--s-6);
  }
  /* Live, it comes in once the last beat's landed; opened late, it's just there */
  .end.fresh {
    animation: award-fade-in 400ms both;
  }
  @media (prefers-reduced-motion: reduce) {
    .after-beat .cue-in {
      animation-duration: 1ms;
    }
  }
</style>
