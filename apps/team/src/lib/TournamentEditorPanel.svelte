<script lang="ts" module>
  // Which tournament the editor panel has open, from wherever an admin is: Settings → Tournaments, or a series' own
  // pages (Games, Standings, Draft), where "New date", "Edit" and "Add the captains" open it in place. A new date in a
  // series opens on its three questions (ADR 0074); Advanced opens the full editor with the answers filled in.
  type Tab = "details" | "rules" | "signup" | "teams";
  export const tournamentPanel = $state<{ open: number | "new" | null; typeId?: number; tab: Tab; advanced: boolean }>({
    open: null,
    tab: "details",
    advanced: false,
  });
  /** Open a tournament's editor (on a tab), or a new one (in a series). */
  export function editTournament(
    open: number | "new",
    { typeId, tab = "details" }: { typeId?: number; tab?: Tab } = {},
  ) {
    Object.assign(tournamentPanel, { open, typeId, tab, advanced: false });
  }
</script>

<script lang="ts">
  import { deleteTournament, saving } from "../app/backend.svelte";
  import Icon from "../app/shell/Icon.svelte";
  import EditorPanel from "./EditorPanel.svelte";
  import TournamentDateEditor from "./TournamentDateEditor.svelte";
  import TournamentQuickCreate, { blankQuick } from "./TournamentQuickCreate.svelte";
  import { typeById, whenOf } from "../demo/schedule.svelte";
  import { db } from "../demo/store.svelte";

  /** From the Calendar's New event: a new one, once scheduled, closes on the calendar, which now shows it. Elsewhere
   * the panel goes on to the new one's editor. */
  let { closeOnCreate = false }: { closeOnCreate?: boolean } = $props();

  const date = $derived(
    typeof tournamentPanel.open === "number" ? db.tournaments.find((t) => t.id === tournamentPanel.open) : undefined,
  );
  const type = $derived(typeById(date?.typeId ?? tournamentPanel.typeId ?? null));
  // A new date in a series: the quick questions first, unless Advanced
  const quick = $derived(tournamentPanel.open === "new" && !!type && !tournamentPanel.advanced);
  // The answers so far, kept when Advanced takes over
  let answers = $state(blankQuick());
  // Deleting one: asked in the footer first, in so many words
  let asking = $state(false);
  async function remove() {
    if (!date) return;
    // Closed first, so the panel never shows it gone; a failure says so in the save note
    const id = date.id;
    tournamentPanel.open = null;
    await deleteTournament(id);
  }
  $effect(() => {
    if (tournamentPanel.open === "new") answers = blankQuick(typeById(tournamentPanel.typeId ?? null));
    void tournamentPanel.open;
    asking = false;
  });
</script>

{#if tournamentPanel.open !== null}
  {#key tournamentPanel.open}
    <EditorPanel
      eyebrow={date ? `${type?.name ?? "Tournament"} · ${whenOf(date)}` : (type?.name ?? "Tournament")}
      title={date?.name ?? (type ? `The next ${type.shortName}` : "New tournament")}
      icon={type?.icon}
      tone={type?.tone}
      onclose={() => (tournamentPanel.open = null)}
    >
      {#if quick && type}
        <!-- Scheduled: the panel closes on the page, which now shows the new one -->
        <TournamentQuickCreate {type} bind:values={answers} oncreated={() => (tournamentPanel.open = null)} />
      {:else}
        <TournamentDateEditor
          dateId={date?.id}
          typeId={tournamentPanel.typeId}
          startTab={tournamentPanel.tab}
          bind:start={answers}
          oncreated={(id) => (tournamentPanel.open = closeOnCreate ? null : id)}
        />
      {/if}
      {#snippet footer()}
        {#if quick}
          <button class="btn ghost" type="button" onclick={() => (tournamentPanel.advanced = true)}
            >Advanced<Icon name="chevronRight" size={16} /></button
          >
          <button class="btn primary" type="submit" form="quick-form" disabled={saving.busy > 0}>Schedule it</button>
        {:else if tournamentPanel.open === "new" && type}
          <!-- Advanced on a new one: back to the three questions, with what's been filled in here -->
          <button class="btn ghost back" type="button" onclick={() => (tournamentPanel.advanced = false)}
            ><Icon name="chevronLeft" size={16} />Back to the questions</button
          >
          <button class="btn primary" type="submit" form="date-form" disabled={saving.busy > 0}>Schedule it</button>
        {:else if date && asking}
          <p class="ask" role="alert">Delete it? Its teams, sign-ups and results go too.</p>
          <button class="btn ghost" type="button" onclick={() => (asking = false)}>Keep it</button>
          <button class="btn delete" type="button" disabled={saving.busy > 0} onclick={remove}>Delete</button>
        {:else}
          {#if date}
            <button class="btn ghost danger" type="button" onclick={() => (asking = true)}>Delete</button>
          {/if}
          <button class="btn primary" type="submit" form="date-form" disabled={saving.busy > 0}
            >{date ? "Save" : "Schedule it"}</button
          >
        {/if}
      {/snippet}
    </EditorPanel>
  {/key}
{/if}

<style>
  /* Delete sits apart, at the start of the footer, in red words; asked, the question takes its place */
  .danger {
    margin-right: auto;
    color: var(--red-hot);
  }
  .back {
    margin-right: auto;
  }
  .ask {
    flex: 1;
    min-width: 0;
    margin: 0;
    color: var(--fg-body);
    font-size: var(--text-sm);
  }
  /* The one red fill: the tap that does it */
  .delete {
    background: var(--red);
    color: var(--on-red);
  }
  .delete:hover:not(:disabled) {
    background: var(--red-hot);
  }
</style>
