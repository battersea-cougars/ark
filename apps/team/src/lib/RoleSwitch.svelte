<script lang="ts">
  // Your everyday role and your full one (ADR 0024), side by side: one tap switches, lit red with the slash like any
  // Pick. On your You page under your card, and at the top of Settings; only for someone with an everyday role. The
  // gear switches you up on the way into Settings, and this shows it.
  import Icon from "../app/shell/Icon.svelte";
  import { useFullRole } from "../app/settings-entry.svelte";
  import { elevated, everydayName, fullRole, hasEveryday } from "../demo/session.svelte";
</script>

{#if hasEveryday()}
  <div class="field role-switch">
    <span id="using-as">Using the app as</span>
    <div class="seg block" role="group" aria-labelledby="using-as">
      <button type="button" aria-pressed={!elevated()} onclick={() => useFullRole(false)}>
        <Icon name="user" size={18} />{everydayName()}
      </button>
      <button type="button" aria-pressed={elevated()} onclick={() => useFullRole(true)}>
        <Icon name="key" size={18} />{fullRole()}
      </button>
    </div>
  </div>
{/if}
