<script lang="ts">
  // The admin's call as they confirm the awards (ADR 0044), in a sheet over the drawer: for the judges' call, what it
  // is tonight (one of its names, or their own typed in) and who won it; for a vote that's level after its tie-break,
  // who of the level ones takes it. Then it's confirmed with the rest, and revealed in its turn. Either half has a
  // Random: a name, or a winner, chosen for them (another each press), theirs to change.
  import Icon from "../app/shell/Icon.svelte";
  import type { Tournament } from "../demo/model";
  import PeopleChoice from "./PeopleChoice.svelte";
  import Sheet from "./Sheet.svelte";

  let {
    open = $bindable(false),
    tournament,
    award,
    names,
    people,
    tie = false,
    onchoose,
  }: {
    open?: boolean;
    tournament: Pick<Tournament, "teams">;
    /** The award, as listed ("The Judges' Call"). */
    award: string;
    /** A live call's names to choose from; none, it keeps its own (and a vote's tie has none). */
    names: string[];
    /** Who can win it: everyone who played, or the level ones. */
    people: number[];
    /** A vote, level after its tie-break: the words say so. */
    tie?: boolean;
    onchoose: (call: { title?: string; memberId: number }) => unknown;
  } = $props();

  const OWN = "\u0000own";
  let name = $state<string | null>(null);
  let own = $state("");
  let memberId = $state<number | null>(null);
  let busy = $state(false);
  const title = $derived(name === OWN ? own.trim() : (name ?? ""));
  const ready = $derived(memberId !== null && (!names.length || !!title));
  $effect(() => {
    if (!open) [name, own, memberId] = [null, "", null];
  });
  /** One of `from` at random, never the one already chosen (when there's another to choose). */
  function anyBut<T>(from: T[], now: T | null): T | undefined {
    const others = from.length > 1 ? from.filter((x) => x !== now) : from;
    return others[Math.floor(Math.random() * others.length)];
  }
  const randomName = () => (name = anyBut(names, name) ?? name);
  const randomWinner = () => (memberId = anyBut(people, memberId) ?? memberId);
  async function choose() {
    if (busy || !ready || memberId === null) return;
    busy = true;
    try {
      await onchoose(names.length ? { title, memberId } : { memberId });
      open = false;
    } finally {
      busy = false;
    }
  }
</script>

<Sheet
  bind:open
  title={tie ? "It's a tie" : award}
  sub={tie
    ? `${award}: level on votes${people.length > 2 ? ` between ${people.length}` : ""}. Your call settles it.`
    : "Your call. Name it, choose who; it's out at the reveal."}
  tall
  lazy
>
  <div class="call">
    {#if names.length}
      <section class="part" aria-labelledby="call-what">
        <div class="label-row">
          <h3 class="label" id="call-what">What is it tonight?</h3>
          <button type="button" class="btn sm ghost" onclick={randomName}
            ><Icon name="refresh" size={14} />Random</button
          >
        </div>
        <div class="names" role="listbox" aria-labelledby="call-what">
          {#each names as n (n)}
            <button type="button" class="option" role="option" aria-selected={name === n} onclick={() => (name = n)}
              ><span>{n}</span><span class="tick"
                >{#if name === n}<Icon name="check" size={18} />{/if}</span
              ></button
            >
          {/each}
          <button type="button" class="option" role="option" aria-selected={name === OWN} onclick={() => (name = OWN)}
            ><span>Type your own</span><span class="tick"
              >{#if name === OWN}<Icon name="check" size={18} />{/if}</span
            ></button
          >
        </div>
        {#if name === OWN}
          <!-- svelte-ignore a11y_autofocus -->
          <input
            class="input"
            aria-label="The award"
            placeholder="e.g. Best Hair"
            maxlength="40"
            bind:value={own}
            autofocus
          />
        {/if}
      </section>
    {/if}
    <section class="part" aria-labelledby="call-who">
      <div class="label-row">
        <h3 class="label" id="call-who">{tie ? "Who takes it?" : "Who won it?"}</h3>
        <button type="button" class="btn sm ghost" disabled={!people.length} onclick={randomWinner}
          ><Icon name="refresh" size={14} />Random</button
        >
      </div>
      <PeopleChoice {tournament} {people} bind:value={memberId} aria-label="Who won it" />
    </section>
  </div>
  {#snippet footer()}
    <button class="btn primary reveal" disabled={busy || !ready} onclick={choose}
      ><Icon name="check" size={18} />{tie ? "Settle it" : "Make the call"}</button
    >
  {/snippet}
</Sheet>

<style>
  .call {
    display: grid;
    gap: var(--s-6);
  }
  .part {
    display: grid;
    gap: var(--s-2);
  }
  .label-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--s-3);
  }
  .label {
    margin: 0;
    color: var(--fg-muted);
    font-size: var(--text-xs);
    font-weight: 600;
    letter-spacing: var(--tracking-label);
    text-transform: uppercase;
  }
  .names {
    display: grid;
    gap: var(--s-1);
  }
  .option {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--s-3);
    min-height: 3.25rem;
    padding: 0 var(--s-4);
    border: 0;
    border-radius: var(--r-lg);
    background: none;
    color: var(--fg);
    font: inherit;
    font-size: var(--text-md);
    text-align: left;
  }
  .option:hover {
    background: var(--surface-2);
  }
  .option[aria-selected="true"] {
    background: var(--surface-2);
    font-weight: 600;
  }
  .tick {
    display: inline-flex;
    flex: none;
    width: 18px;
  }
  .reveal {
    width: 100%;
    height: 3.5rem;
    gap: var(--s-2);
  }
</style>
