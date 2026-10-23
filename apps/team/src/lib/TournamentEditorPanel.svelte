<script lang="ts">
  // Which tournament it has open, and the way to open it, are in tournament-panel.svelte.ts: the pages that open it
  // don't carry the editor in their first load (it comes when someone who can edit one is on the page).
  import { tournamentPanel } from "./tournament-panel.svelte";
  import { deleteTournament, saving } from "../app/backend.svelte";
  import { untrack } from "svelte";
  import { Edits } from "./dirty.svelte";
  import SaveBar from "./SaveBar.svelte";
  import Icon from "../app/shell/Icon.svelte";
  import EditorPanel from "./EditorPanel.svelte";
  import TournamentDateEditor from "./TournamentDateEditor.svelte";
  import TournamentQuickCreate, { blankQuick } from "./TournamentQuickCreate.svelte";
  import { typeById, whenOf } from "../demo/schedule.svelte";
  import { db } from "../demo/store.svelte";
  import { navigate } from "../app/router.svelte";

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
  let editor = $state<EditorPanel | undefined>();
  // What's unsaved in the date's editor, and when it was saved (lib/dirty.svelte.ts)
  const edits = new Edits();
  // Off to another page from the editor (a team's, to edit it there): asked first if anything's unsaved, then the
  // panel slides away and the page changes. Never a sheet over the editor for it
  let then: string | null = null;
  function leaveFor(path: string) {
    const go = () => {
      then = path;
      editor?.close();
    };
    if (!edits.guard(go)) go();
  }
  function closed() {
    tournamentPanel.open = null;
    const to = then;
    then = null;
    if (to) navigate(to);
  }
  async function remove() {
    if (!date) return;
    // Closed first, so the panel never shows it gone; a failure says so in the save note
    const id = date.id;
    tournamentPanel.open = null;
    await deleteTournament(id);
  }
  $effect(() => {
    if (tournamentPanel.open === "new") answers = blankQuick(typeById(tournamentPanel.typeId ?? null));
    // Shut without its own way out (deleted): the next one opens with nothing to say
    if (tournamentPanel.open === null) untrack(() => edits.closed());
    asking = false;
  });
</script>

{#if tournamentPanel.open !== null}
  {#key tournamentPanel.open}
    <EditorPanel
      bind:this={editor}
      fill={quick}
      eyebrow={date ? `${type?.name ?? "Tournament"} · ${whenOf(date)}` : (type?.name ?? "Tournament")}
      title={date?.name ?? (type ? `The next ${type.shortName}` : "New tournament")}
      icon={type?.icon}
      tone={type?.tone}
      onclose={closed}
      footer={quick ? undefined : footer}
      {edits}
    >
      {#if quick && type}
        <!-- Scheduled: the panel closes on the page, which now shows the new one -->
        <TournamentQuickCreate
          {type}
          bind:values={answers}
          bind:step={tournamentPanel.step}
          oncreated={() => (tournamentPanel.open = null)}
          onadvanced={() => (tournamentPanel.advanced = true)}
          close={() => editor?.close()}
        />
      {:else}
        <TournamentDateEditor
          dateId={date?.id}
          typeId={tournamentPanel.typeId}
          startTab={tournamentPanel.tab}
          bind:start={answers}
          {edits}
          leave={leaveFor}
          oncreated={(id) => (tournamentPanel.open = closeOnCreate ? null : id)}
        />
      {/if}
    </EditorPanel>
  {/key}
{/if}

<!-- The editor's footer. The questions have none here: the wizard keeps its own (Back, Next, Schedule it) -->
{#snippet footer()}
  {#if date && asking}
    <p class="ask" role="alert">Delete it? Its teams, sign-ups and results go too.</p>
    <button class="btn ghost" type="button" onclick={() => (asking = false)}>Keep it</button>
    <button class="btn delete" type="button" disabled={saving.busy > 0} onclick={remove}>Delete</button>
  {:else}
    <SaveBar {edits} form="date-form" label={date ? "Save" : "Schedule it"} start={date ? deleteIt : backIt} />
  {/if}
{/snippet}
{#snippet deleteIt()}
  <button class="btn ghost danger" type="button" onclick={() => (asking = true)}>Delete</button>
{/snippet}
{#snippet backIt()}
  {#if type}
    <!-- Advanced on a new one: back to the three questions, with what's been filled in here -->
    <button class="btn ghost back" type="button" onclick={() => (tournamentPanel.advanced = false)}
      ><Icon name="chevronLeft" size={16} />Back to the questions</button
    >
  {/if}
{/snippet}

<style>
  /* Delete sits apart, at the start of the footer, in red words; asked, the question takes its place */
  .danger {
    color: var(--red-hot);
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
