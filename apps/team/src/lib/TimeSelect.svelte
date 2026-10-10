<script lang="ts">
  // A time of day in an admin form: the app's Select, every quarter-hour in 24-hour time ("19:30"), opening on the one
  // set. The browser's own time picker can't be themed (and shows AM/PM), so it isn't used. A time off the quarters
  // that's already set (19:05) is kept as an option; `optional` adds "None" (an empty value).
  import { clock } from "./dates";
  import Select, { type SelectOption } from "./Select.svelte";

  let {
    value = $bindable(),
    id,
    optional = false,
    "aria-label": ariaLabel,
    onchange,
  }: {
    value: string;
    id: string;
    optional?: boolean;
    "aria-label": string;
    onchange?: (value: string) => void;
  } = $props();

  const QUARTERS = Array.from({ length: 96 }, (_, i) =>
    [Math.floor(i / 4), (i % 4) * 15].map((n) => String(n).padStart(2, "0")).join(":"),
  );
  const options = $derived<SelectOption[]>([
    ...(optional ? [{ value: "", label: "None" }] : []),
    ...[...new Set([...QUARTERS, ...(value ? [value] : [])])].sort().map((t) => ({ value: t, label: clock(t) })),
  ]);
</script>

<Select bind:value {id} {options} aria-label={ariaLabel} {onchange} class="num" />
