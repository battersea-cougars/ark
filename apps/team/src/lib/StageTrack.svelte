<script lang="ts">
  // Where a tournament's got to, at the top of its front page (ADR 0074): every step it goes through in a row (sign-up,
  // the draft, the teams, the fight card, the day), the one it's at lit in the club's red, italic with a slash, the ones
  // done filled in and quiet, the ones ahead fainter still. Under it, what happens next and when. The same two lines at every
  // stage, so nothing under them moves as it goes along. Which steps and which is now: lib/tournament-front.ts.
  // It's also the series' navigation, on each of its pages under the header: a step opens its page once it has one
  // (`links`), and the page you're on (`on`) is marked apart from the stage it's at: bright, with a bar under its name,
  // as a lit tab is, where the stage it's at is the club's red, italic with a slash.
  import type { Tournament, TournamentType } from "../demo/model";
  import { clock, formatDayDate, londonISO } from "./dates";
  import { nextOf, stepsOf, type Step } from "./tournament-front";

  let {
    type,
    tournament: t,
    today,
    links = {},
    on = null,
  }: {
    type: TournamentType;
    tournament: Tournament;
    today: string;
    /** The page each step opens; none: not a link (yet). */
    links?: Partial<Record<Step, string | null>>;
    /** The step whose page this is. */
    on?: Step | null;
  } = $props();
  // On a phone, the fight card is the Card, so every name stays on one line, clear of the next
  const SHORT: Partial<Record<Step, string>> = { fixtures: "Card" };

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

<!-- stage-track: the shell keeps it in place between the series' pages, as it does the header -->
<div class="track stage-track">
  <ol class="steps" aria-label="Where the {type.shortName} has got to">
    {#each steps as s (s.step)}
      {@const href = links[s.step]}
      <li class="step {s.state}" class:here={on === s.step} aria-current={s.state === "now" ? "step" : undefined}>
        {#snippet inside()}
          <span class="bar" aria-hidden="true"></span>
          <span class="label"
            ><span class="full">{s.label}</span>{#if SHORT[s.step]}<span class="short" aria-hidden="true"
                >{SHORT[s.step]}</span
              >{/if}{#if s.state === "done"}<span class="sr-only">, done</span>{/if}</span
          >
        {/snippet}
        {#if href}
          <a class="go" {href} aria-current={on === s.step ? "page" : undefined}>{@render inside()}</a>
        {:else}
          <span class="go">{@render inside()}</span>
        {/if}
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
    grid-template-columns: minmax(0, 1fr);
    align-content: start;
    gap: var(--s-2);
    min-width: 0;
    color: var(--fg-subtle);
  }
  /* The whole step is the link (bar and name), tall enough for a thumb */
  .go {
    display: grid;
    grid-template-columns: minmax(0, 1fr);
    align-content: start;
    gap: var(--s-2);
    min-height: 2.75rem;
    color: inherit;
    text-decoration: none;
  }
  a.go:hover .label {
    color: var(--fg);
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
  /* The page you're on: its name bright, a bar under it, as a lit tab. Apart from the stage it's at (red, slashed),
     which it may also be */
  .here .label {
    color: var(--fg);
  }
  .here.now .label {
    color: var(--red-hot);
  }
  .here .label > span {
    text-decoration: underline 2px;
    text-underline-offset: 0.3em;
  }
  .short {
    display: none;
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
  @media (max-width: 400px) {
    .label .full:has(+ .short) {
      display: none;
    }
    .short {
      display: inline;
    }
  }
</style>
