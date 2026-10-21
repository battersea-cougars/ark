<script lang="ts">
  // Settings, where the gear goes (lib/SettingsButton), the same page on a phone and a desktop: every admin area your
  // account can set up, grouped Club / Schedule / Content / System (app/settings-list). With an everyday role, the
  // switch comes first; in that role the rows it can't open go quiet rather than away, so nothing moves, and opening
  // one switches you up (ADR 0024).
  import Icon from "../app/shell/Icon.svelte";
  import { openSetting, settingsNow } from "../app/settings-entry.svelte";
  import PageHeader from "../lib/PageHeader.svelte";
  import RoleSwitch from "../lib/RoleSwitch.svelte";

  const sections = $derived(settingsNow());
</script>

<div class="page">
  <PageHeader title="Settings" subtitle="Everything the club sets up, in one place." />
  <RoleSwitch />
  {#if sections.length}
    {#each sections as s (s.section)}
      <section class="group" aria-labelledby="settings-{s.section}">
        <h2 class="section-title" id="settings-{s.section}">{s.section}</h2>
        <div class="list">
          {#each s.rows as row (row.route.id)}
            <a class="row" class:quiet={!row.open} href={row.route.path} onclick={() => openSetting(row)}>
              <span class="glyph"><Icon name={row.route.icon} /></span>
              <span class="grow"
                ><span class="title">{row.route.name}</span><span class="sub">{row.route.hint}</span></span
              >
              <Icon name="chevronRight" size={18} />
            </a>
          {/each}
        </div>
      </section>
    {/each}
  {:else}
    <p class="note">Nothing to set up in your role.</p>
  {/if}
</div>

<style>
  .group {
    display: grid;
    gap: var(--s-3);
  }
  /* One line each on a phone: the hints are written short, and a long one trails off */
  .sub {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  /* Your everyday role can't open it: still there, quieter; a tap switches you up */
  .quiet {
    color: var(--fg-subtle);
  }
  .quiet .title,
  .quiet .glyph {
    color: var(--fg-subtle);
  }
</style>
