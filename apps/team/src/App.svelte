<script lang="ts">
  import { untrack, type Component } from "svelte";
  import { can } from "./access/actions";
  import { granted } from "./demo/session.svelte";
  import { routeFor } from "./app/nav-routes";
  import { routes } from "./app/routes.svelte";
  import { interceptLinks, remember, router } from "./app/router.svelte";
  import Shell from "./app/shell/Shell.svelte";
  import NotAllowed from "./pages/NotAllowed.svelte";
  import { loadedPage, loadPage, preloadPages } from "./app/pages.svelte";
  import { enterSettings } from "./app/settings-entry.svelte";
  import SimulationControl from "./lib/SimulationControl.svelte";

  const all = $derived(routes());
  const route = $derived(routeFor(all, router.path) ?? routeFor(all, "/")!);
  const allowed = $derived(can(granted(), route.action));
  // Each page is its own chunk (app/pages.svelte.ts). main.ts loaded the first; any other that isn't in yet shows
  // the moment it is.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const Page: Component<any> | undefined = $derived(allowed ? loadedPage(route.page) : NotAllowed);
  $effect(() => {
    if (allowed) void loadPage(route.page);
  });
  // A settings page opened in your everyday role (a link, a reload): your full role, as the gear does (ADR 0024)
  $effect(() => {
    if (route.group === "Settings") enterSettings(route);
  });
  // Then the pages you can open, in the background
  $effect(() => {
    preloadPages(untrack(() => all.filter((r) => can(granted(), r.action)).map((r) => r.page)));
  });

  // The page's params, the same object until one actually changes. Every save rebuilds the routes (members are in
  // them), and a new object each time would re-run a page's effects on its params: the member page reloaded its
  // attendance and flickered.
  const paramsKey = $derived(JSON.stringify(route.params ?? {}));
  const params = $derived(JSON.parse(paramsKey) as Record<string, unknown>);
  // A page keeps its own route's params while it leaves: keyed by route, the one going is dropped, never handed the
  // next route's. Handed them, The Kumite read its type as gone (no typeId on Calendar) in the Manage button it lends
  // the phone bar, which sits outside the page, and the error stopped the next page from showing.
  const view = $derived({ id: route.id, Page, params });

  $effect(() => {
    if (!route.focus && !route.hidden) remember(route.tab, route.path);
    document.title = route.id === "home" ? "Cougars Fresh Meat" : `${route.name} · Cougars Fresh Meat`;
  });
</script>

<svelte:document onclick={interceptLinks} />

<Shell {route}>
  {#each [view] as v (v.id)}
    {#if v.Page}<v.Page {...v.params} />{/if}
  {/each}
</Shell>
<!-- Dev only (ADR 0123): the Kumite simulation's control, while one runs, over whichever page -->
<SimulationControl focus={!!route.focus} />
