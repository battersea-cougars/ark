<script lang="ts">
  // A card, opened: the editor every non-player card opens into, the side drawer (lib/Drawer) placed in the page's column
  // on a desktop and a tall sheet on a phone (ADR 0065), with a scrolling body and the footer's Save. Open while mounted:
  // `close()` slides it away (asking first over unsaved `edits`), then `onclose` says it's gone.
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
