<script lang="ts">
  // A training's editor in its panel, from wherever an admin is: Settings → Training (a card, or New training) and
  // the Calendar's New event (ADR 0065: one editor per thing). Saving a new one hands its id to `oncreated`.
  import { Edits } from "./dirty.svelte";
  import SaveBar from "./SaveBar.svelte";
  import { db } from "../demo/store.svelte";
  import EditorPanel from "./EditorPanel.svelte";
  import TrainingEditor from "./TrainingEditor.svelte";
  import { describeRule } from "./recurrence";

  let { open, onclose, oncreated }: { open: number | "new"; onclose: () => void; oncreated: (id: number) => void } =
    $props();

  const editing = $derived(typeof open === "number" ? db.series.find((s) => s.id === open) : undefined);
  // What's unsaved, and when it was saved (lib/dirty.svelte.ts)
  const edits = new Edits();
</script>

{#key open}
  <EditorPanel
    eyebrow={editing ? `Training · ${describeRule(editing)}` : "Training"}
    title={editing?.name ?? "New training"}
    icon={editing?.icon}
    tone={editing?.tone}
    {onclose}
    {edits}
  >
    <TrainingEditor seriesId={editing?.id} {edits} {oncreated} />
    {#snippet footer()}
      <SaveBar {edits} form="training-form" label={editing ? "Save" : "Add training"} />
    {/snippet}
  </EditorPanel>
{/key}
