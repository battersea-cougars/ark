<script lang="ts">
  // Settings → Quips: Home's lines. Replies: what it says before you answer and when you do. Greetings: its title,
  // by the time of day, on a training night, or after too many looks. A line saves when you leave it, so a refresh
  // never lands mid-word; a kind keeps at least one line so Home always has something to say.
  import PageHeader from "../lib/PageHeader.svelte";
  import Icon from "../app/shell/Icon.svelte";
  import { db } from "../demo/store.svelte";
  import { addQuip, deleteQuip, saveQuip } from "../app/backend.svelte";
  import { NAG_FROM } from "../lib/greetings";
  import { QUIP_KINDS, type QuipGroup, type QuipKind } from "../lib/quips";

  const GROUPS: { group: QuipGroup; label: string }[] = [
    { group: "reply", label: "Replies" },
    { group: "greeting", label: "Greetings" },
  ];
  let group = $state<QuipGroup>("reply");
  let kind = $state<QuipKind>("ask");
  const kinds = $derived(QUIP_KINDS.filter((k) => k.group === group));
  function setGroup(g: QuipGroup) {
    group = g;
    kind = QUIP_KINDS.find((k) => k.group === g)!.kind;
  }
  let draft = $state("");
  const about = $derived(QUIP_KINDS.find((k) => k.kind === kind)!);
  const lines = $derived(db.quips.filter((q) => q.kind === kind));

  function add(e: SubmitEvent) {
    e.preventDefault();
    const text = draft.trim();
    if (!text) return;
    addQuip(kind, text);
    draft = "";
  }
  function remove(id: number) {
    db.quips = db.quips.filter((q) => q.id !== id);
    deleteQuip(id);
  }
</script>

<div class="page">
  <PageHeader title="Quips" subtitle="Home chooses one at random. Short and cheeky, never needy, never a club fact.">
    {#snippet toolbar()}
      <div class="seg" role="group" aria-label="Which lines">
        {#each GROUPS as g (g.group)}
          <button aria-pressed={g.group === group} onclick={() => setGroup(g.group)}>{g.label}</button>
        {/each}
      </div>
      <div class="tablist" role="tablist" aria-label="When it's said">
        {#each kinds as k (k.kind)}
          <button role="tab" aria-selected={k.kind === kind} onclick={() => (kind = k.kind)}>
            {k.label} <span class="count num">{db.quips.filter((q) => q.kind === k.kind).length}</span>
          </button>
        {/each}
      </div>
    {/snippet}
  </PageHeader>

  {#key kind}
    <div class="lines rise">
      <p class="hint">{about.hint}.</p>
      {#if group === "greeting"}
        <p class="hint">
          <code>{"{name}"}</code> is their first name{#if kind === "nag"}, <code>{"{nth}"}</code> how many looks today
            (“{NAG_FROM}th”){/if}, <code>{"{day}"}</code> the next training's day.
        </p>
      {/if}
      <div class="list">
        {#each lines as q (q.id)}
          <div class="row">
            <input
              class="input line"
              maxlength={about.max}
              bind:value={q.text}
              onchange={() => saveQuip(q)}
              aria-label="Quip"
            />
            <button
              class="btn ghost icon"
              onclick={() => remove(q.id)}
              disabled={lines.length === 1}
              title={lines.length === 1 ? "Keep at least one" : "Delete"}
              aria-label="Delete “{q.text}”"
            >
              <Icon name="x" size={18} />
            </button>
          </div>
        {/each}
      </div>

      <form class="add" onsubmit={add}>
        <input
          class="input"
          maxlength={about.max}
          placeholder="New {about.label.toLowerCase()} line"
          aria-label="New quip"
          bind:value={draft}
        />
        <button class="btn primary" disabled={!draft.trim()}>Add</button>
      </form>
      <p class="hint num">
        Up to {about.max} characters, so it fits two lines on a phone{group === "greeting"
          ? " in the title's big type"
          : ""}.
      </p>
    </div>
  {/key}
</div>

<style>
  code {
    color: var(--fg);
    font-size: 0.95em;
  }
  .count {
    margin-left: 0.2em;
    opacity: 0.6;
  }
  .lines {
    display: grid;
    gap: var(--s-4);
  }
  .row {
    padding-block: var(--s-2);
  }
  /* Reads as text in the list; the field's fill shows on hover and while editing */
  .line {
    flex: 1;
    padding-inline: var(--s-3);
    border-color: transparent;
    background: none;
    box-shadow: none;
  }
  .line:hover {
    background: var(--field-bg);
  }
  .line:focus-visible {
    border-color: var(--red-border);
    background: var(--field-bg-focus);
    box-shadow: 0 0 0 3px var(--red-wash);
  }
  .add {
    display: flex;
    gap: var(--s-2);
  }
</style>
