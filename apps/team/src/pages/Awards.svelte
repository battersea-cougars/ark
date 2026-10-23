<script lang="ts">
  // The awards (ADR 0074, 0044): a page of their own, a stage. One card, centred, big: the award now, sealed (its
  // name, and "?" for who took it), then revealed. Whoever runs it has one button under the card: Confirm the awards
  // (the drawer) till they're confirmed, then Reveal (The champions for the finale), then Next award, which dissolves
  // the card as the next one zooms in, sealed. Everyone else's place under it says Waiting for the reveal, and their
  // vote's there till the awards are confirmed. Every phone follows each step live (the live hub), each playing the
  // same beat from the change of state (lib/afters beatOf; the timing, lib/award-reveal.css); opened late or
  // reloaded, it's just where it is. The stage's room is the finale's from the start, so nothing round it moves, and
  // nothing scrolls. After the last, the champions stay up, the winners listed under them.
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
  import Kanji from "../lib/Kanji.svelte";
  import { beatOf, cueOf, isFinale, revealOf, toConfirmOf, type Card } from "../lib/afters";
  import { kanjiFor } from "../lib/motif";
  import { goesByOf, nameOfTeam } from "../lib/names";
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

  // The winners, once every one's out: a line each, the award and who took it home
  const byId = (id: number | null) => PLAYERS.find((p) => p.id === id);
  const winnerWords = (award: string) => {
    if (!t) return "";
    const won = (t.winners ?? []).filter((w) => w.award === award);
    if (!won.length) return "Nobody this time";
    const names = won.map((w) =>
      w.teamId
        ? nameOfTeam(
            t.teams.find((x) => x.id === w.teamId),
            t.teams,
            byId,
          )
        : goesByOf(byId(w.memberId)),
    );
    return won.length > 2 ? `Shared by ${won.length}: ${names.join(", ")}` : names.join(" & ");
  };
</script>

<div class="page">
  <TournamentHead {type} tournament={t ?? undefined} title="The awards" {back} />

  {#if !t || !reveal || !awards.length}
    <p class="note">No awards this time.</p>
  {:else if !done}
    <p class="note">The awards come out at the after-party, once the last match is played.</p>
  {:else}
    <div class="awards award-reveal" class:finale={finale(shown.at)}>
      <!-- The stage: the finale's room from the start, the card centred in it; the last card dissolves here as the
           next comes in -->
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
        {#key shown.at}
          <AwardStage
            {type}
            tournament={t}
            award={awards[shown.at]}
            at={shown.at}
            count={awards.length}
            face={shown.face}
            finale={finale(shown.at)}
            {beat}
            onreveal={cue === "reveal" || cue === "champions" ? go : undefined}
          />
        {/key}
      </div>

      <!-- Under the card: whoever runs it, the one button; everyone else, where it's at. Its room kept -->
      <div class="cue" class:after-beat={!!beat} aria-live="polite">
        {#key `${shown.at}:${shown.face}`}
          <div class="cue-in">
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

      {#if reveal.all}
        <!-- After the last: the champions stay up, and every award with who took it home -->
        <section class="winners" class:after-beat={!!beat} aria-labelledby="winners-title">
          <h2 class="section-title" id="winners-title">The winners<Kanji text={kanjiFor(type, "awards")} /></h2>
          <ol>
            {#each awards as a (a.name)}
              <li>
                <span class="w-award">{a.title ?? a.name}</span><span class="w-who">{winnerWords(a.name)}</span>
              </li>
            {/each}
          </ol>
          <a class="btn sm ghost table-link" href={back.href}><Icon name="list" size={16} />The final table</a>
        </section>
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
  /* Back once the beat's landed (lib/award-reveal.css --beat-ms), so a tap waits for the moment */
  .after-beat .cue-in {
    animation: award-fade-in 240ms var(--beat-ms) both;
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
  .winners {
    display: grid;
    gap: var(--s-3);
    animation: award-fade-in 400ms both;
  }
  /* After the champions' reveal, only once it's all landed */
  .winners.after-beat {
    animation-delay: var(--beat-ms);
  }
  .winners .section-title {
    margin: 0;
    color: color-mix(in srgb, var(--brass-ink) 70%, var(--fg-muted));
  }
  .winners ol {
    display: grid;
    margin: 0;
    padding: 0;
    list-style: none;
  }
  .winners li {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: var(--s-3);
    min-height: 2.5rem;
    padding-block: var(--s-2);
  }
  .winners li + li {
    border-top: 1px solid var(--border);
  }
  .w-award {
    color: var(--brass-ink);
    font-size: var(--text-sm);
    font-weight: 600;
  }
  .w-who {
    overflow: hidden;
    color: var(--fg);
    font-weight: 600;
    text-align: right;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .table-link {
    justify-self: start;
    gap: var(--s-1);
  }
  @media (prefers-reduced-motion: reduce) {
    .after-beat .cue-in {
      animation-duration: 1ms;
    }
  }
</style>
