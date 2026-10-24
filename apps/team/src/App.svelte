<script lang="ts">
  import { untrack, type Component } from "svelte";
  import { can } from "./access/actions";
  import { granted } from "./demo/session.svelte";
  import { routeFor } from "./app/nav-routes";
  import { editionAddressOf, routes } from "./app/routes.svelte";
  import { askedBy, editions, wantEdition } from "./app/editions.svelte";
  import { db } from "./demo/store.svelte";
  import { interceptLinks, navigate, remember, router } from "./app/router.svelte";
  import Shell from "./app/shell/Shell.svelte";
  import NotAllowed from "./pages/NotAllowed.svelte";
  import { loadedPage, loadPage, preloadPages } from "./app/pages.svelte";
  import { need, needsOf, prefetch, readyFor, showing } from "./app/page-data.svelte";
  import { reportUnexpected } from "./app/errors.early";
  import { ACTIONS } from "./demo/data";
  import { enterSettings } from "./app/settings-entry.svelte";
  import SimulationControl from "./lib/SimulationControl.svelte";
  import EnvRibbon from "./app/shell/EnvRibbon.svelte";
  import { ribbon } from "./app/shell/env-ribbon";
  import { withRibbon } from "@cougars/shared/ribbon";

  // A past one's page, or one of its games' or teams': read it if the app hasn't it, or ask again if it's changed
  // since (#175, app/editions.svelte.ts). Its page shows it loading meanwhile. First, so the address below knows
  // it's on its way
  $effect.pre(() => {
    void editions.round;
    const asked = askedBy(router.path);
    if (asked && db.tournamentTypes.some((t) => t.slug === asked.slug)) untrack(() => wantEdition(asked));
  });
  // A series' address with one on is that one's own (ADR 0074): replaced before the page shows, and again when the
  // one on changes under it (the next one scheduled from No Kumite yet)
  $effect.pre(() => {
    const to = editionAddressOf(router.path);
    if (to) navigate(to, { replace: true });
  });
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
  // ...and its parts of the club beyond the core (#178, app/page-data.svelte.ts): one request, if they aren't in. An
  // address that isn't a page yet (a member's, before the roster's in) is given everything, then found
  const needs = $derived(needsOf(allowed ? routeFor(all, router.path)?.page : "home", granted()));
  $effect(() => {
    showing(needs);
    // Offline or resting: the page shows with what the app has; anything else is ours to hear of
    need(needs).catch((e) => reportUnexpected(e, "Couldn't read this page's part of the club"));
  });
  const ready = $derived(readyFor(needs));
  // Then the pages you're likely to open next, while the phone's idle, once
  $effect(() => {
    untrack(() => prefetch(new Set(ACTIONS)));
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
    document.title = withRibbon(
      ribbon,
      route.id === "home" ? "Cougars Fresh Meat" : `${route.name} · Cougars Fresh Meat`,
    );
  });
</script>

<svelte:document onclick={interceptLinks} />

<Shell {route}>
  {#each [view] as v (v.id)}
    {#if v.Page && ready}<v.Page {...v.params} />{/if}
  {/each}
</Shell>
<!-- Dev only (ADR 0123): the Kumite simulation's control, while one runs, over whichever page -->
<SimulationControl focus={!!route.focus} />
<!-- LOCAL or DEV in the corner; nothing in production (ADR 0010) -->
{#if ribbon}<EnvRibbon {ribbon} />{/if}
