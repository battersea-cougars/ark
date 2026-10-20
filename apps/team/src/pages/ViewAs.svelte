<script lang="ts">
  // View as a member (ADR 0024): the app exactly as they see it, read-only. In Settings → Security, where an admin
  // looks for it; the bar across the top while you're viewing brings you back.
  import { matchesName, goesBy } from "../lib/names";
  import { db } from "../demo/store.svelte";
  import { realMember, viewAs } from "../demo/session.svelte";
  import { navigate } from "../app/router.svelte";
  import PageHeader from "../lib/PageHeader.svelte";
  import Person from "../lib/Person.svelte";
  import SearchField from "../lib/SearchField.svelte";
  import { phone } from "../lib/viewport.svelte";

  let query = $state("");
  const members = $derived(
    db.members
      .filter((m) => m.status === "active" && m.player.id !== realMember().id)
      .filter((m) => matchesName(m.player, query))
      .sort((a, b) => goesBy(a.player).localeCompare(goesBy(b.player))),
  );
  function become(id: number) {
    viewAs(id);
    navigate("/");
  }
</script>

<div class="page">
  <PageHeader title="View as a member" subtitle="The app as they see it. Read-only: you can't change anything as them.">
    {#snippet toolbar()}
      <SearchField bind:value={query} placeholder="Search members" collapsible={!phone.current} />
    {/snippet}
  </PageHeader>
  {#if phone.current}<p class="note">The app as they see it. Read-only: you can't change anything as them.</p>{/if}
  {#if members.length}
    <div class="list">
      {#each members as m (m.player.id)}
        <button type="button" class="row" onclick={() => become(m.player.id)}>
          <Person player={m.player} meta={m.roles.join(", ")} />
        </button>
      {/each}
    </div>
  {:else}
    <p class="note">No one matches.</p>
  {/if}
</div>
