<script lang="ts" module>
  /** A series to open when the page arrives: a tournament's editor sends you to its series' defaults. */
  export const seriesToOpen = $state<{ id: number | null }>({ id: null });
</script>

<script lang="ts">
  // Settings → Tournament Series: a kind of tournament the club runs again and again (The Cougars Kumite), as a card.
  // Its defaults (rules, fee, location, awards, look) are set once here; a new tournament that picks the series
  // starts from them (Settings → Tournaments). A series gets its own section in the menu.
  import { gameLength } from "../lib/periods";
  import { Edits } from "../lib/dirty.svelte";
  import SaveBar from "../lib/SaveBar.svelte";
  import { kindLabel } from "../demo/model";
  import PageHeader from "../lib/PageHeader.svelte";
  import ScheduleCards, { type ScheduleCard } from "../lib/ScheduleCards.svelte";
  import EditorPanel from "../lib/EditorPanel.svelte";
  import TournamentEditor from "../lib/TournamentEditor.svelte";
  import { db } from "../demo/store.svelte";
  import { pounds } from "../lib/dates";
  import { typePlace } from "../demo/schedule.svelte";

  const cards = $derived(
    db.tournamentTypes.map((t): ScheduleCard => {
      const mine = db.tournaments.filter((x) => x.typeId === t.id);
      return {
        id: t.id,
        icon: t.icon,
        tone: t.tone,
        status: t.active ? { label: "Running", tone: "green" } : { label: "Paused" },
        eyebrow: `Round robin · ${kindLabel(t.kind)}`,
        name: t.name,
        next: typePlace(t)?.name ?? "No usual location",
        nextLabel: "At",
        lines: [
          `Win ${t.pointsWin} · Draw ${t.pointsDraw} · Loss ${t.pointsLoss} · ${gameLength(t)}`,
          `${t.defaultFeePence ? pounds(t.defaultFeePence) : "Free"} to enter · ${mine.length} ${mine.length === 1 ? "tournament" : "tournaments"}`,
        ],
      };
    }),
  );

  // The series open in the panel, or a new one
  let open = $state<number | "new" | null>(seriesToOpen.id);
  seriesToOpen.id = null;
  const editing = $derived(typeof open === "number" ? db.tournamentTypes.find((t) => t.id === open) : undefined);
  // What's unsaved in the series' editor, and when it was saved (lib/dirty.svelte.ts)
  const edits = new Edits();
</script>

<div class="page">
  <PageHeader
    title="Tournament Series"
    subtitle="Tournaments the club runs again and again. A new tournament in a series starts from its defaults."
  />
  <ScheduleCards
    {cards}
    add={{ name: "New series", hint: "Its rules, fee and awards. It gets its own section in the menu." }}
    onopen={(id) => (open = id)}
  />
</div>

{#if open !== null}
  {#key open}
    <EditorPanel
      eyebrow={editing ? `Series · ${kindLabel(editing.kind)}` : "Series"}
      title={editing?.name ?? "New series"}
      icon={editing?.icon}
      tone={editing?.tone}
      onclose={() => (open = null)}
      {edits}
    >
      <TournamentEditor typeId={editing?.id} {edits} oncreated={(id) => (open = id)} />
      {#snippet footer()}
        <SaveBar {edits} form="tournament-form" label={editing ? "Save" : "Add series"} />
      {/snippet}
    </EditorPanel>
  {/key}
{/if}
