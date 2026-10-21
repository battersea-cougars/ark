<script lang="ts">
  // The Settings gear on a phone: the one way in, top right in the You page's bar (a desktop's is at the dock's foot,
  // app/shell/Shell). In your everyday role it switches you up to your full role on the way (app/settings-entry), and the
  // switch at the top of Settings shows it.
  import Icon from "../app/shell/Icon.svelte";
  import { canReachSettings, enterSettings } from "../app/settings-entry.svelte";

  let { on = false, tile = false }: { on?: boolean; tile?: boolean } = $props();
</script>

{#if canReachSettings()}
  <a
    class="gear"
    class:btn={!tile}
    class:sm={!tile}
    class:icon={!tile}
    class:ghost={!tile}
    class:tile
    class:on
    href="/settings"
    aria-label="Settings"
    aria-current={on ? "page" : undefined}
    title="Settings"
    onclick={() => enterSettings()}><Icon name="settings" size={tile ? 20 : 22} /></a
  >
{/if}

<style>
  /* Beside a desktop's avatar: the same glass tile */
  .tile {
    display: inline-grid;
    place-items: center;
    width: 2.25rem;
    height: 2.25rem;
    border: 1px solid var(--border);
    border-radius: var(--r-md);
    background: color-mix(in srgb, var(--surface-1) 45%, transparent);
    backdrop-filter: blur(14px) saturate(1.4);
    -webkit-backdrop-filter: blur(14px) saturate(1.4);
    color: var(--fg-muted);
    transition:
      background-color var(--t-fast) var(--ease-in-out),
      color var(--t-fast) var(--ease-in-out);
  }
  .tile:hover {
    background: color-mix(in srgb, var(--surface-3) 90%, transparent);
    color: var(--fg);
  }
  /* In Settings: lit, as the dock lights the page you're on */
  .gear.on {
    color: var(--red-ink);
  }
</style>
