<script lang="ts">
  // A day in an admin form: a button showing "Fri 30 Oct 2026" that opens a month to pick from. The browser's own date
  // picker can't be themed (and shows mm/dd/yyyy), so it isn't used. Values are plain "YYYY-MM-DD", "" for none; the
  // pop-over is fixed-position and moved to the page (or the open dialog) like Select's, so panels never clip it.
  // `required` keeps the form's own check: an invisible input over the button carries the value.
  import { onMount, tick } from "svelte";
  import Icon from "../app/shell/Icon.svelte";
  import { londonToday } from "./dates";
  import { addDays, weekdayOf, WEEKDAYS } from "./recurrence";

  let {
    value = $bindable(),
    id,
    min,
    max,
    required = false,
    placeholder = "Choose a day",
    "aria-label": ariaLabel,
    "aria-describedby": describedBy,
    onchange,
  }: {
    value: string;
    id?: string;
    min?: string;
    max?: string;
    required?: boolean;
    placeholder?: string;
    "aria-label"?: string;
    "aria-describedby"?: string;
    /** After the value changes by a pick (not when the parent sets it). */
    onchange?: (value: string) => void;
  } = $props();

  const UTC = (opts: Intl.DateTimeFormatOptions) => new Intl.DateTimeFormat("en-GB", { timeZone: "UTC", ...opts });
  const long = UTC({ weekday: "short", day: "numeric", month: "short", year: "numeric" });
  const monthName = UTC({ month: "long", year: "numeric" });
  const at = (d: string) => new Date(`${d}T00:00:00Z`);
  const said = (d: string) => long.format(at(d)).replace(/,/g, "");

  let open = $state(false);
  let trigger = $state<HTMLButtonElement>();
  let pop = $state<HTMLDivElement>();
  let popStyle = $state("");
  // The day the keyboard is on, and so the month shown
  let focus = $state("");

  const today = londonToday();
  const month = $derived(focus.slice(0, 7));
  // Monday on or before the 1st, then six weeks: every month fits, and the grid never changes height
  const days = $derived.by(() => {
    const first = `${month}-01`;
    const start = addDays(first, -WEEKDAYS.indexOf(weekdayOf(first)));
    return Array.from({ length: 42 }, (_, i) => addDays(start, i));
  });
  const out = (d: string) => (!!min && d < min) || (!!max && d > max);
  const clamp = (d: string) => (min && d < min ? min : max && d > max ? max : d);
  const shiftMonth = (d: string, n: number) => {
    const [y, m, day] = d.split("-").map(Number);
    const t = new Date(Date.UTC(y, m - 1 + n, 1));
    const last = new Date(Date.UTC(t.getUTCFullYear(), t.getUTCMonth() + 1, 0)).getUTCDate();
    return new Date(Date.UTC(t.getUTCFullYear(), t.getUTCMonth(), Math.min(day, last))).toISOString().slice(0, 10);
  };

  function place() {
    if (!trigger || !pop) return;
    const r = trigger.getBoundingClientRect();
    const h = pop.offsetHeight;
    const w = pop.offsetWidth;
    const gap = 6;
    const up = innerHeight - r.bottom - gap < h + 12 && r.top - gap > innerHeight - r.bottom;
    const top = up ? Math.max(12, r.top - gap - h) : r.bottom + gap;
    const left = Math.max(12, Math.min(r.left, innerWidth - w - 12));
    popStyle = `top:${Math.round(top)}px;left:${Math.round(left)}px`;
  }

  /** Moves the pop-over out to the page, or to the native modal it's in: that sits above the page. */
  function portal(node: HTMLElement) {
    (trigger?.closest("dialog") ?? document.body).append(node);
    return { destroy: () => node.remove() };
  }

  async function focusDay() {
    await tick();
    pop?.querySelector<HTMLElement>(`[data-day="${focus}"]`)?.focus({ preventScroll: true });
  }

  async function setOpen(next: boolean) {
    open = next;
    if (!next) return;
    focus = clamp(value || today);
    await tick();
    place();
    void focusDay();
  }

  function choose(d: string) {
    if (out(d)) return;
    const changed = value !== d;
    value = d;
    if (changed) onchange?.(d);
    open = false;
    trigger?.focus();
  }

  function clear() {
    const changed = value !== "";
    value = "";
    if (changed) onchange?.("");
    open = false;
    trigger?.focus();
  }

  function move(d: string) {
    focus = d;
    void focusDay();
  }

  function onKey(e: KeyboardEvent) {
    const step: Record<string, number> = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -7, ArrowDown: 7 };
    if (e.key === "Escape") {
      e.preventDefault();
      open = false;
      trigger?.focus();
    } else if (e.key in step) {
      e.preventDefault();
      move(addDays(focus, step[e.key]));
    } else if (e.key === "PageUp" || e.key === "PageDown") {
      e.preventDefault();
      move(shiftMonth(focus, e.key === "PageUp" ? -1 : 1));
    } else if (e.key === "Tab" && !pop?.contains(e.target as Node)) open = false;
  }

  onMount(() => {
    const onPointer = (e: PointerEvent) => {
      const t = e.target as Node;
      if (open && !trigger?.contains(t) && !pop?.contains(t)) open = false;
    };
    const onMove = () => open && place();
    addEventListener("pointerdown", onPointer, true);
    addEventListener("resize", onMove);
    addEventListener("scroll", onMove, true);
    return () => {
      removeEventListener("pointerdown", onPointer, true);
      removeEventListener("resize", onMove);
      removeEventListener("scroll", onMove, true);
    };
  });
</script>

<div class="wrap" class:open>
  <button
    bind:this={trigger}
    type="button"
    class="input trigger"
    {id}
    aria-label={ariaLabel && `${ariaLabel}: ${value ? said(value) : placeholder}`}
    aria-describedby={describedBy}
    aria-haspopup="dialog"
    aria-expanded={open}
    onclick={() => void setOpen(!open)}
    onkeydown={(e) => e.key === "ArrowDown" && (e.preventDefault(), void setOpen(true))}
  >
    <span class="label" class:empty={!value}>{value ? said(value) : placeholder}</span>
    <Icon name="calendar" size={16} />
  </button>
  {#if required}
    <!-- The form's own "fill this in": carries the value, sits under the button so the browser points at it -->
    <input class="carrier" tabindex="-1" aria-hidden="true" {required} {value} oninput={() => {}} />
  {/if}

  {#if open}
    <div
      bind:this={pop}
      use:portal
      class="pop"
      style={popStyle}
      role="dialog"
      aria-label={ariaLabel ?? "Choose a day"}
      tabindex="-1"
      onkeydown={onKey}
    >
      <div class="head">
        <button
          type="button"
          class="btn ghost sm icon"
          aria-label="Last month"
          onclick={() => move(shiftMonth(focus, -1))}><Icon name="chevronLeft" size={16} /></button
        >
        <span class="month">{monthName.format(at(`${month}-01`))}</span>
        <button
          type="button"
          class="btn ghost sm icon"
          aria-label="Next month"
          onclick={() => move(shiftMonth(focus, 1))}><Icon name="chevronRight" size={16} /></button
        >
      </div>
      <div class="grid" role="grid">
        {#each ["M", "T", "W", "T", "F", "S", "S"] as w, i (i)}<span class="dow" aria-hidden="true">{w}</span>{/each}
        {#each days as d (d)}
          <button
            type="button"
            class="day"
            class:other={d.slice(0, 7) !== month}
            class:today={d === today}
            data-day={d}
            tabindex={d === focus ? 0 : -1}
            aria-label={said(d)}
            aria-pressed={d === value}
            aria-current={d === today ? "date" : undefined}
            disabled={out(d)}
            onclick={() => choose(d)}>{Number(d.slice(8))}</button
          >
        {/each}
      </div>
      <div class="foot">
        <button type="button" class="btn ghost sm" disabled={out(today)} onclick={() => choose(today)}>Today</button>
        {#if !required && value}
          <button type="button" class="btn ghost sm" onclick={clear}>Clear</button>
        {/if}
      </div>
    </div>
  {/if}
</div>

<style>
  .wrap {
    position: relative;
    min-width: 0;
  }
  .trigger {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--s-2);
    width: 100%;
    padding-right: var(--s-3);
    color: var(--fg);
    text-align: left;
    cursor: pointer;
  }
  .trigger :global(svg) {
    flex: none;
    color: var(--fg-muted);
  }
  .trigger:hover {
    border-color: color-mix(in srgb, var(--fg) 24%, transparent);
  }
  .label {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-variant-numeric: tabular-nums;
  }
  .label.empty {
    color: var(--fg-subtle);
  }
  .carrier {
    position: absolute;
    inset: auto 0 0;
    height: 1px;
    opacity: 0;
    pointer-events: none;
  }

  .pop {
    position: fixed;
    /* Above the editor panel (80) it may open from */
    z-index: 90;
    width: 18rem;
    padding: var(--s-2);
    border: 1px solid var(--border-strong);
    border-radius: var(--r-md);
    background: var(--surface-2);
    box-shadow: var(--shadow-pop);
    animation: pop var(--t-fast) var(--ease);
  }
  .pop:focus {
    outline: none;
  }
  @keyframes pop {
    from {
      opacity: 0;
      transform: translateY(-4px);
    }
  }
  .head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin-bottom: var(--s-1);
  }
  .month {
    font-weight: 600;
  }
  .grid {
    display: grid;
    grid-template-columns: repeat(7, 1fr);
    gap: 2px;
  }
  .dow {
    padding: var(--s-1) 0;
    color: var(--fg-subtle);
    font-size: var(--text-xs);
    text-align: center;
  }
  .day {
    position: relative;
    aspect-ratio: 1;
    border: 0;
    border-radius: var(--r-sm);
    background: none;
    color: var(--fg-body);
    font-size: var(--text-sm);
    font-variant-numeric: tabular-nums;
  }
  .day.other {
    color: var(--fg-subtle);
  }
  .day:hover:not(:disabled) {
    background: var(--surface-3);
    color: var(--fg);
  }
  /* The keyboard's day: a quiet tile (it starts on the chosen one, so no loud ring) */
  .day:focus {
    outline: none;
  }
  .day:focus-visible:not([aria-pressed="true"]) {
    background: var(--surface-3);
    color: var(--fg);
  }
  /* The one set: the chosen-tile look of a segment, not a colour block */
  .day[aria-pressed="true"] {
    background: color-mix(in srgb, var(--fg) 22%, var(--surface-2));
    color: var(--fg);
    font-weight: 700;
    box-shadow: 0 1px 2px rgb(0 0 0 / 0.35);
  }
  /* Today: a small red-hot mark under the number */
  .day.today::after {
    content: "";
    position: absolute;
    bottom: 4px;
    left: 50%;
    width: 4px;
    height: 4px;
    margin-left: -2px;
    border-radius: 50%;
    background: var(--red-hot);
  }
  .day:disabled {
    opacity: 0.3;
    cursor: not-allowed;
  }
  .foot {
    display: flex;
    justify-content: space-between;
    margin-top: var(--s-1);
  }
</style>
