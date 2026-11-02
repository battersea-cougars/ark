<script lang="ts">
  // A page's Manage menu (ADR 0065), the one way every page opens one: its jobs (lib/ManageList) over the page, a short
  // sheet on a phone, a side drawer on a desktop. Choosing one closes the menu, then runs it.
  import Drawer from "./Drawer.svelte";
  import ManageList, { type ManageItem } from "./ManageList.svelte";

  let {
    open = $bindable(false),
    title,
    sub,
    items,
  }: {
    open?: boolean;
    title: string;
    /** Under the title on a desktop. */ sub?: string;
    items: ManageItem[];
  } = $props();

  function go(run: () => void) {
    open = false;
    run();
  }
</script>

<Drawer bind:open short {title} {sub}><ManageList {items} {go} /></Drawer>
