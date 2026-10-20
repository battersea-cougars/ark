<script lang="ts">
  // Everything that isn't a tab: you, the club, then Settings for admins, grouped Schedule / Money / Club / Security.
  // On More (desktop, for members with nothing to set up), under your details on a phone's You page, and alone (just
  // Settings) on a phone's Settings, where the gear goes. `except`: the page it's on, which needn't link to itself; `parts`: which groups.
  import { can } from "../access/actions";
  import Icon from "../app/shell/Icon.svelte";
  import type { Group, Route } from "../app/nav-routes";
  import { routes } from "../app/routes.svelte";
  import { granted } from "../demo/session.svelte";

  let { except, parts = ["You", "Club", "Settings"] }: { except?: string; parts?: ("You" | "Club" | "Settings")[] } =
    $props();

  const perms = $derived(granted());
  const visible = (g: Group) =>
    parts.includes(g) ? routes().filter((r) => r.group === g && r.id !== except && can(perms, r.action)) : [];
  const you = $derived(visible("You"));
  const club = $derived(visible("Club"));
  const settings = $derived(
    (["Schedule", "Money", "Club", "Security"] as const)
      .map((section) => ({ section, routes: visible("Settings").filter((r) => r.section === section) }))
      .filter((s) => s.routes.length),
  );
</script>

{#snippet rows(routes: Route[])}
  <div class="list">
    {#each routes as r (r.id)}
      <a class="row" href={r.path}>
        <span class="glyph"><Icon name={r.icon} /></span>
        <span class="grow"><span class="title">{r.name}</span><span class="sub">{r.hint}</span></span>
        <Icon name="chevronRight" size={18} />
      </a>
    {/each}
  </div>
{/snippet}

{#if you.length}
  <h2 class="section-title">You</h2>
  {@render rows(you)}
{/if}

{#if club.length}
  <h2 class="section-title">Club</h2>
  {@render rows(club)}
{/if}

{#if settings.length}
  <div class="settings">
    <!-- Alone, whatever holds it says Settings -->
    {#if parts.length > 1}<h2 class="settings-title"><Icon name="settings" size={16} /> Settings</h2>{/if}
    {#each settings as s (s.section)}
      <h3 class="section-title">{s.section}</h3>
      {@render rows(s.routes)}
    {/each}
  </div>
{/if}

<style>
  /* One line each, so the list stays a list on a phone: the hints are written short, and a long one trails off */
  .sub {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .settings {
    display: grid;
    gap: var(--s-5);
    margin-top: var(--s-6);
  }
  .settings:first-child {
    margin-top: 0;
  }
  .settings-title {
    display: flex;
    align-items: center;
    gap: var(--s-2);
    color: var(--fg);
    font-size: var(--text-md);
    font-weight: 600;
  }
</style>
