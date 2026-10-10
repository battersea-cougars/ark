<script lang="ts">
  import { addRole as addRoleOnServer, saveRole } from "../app/backend.svelte";
  import Icon from "../app/shell/Icon.svelte";
  import PageHeader from "../lib/PageHeader.svelte";
  import SearchField from "../lib/SearchField.svelte";
  import { listScroll } from "../lib/list-scroll";
  import { flip } from "svelte/animate";
  import { cardMoveMs, easeOut, sift } from "../app/motion";
  import { ACTIONS, actionsBySubject, type Action } from "../access/actions";
  import { db } from "../demo/store.svelte";

  let selected = $state(db.roles[0].id);
  const role = $derived(db.roles.find((r) => r.id === selected)!);
  // One row per action, in its group's order; the search matches its name, key, group or what it does
  const rows = actionsBySubject()
    .filter(([subject]) => subject !== "all")
    .flatMap(([group, actions]) => actions.map((action) => ({ action, group, ...ACTIONS[action] })));
  let query = $state("");
  const shown = $derived.by(() => {
    const words = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
    return rows.filter((r) => {
      const text = `${r.name} ${r.action} ${r.group} ${r.description}`.toLowerCase();
      return words.every((w) => text.includes(w));
    });
  });

  // Each change is saved as it's made; the name a moment after you stop typing.
  function toggle(action: Action) {
    role.actions = role.actions.includes(action) ? role.actions.filter((a) => a !== action) : [...role.actions, action];
    saveRole(role);
  }
  let typing: ReturnType<typeof setTimeout> | undefined;
  function rename() {
    clearTimeout(typing);
    const r = role;
    typing = setTimeout(() => r.name.trim() && saveRole(r), 600);
  }
  async function addRole() {
    const taken = new Set(db.roles.map((r) => r.name));
    let n = 1;
    while (taken.has(`New role ${n}`)) n++;
    const created = await addRoleOnServer(`New role ${n}`);
    if (created) selected = created.id;
  }
</script>

<div class="page">
  <PageHeader title="Roles" subtitle="A role is a set of actions. Every page and button checks an action.">
    {#snippet actions()}
      <button class="btn sm primary" onclick={addRole}><Icon name="plus" size={16} />Role</button>
    {/snippet}
    {#snippet toolbar()}
      <!-- The app's filter chips, kept in the toolbar (not the phone's Filters sheet): which role you're editing -->
      <div class="filters" role="group" aria-label="Roles">
        {#each db.roles as r (r.id)}
          <button class="filter" aria-pressed={r.id === selected} onclick={() => (selected = r.id)}>{r.name}</button>
        {/each}
      </div>
    {/snippet}
  </PageHeader>

  {#key selected}
    <div class="rise">
      {#if role.system}
        <div class="panel pad feature">
          <h2>{role.name}</h2>
          <p class="hint">
            Can do everything (<code>manage:all</code>). It can't be edited, and the last admin can't be removed.
          </p>
        </div>
      {:else}
        <label class="field">Name <input class="input" bind:value={role.name} oninput={rename} /></label>
      {/if}
    </div>
  {/key}

  {#if !role.system}
    <!-- The page scrolls until the table's header reaches the top, then on through the actions, the box under it
         showing them pass (lib/list-scroll.ts), as on Friday's Who's coming. A role switch keeps the table, and
         the search, where they are: only the ticks change -->
    <div class="hybrid" use:listScroll>
      <div class="stuck">
        <div class="table-head list-tabs">
          <span aria-hidden="true"></span>
          <span class="col-name">Action</span>
          <span class="col-group">Group</span>
          <span class="col-what">Description</span>
          <!-- Find an action: a magnifier at the end of the row that widens into the field when you tap it (across
               the row, over the headings, on a phone) -->
          <div class="finder">
            <SearchField bind:value={query} placeholder="Search actions" label="Search actions" collapsible />
          </div>
        </div>
        <div class="list-box">
          <!-- A search sifts rows; the rest glide to their places (as on Friday) -->
          <div class="list">
            {#each shown as r (r.action)}
              <div
                class="slot"
                animate:flip={{ duration: cardMoveMs, easing: easeOut }}
                in:sift
                out:sift={{ out: true }}
              >
                <!-- The whole row ticks the box -->
                <label class="table-row action">
                  <input
                    type="checkbox"
                    aria-label={r.name}
                    checked={role.actions.includes(r.action)}
                    onchange={() => toggle(r.action)}
                  />
                  <span class="col-name"><strong>{r.name}</strong><code>{r.action}</code></span>
                  <span class="col-group">{r.group}</span>
                  <span class="col-what">{r.description}</span>
                </label>
              </div>
            {:else}
              <p class="hint none">No actions match “{query.trim()}”.</p>
            {/each}
          </div>
        </div>
      </div>
      <div class="list-spacer"></div>
    </div>
  {/if}
</div>

<style>
  .panel h2 {
    font-size: var(--text-md);
    font-weight: 600;
    margin-bottom: var(--s-2);
  }
  code {
    font-size: var(--text-xs);
  }
  /* The tick, the action, its group, what it does */
  .hybrid {
    --cols: 1.25rem minmax(0, 15rem) 8rem minmax(0, 1fr);
  }
  .action input {
    margin: 0;
  }
  /* The name is what people read; the key under it is for whoever's looking at the code */
  .col-name strong {
    display: block;
    color: var(--fg);
    font-weight: 500;
  }
  .col-name code {
    display: block;
    color: var(--fg-muted);
  }
  .action .col-group,
  .action .col-what {
    color: var(--fg-body);
  }
  .none {
    margin: 0;
    padding: var(--s-4);
  }
  /* A phone: the tick, then the action with what it does under it; the group goes (the key says it) */
  @media (max-width: 900px) {
    .hybrid {
      --cols: 1.25rem minmax(0, 1fr);
    }
    .table-head,
    .table-row {
      column-gap: var(--s-3);
      row-gap: var(--s-1);
    }
    .col-group,
    .table-head .col-what {
      display: none;
    }
    .action .col-what {
      grid-column: 2;
      font-size: var(--text-sm);
    }
  }
</style>
