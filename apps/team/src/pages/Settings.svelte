<script lang="ts">
  // Where the gear goes (lib/SettingsButton). A phone lists every settings page you can open, grouped as the desktop's
  // list; a desktop opens the first one, with the list beside it (Shell).
  import { navigate } from "../app/router.svelte";
  import { settingsNow } from "../app/settings-entry.svelte";
  import MoreLinks from "../lib/MoreLinks.svelte";
  import PageHeader from "../lib/PageHeader.svelte";
  import { phone } from "../lib/viewport.svelte";

  const first = $derived(settingsNow()[0]);
  $effect(() => {
    if (!phone.current && first) navigate(first.path, { replace: true });
  });
</script>

<div class="page">
  <PageHeader title="Settings" />
  {#if first}
    <MoreLinks parts={["Settings"]} />
  {:else}
    <p class="note">Nothing to set up in your role.</p>
  {/if}
</div>
