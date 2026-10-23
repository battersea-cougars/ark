<script lang="ts">
  // Something already on then (ADR 0122): before an editor saves a new time (a tournament's day, a one-off, a
  // training's nights), it asks the Worker what's on over it. Nothing: it saves. Something: this sheet lists each
  // (Friday Training, Fri 16 Oct, 7:30 to 9:30pm), and for each the admin can call off, Cancel it or Keep both; with
  // two or more, one answer for all at the top sets them all, each still to change. Something that stays on (the
  // Kumite) over a training being saved can be kept, or the training skipped that night. Saving goes on with what
  // they chose, a red fill when that calls something off; closing it goes back to the editor, nothing saved. The
  // editor saves, then cancelClashes calls off what was chosen and skipNights the training's own nights.
  import Sheet from "./Sheet.svelte";
  import Choice from "./Choice.svelte";
  import Icon from "../app/shell/Icon.svelte";
  import type { IconName } from "../app/shell/icons";
  import { findClashes, type Clash } from "../app/backend.svelte";
  import { db } from "../demo/store.svelte";
  import { formatDayDate, timeRange } from "./dates";
  import { offWords } from "./night-off";
  import {
    answerAll,
    answerOfAll,
    choiceOf,
    nightsToSkip,
    skipLabel,
    type Answer,
    type ClashQuestion,
  } from "./clashes";

  type Option<T> = { value: T; label: string; icon: IconName };
  let open = $state(false);
  let what = $state("");
  /** A training's save: something that stays on can be skipped that night instead. */
  let training = $state(false);
  let skipAs = $state("");
  let clashes = $state<Clash[]>([]);
  let picks = $state<Record<string, Answer>>({});
  let answer: ((chosen: Clash[] | null) => void) | null = null;

  const keyOf = (c: Clash) => c.key;
  const choosing = $derived(clashes.filter((c) => choiceOf(c, training)));
  const ready = $derived(choosing.every((c) => picks[keyOf(c)]));
  /** Saving calls something off (theirs, or the training's own night): the one red fill, on the tap that does it. */
  const cancelling = $derived(choosing.some((c) => picks[keyOf(c)] === "cancel" || picks[keyOf(c)] === "skip"));
  /** One answer for all, when there are two or more to call off (a weekly training over another: up to 12). */
  const many = $derived(clashes.filter((c) => c.canCancel).length >= 2);
  const OPTIONS: Option<Answer>[] = [
    { value: "cancel", label: "Cancel it", icon: "x" },
    { value: "keep", label: "Keep both", icon: "check" },
  ];
  const ALL: Option<"" | "cancel" | "keep">[] = [
    { value: "cancel", label: "Cancel them", icon: "x" },
    { value: "keep", label: "Keep both", icon: "check" },
  ];
  const SKIP = $derived<Option<Answer>[]>([
    { value: "skip", label: skipLabel(skipAs), icon: "x" },
    { value: "keep", label: "Keep both", icon: "check" },
  ]);

  /**
   * Before saving `name` at this time: what to call off ([] for nothing, or nothing on then), or null for back to the
   * editor. If the Worker can't be asked, the save goes ahead: the question is a help, not a gate.
   */
  export async function ask(question: ClashQuestion, name: string, shortName = name) {
    let found: Clash[];
    clashes = [];
    try {
      found = await findClashes(question);
    } catch {
      return [];
    }
    if (!found.length) return [];
    what = name.trim() || "This";
    training = "weekdays" in question;
    skipAs = shortName;
    clashes = found;
    picks = Object.fromEntries(found.map((c) => [keyOf(c), ""]));
    open = true;
    return new Promise<Clash[] | null>((resolve) => (answer = resolve));
  }

  /** What the last question found, each by its key: a training's save says it was asked about these. */
  export function asked() {
    return clashes.map(keyOf);
  }

  /** The days of the training's own nights to call off once it's saved: where the admin chose to skip it. */
  export function skipped() {
    return nightsToSkip(clashes, picks);
  }

  function finish(chosen: Clash[] | null) {
    const done = answer;
    answer = null;
    open = false;
    done?.(chosen);
  }

  function iconOf(c: Clash): IconName {
    if (c.source === "session") return db.series.find((s) => s.id === c.seriesId)?.icon ?? "stick";
    if (c.source === "club_event") return "glass";
    const t = db.tournaments.find((x) => x.id === c.id);
    return db.tournamentTypes.find((y) => y.id === t?.typeId)?.icon ?? "trophy";
  }
  /** One line under each, always there, so choosing never moves anything. */
  function lineOf(c: Clash) {
    if (c.source === "tournament") return "A tournament: it stays on. Move it from its own page.";
    if (!c.canCancel) return "It stays on: calling it off is for whoever runs it.";
    return offWords(c.signedUp);
  }
</script>

<Sheet
  bind:open
  title="Already on then"
  sub="{what} is over {clashes.length === 1 ? 'this' : 'these'}."
  onclose={() => finish(null)}
>
  {#if many}
    <!-- There from the start, so nothing moves; each row below can still be changed after -->
    <div class="clash all">
      <div class="words">
        <strong class="title">All of these</strong>
        <span class="line small">Each below can still be changed after.</span>
      </div>
      <Choice
        id="clash-all"
        size="sm"
        options={ALL}
        bind:value={() => answerOfAll(clashes, picks), (v) => v && (picks = answerAll(clashes, picks, v))}
        aria-label="All of these: cancel them?"
      />
    </div>
  {/if}
  <ul class="clashes">
    {#each clashes as c (keyOf(c))}
      <li class="clash">
        <div class="what">
          <span class="icon"><Icon name={iconOf(c)} size={18} /></span>
          <div class="words">
            <strong class="title">{c.title}</strong>
            <span class="when">{formatDayDate(c.startsAt)}, {timeRange(c.startsAt, c.endsAt)}</span>
            <span class="line small">{lineOf(c)}</span>
          </div>
        </div>
        {#if choiceOf(c, training) === "cancel"}
          <Choice
            id="clash-{keyOf(c)}"
            size="sm"
            options={OPTIONS}
            bind:value={picks[keyOf(c)]}
            aria-label="{c.title}: cancel it?"
          />
        {:else if choiceOf(c, training) === "skip"}
          <Choice
            id="clash-{keyOf(c)}"
            size="sm"
            options={SKIP}
            bind:value={picks[keyOf(c)]}
            aria-label="{c.title}: skip {skipAs} that night?"
          />
        {/if}
      </li>
    {/each}
  </ul>
  <!-- Why Save waits, there from the start (seen only while it does), so nothing moves as the last one's answered -->
  <p class="why small" id="clash-why" class:shown={!ready}>Choose for each one above to save.</p>
  {#snippet footer()}
    <button class="btn ghost" type="button" onclick={() => finish(null)}>Back</button>
    <button
      class="btn {cancelling ? 'cancel' : 'primary'}"
      type="button"
      disabled={!ready}
      aria-describedby={ready ? undefined : "clash-why"}
      onclick={() => finish(choosing.filter((c) => picks[keyOf(c)] === "cancel"))}
    >
      <!-- Both words always there, one seen, so choosing never changes the button's size -->
      <span class="swap">
        <span class:shown={!cancelling}>Save</span>
        <span class:shown={cancelling}>Save &amp; cancel</span>
      </span>
    </button>
  {/snippet}
</Sheet>

<style>
  /* The one red fill: the tap that calls something off */
  .cancel {
    background: var(--red);
    color: var(--on-red);
  }
  .cancel:hover:not(:disabled) {
    background: var(--red-hot);
  }
  .swap {
    display: inline-grid;
  }
  .swap > span {
    grid-area: 1 / 1;
    visibility: hidden;
  }
  .swap > .shown {
    visibility: visible;
  }
  /* One answer for all: a row like the others, set apart by space */
  .all {
    margin-bottom: var(--s-5);
  }
  .clashes {
    display: grid;
    gap: var(--s-5);
    margin: 0;
    padding: 0;
    list-style: none;
  }
  .clash {
    display: grid;
    gap: var(--s-3);
  }
  .what {
    display: flex;
    gap: var(--s-3);
    align-items: flex-start;
  }
  .icon {
    display: grid;
    flex: none;
    place-items: center;
    width: 2.25rem;
    height: 2.25rem;
    border-radius: var(--r-md);
    background: var(--surface-2);
    color: var(--fg-muted);
  }
  .words {
    display: grid;
    min-width: 0;
    gap: 2px;
  }
  .title {
    overflow: hidden;
    white-space: nowrap;
    text-overflow: ellipsis;
  }
  .when {
    color: var(--fg-body);
    font-size: var(--text-sm);
  }
  .line {
    color: var(--fg-muted);
  }
  .why {
    margin: var(--s-5) 0 0;
    color: var(--fg-muted);
    visibility: hidden;
  }
  .why.shown {
    visibility: visible;
  }
</style>
