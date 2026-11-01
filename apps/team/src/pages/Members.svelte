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
  import ManageMenu from "../lib/ManageMenu.svelte";
  import type { ManageItem } from "../lib/ManageList.svelte";
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
  const manageItems: ManageItem[] = [
    {
      icon: "userPlus",
      label: "Add a member",
      sub: "One person, emailed a link to the app.",
      run: () => (adding = true),
    },
    {
      icon: "upload",
      label: "Import members",
      sub: "Many at once, from a spreadsheet saved as CSV.",
      run: () => (importing = true),
    },
  ];
  let filter = $state<"all" | "F" | "D" | "G">("all");
  let query = $state("");
  // ?member=12 (the email an admin gets when someone asks to join, ADR 0069): their sheet opens straight away, and the
  // address goes back to the plain page so a reload doesn't open it again
  const asked = Number(new URLSearchParams(location.search).get("member")) || null;
  if (asked) history.replaceState(history.state, "", location.pathname);
  let open = $state<number | null>(asked);

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
      valueGetter: (p) =>
        p.data?.plan === "Subscription" ? "Quarterly" : p.data?.plan === "Keeper" ? "Keeper · free" : "Pay as you go",
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

<ManageMenu bind:open={manageOpen} title="Manage members" items={manageItems} />

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
</style>
