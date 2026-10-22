<script lang="ts">
  // Something already on then (ADR 0122): before an editor saves a new time (a tournament's day, a one-off, a
  // training's nights), it asks the Worker what's on over it. Nothing: it saves. Something: this sheet lists each
  // (Friday Training, Fri 16 Oct, 7:30 to 9:30pm), and for each the admin can call off, Cancel it or Keep both. Saving
  // goes on with what they chose, a red fill when that calls something off; closing it goes back to the editor,
  // nothing saved. The editor saves, then cancelClashes calls off what was chosen.
  import Sheet from "./Sheet.svelte";
  import Choice from "./Choice.svelte";
  import Icon from "../app/shell/Icon.svelte";
  import type { IconName } from "../app/shell/icons";
  import { findClashes, type Clash } from "../app/backend.svelte";
  import { db } from "../demo/store.svelte";
  import { formatDayDate, timeRange } from "./dates";
  import type { ClashQuestion } from "./clashes";

  type Pick = "" | "cancel" | "keep";
  let open = $state(false);
  let what = $state("");
  let clashes = $state<Clash[]>([]);
  let picks = $state<Record<string, Pick>>({});
  let answer: ((chosen: Clash[] | null) => void) | null = null;

  const keyOf = (c: Clash) => c.key;
  const choosing = $derived(clashes.filter((c) => c.canCancel));
  const ready = $derived(choosing.every((c) => picks[keyOf(c)]));
  /** Saving calls something off: the one red fill, on the tap that does it. */
  const cancelling = $derived(choosing.some((c) => picks[keyOf(c)] === "cancel"));
  const OPTIONS: { value: Pick; label: string; icon: IconName }[] = [
    { value: "cancel", label: "Cancel it", icon: "x" },
    { value: "keep", label: "Keep both", icon: "check" },
  ];

  /**
   * Before saving `name` at this time: what to call off ([] for nothing, or nothing on then), or null for back to the
   * editor. If the Worker can't be asked, the save goes ahead: the question is a help, not a gate.
   */
  export async function ask(question: ClashQuestion, name: string) {
    let found: Clash[];
    clashes = [];
    try {
      found = await findClashes(question);
    } catch {
      return [];
    }
    if (!found.length) return [];
    what = name.trim() || "This";
    clashes = found;
    picks = Object.fromEntries(found.map((c) => [keyOf(c), ""]));
    open = true;
    return new Promise<Clash[] | null>((resolve) => (answer = resolve));
  }

  /** What the last question found, each by its key: a training's save says it was asked about these. */
  export function asked() {
    return clashes.map(keyOf);
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
    if (!c.signedUp) return "Nobody's signed up yet.";
    return `${c.signedUp} signed up ${c.signedUp === 1 ? "hears" : "hear"} it's off if you cancel it.`;
  }
</script>

<Sheet
  bind:open
  title="Already on then"
  sub="{what} is over {clashes.length === 1 ? 'this' : 'these'}."
  onclose={() => finish(null)}
>
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
        {#if c.canCancel}
          <Choice
            id="clash-{keyOf(c)}"
            size="sm"
            options={OPTIONS}
            bind:value={picks[keyOf(c)]}
            aria-label="{c.title}: cancel it?"
          />
        {/if}
      </li>
    {/each}
  </ul>
  {#snippet footer()}
    <button class="btn ghost" type="button" onclick={() => finish(null)}>Back</button>
    <button
      class="btn {cancelling ? 'cancel' : 'primary'}"
      type="button"
      disabled={!ready}
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
</style>
