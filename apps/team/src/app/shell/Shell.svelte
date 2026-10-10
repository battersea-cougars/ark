<script lang="ts">
  // The shell. Desktop: the page has the whole screen; a dock of the main sections floats mid-left, the brand
  // mark top-left, your badge top-right, the wordmark in the bottom-left corner. A section's
  // pages (The Kumite, Fight card, Draft) sit in the page header's toolbar row, which pins as the page scrolls
  // (PageHeader). Phones: five tabs at the bottom, and a slim bar along the top with the page's name (or its
  // section's strip of pages), its actions, and its filters: inline when they fit, otherwise a Filters button that
  // opens them in a sheet. Home has neither: it starts with the greeting.
  import { goesBy, shortName } from "../../lib/names";
  import { initials } from "../../lib/initials";
  import { type Snippet } from "svelte";
  import { can } from "../../access/actions";
  import { granted, impersonating, me, realMember, rolesOf, viewAs } from "../../demo/session.svelte";
  import { stripRoutes, tabHref, tabRoutes } from "../mobile-nav";
  import { routeFor, type Route, type TabId } from "../nav-routes";
  import { folds, routes, stayIfAllowed, tabs } from "../routes.svelte";
  import { navigate, router } from "../router.svelte";
  import { fly } from "svelte/transition";
  import { easeOut, eject, fadeMs, flyMs, prefersReducedMotion, zoom } from "../motion";
  import type { IconName } from "./icons";
  import AccountMenu from "./AccountMenu.svelte";
  import PullToRefresh from "./PullToRefresh.svelte";
  import Icon from "./Icon.svelte";
  import logo from "../../assets/cougars-mark.webp";
  import { owedBy } from "../../demo/dues.svelte";
  import { pounds } from "../../lib/dates";
  import Sheet from "../../lib/Sheet.svelte";
  import { phone } from "../../lib/viewport.svelte";
  import { pageBar } from "./page-bar.svelte";
  import { saving } from "../backend.svelte";
  import { update } from "../update.svelte";

  let { route, children }: { route: Route; children: Snippet } = $props();

  const perms = $derived(granted());
  const all = $derived(routes());
  const tabList = $derived(tabs());
  const strip = $derived(route.focus ? [] : stripRoutes(all, route, perms));
  const allowed = (r: Route) => !r.focus && !r.hidden && can(perms, r.action);

  // The dock: only the main sections. Home, a tile per training, Calendar, a tile per tournament type, the club
  // pages, then Settings (or More, for members with nothing to set up). Everything else is reached from a page.
  interface DockItem {
    id: string;
    name: string;
    icon: IconName;
    href: string;
    on: boolean;
    /** A small count on the tile: what you owe. */
    badge?: string;
  }
  const dock = $derived.by((): DockItem[] => {
    const items: DockItem[] = [];
    const home = all.find((r) => r.id === "home");
    if (home) items.push({ id: home.id, name: home.name, icon: home.icon, href: home.path, on: route.id === home.id });
    for (const r of all.filter((r) => r.tab === "training" && allowed(r))) {
      items.push({
        id: r.id,
        name: r.name,
        icon: r.icon,
        href: r.path,
        on: route.params?.seriesId === r.params?.seriesId && route.tab === "training",
      });
    }
    const cal = all.find((r) => r.tab === "calendar" && allowed(r));
    if (cal) items.push({ id: cal.id, name: cal.name, icon: cal.icon, href: cal.path, on: route.tab === "calendar" });
    for (const f of folds()) {
      const first = all.find((r) => r.fold === f.id && allowed(r));
      if (first) items.push({ id: f.id, name: f.name, icon: f.icon, href: first.path, on: route.fold === f.id });
    }
    for (const r of all.filter((r) => r.group === "Club" && allowed(r))) {
      // Its own pages too: a member's (/more/teammates/12) is Teammates
      const on = route.id === r.id || route.path.startsWith(r.path + "/");
      items.push({ id: r.id, name: r.name, icon: r.icon, href: r.path, on });
    }
    // Dues: always there, with what you owe on it until it's paid
    const dues = all.find((r) => r.id === "tab");
    if (dues) {
      const owed = owedBy(me().id);
      items.push({
        id: dues.id,
        name: owed > 0 ? `Dues · you owe ${pounds(owed)}` : "Dues",
        icon: dues.icon,
        href: dues.path,
        on: route.id === dues.id,
        badge: owed > 0 ? pounds(owed) : undefined,
      });
    }
    const more = all.find((r) => r.id === "more");
    if (more) {
      const settings = all.some((r) => r.group === "Settings" && allowed(r));
      // Settings opens on its first page, with every settings page listed beside it
      const firstSetting = all.find((r) => r.group === "Settings" && allowed(r));
      items.push({
        id: more.id,
        name: settings ? "Settings" : "More",
        icon: settings ? "settings" : "more",
        href: firstSetting?.path ?? more.path,
        // Only its own pages: Teammates and Upload (More's tab on a phone) have tiles of their own
        on: route.group === "Settings" || route.id === "more",
      });
    }
    return items;
  });

  // Desktop settings: every settings page in a list beside the dock while you're in one, so moving between them is
  // one click, not Back to the list. Grouped as the list is (More); a narrower desktop gets a link back to it.
  const inSettings = $derived(route.group === "Settings" && !route.focus);
  const settingsNav = $derived(
    (["Schedule", "Money", "Club", "Security"] as const)
      .map((section) => ({
        section,
        routes: all.filter((r) => r.group === "Settings" && r.section === section && allowed(r)),
      }))
      .filter((s) => s.routes.length),
  );
  // The phone's Settings is the More list; a desktop lists them beside the page instead. Widened onto More, open the
  // first settings page in its place, as the dock's Settings does (members with nothing to set up keep More)
  $effect(() => {
    const first = settingsNav[0]?.routes[0];
    if (!phone.current && route.id === "more" && first) navigate(first.path, { replace: true });
  });
  // A phone's More is your profile now (the avatar tab, with the lists under your details)
  $effect(() => {
    if (phone.current && route.id === "more") navigate("/me", { replace: true });
  });
  // Each row's place in the list, so they arrive one after another
  const settingsOrder = $derived(new Map(settingsNav.flatMap((s) => s.routes).map((r, i) => [r.id, i])));

  // The save note: "Saving…" once a save has taken a moment (a quick one doesn't flash), then its outcome
  let slow = $state(false);
  $effect(() => {
    if (!saving.busy) return void (slow = false);
    const t = setTimeout(() => (slow = true), 250);
    return () => clearTimeout(t);
  });
  const note = $derived<{ kind: "busy" | "done" | "failed"; text: string } | null>(
    saving.message
      ? { kind: saving.failed ? "failed" : "done", text: saving.message }
      : slow
        ? { kind: "busy", text: "Saving…" }
        : null,
  );

  // The save note lives on the page body, like an open editor panel, so it shows above one
  function onBody(node: HTMLElement) {
    document.body.append(node);
    return { destroy: () => node.remove() };
  }

  let chromeH = $state(0);
  // The pinned band's height (the View-as banner): the desktop corners sit under it, not behind it
  let pinnedH = $state(0);
  let content: HTMLElement | undefined = $state();

  let filtersOpen = $state(false);
  // The desktop header shows the section's pages as pills in its toolbar row
  $effect(() => {
    pageBar.strip = strip.map((r) => ({ id: r.id, path: r.path, label: r.short ?? r.name }));
    pageBar.current = route.under ?? route.id;
  });
  const showBar = $derived(!route.focus && route.id !== "home");

  // A page reached from another (a team, a matchup, a past Kumite, a member): Back, named for where you were, along
  // the trail (#86). Opened from outside the app or after a reload, back to the page it belongs under.
  const backTo = $derived.by(() => {
    if (!route.hidden || route.focus) return null;
    const from = router.from ? routeFor(all, router.from) : undefined;
    const to = from ?? all.find((r) => r.id === route.under) ?? all.find((r) => r.tab === route.tab && !r.hidden);
    return to ? { href: to.path, label: to.short ?? to.name, history: !!from } : null;
  });
  function back(e: MouseEvent) {
    if (!backTo?.history || e.metaKey || e.ctrlKey || e.shiftKey) return;
    e.preventDefault();
    history.back();
  }

  // Phone bar: the filters sit in the bar when they fit beside the name and the actions. A hidden copy gives
  // their natural width, so the answer doesn't flip-flop as the Filters button comes and goes.
  let bar = $state<HTMLElement | undefined>();
  let lead = $state<HTMLElement | undefined>();
  let acts = $state<HTMLElement | undefined>();
  let measure = $state<HTMLElement | undefined>();
  let filtersFit = $state(false);
  $effect(() => {
    const [b, m] = [bar, measure];
    void route.id; // a new page brings a new name, which no resize would report
    if (!b || !m) {
      filtersFit = false;
      return;
    }
    // The name and the strip stretch to fill the bar, so add up what's in them instead of taking their width
    const natural = (el: HTMLElement | undefined) => {
      if (!el) return 0;
      if (!el.matches(".strip")) {
        const r = document.createRange();
        r.selectNodeContents(el);
        return r.getBoundingClientRect().width;
      }
      return [...el.querySelectorAll<HTMLElement>(".strip-link")].reduce((w, a) => w + a.offsetWidth, 0);
    };
    const check = () => {
      const cs = getComputedStyle(b);
      const room = b.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight);
      const gap = parseFloat(cs.columnGap) || 0;
      const back = b.querySelector<HTMLElement>(".bar-back")?.offsetWidth ?? 0;
      const need = back + natural(lead) + m.offsetWidth + (acts?.offsetWidth ?? 0) + gap * 3;
      filtersFit = need <= room;
    };
    const ro = new ResizeObserver(check);
    for (const el of [b, m, acts]) if (el) ro.observe(el);
    check();
    return () => ro.disconnect();
  });

  // Tapping the tab you're on goes to its first page; on the first page, it scrolls to the top.
  function onTab(tab: TabId, event: MouseEvent) {
    if (tab !== route.tab) return;
    event.preventDefault();
    const first = tabRoutes(all, tab, perms)[0]?.path ?? "/";
    if (router.path !== first) navigate(first);
    else content?.querySelector(".view")?.scrollTo({ top: 0, behavior: prefersReducedMotion ? "auto" : "smooth" });
  }

  // Full-screen pages zoom in from a blur. The page leaving goes at once, so the two never show through each other.
  // Desktop pages slide in from the way you went: down the dock (or across a section's strip) they come from below
  // (or the right); back up, from above (or the left). Transform only: a parent below full opacity stops the browser
  // blurring behind the glass cards inside it. Phones just fade in, briefly, so that pause in the blur goes unseen.
  //
  // Desktop, between the pages of one section (a tournament's home, Fight card, The board, Teams, Draft): the header and the
  // strip stay exactly where they were, as tabs do. The new page goes in at once, at the same scroll (so a docked
  // strip stays docked), and only what's under the strip slides across.
  // Where you start counts as where you came from: the first page shows without a transition (no intro), so it never
  // goes through enter, and the first move from it would otherwise look like arriving from somewhere else
  // svelte-ignore state_referenced_locally
  let prevIndex = all.findIndex((r) => r.id === route.id);
  // svelte-ignore state_referenced_locally
  let prevTab: string | undefined = route.tab;
  // svelte-ignore state_referenced_locally
  let prevFold: string | undefined = route.fold;
  let lastScroll = 0;
  // Where each page was scrolled to, so going back opens it there (#86). Not state: only read as a page opens
  // eslint-disable-next-line svelte/prefer-svelte-reactivity
  const scrolls = new Map<string, number>();
  // Phones (#83): the bar slides up out of the way as you scroll down, and back the moment you scroll up or reach
  // the top. It overlays the page, so nothing moves. Not while a sheet's open (the page under it can scroll)
  let tucked = $state(false);
  let barH = $state(0);
  const TUCK_AFTER = 8;
  // Where the last move of more than TUCK_AFTER ended: a small wobble either way doesn't flick the bar
  let turnedAt = 0;
  $effect(() => {
    void route.id;
    tucked = false;
    turnedAt = 0;
  });
  $effect(() => {
    if (!content) return;
    const track = (e: Event) => {
      const el = e.target as HTMLElement;
      if (!el.classList?.contains("view")) return;
      lastScroll = el.scrollTop;
      const delta = el.scrollTop - turnedAt;
      if (!phone.current || !showBar || el.scrollTop <= barH) tucked = false;
      else if (document.querySelector("dialog[open]")) {
        // A sheet's open: leave the bar as it is
      } else if (delta > TUCK_AFTER) tucked = true;
      else if (delta < -TUCK_AFTER) tucked = false;
      if (Math.abs(delta) > TUCK_AFTER || el.scrollTop <= barH) turnedAt = el.scrollTop;
      scrolls.set(router.path, el.scrollTop);
    };
    content.addEventListener("scroll", track, true);
    return () => content?.removeEventListener("scroll", track, true);
  });
  function enter(node: Element, { focus }: { focus?: boolean }) {
    const index = all.findIndex((r) => r.id === route.id);
    const sideways = prevTab === route.tab && strip.length > 1;
    const within = !phone.current && !!route.fold && prevFold === route.fold && strip.length > 1;
    const dir = prevIndex < 0 ? 1 : Math.sign(index - prevIndex) || 1;
    prevIndex = index;
    prevTab = route.tab;
    prevFold = route.fold;
    // Back to a page: where you left it, once it's laid out
    const saved = router.back ? scrolls.get(router.path) : undefined;
    if (saved) requestAnimationFrame(() => ((node as HTMLElement).scrollTop = saved));
    if (focus) return zoom(node);
    if (within) {
      const view = node as HTMLElement;
      const header = view.querySelector(".page-header");
      // As far down as you were, but no further than where the strip docks
      const dock = header ? header.getBoundingClientRect().bottom - view.getBoundingClientRect().top : 0;
      view.scrollTop = Math.min(lastScroll, dock);
      lastScroll = view.scrollTop;
      if (!prefersReducedMotion) {
        view.style.setProperty("--swap", `${dir * 32}px`);
        view.classList.add("swap");
        // Only this once: anything the page adds later (a confirm panel) just appears
        setTimeout(() => view.classList.remove("swap"), 450);
      }
      return { duration: 0 };
    }
    lastScroll = 0;
    if (prefersReducedMotion) return { duration: 0 };
    // Phones: a quick fade in place, as phone apps do; a slide across a small screen reads as the whole app moving
    if (phone.current) return { duration: 150, css: (t: number) => `opacity: ${t.toFixed(3)}` };
    const axis = sideways ? "X" : "Y";
    const distance = sideways ? 56 : 44;
    return {
      duration: 480,
      easing: (t: number) => 1 - Math.pow(1 - t, 4),
      css: (_t: number, u: number) => `transform: translate${axis}(${(dir * distance * u).toFixed(2)}px)`,
    };
  }
  function leave(node: Element, { focus }: { focus?: boolean }) {
    return focus ? zoom(node, { out: true }) : { duration: 0 };
  }

  // Keep the current page's strip link in view, centred where there's room.
  function centre(nav: HTMLElement, _key: unknown) {
    const run = () => {
      const el = nav.querySelector<HTMLElement>("[aria-current]");
      if (!el) return;
      nav.scrollLeft = Math.max(0, el.offsetLeft - (nav.clientWidth - el.offsetWidth) / 2);
    };
    run();
    return { update: run };
  }

  // The poster word behind each page's title: the section it's in (Friday, Kumite), else the page itself.
  const ghost = $derived(
    route.id === "home"
      ? ""
      : route.id === "more"
        ? (dock.find((d) => d.id === "more")?.name ?? route.name)
        : route.fold
          ? (tabList.find((t) => t.id === route.tab)?.label ?? route.name)
          : (route.short ?? route.name),
  );
</script>

<div class="shell" class:focus={route.focus} class:in-settings={inSettings && !phone.current}>
  <!-- Desktop: the dock, floating mid-left -->
  <nav class="dock" aria-label="Main" inert={route.focus || undefined}>
    {#each dock as item (item.id)}
      <a
        class="dock-item"
        class:on={item.on}
        href={item.href}
        aria-current={item.on ? "page" : undefined}
        aria-label={item.name}
      >
        <Icon name={item.icon} size={20} />
        {#if item.badge}<span class="dock-badge num" aria-hidden="true">{item.badge}</span>{/if}
        <span class="dock-label" aria-hidden="true">{item.name}</span>
      </a>
    {/each}
  </nav>

  {#if inSettings && !phone.current}
    <!-- Desktop: every settings page, beside the dock -->
    <nav class="settings-nav" aria-label="Settings" in:eject out:eject={{ out: true }}>
      <p class="settings-home"><Icon name="settings" size={16} />Settings</p>
      {#each settingsNav as s (s.section)}
        <p
          class="settings-section"
          in:eject|global={{ delay: 60 + (settingsOrder.get(s.routes[0].id) ?? 0) * 28, x: 14 }}
        >
          {s.section}
        </p>
        {#each s.routes as r (r.id)}
          <a
            in:eject|global={{ delay: 80 + (settingsOrder.get(r.id) ?? 0) * 28, x: 14 }}
            class="settings-link"
            class:on={r.id === route.id}
            href={r.path}
            aria-current={r.id === route.id ? "page" : undefined}
          >
            <Icon name={r.icon} size={16} />{r.name}
          </a>
        {/each}
      {/each}
    </nav>
  {/if}

  <main class="main">
    <header class="chrome" bind:clientHeight={chromeH} style:--pinned-h="{pinnedH}px">
      <!-- Always there: the notch, and the View-as banner (it must never scroll away) -->
      <div class="pinned" class:bare={route.focus} bind:clientHeight={pinnedH}>
        {#if impersonating()}
          <div class="viewing" role="status">
            <Icon name="eye" size={16} />
            <span class="viewing-text">
              Viewing as <strong>{goesBy(me())}</strong>
              <span class="viewing-role">· {rolesOf(me().id).join(", ")} · read-only</span>
            </span>
            <button class="btn sm viewing-back" onclick={() => (viewAs(null), stayIfAllowed())}>
              Back to {shortName(realMember())}
            </button>
          </div>
        {/if}
      </div>

      {#if phone.current}
        {#if showBar}
          <!-- Phones: the page's name or its section's pages, then its actions and filters -->
          <div class="phone-bar" class:tucked bind:this={bar} bind:clientHeight={barH}>
            {#if backTo}
              <a class="bar-back named" href={backTo.href} onclick={back}
                ><Icon name="chevronLeft" size={20} /><span>{backTo.label}</span></a
              >
              <p class="bar-title" bind:this={lead}>{route.short ?? route.name}</p>
            {:else if strip.length}
              {@render stripNav()}
            {:else}
              <!-- Pages opened from your profile lead back to it -->
              {#if route.tab === "more" && route.id !== "profile"}
                <a class="bar-back" href="/me" aria-label="Back to Profile"><Icon name="chevronLeft" size={22} /></a>
              {/if}
              <!-- The short name where there is one (Friday), as the tabs and the dock call it: the bar is narrow -->
              <p class="bar-title" bind:this={lead}>{route.short ?? route.name}</p>
            {/if}
            {#if pageBar.filters}
              <div class="measure" aria-hidden="true" inert>
                <div class="bar-filters" bind:this={measure}>{@render pageBar.filters()}</div>
              </div>
              {#if filtersFit}<div class="bar-filters">{@render pageBar.filters()}</div>{/if}
            {/if}
            {#if pageBar.actions || (pageBar.filters && !filtersFit)}
              <div class="bar-actions">
                {#if pageBar.actions}<span class="bar-actions" bind:this={acts}>{@render pageBar.actions()}</span>{/if}
                {#if pageBar.filters && !filtersFit}
                  <button class="btn sm filters-btn" aria-haspopup="dialog" onclick={() => (filtersOpen = true)}>
                    <Icon name="filter" size={16} />Filters<span class="count num">{pageBar.active || ""}</span>
                  </button>
                {/if}
              </div>
            {/if}
          </div>
        {/if}
      {:else if !route.focus}
        <!-- Desktop: the mark and your badge in the top corners -->
        <div class="topbar" style:top="{pinnedH}px">
          <a class="brand" href="/" aria-label="Home">
            <img src={logo} alt="" width="36" height="36" />
          </a>
          <AccountMenu />
        </div>
      {/if}
    </header>

    {#snippet stripNav()}
      <nav
        bind:this={lead}
        class="strip"
        aria-label="{tabList.find((t) => t.id === route.tab)?.label} pages"
        use:centre={route.id}
      >
        {#each strip as r (r.id)}
          {@const on = r.id === route.id}
          <a class="strip-link" class:on href={r.path} aria-current={on ? "page" : undefined}>
            {r.short ?? r.name}
          </a>
        {/each}
      </nav>
    {/snippet}

    {#if pageBar.filters && phone.current && !filtersFit}
      <Sheet bind:open={filtersOpen} title="Filters">
        {@render pageBar.filters()}
        {#snippet footer()}
          {#if pageBar.onclear}
            <button class="btn ghost" disabled={!pageBar.active} onclick={() => pageBar.onclear?.()}>Clear</button>
          {/if}
          <button class="btn primary" onclick={() => (filtersOpen = false)}>Done</button>
        {/snippet}
      </Sheet>
    {/if}

    <!-- (bar-tucked and --bar-h: for what sticks under the bar, to follow it up: Friday's table) -->
    <div
      class="content"
      class:bar-tucked={tucked}
      bind:this={content}
      style:--chrome-h="{chromeH}px"
      style:--bar-h="{barH}px"
    >
      <!-- Phones: pull down from the top to read the club again. Not on a full-screen page (the game clock) -->
      {#if phone.current && !route.focus}<PullToRefresh {content} top={chromeH} />{/if}
      {#key route.id}
        <div
          class="view"
          class:under-tabs={!route.focus}
          in:enter={{ focus: route.focus }}
          out:leave={{ focus: route.focus }}
        >
          {#if ghost && !route.focus}<span class="ghost-word display" aria-hidden="true">{ghost}</span>{/if}
          {@render children()}
        </div>
      {/key}
    </div>

    <!-- Desktop corner -->
    {#if !route.focus}
      <a class="corner wordmark-corner display" href="/" aria-hidden="true" tabindex="-1">
        <span>Cougars</span><span class="meat">Fresh Meat</span>
      </a>
    {/if}

    <nav class="tabs" aria-label="Primary" inert={route.focus || undefined}>
      {#each tabList as tab (tab.id)}
        {@const on = route.tab === tab.id}
        <a
          class="tab"
          class:on
          href={tabHref(all, tab.id, perms, router.last)}
          aria-current={on ? "true" : undefined}
          onclick={(e) => onTab(tab.id, e)}
        >
          <span class="tab-icon">
            {#if tab.id === "more"}
              <!-- You: your initials, as your badge shows them -->
              <span class="avatar tab-avatar" aria-hidden="true">{initials(goesBy(me()))}</span>
            {:else}
              <Icon name={tab.icon} size={22} />
            {/if}
          </span>
          <span class="tab-label">{tab.label}</span>
        </a>
      {/each}
    </nav>
  </main>

  <!-- A newer build is out (ADR 0104): offered, never forced, in the save note's place; a save's note goes first -->
  {#if update.ready && !update.dismissed && !note && !route.focus}
    <div
      class="save-note update-note"
      use:onBody
      role="status"
      in:fly={{ y: 64, duration: flyMs, easing: easeOut, opacity: 0 }}
      out:fly={{ y: 64, duration: fadeMs, opacity: 0 }}
    >
      <span>A new version's out</span>
      <button class="btn sm primary" onclick={() => location.reload()}>Reload</button>
      <button class="btn sm ghost icon" aria-label="Not now" onclick={() => (update.dismissed = true)}
        ><Icon name="x" size={16} /></button
      >
    </div>
  {/if}

  <!-- What the last save did: "Saved", or what went wrong. Floats over the page, so nothing moves. -->
  {#if note}
    <!-- Rises from the bottom edge; "Saving…" turns into "Saved" (or what went wrong) in place -->
    <p
      class="save-note {note.kind}"
      use:onBody
      role={note.kind === "failed" ? "alert" : "status"}
      in:fly={{ y: 64, duration: flyMs, easing: easeOut, opacity: 0 }}
      out:fly={{ y: 64, duration: fadeMs, opacity: 0 }}
    >
      {#if note.kind === "busy"}
        <span class="spinner" aria-hidden="true"></span>
      {:else}
        <span class="note-icon" aria-hidden="true"
          ><Icon name={note.kind === "failed" ? "alert" : "check"} size={14} /></span
        >
      {/if}
      <span>{note.text}</span>
    </p>
  {/if}
</div>

<style>
  .shell {
    height: 100dvh;
    overflow: hidden;
  }
  .main {
    position: relative;
    display: flex;
    flex-direction: column;
    height: 100%;
    min-width: 0;
    min-height: 0;
  }
  .content {
    position: relative;
    flex: 1;
    min-height: 0;
  }
  /* Views stack, so one can leave while the next slides in. Each scrolls on its own, under the chrome. */
  .view {
    position: absolute;
    inset: 0;
    padding-top: var(--chrome-h, 0px);
    overflow-x: clip;
    overflow-y: auto;
    /* Room for the scrollbar whether the page is long enough to need it or not: a short page and a long one put
       their content in the same place, so moving between them nothing shifts sideways */
    scrollbar-gutter: stable;
    /* No scroll anchoring: when a filter shortens the page, the scroll clamps rather than jumping to the top, so
       the toolbar row stays docked */
    overflow-anchor: none;
    overscroll-behavior: contain;
    -webkit-overflow-scrolling: touch;
  }
  .view > :global(.page) {
    position: relative;
    z-index: 1;
  }
  /* ─── The dock (desktop): glass tiles, the current one raised; a label shows on hover ─── */
  .dock {
    position: fixed;
    top: 50%;
    left: var(--s-5);
    z-index: 7;
    display: flex;
    flex-direction: column;
    gap: 0.375rem;
    translate: 0 -50%;
    transition:
      translate var(--t-slow) var(--ease),
      opacity var(--t-slow) var(--ease);
  }
  .focus .dock {
    translate: -140% -50%;
    opacity: 0;
  }
  .dock-item {
    position: relative;
    z-index: 1;
    display: grid;
    place-items: center;
    width: 3rem;
    height: 3rem;
    border-radius: var(--r-md);
    border: 1px solid var(--border);
    background: color-mix(in srgb, var(--surface-1) 45%, transparent);
    backdrop-filter: blur(14px) saturate(1.4);
    -webkit-backdrop-filter: blur(14px) saturate(1.4);
    color: var(--fg-muted);
    transition:
      color var(--t-fast) var(--ease-in-out),
      border-color var(--t-fast) var(--ease-in-out),
      background-color var(--t-fast) var(--ease-in-out);
  }
  .dock-item:hover {
    color: var(--fg);
    border-color: var(--border-strong);
  }
  /* The current one, raised */
  .dock-item.on {
    color: var(--fg);
    border-color: color-mix(in srgb, var(--fg) 18%, transparent);
    background: color-mix(in srgb, var(--surface-3) 90%, transparent);
    box-shadow:
      inset 0 1px 0 rgb(255 255 255 / 0.12),
      0 14px 30px -14px rgb(0 0 0 / 0.9);
  }
  .dock-item.on :global(svg) {
    color: var(--red-hot);
    filter: drop-shadow(0 0 10px color-mix(in srgb, var(--red) 55%, transparent));
  }
  .dock-item:focus-visible {
    outline-offset: 3px;
  }
  .dock-badge {
    position: absolute;
    top: -0.45rem;
    right: -0.55rem;
    padding: 0.1rem 0.35rem;
    border-radius: var(--r-pill);
    background: var(--red);
    color: var(--on-red);
    font-size: 0.65rem;
    font-weight: 700;
    line-height: 1.3;
    box-shadow: 0 0 0 2px var(--bg);
  }
  .dock-label {
    position: absolute;
    left: calc(100% + var(--s-3));
    top: 50%;
    translate: 0 -50%;
    padding: 0.4rem 0.7rem;
    border-radius: var(--r-sm);
    border: 1px solid color-mix(in srgb, var(--fg) 12%, transparent);
    background: color-mix(in srgb, var(--surface-2) 92%, transparent);
    color: var(--fg);
    font-size: var(--text-2xs);
    font-weight: 700;
    letter-spacing: var(--tracking-label);
    text-transform: uppercase;
    white-space: nowrap;
    box-shadow: var(--shadow);
    opacity: 0;
    pointer-events: none;
    transition: opacity var(--t-fast) var(--ease-in-out);
  }
  .dock-item:hover .dock-label,
  .dock-item:focus-visible .dock-label {
    opacity: 1;
  }

  /* ─── The save note (toast): a small pill at the bottom centre, above the tabs on a phone. It rises from the
     bottom edge and drops back. Busy: a spinner; saved: a green tick; failed: red. ─── */
  .save-note {
    position: fixed;
    left: 50%;
    bottom: calc(var(--s-4) + env(safe-area-inset-bottom, 0px));
    /* On the body (onBody), above an open editor panel (80) so it shows while one's open; below menus (90) */
    z-index: 85;
    display: flex;
    align-items: center;
    gap: var(--s-2);
    max-width: min(24rem, calc(100vw - 2 * var(--gutter)));
    margin: 0;
    padding: var(--s-2) var(--s-4) var(--s-2) var(--s-3);
    border-radius: 999px;
    background: var(--surface-3);
    box-shadow: var(--shadow-pop);
    color: var(--fg);
    font-size: var(--text-sm);
    font-weight: 500;
    translate: -50% 0;
  }
  /* Room for its buttons: a slimmer pill edge on the right */
  .update-note {
    gap: var(--s-3);
    padding: var(--s-1) var(--s-1) var(--s-1) var(--s-4);
  }
  .update-note .btn {
    border-radius: 999px;
  }
  .note-icon {
    display: grid;
    flex-shrink: 0;
    place-items: center;
    color: var(--green);
  }
  .save-note.failed .note-icon {
    color: var(--red-hot);
  }
  .spinner {
    flex-shrink: 0;
    width: 14px;
    height: 14px;
    border: 2px solid color-mix(in srgb, var(--fg) 20%, transparent);
    border-top-color: var(--fg);
    border-radius: 50%;
    animation: spin 0.7s linear infinite;
  }
  /* Between a section's pages: everything under the header and its strip slides in from the way you went (transform
     only, so the glass behind cards still blurs) */
  .view.swap :global(.page > :not(.page-header, .page-toolbar, .tone)) {
    animation: swap-in 420ms cubic-bezier(0.16, 1, 0.3, 1);
  }
  @keyframes swap-in {
    from {
      transform: translateX(var(--swap, 32px));
    }
  }
  @keyframes spin {
    to {
      rotate: 360deg;
    }
  }
  @media (max-width: 900px) {
    .save-note {
      bottom: calc(var(--tab-h) + var(--s-3));
    }
  }

  /* ─── Chrome: the pinned band (notch, View-as banner), then the phone bar or the desktop corners ─── */
  .chrome {
    position: absolute;
    top: 0;
    left: 0;
    right: 0;
    z-index: 6;
    /* Only its bars take taps, not the room they leave: with a phone's bar hidden (#83), what sticks under it (Friday's
       table header) sits in that room and must still be tapped */
    pointer-events: none;
  }
  .chrome > * {
    pointer-events: auto;
  }
  .pinned {
    position: relative;
    z-index: 3;
  }
  .pinned:not(.bare) {
    padding-top: env(safe-area-inset-top, 0px);
  }
  .meat {
    color: var(--red-hot);
  }

  .viewing {
    display: flex;
    align-items: center;
    gap: var(--s-2);
    min-height: 2.75rem;
    padding: var(--s-1) var(--gutter);
    background: color-mix(in srgb, var(--caution) 16%, var(--bg));
    border-bottom: 1px solid var(--caution-border);
    color: var(--caution);
    font-size: var(--text-sm);
  }
  .viewing-text {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .viewing strong {
    color: var(--fg);
    font-weight: 600;
  }
  .viewing-back {
    background: color-mix(in srgb, var(--caution) 18%, transparent);
    color: var(--caution);
  }
  .viewing-back:hover {
    background: color-mix(in srgb, var(--caution) 24%, transparent);
  }

  /* ─── Strip of a section's pages: a row under the bar on phones, floating pills along the top on desktop ─── */
  .strip {
    position: relative;
    display: flex;
    align-items: stretch;
    gap: var(--s-1);
    height: var(--strip-h);
    padding: 0 calc(var(--gutter) - var(--s-2));
    overflow-x: auto;
    scroll-snap-type: x proximity;
    scrollbar-width: none;
  }
  .strip::-webkit-scrollbar {
    display: none;
  }
  .strip-link {
    position: relative;
    z-index: 1;
    display: inline-flex;
    align-items: center;
    flex-shrink: 0;
    padding: 0 var(--s-2);
    scroll-snap-align: start;
    color: var(--fg-muted);
    font-size: var(--text-sm);
    font-weight: 500;
    white-space: nowrap;
    transition: color var(--t-fast) var(--ease-in-out);
  }
  .strip-link:hover,
  .strip-link.on {
    color: var(--fg);
  }
  .strip-link:focus-visible {
    outline-offset: -2px;
  }
  /* The current page: a red underline the width of its label */
  .strip-link.on::after {
    content: "";
    position: absolute;
    left: var(--s-2);
    right: var(--s-2);
    bottom: 0;
    height: 2px;
    border-radius: 1px;
    background: var(--red-hot);
  }

  /* ─── The poster word: the page's section in huge outlined capitals behind its title ─── */
  .ghost-word {
    position: absolute;
    top: calc(var(--chrome-h, 0px) - 0.9rem);
    left: 50%;
    width: min(100%, calc(var(--page-max) + 8rem));
    translate: -50% 0;
    padding-left: 1.5rem;
    overflow: hidden;
    font-size: clamp(5.5rem, 17vw, 10rem);
    font-style: italic;
    line-height: 1;
    white-space: nowrap;
    color: transparent;
    -webkit-text-stroke: 1px color-mix(in srgb, var(--fg) 9%, transparent);
    pointer-events: none;
    user-select: none;
    z-index: 0;
  }

  /* ─── Desktop corner: the wordmark ─── */
  .corner {
    position: absolute;
    bottom: var(--s-5);
    z-index: 6;
    margin: 0;
    color: var(--fg-subtle);
    pointer-events: none;
  }
  .wordmark-corner {
    left: var(--s-5);
    display: grid;
    font-size: 1.05rem;
    font-style: italic;
    line-height: 0.95;
    color: var(--fg-muted);
  }

  /* ─── Bottom tabs (phones): frosted, content scrolls under them ─── */
  .tabs {
    display: none;
  }

  @media (min-width: 901px) {
    /* Over the page, not above it: the page's own header pins at the very top */
    .topbar {
      position: absolute;
      top: 0;
      left: 0;
      right: 0;
      display: flex;
      align-items: center;
      justify-content: space-between;
      height: 4.5rem;
      padding: 0 var(--s-5);
      pointer-events: none;
    }
    .topbar > :global(*) {
      pointer-events: auto;
    }
    .brand {
      display: inline-flex;
    }
    .brand img {
      filter: drop-shadow(0 2px 8px color-mix(in srgb, var(--red) 35%, transparent));
    }
    /* Room for the dock on narrower desktops, mirrored so the page stays centred */
    .shell:not(.focus) .view {
      padding-left: 6rem;
      padding-right: 6rem;
      /* Eases across as the settings list slides out beside it */
      transition: padding var(--t-slow) var(--ease);
    }
  }

  /* Phones have no settings list: hidden by the width itself, so while a shrinking window crosses over it never lands
     in the page's flow before the shell takes it away */
  @media (max-width: 900px) {
    .settings-nav {
      display: none;
    }
  }

  /* Every desktop: the settings list beside the dock, slimmer on a narrow window; the page moves over to make room */
  @media (min-width: 901px) {
    .shell {
      --settings-w: 11rem;
    }
    .settings-nav {
      position: fixed;
      top: 50%;
      translate: 0 -50%;
      left: calc(var(--s-5) + 3rem + var(--s-5));
      z-index: 6;
      display: flex;
      flex-direction: column;
      gap: 2px;
      width: var(--settings-w);
      max-height: calc(100dvh - 8rem);
      overflow-y: auto;
    }
    /* The dock's hover names would land on the list */
    .shell.in-settings .dock-label {
      display: none;
    }
    .shell.in-settings .view {
      padding-left: calc(var(--s-5) + 3rem + var(--s-5) + var(--settings-w) + var(--s-5));
      padding-right: var(--s-6);
    }
  }
  @media (min-width: 1100px) {
    .shell {
      --settings-w: 13rem;
    }
  }
  .settings-home {
    display: flex;
    margin: 0;
    align-items: center;
    gap: var(--s-2);
    margin-bottom: var(--s-2);
    padding: var(--s-2) var(--s-3);
    color: var(--fg);
    font-weight: 600;
  }
  .settings-section {
    margin: var(--s-3) 0 var(--s-1);
    padding: 0 var(--s-3);
    color: var(--fg-subtle);
    font-size: var(--text-2xs);
    font-weight: 700;
    letter-spacing: var(--tracking-label);
    text-transform: uppercase;
  }
  /* A page: a quiet row; the one you're on, a soft fill. No lines (fewer borders, more space). */
  .settings-link {
    display: flex;
    align-items: center;
    gap: var(--s-3);
    padding: var(--s-2) var(--s-3);
    border-radius: var(--r-md);
    color: var(--fg-muted);
    font-size: var(--text-sm);
    font-weight: 500;
    transition:
      color var(--t-fast) var(--ease-in-out),
      background-color var(--t-fast) var(--ease-in-out);
  }
  .settings-link:hover {
    color: var(--fg);
    background: color-mix(in srgb, var(--surface-2) 70%, transparent);
  }
  .settings-link.on {
    color: var(--fg);
    background: var(--surface-2);
  }
  .settings-link.on :global(svg) {
    color: var(--red-hot);
  }

  @media (max-width: 900px) {
    .dock,
    .corner {
      display: none;
    }
    .pinned:not(.bare) {
      background: var(--chrome-bg-solid);
      backdrop-filter: var(--blur);
      -webkit-backdrop-filter: var(--blur);
    }
    /* The slim bar: the page's name (or its section's pages) and its actions. Frosted, no line under it. */
    .phone-bar {
      display: flex;
      align-items: center;
      gap: var(--s-2);
      height: 2.5rem;
      padding: 0 var(--s-2) 0 var(--gutter);
      background: var(--chrome-bg-solid);
      backdrop-filter: var(--blur);
      -webkit-backdrop-filter: var(--blur);
      transition:
        translate var(--t) var(--ease),
        visibility 0s;
    }
    /* Scrolled down: up under the pinned band, out of sight (#83). Reduced motion: it just goes */
    .phone-bar.tucked {
      translate: 0 calc(-100% - var(--pinned-h, 0px));
      visibility: hidden;
      transition:
        translate var(--t) var(--ease),
        visibility 0s var(--t);
    }
    .phone-bar:has(.strip) {
      padding-left: 0;
    }
    .bar-back {
      display: grid;
      place-items: center;
      width: 2rem;
      height: 2.5rem;
      margin-left: calc(-1 * var(--s-2));
      margin-right: calc(-1 * var(--s-1));
      color: var(--red-hot);
    }
    /* Back, named for where you were: "‹ The board" */
    .bar-back.named {
      display: flex;
      align-items: center;
      gap: 0.1rem;
      flex-shrink: 0;
      width: auto;
      max-width: 45%;
      margin-right: var(--s-1);
      font-size: var(--text-sm);
      font-weight: 600;
    }
    .bar-back.named span {
      overflow: hidden;
      white-space: nowrap;
      text-overflow: ellipsis;
    }
    /* The page title's face, smaller: heavy italic capitals, so the bar reads as the page's title */
    .bar-title {
      flex: 1;
      min-width: 0;
      margin: 0;
      overflow: hidden;
      color: var(--fg);
      font-family: var(--font-display);
      font-size: 1.2rem;
      font-style: italic;
      font-weight: 400;
      letter-spacing: 0.005em;
      line-height: 1;
      text-transform: uppercase;
      white-space: nowrap;
      text-overflow: ellipsis;
    }
    .bar-filters {
      flex-shrink: 0;
    }
    .bar-filters :global(.filters) {
      flex-wrap: nowrap;
    }
    .bar-filters :global(.filter) {
      height: 1.75rem;
    }
    /* The bar's buttons (Filters, a page's actions), to the slimmer bar */
    .phone-bar :global(.btn.sm) {
      height: 2rem;
      padding: 0 var(--s-2);
    }
    .phone-bar :global(.btn.sm.icon) {
      width: 2rem;
      padding: 0;
    }
    /* Laid out but unseen, in a box of no size so it can't widen the page: it only tells the bar how wide the
       filters are */
    .measure {
      position: absolute;
      width: 0;
      height: 0;
      overflow: hidden;
      visibility: hidden;
    }
    .measure .bar-filters {
      width: max-content;
    }
    .phone-bar .strip {
      flex: 1;
      min-width: 0;
      height: 100%;
    }
    .filters-btn .count {
      min-width: 1ch;
      color: var(--red-hot);
      font-weight: 700;
    }
    .ghost-word {
      display: none;
    }
    .viewing-role {
      display: none;
    }
    .view.under-tabs {
      padding-bottom: var(--tab-h);
    }
    .tabs {
      position: absolute;
      left: 0;
      right: 0;
      bottom: 0;
      z-index: 5;
      display: grid;
      grid-auto-flow: column;
      grid-auto-columns: minmax(0, 1fr);
      height: var(--tab-h);
      padding: var(--s-1) var(--s-2) env(safe-area-inset-bottom, 0px);
      /* Solid: phones (Android especially) blur thinly or not at all, and the page read through the tabs */
      background: var(--bg);
      transform: translateY(0);
      transition:
        transform var(--t-slow) var(--ease),
        opacity var(--t-slow) var(--ease);
    }
    .focus .tabs {
      transform: translateY(100%);
      opacity: 0;
      pointer-events: none;
    }
    .tab {
      position: relative;
      z-index: 1;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      gap: 0.2rem;
      min-height: 2.75rem;
      color: var(--fg-muted);
      font-size: var(--text-2xs);
      font-weight: 600;
      transition: color var(--t-fast) var(--ease-in-out);
    }
    /* Pressed: a soft grey glow swells behind the tab and fades as you let go (a phone's press state). Only while
       the finger's down, so the tab you're on still has no fill */
    .tab::before {
      content: "";
      position: absolute;
      top: 50%;
      left: 50%;
      z-index: -1;
      width: 3.25rem;
      height: 3.25rem;
      translate: -50% -50%;
      border-radius: 50%;
      background: color-mix(in srgb, var(--fg) 12%, transparent);
      opacity: 0;
      scale: 0.6;
      transition:
        opacity 360ms var(--ease),
        scale 360ms var(--ease);
      pointer-events: none;
    }
    .tab:active::before {
      opacity: 1;
      scale: 1;
      transition-duration: 90ms;
    }
    .tab-icon {
      position: relative;
      display: inline-flex;
    }
    .tab.on {
      color: var(--fg);
    }
    .tab.on .tab-icon {
      color: var(--red-hot);
    }
    /* The current tab: its icon filled, red over a red tint (the icons are strokes, some open, so a solid fill would
       blot them out), and no pill behind it */
    .tab.on .tab-icon :global(path) {
      fill: currentColor;
      fill-opacity: 0.22;
    }
    .tab:focus-visible {
      outline-offset: -2px;
    }
    .tab-label {
      line-height: 1;
    }
    /* The same 22px as the icons beside it, so the row lines up */
    /* You: teal initials on the plain disc, so it reads as you; lit, the disc fills teal */
    .tab-avatar {
      width: 22px;
      height: 22px;
      font-size: 0.55rem;
      color: var(--tone-teal);
    }
    .tab.on .tab-avatar {
      background: var(--tone-teal);
      color: var(--bg);
    }
    .ghost-word {
      font-size: clamp(4.5rem, 22vw, 6rem);
    }
  }
</style>
