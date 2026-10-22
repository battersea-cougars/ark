<script lang="ts">
  // Where a tournament's got to, at the top of its front page (ADR 0074): every step it goes through in a row (sign-up,
  // the draft, the teams, the fight card, the day), the one it's at lit in the club's red, italic with a slash, the ones
  // done filled in and quiet, the ones ahead fainter still. Under it, what happens next and when. The same two lines at every
  // stage, so nothing under them moves as it goes along. Which steps and which is now: lib/tournament-front.ts.
  import type { Tournament, TournamentType } from "../demo/model";
  import { clock, formatDayDate, londonISO } from "./dates";
  import { nextOf, stepsOf } from "./tournament-front";

  let { type, tournament: t, today }: { type: TournamentType; tournament: Tournament; today: string } = $props();

  const steps = $derived(stepsOf(t, type, today));
  const now = $derived(steps.findIndex((s) => s.state === "now"));
  const next = $derived(nextOf(t, today));
  const when = $derived.by(() => {
    if (!next) return "";
    if (!next.on) return next.note ?? "";
    const day = next.on === today ? "Today" : formatDayDate(londonISO(next.on, next.at ?? "12:00"));
    return next.at ? `${day} · ${clock(next.at)}` : day;
  });
</script>

<div class="track">
  <ol class="steps" aria-label="Where the {type.shortName} has got to">
    {#each steps as s (s.step)}
      <li class="step {s.state}" aria-current={s.state === "now" ? "step" : undefined}>
        <span class="bar" aria-hidden="true"></span>
        <span class="label"
          >{s.label}{#if s.state === "done"}<span class="sr-only">, done</span>{/if}</span
        >
      </li>
    {/each}
  </ol>
  <p class="next">
    {#if next}
      <span class="eyebrow">{now >= 0 && steps[now].step === "day" ? "So far" : "Next"}</span>
      <span class="what">{next.label}</span>{#if when}<span class="when">{when}</span>{/if}
    {:else}&nbsp;{/if}
  </p>
</div>

<style>
  .track {
    display: grid;
    gap: var(--s-3);
  }
  /* The steps, one to a column whatever their number, so the track spans the column on a phone and a desktop alike */
  .steps {
    display: grid;
    grid-auto-columns: minmax(0, 1fr);
    grid-auto-flow: column;
    gap: var(--s-1);
    max-width: 44rem;
    margin: 0;
    padding: 0;
    list-style: none;
  }
  .step {
    display: grid;
    align-content: start;
    gap: var(--s-2);
    min-width: 0;
    color: var(--fg-subtle);
  }
  /* A filled bar a step: done ones quiet, now the club's red, ahead barely there */
  .bar {
    height: 4px;
    border-radius: 2px;
    background: var(--surface-3);
  }
  .done .bar {
    background: var(--fg-muted);
  }
  .now .bar {
    background: var(--red-hot);
  }
  /* Two lines reserved for every label, so a step that wraps ("Fight card" on a narrow phone) never moves the page */
  .label {
    display: block;
    min-height: 2.3em;
    font-family: var(--font-display);
    font-size: 0.95rem;
    line-height: 1.15;
    letter-spacing: 0.02em;
    text-transform: uppercase;
  }
  .done {
    color: var(--fg-muted);
  }
  .now {
    color: var(--red-hot);
  }
  /* The step it's at: italic caps and a slash, as the app's tabs mark the one you're on */
  .now .label {
    font-style: italic;
  }
  .now .label::before {
    content: "/ ";
  }
  .next {
    display: flex;
    flex-wrap: wrap;
    align-items: baseline;
    gap: 0 var(--s-2);
    min-height: 1.6rem;
    margin: 0;
    color: var(--fg-muted);
  }
  .what {
    color: var(--fg);
    font-weight: 600;
  }
  .when::before {
    content: "·";
    margin-right: var(--s-2);
    color: var(--fg-subtle);
  }
  @media (max-width: 380px) {
    .label {
      font-size: 0.8rem;
    }
  }
</style>
