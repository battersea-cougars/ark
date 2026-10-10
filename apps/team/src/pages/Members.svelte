<script lang="ts">
  // Settings → Members: everyone in the club as one table, for whoever manages members. Sortable, resizable columns,
  // search and the position chips filter it; a tap on a row opens everything about them (MemberSheet). The page fills
  // the room beside the settings list and the window's height, and the table scrolls inside itself, so its header row
  // stays in view. Teammates is the everyday view (cards), for everyone.
  import PageHeader from "../lib/PageHeader.svelte";
  import { can } from "../access/actions";
  import { emailFor, phoneFor, type MemberRow } from "../demo/data";
  import { owedBy } from "../demo/dues.svelte";
  import { granted } from "../demo/session.svelte";
  import { db } from "../demo/store.svelte";
  import MemberSheet from "../lib/MemberSheet.svelte";
  import AddMemberSheet from "../lib/AddMemberSheet.svelte";
  import ImportMembersDrawer from "../lib/ImportMembersDrawer.svelte";
  import Sheet from "../lib/Sheet.svelte";
  import Drawer from "../lib/Drawer.svelte";
  import { phone } from "../lib/viewport.svelte";
  import Icon from "../app/shell/Icon.svelte";
  import SearchField from "../lib/SearchField.svelte";
  import { pounds } from "../lib/dates";
  import DataGrid from "../lib/DataGrid.svelte";
  import { goesBy } from "../lib/names";
  import type { ColDef } from "ag-grid-community";

  const ratings = $derived(can(granted(), "read:Rating"));
  const seesDues = $derived(can(granted(), "read:Dues") || can(granted(), "record:Payment"));
  // Manage (ADR 0065): adding someone to the club (ADR 0069), or bringing many in from a file
  let manageOpen = $state(false);
  let adding = $state(false);
  let importing = $state(false);
  // A tool opens its own drawer: the sheet gets out of the way first
  function go(run: () => void) {
    manageOpen = false;
    run();
  }
  let filter = $state<"all" | "F" | "D" | "G">("all");
  let query = $state("");
  let open = $state<number | null>(null);

  const active = $derived(db.members.filter((m) => m.status === "active"));
  const shown = $derived(active.filter((m) => filter === "all" || m.player.position === filter));

  // One column per thing an admin checks, each as wide as what's in it (DataGrid)
  const columns = $derived<ColDef<MemberRow>[]>([
    { headerName: "Name", valueGetter: (p) => p.data?.player.name, pinned: "left", cellClass: "name" },
    // What the app calls them (ADR 0043), when it isn't their full name
    {
      headerName: "Goes by",
      valueGetter: (p) => (p.data && goesBy(p.data.player) !== p.data.player.name ? goesBy(p.data.player) : ""),
    },
    { headerName: "Pos", valueGetter: (p) => p.data?.player.position },
    ...(ratings
      ? [
          {
            headerName: "Rating",
            valueGetter: (p) => p.data?.player.rating,
            type: "numericColumn",
          } as ColDef<MemberRow>,
        ]
      : []),
    { headerName: "Cougar", valueGetter: (p) => (p.data?.player.cougar ? "Cougar" : "") },
    { headerName: "Role", valueGetter: (p) => p.data?.roles[0] ?? "Member" },
    {
      headerName: "Plan",
      valueGetter: (p) => (p.data?.plan === "Subscription" ? "Quarterly" : "Pay as you go"),
    },
    { headerName: "Played", valueGetter: (p) => p.data?.player.played ?? 0, type: "numericColumn" },
    // What each owes (ADR 0007): for whoever sees everyone's dues
    ...(seesDues
      ? [
          {
            headerName: "Owes",
            valueGetter: (p) => (p.data ? owedBy(p.data.player.id) : 0),
            valueFormatter: (p) => (p.value > 0 ? pounds(p.value) : ""),
            // numericColumn's right alignment is a cellClass too, so keep it beside ours
            cellClass: (p) => (p.value > 0 ? ["ag-right-aligned-cell", "owes"] : "ag-right-aligned-cell"),
            type: "numericColumn",
          } as ColDef<MemberRow>,
        ]
      : []),
    {
      headerName: "Email",
      valueGetter: (p) => (p.data && emailFor(p.data.player) !== "No email yet" ? emailFor(p.data.player) : ""),
    },
    { headerName: "Phone", valueGetter: (p) => (p.data ? (phoneFor(p.data.player.id) ?? "") : "") },
  ]);
</script>

<div class="page full fill">
  <PageHeader
    title="Members"
    subtitle="{active.length} players · {active.filter((m) => m.player.cougar).length} Cougars"
    active={filter === "all" ? 0 : 1}
    onclear={() => (filter = "all")}
  >
    {#snippet actions()}
      <button
        class="btn sm ghost icon"
        aria-haspopup="dialog"
        aria-label="Manage members"
        title="Manage"
        onclick={() => (manageOpen = true)}><Icon name="settings" size={18} /></button
      >
    {/snippet}
    {#snippet toolbar()}
      <SearchField bind:value={query} placeholder="Search members" collapsible={!phone.current} />
    {/snippet}
    {#snippet filters()}
      <div class="filters" role="group" aria-label="Position">
        {#each [["all", "All", "teams"], ["F", "Forwards", "stick"], ["D", "Defence", "shield"], ["G", "Keepers", "net"]] as const as [v, label, icon] (v)}
          <button class="filter" aria-pressed={filter === v} onclick={() => (filter = v as typeof filter)}
            ><Icon name={icon} size={16} />{label}</button
          >
        {/each}
      </div>
    {/snippet}
  </PageHeader>

  <div class="table">
    <DataGrid
      rows={shown}
      {columns}
      filter={query}
      rowId={(m) => String(m.player.id)}
      onrowclick={(m) => (open = m.player.id)}
    />
  </div>
</div>

{#snippet manageTools()}
  <div class="tools">
    <button class="tool" onclick={() => go(() => (adding = true))}>
      <Icon name="userPlus" size={22} />
      <span class="tool-text"><strong>Add a member</strong><span>One person, emailed a link to the app.</span></span>
      <Icon name="chevronRight" size={18} />
    </button>
    <button class="tool" onclick={() => go(() => (importing = true))}>
      <Icon name="upload" size={22} />
      <span class="tool-text"
        ><strong>Import members</strong><span>Many at once, from a spreadsheet saved as CSV.</span></span
      >
      <Icon name="chevronRight" size={18} />
    </button>
  </div>
{/snippet}

{#if phone.current}
  <Sheet bind:open={manageOpen} title="Manage members">{@render manageTools()}</Sheet>
{:else}
  <Drawer bind:open={manageOpen} title="Manage members">{@render manageTools()}</Drawer>
{/if}

<AddMemberSheet bind:open={adding} />
<ImportMembersDrawer bind:open={importing} />

{#if open != null}
  {#key open}
    <MemberSheet memberId={open} onclose={() => (open = null)} />
  {/key}
{/if}

<style>
  /* The rest of the window's height, never less than a few rows on a short phone (then the page scrolls too) */
  .table {
    flex: 1;
    min-height: 18rem;
  }
  /* Grid cells: the name stands out; what's owed shows in red */
  .table :global(.name) {
    color: var(--fg);
    font-weight: 500;
  }
  .table :global(.owes) {
    color: var(--red-hot);
    font-weight: 500;
  }
  /* Manage's tools, as on Training */
  .tools {
    display: grid;
    gap: var(--s-2);
  }
  .tool {
    display: flex;
    align-items: center;
    gap: var(--s-4);
    min-height: 4.25rem;
    padding: var(--s-3) var(--s-4);
    border: 0;
    border-radius: var(--r-lg);
    background: var(--surface-2);
    color: var(--fg-muted);
    font: inherit;
    text-align: left;
  }
  .tool:active {
    background: var(--surface-3);
  }
  .tool-text {
    display: grid;
    flex: 1;
    gap: 0.15rem;
    min-width: 0;
  }
  .tool-text strong {
    color: var(--fg);
    font-size: var(--text-md);
    font-weight: 600;
  }
  .tool-text span {
    font-size: var(--text-sm);
  }
</style>
