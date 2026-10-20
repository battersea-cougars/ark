<script lang="ts">
  import { goesBy, shortName } from "../../lib/names";
  /**
   * Who's signed in, top right (the Gwenda ops account badge). Opens your account: profile, your tab, your everyday
   * role and back, and sign out; while you view as a member, the way back (View as itself is in Settings → Security,
   * ADR 0024). Escape or a click
   * outside closes it. No drop-down: on a desktop it's a side drawer from the right, on a phone a sheet from the
   * bottom, both moved to the end of the page so they sit
   * above the tabs wherever the badge is placed. `card` draws the trigger as a big row with your email and roles,
   * for the top of More.
   */
  import { tick } from "svelte";
  import { fade, fly } from "svelte/transition";
  import { easeOut, fadeMs, prefersReducedMotion, switchView } from "../motion";
  import { phone } from "../../lib/viewport.svelte";
  import { emailFor } from "../../demo/data";
  import {
    elevated,
    everydayName,
    fullRole,
    hasEveryday,
    impersonating,
    me,
    realMember,
    setElevated,
    shownRoles,
    viewAs,
  } from "../../demo/session.svelte";
  import { stayIfAllowed } from "../routes.svelte";
  import { initials } from "../../lib/initials";
  import { api } from "../api";
  import { navigate } from "../router.svelte";
  import Icon from "./Icon.svelte";

  let open = $state(false);
  let root = $state<HTMLDivElement | undefined>();
  let trigger = $state<HTMLButtonElement | undefined>();
  let menu = $state<HTMLDivElement | undefined>();
  let layer = $state<HTMLDivElement | undefined>();

  let { card = false }: { card?: boolean } = $props();

  // The sheet (phone) and the drawer (desktop) leave the page for <body>: inside it they'd sit under the tabs or bars
  // In and out like every other drawer (lib/Drawer.svelte): from the right on a desktop, up from the bottom on a phone
  const slide = (node: Element) =>
    fly(node, {
      ...(phone.current ? { y: node.clientHeight || 480 } : { x: node.clientWidth || 420 }),
      duration: prefersReducedMotion ? 0 : 320,
      easing: easeOut,
      opacity: 1,
    });
  function portal(node: HTMLElement) {
    document.body.append(node);
    return { destroy: () => node.remove() };
  }

  const shown = $derived(me());
  const roles = $derived(shownRoles(shown.id));

  // Your full role and your everyday one (ADR 0024). Back to everyday on a page it can't see: Home.
  function toggleMode() {
    const up = !elevated();
    switchView(() => {
      setElevated(up);
      if (!up) stayIfAllowed();
    });
  }

  async function toggle() {
    open = !open;
    if (open) {
      await tick();
      menu?.querySelector<HTMLElement>("[role=menuitem]")?.focus();
    }
  }
  function close(focusTrigger = false) {
    open = false;
    if (focusTrigger) trigger?.focus();
  }
  function go(path: string) {
    close();
    navigate(path);
  }
  function become(id: number | null) {
    viewAs(id);
    close();
    stayIfAllowed();
  }
  // Off this device only; the app reloads to the sign-in screen
  async function signOut() {
    close();
    await api("POST", "/api/auth/sign-out").catch(() => {});
    location.replace("/");
  }
</script>

<svelte:window
  onpointerdown={(e) =>
    open && root && !root.contains(e.target as Node) && !layer?.contains(e.target as Node) && close()}
  onkeydown={(e) => open && e.key === "Escape" && (e.preventDefault(), close(true))}
/>

<div class="account" class:wide={card} bind:this={root}>
  <button
    type="button"
    class="trigger"
    class:card
    class:as={impersonating()}
    bind:this={trigger}
    aria-haspopup="menu"
    aria-expanded={open}
    aria-label="Account: {goesBy(shown)}"
    onclick={toggle}
  >
    {#if card}
      <span class="avatar big" aria-hidden="true">{initials(goesBy(shown))}</span>
      <span class="card-text">
        <span class="card-name">{goesBy(shown)}</span>
        <span class="hint">{emailFor(shown)} · {roles.join(", ")}</span>
      </span>
      <Icon name="chevronRight" size={18} />
    {:else}
      <span class="avatar sm" aria-hidden="true">{initials(goesBy(shown))}</span>
      <span class="name">{shortName(shown)}</span>
    {/if}
  </button>

  {#if open}
    <div class="layer" bind:this={layer} use:portal>
      <!-- A tap outside the drawer closes it -->
      <div class="scrim" aria-hidden="true" onclick={() => close(true)} transition:fade={{ duration: fadeMs }}></div>
      <div class="menu" role="menu" aria-label="Account" bind:this={menu} transition:slide>
        <button class="btn ghost icon close-x menu-close" aria-label="Close" onclick={() => close(true)}>
          <Icon name="x" size={18} />
        </button>
        <div class="who">
          <span class="avatar big" aria-hidden="true">{initials(goesBy(shown))}</span>
          <span class="who-text">
            <span class="title">{goesBy(shown)}</span>
            <span class="hint">{emailFor(shown)}</span>
            <span class="roles"
              >{#each roles as r (r)}<span class="badge" class:red={r === "Admin"}>{r}</span>{/each}</span
            >
          </span>
        </div>
        <div class="sep" role="separator"></div>
        <button class="item" role="menuitem" onclick={() => go("/me")}><Icon name="user" size={16} /> Profile</button>
        <button class="item" role="menuitem" onclick={() => go("/me/tab")}><Icon name="pound" size={16} /> Dues</button>
        {#if hasEveryday()}
          <div class="sep" role="separator"></div>
          <button class="item" role="menuitem" onclick={() => (toggleMode(), close())}>
            <Icon name="key" size={16} />
            {elevated() ? `Back to ${everydayName()}` : `Switch to ${fullRole()}`}
          </button>
        {/if}
        {#if impersonating()}
          <div class="sep" role="separator"></div>
          <button class="item accent" role="menuitem" onclick={() => become(null)}>
            <Icon name="undo" size={16} /> Back to {shortName(realMember())}
          </button>
        {/if}
        <div class="sep" role="separator"></div>
        <button class="item" role="menuitem" disabled={impersonating()} onclick={signOut}
          ><Icon name="signOut" size={16} /> Sign out</button
        >
      </div>
    </div>
  {/if}
</div>

<style>
  .account {
    position: relative;
    display: flex;
    align-items: center;
    gap: var(--s-2);
    flex-shrink: 0;
  }
  /* The switch to your full role: the badge's glass tile, lit red while you're in it */
  /* The same glass tile as the dock, so the two pieces of chrome match */
  .trigger {
    display: inline-flex;
    align-items: center;
    gap: var(--s-2);
    height: 2.25rem;
    padding: 0 var(--s-2) 0 0.2rem;
    border: 1px solid var(--border);
    border-radius: var(--r-md);
    background: color-mix(in srgb, var(--surface-1) 45%, transparent);
    backdrop-filter: blur(14px) saturate(1.4);
    -webkit-backdrop-filter: blur(14px) saturate(1.4);
    color: var(--fg-muted);
    transition:
      border-color var(--t-fast) var(--ease-in-out),
      background-color var(--t-fast) var(--ease-in-out),
      color var(--t-fast) var(--ease-in-out);
  }
  .trigger:hover,
  .trigger[aria-expanded="true"] {
    border-color: var(--border-strong);
    background: color-mix(in srgb, var(--surface-3) 90%, transparent);
    color: var(--fg);
  }
  /* The big row at the top of More */
  .trigger.card {
    gap: var(--s-4);
    width: 100%;
    height: auto;
    padding: var(--s-2) var(--s-1);
    border: 0;
    border-radius: var(--r-md);
    background: none;
    text-align: left;
  }
  .trigger.card:hover,
  .trigger.card[aria-expanded="true"] {
    background: none;
  }
  .card-text {
    display: grid;
    flex: 1;
    min-width: 0;
  }
  .card-name {
    color: var(--fg);
    font-size: var(--text-lg);
    font-weight: 600;
  }
  .account.wide {
    width: 100%;
  }
  .layer {
    display: contents;
  }
  .trigger.as {
    border-color: transparent;
    background: var(--caution-wash);
    color: var(--caution);
  }
  .name {
    color: var(--fg);
    font-size: var(--text-sm);
    font-weight: 500;
  }
  .avatar.sm {
    width: 1.75rem;
    height: 1.75rem;
    font-size: 0.65rem;
  }
  .trigger .avatar.sm {
    background: var(--red-wash-strong);
    color: var(--fg);
  }
  .trigger.as .avatar {
    background: var(--caution-wash);
    color: var(--caution);
  }
  /* In the menu's own header, a size down from a page's */
  .menu .avatar.big {
    width: 2.75rem;
    height: 2.75rem;
    font-size: 1.1rem;
  }
  /* A side drawer from the right on a desktop, over a dimmed page */
  .menu {
    position: fixed;
    z-index: 60;
    top: 0;
    right: 0;
    bottom: 0;
    display: grid;
    align-content: start;
    gap: var(--s-1);
    width: min(24rem, 100vw);
    overflow-y: auto;
    padding: max(var(--s-4), env(safe-area-inset-top)) var(--s-3) var(--s-4);
    border-left: 1px solid var(--border-strong);
    background: var(--surface-1);
    box-shadow: var(--shadow-pop);
  }
  .who {
    display: flex;
    align-items: center;
    gap: var(--s-3);
    padding: var(--s-2);
    /* Clear of the close button */
    padding-right: 2.75rem;
  }
  .menu-close {
    position: absolute;
    top: max(var(--s-3), env(safe-area-inset-top));
    right: var(--s-3);
    z-index: 1;
  }
  .who-text {
    display: grid;
    gap: 0.15rem;
    min-width: 0;
  }
  .title {
    color: var(--fg);
    font-weight: 600;
  }
  .roles {
    display: flex;
    flex-wrap: wrap;
    gap: var(--s-1);
    margin-top: var(--s-1);
  }
  .sep {
    height: 1px;
    margin: var(--s-1) calc(-1 * var(--s-2));
    background: var(--border);
  }
  .item {
    display: flex;
    align-items: center;
    gap: var(--s-3);
    width: 100%;
    min-height: 2.5rem;
    padding: 0 var(--s-2);
    border: 0;
    border-radius: var(--r-md);
    background: none;
    color: var(--fg-body);
    font-size: var(--text-sm);
    font-weight: 500;
    text-align: left;
    transition:
      background-color var(--t-fast) var(--ease-in-out),
      color var(--t-fast) var(--ease-in-out);
  }
  .item:hover:not(:disabled),
  .item:focus-visible {
    background: color-mix(in srgb, var(--fg) 7%, transparent);
    color: var(--fg);
  }
  .item:disabled {
    color: var(--fg-subtle);
    cursor: not-allowed;
  }
  .item.accent {
    color: var(--caution);
  }

  .scrim {
    position: fixed;
    inset: 0;
    z-index: 59;
    background: color-mix(in srgb, var(--bg) 40%, transparent);
  }

  /* Phones: the menu is a sheet from the bottom, above the tabs */
  @media (max-width: 900px) {
    .scrim {
      display: block;
      position: fixed;
      inset: 0;
      z-index: 59;
      background: color-mix(in srgb, var(--bg) 55%, transparent);
    }
    .menu {
      position: fixed;
      top: auto;
      left: 0;
      right: 0;
      bottom: 0;
      width: auto;
      padding: var(--s-3) var(--s-3) max(var(--s-4), env(safe-area-inset-bottom));
      border-bottom: 0;
      border-radius: var(--r-xl) var(--r-xl) 0 0;
    }
    .item {
      min-height: 3rem;
      font-size: var(--text-base);
    }
  }
</style>
