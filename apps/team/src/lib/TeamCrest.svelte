<script lang="ts">
  // A team's crest: its logo, or its initials on a grey tile in the team's colour. With `onclick` it's a button (its captain or an admin
  // changes the look).
  import { teamInitials } from "@cougars/shared/team-initials";

  let {
    name,
    among,
    logo,
    size = "2.75rem",
    tone,
    onclick,
  }: {
    name: string;
    /** Its tournament's team names, in order: no two of their crests share initials (@cougars/shared/team-initials). */
    among?: readonly string[];
    logo: string | null;
    size?: string;
    /** The team's colour (team-tones.ts): its initials are in it; the tile stays grey. */
    tone?: string;
    onclick?: () => void;
  } = $props();
</script>

{#snippet face()}
  {#if logo}<img src={logo} alt="" />{:else}<span class="display">{teamInitials(name, among)}</span>{/if}
{/snippet}

{#if onclick}
  <button
    class="crest tap"
    style:--size={size}
    style:--crest={tone}
    aria-label="{name}: change the name or logo"
    {onclick}>{@render face()}</button
  >
{:else}
  <span class="crest" style:--size={size} style:--crest={tone} aria-hidden="true">{@render face()}</span>
{/if}

<style>
  .crest {
    display: inline-grid;
    place-items: center;
    flex-shrink: 0;
    width: var(--size);
    height: var(--size);
    padding: 0;
    overflow: hidden;
    border: 0;
    border-radius: var(--r-md);
    background: var(--surface-3);
    color: var(--crest, var(--fg));
    font-size: calc(var(--size) * 0.42);
    line-height: 1;
  }
  .tap {
    cursor: pointer;
    transition: scale var(--t-fast) var(--ease);
  }
  .tap:hover {
    scale: 1.06;
  }
  .tap:focus-visible {
    outline: 2px solid var(--ring);
    outline-offset: 2px;
  }
  img {
    width: 100%;
    height: 100%;
    object-fit: cover;
  }
</style>
