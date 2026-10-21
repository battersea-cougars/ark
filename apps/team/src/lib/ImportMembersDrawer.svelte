<script lang="ts">
  // An admin brings players in from a file, in a side drawer over Members (ADR 0065): a spreadsheet saved as CSV, or
  // the roster's JSON. Choosing the file checks it (nothing changes yet) and lists who'd be added, who's in already
  // and any rows to fix; then one tap adds them all. Nobody is emailed (worker/members/members.import.ts).
  import Drawer from "./Drawer.svelte";
  import Icon from "../app/shell/Icon.svelte";
  import { checkImport, importMembers, type ImportCheck } from "../app/backend.svelte";

  let { open = $bindable(false) }: { open?: boolean } = $props();

  let fileName = $state("");
  let file = $state("");
  let check = $state<ImportCheck | null>(null);
  let failed = $state("");
  let busy = $state(false);
  let input: HTMLInputElement | undefined = $state();

  // Each time it opens, it starts with no file
  $effect(() => {
    if (open) return;
    fileName = file = failed = "";
    check = null;
  });

  async function choose() {
    const picked = input?.files?.[0];
    if (!picked) return;
    fileName = picked.name;
    check = null;
    failed = "";
    busy = true;
    try {
      file = await picked.text();
      check = await checkImport(file);
    } catch (e) {
      failed = e instanceof Error ? e.message : "Couldn't read that file.";
    } finally {
      busy = false;
      if (input) input.value = "";
    }
  }

  async function add() {
    if (busy || !check?.add.length || check.problems.length) return;
    busy = true;
    try {
      if (await importMembers(file)) open = false;
    } finally {
      busy = false;
    }
  }

  const POS = { F: "Forward", D: "Defence", G: "Goalie" } as const;
  const PLAN = { quarterly: "Quarterly", payg: "Pay as you go", keeper: "Keeper" } as const;

  // The club's own columns, in its order, with one made-up player to copy
  const TEMPLATE =
    "name,position,subx,email,role,is Cougars\r\nJo Bloggs,F,quarterly,jo@example.com,Session lead,yes\r\n";
  const template = `data:text/csv;charset=utf-8,${encodeURIComponent(TEMPLATE)}`;
</script>

<Drawer bind:open title="Import members" sub="From a spreadsheet saved as CSV">
  <div class="stack">
    <p class="hint">The first row names the columns, in any order:</p>
    <dl class="columns">
      <dt>name</dt>
      <dd>Needed</dd>
      <dt>position</dt>
      <dd>F, D or G (F if blank)</dd>
      <dt>subx</dt>
      <dd>quarterly (or yes), payg (or no, or blank), keeper. A G is always Keeper</dd>
      <dt>email</dt>
      <dd>What they sign in with</dd>
      <dt>role</dt>
      <dd>Session lead, Contributor or Admin; several separated by ;</dd>
      <dt>is Cougars</dt>
      <dd>yes or no</dd>
      <dt>rating</dt>
      <dd>Optional, 0–100: 50 if left out, as for anyone you add</dd>
    </dl>
    <p class="hint">
      Anyone already in the club is left as they are. Nobody is emailed: they sign in with their email when you tell
      them.
    </p>

    <a class="btn ghost block" href={template} download="cougars-members.csv">
      <Icon name="download" size={18} />
      Download template
    </a>

    <label class="btn outline block">
      <Icon name="upload" size={18} />
      {busy && !check ? "Checking…" : fileName ? "Choose another file" : "Choose a file"}
      <input bind:this={input} class="sr-only" type="file" accept=".csv,.json,text/csv" onchange={choose} />
    </label>

    {#if failed}
      <p class="problem" role="alert">{fileName}: {failed}</p>
    {/if}

    {#if check}
      {#if check.problems.length}
        <section>
          <h3>Fix these first ({check.problems.length})</h3>
          <ul>
            {#each check.problems as p, i (i)}
              <li>
                <span class="row">Row {p.row}</span> <strong>{p.name || "No name"}</strong>
                <span class="why">{p.why}</span>
              </li>
            {/each}
          </ul>
        </section>
      {/if}
      <section>
        <h3>To add ({check.add.length})</h3>
        {#if check.add.length}
          <ul>
            {#each check.add as p (p.row)}
              <li>
                <strong>{p.name}</strong>
                <span
                  >{PLAN[p.plan]} · {POS[p.position]} · {p.rating}{p.cougar ? " · Cougar" : ""}{p.roles.length
                    ? ` · ${p.roles.join(", ")}`
                    : ""}</span
                >
                <span class="email">{p.email ?? "No email: can't sign in yet"}</span>
              </li>
            {/each}
          </ul>
        {:else}
          <p class="hint">Nobody new in {fileName}.</p>
        {/if}
      </section>
      {#if check.skip.length}
        <section>
          <h3>Already in ({check.skip.length})</h3>
          <p class="hint">{check.skip.map((s) => s.name).join(", ")}</p>
        </section>
      {/if}
    {/if}
  </div>

  {#snippet footer()}
    <button class="btn primary" disabled={busy || !check?.add.length || !!check?.problems.length} onclick={add}>
      {check?.add.length ? `Add ${check.add.length} member${check.add.length === 1 ? "" : "s"}` : "Add members"}
    </button>
  {/snippet}
</Drawer>

<style>
  .stack {
    display: grid;
    gap: var(--s-4);
  }
  .hint {
    margin: 0;
  }
  .columns {
    display: grid;
    grid-template-columns: auto 1fr;
    gap: var(--s-1) var(--s-3);
    margin: 0;
    font-size: var(--text-sm);
  }
  .columns dt {
    font-weight: 600;
    white-space: nowrap;
  }
  .columns dd {
    margin: 0;
    color: var(--fg-muted);
  }
  label.btn {
    position: relative;
    cursor: pointer;
  }
  h3 {
    margin: 0 0 var(--s-2);
    font-size: var(--text-sm);
    font-weight: 600;
    color: var(--fg-muted);
  }
  ul {
    display: grid;
    gap: var(--s-2);
    margin: 0;
    padding: 0;
    list-style: none;
  }
  li {
    display: grid;
    gap: 0.1rem;
    font-size: var(--text-sm);
    color: var(--fg-muted);
  }
  li strong {
    color: var(--fg);
    font-size: var(--text-md);
    font-weight: 500;
  }
  .row,
  .email {
    font-size: var(--text-xs);
  }
  .problem,
  .why {
    color: var(--red-hot);
  }
  .problem {
    margin: 0;
  }
</style>
