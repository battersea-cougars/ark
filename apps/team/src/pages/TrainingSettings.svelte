<script lang="ts">
  // Settings → Training: every training as a card, as Gwenda ops shows its series. A card opens that training's
  // editor in a modal panel; "New training" opens a blank one. New trainings appear in the menu and calendar at once.
  import { saving } from "../app/backend.svelte";
  import PageHeader from "../lib/PageHeader.svelte";
  import ScheduleCards, { type ScheduleCard } from "../lib/ScheduleCards.svelte";
  import EditorPanel from "../lib/EditorPanel.svelte";
  import TrainingEditor from "../lib/TrainingEditor.svelte";
  import { nextSession, seriesPlace, sessionBookable } from "../demo/schedule.svelte";
  import { db } from "../demo/store.svelte";
  import { clock, formatDayDate, londonToday, pounds } from "../lib/dates";
  import { feeOn } from "../lib/dues";
  import { describeRule } from "../lib/recurrence";

  const cards = $derived(
    db.series.map((s): ScheduleCard => {
      const next = s.active ? nextSession(s) : undefined;
      return {
        id: s.id,
        icon: s.icon,
        tone: s.tone,
        status: !s.active
          ? { label: "Paused" }
          : !s.public
            ? { label: "Members only" }
            : { label: "Running", tone: "green" },
        eyebrow: describeRule(s),
        name: s.name,
        next: next ? formatDayDate(sessionBookable(next).startsAt) : "No sessions coming up",
        lines: [
          `${clock(s.startTime)}–${clock(s.endTime)} · ${seriesPlace(s)?.name ?? "No venue"}`,
          `${pounds(feeOn(s.fees, londonToday())) || "Free"} a session`,
          ...(next ? [`${next.going.length}${s.capacity ? ` / ${s.capacity}` : ""} in`] : []),
        ],
      };
    }),
  );

  // The training open in the panel, or a new one
  let open = $state<number | "new" | null>(null);
  const editing = $derived(typeof open === "number" ? db.series.find((s) => s.id === open) : undefined);
</script>

<div class="page">
  <PageHeader
    title="Training"
    subtitle="Repeating sessions. Each one gets its own page, menu link and place in the calendar."
  />
  <ScheduleCards
    {cards}
    add={{ name: "New training", hint: "A day, a time, a place. Sessions are made 12 weeks ahead." }}
    onopen={(id) => (open = id)}
  />
</div>

{#if open !== null}
  {#key open}
    <EditorPanel
      eyebrow={editing ? `Training · ${describeRule(editing)}` : "Training"}
      title={editing?.name ?? "New training"}
      icon={editing?.icon}
      tone={editing?.tone}
      onclose={() => (open = null)}
    >
      <TrainingEditor seriesId={editing?.id} oncreated={(id) => (open = id)} />
      {#snippet footer()}
        <button class="btn primary" type="submit" form="training-form" disabled={saving.busy > 0}
          >{editing ? "Save" : "Add training"}</button
        >
      {/snippet}
    </EditorPanel>
  {/key}
{/if}
