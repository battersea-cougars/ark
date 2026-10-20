<script lang="ts">
  // A training's editor in its panel, from wherever an admin is: Settings → Training (a card, or New training) and
  // the Calendar's New event (ADR 0065: one editor per thing). Saving a new one hands its id to `oncreated`.
  import { saving } from "../app/backend.svelte";
  import { db } from "../demo/store.svelte";
  import EditorPanel from "./EditorPanel.svelte";
  import TrainingEditor from "./TrainingEditor.svelte";
  import { describeRule } from "./recurrence";

  let { open, onclose, oncreated }: { open: number | "new"; onclose: () => void; oncreated: (id: number) => void } =
    $props();

  const editing = $derived(typeof open === "number" ? db.series.find((s) => s.id === open) : undefined);
</script>

{#key open}
  <EditorPanel
    eyebrow={editing ? `Training · ${describeRule(editing)}` : "Training"}
    title={editing?.name ?? "New training"}
    icon={editing?.icon}
    tone={editing?.tone}
    {onclose}
  >
    <TrainingEditor seriesId={editing?.id} {oncreated} />
    {#snippet footer()}
      <button class="btn primary" type="submit" form="training-form" disabled={saving.busy > 0}
        >{editing ? "Save" : "Add training"}</button
      >
    {/snippet}
  </EditorPanel>
{/key}
