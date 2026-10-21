<script lang="ts">
  // A date as the club shows it: the weekday, the day's number big, the month, stacked (Fri / 23 / Oct). The event
  // card leads with it, Home's rows line up on it. With no day yet it keeps its shape: the season over TBC over its
  // year (Summer / TBC / 2027), or Date / TBC. `small`: a light row's size, the same type and proportions.
  import { dateBadge } from "./dates";

  let {
    at,
    season,
    tbc = false,
    small = false,
  }: { at: string; season?: { name: string; year: number }; tbc?: boolean; small?: boolean } = $props();

  const badge = $derived(dateBadge(at));
  const [top, mid, bottom] = $derived(
    season
      ? [season.name, "TBC", String(season.year)]
      : tbc
        ? ["Date", "TBC", " "]
        : [badge.weekday, badge.day, badge.month],
  );
</script>

<span class="date-block" class:small>
  <span class="eyebrow">{top}</span>
  <span class="display day" class:word={mid === "TBC"}>{mid}</span>
  <span class="eyebrow">{bottom}</span>
</span>

<style>
  .date-block {
    display: grid;
    justify-items: center;
    gap: 0.1rem;
    text-align: center;
  }
  .day {
    font-size: 1.9rem;
    color: var(--fg);
  }
  /* TBC is three letters where a number is one or two: a size down so the block keeps its width */
  .day.word {
    font-size: 1.45rem;
  }
  /* In a light row: the same block, scaled to its height */
  .small {
    gap: 0;
  }
  .small .eyebrow {
    font-size: 0.6rem;
    line-height: 1.2;
  }
  .small .day {
    font-size: 1.4rem;
    line-height: 1;
  }
  .small .day.word {
    font-size: 1.05rem;
    line-height: 1.33;
  }
</style>
