<script lang="ts">
  // A card, opened: the editor every non-player card opens into (Settings → Training, Settings → Tournaments, a
  // tournament's own pages). The app's side drawer (lib/Drawer) in its editor placement: in the page's own column on
  // a desktop (ADR 0065), the phone's tall sheet (ADR 0065), with what it is, a close button, a body that scrolls on
  // its own and the footer's Save (lib/SaveBar). It's open while it's mounted: `close()` (or any way out, which asks
  // first if `edits` has unsaved changes) slides it away, then `onclose` says it's gone. Player cards flip instead
  // (PlayerCardZoom, MemberSheet).
  import type { Snippet } from "svelte";
  import type { IconName } from "../app/shell/icons";
  import Drawer from "./Drawer.svelte";
  import type { Edits } from "./dirty.svelte";

  let {
    eyebrow,
    title,
    tone,
    onclose,
    actions,
    footer,
    fill = false,
    edits,
    children,
  }: {
    eyebrow: string;
    title: string;
    /** Its card's icon: kept for the callers, not drawn (the drawer's header is the same everywhere). */
    icon?: IconName;
    tone?: string;
    onclose: () => void;
    /** Buttons in the header, left of the close button. */
    actions?: Snippet;
    /** The footer bar along the bottom, actions on the right (lib/SaveBar). */
    footer?: Snippet;
    /** The body lays itself out to the panel's height, with its own scrolling and foot (lib/Wizard). */
    fill?: boolean;
    /** Its form's unsaved changes: every way out asks first. */
    edits?: Edits;
    children: Snippet;
  } = $props();

  let shown = $state(true);
  let drawer = $state<Drawer | undefined>();

  /** Out, the way every drawer goes (asking first if there are unsaved changes). */
  export function close() {
    drawer?.close();
  }
</script>

<Drawer
  bind:this={drawer}
  bind:open={shown}
  page
  {title}
  sub={eyebrow}
  head={actions}
  {footer}
  {fill}
  {tone}
  {edits}
  {onclose}>{@render children()}</Drawer
>
