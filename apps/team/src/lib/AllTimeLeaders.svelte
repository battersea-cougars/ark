<script lang="ts">
  // Every played edition's leaders in a series (#47), as the Worker counts them (#175, app/history.svelte.ts): no
  // game of them needs to be in the app. Read again when the club's tournaments change (unchanged, a 304).
  import Leaderboard from "./Leaderboard.svelte";
  import type { LeaderRow } from "./leaders";
  import { allTimeLeaders } from "../app/history.svelte";
  import { db } from "../demo/store.svelte";

  let { typeId }: { typeId: number } = $props();

  let rows = $state<LeaderRow[]>([]);
  $effect(() => {
    void db.tournaments;
    allTimeLeaders(typeId).then(
      (r) => (rows = r),
      () => {},
    );
  });
</script>

<Leaderboard counted={rows} label="All-time leaders" />
