<script lang="ts">
  // Settings → Training: every training as a card, as Gwenda ops shows its series. A card opens that training's
  // editor in a modal panel; "New training" opens a blank one. New trainings appear in the menu and calendar at once.
  import PageHeader from "../lib/PageHeader.svelte";
  import ScheduleCards, { type ScheduleCard } from "../lib/ScheduleCards.svelte";
  import TrainingEditorPanel from "../lib/TrainingEditorPanel.svelte";
  import { nextSession, seriesPlace, sessionBookable } from "../demo/schedule.svelte";
  import { db } from "../demo/store.svelte";
  import { clockRange, formatDayDate, londonToday, pounds } from "../lib/dates";
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
          `${clockRange(s.startTime, s.endTime)} · ${seriesPlace(s)?.name ?? "No venue"}`,
          `${feeOn(s.fees, londonToday()) ? pounds(feeOn(s.fees, londonToday())) : "Free"} a session`,
          ...(next ? [`${next.going.length}${s.capacity ? ` / ${s.capacity}` : ""} in`] : []),
        ],
      };
    }),
  );

  // The training open in the panel, or a new one
  let open = $state<number | "new" | null>(null);
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
  <TrainingEditorPanel {open} onclose={() => (open = null)} oncreated={(id) => (open = id)} />
{/if}
