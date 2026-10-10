<script lang="ts">
  // Unpaid fees, the aged-receivables report (ADR 0007): every unpaid charge, added up per member and by how
  // long it's been owed. Marking a charge paid on a member's profile takes it off here. A tap on someone opens their
  // card over the page, as on Teammates: admins get the member sheet on its Dues tab.
  import Icon from "../app/shell/Icon.svelte";
  import PageHeader from "../lib/PageHeader.svelte";
  import MemberSheet from "../lib/MemberSheet.svelte";
  import PlayerCardZoom from "../lib/PlayerCardZoom.svelte";
  import { can } from "../access/actions";
  import { granted } from "../demo/session.svelte";
  import { PLAYERS, referenceFor } from "../demo/data";
  import { db } from "../demo/store.svelte";
  import { BUCKETS, BUCKET_HINT, aged } from "../lib/dues";
  import { londonToday, pounds } from "../lib/dates";

  const rows = $derived(
    aged(db.charges, londonToday()).map((r) => ({
      ...r,
      player: PLAYERS.find((p) => p.id === r.memberId) ?? { id: r.memberId, name: "Someone who's left" },
      reference: referenceFor(r.memberId),
    })),
  );
  const totals = $derived(BUCKETS.map((_, i) => rows.reduce((s, r) => s + r.amounts[i], 0)));
  const grand = $derived(totals.reduce((a, b) => a + b, 0));
  const max = $derived(Math.max(1, ...totals));
  const tone = ["", "amber", "red", "red"];

  const perms = $derived(granted());
  const admin = $derived(can(perms, "manage:Member"));
  // Whose card is open; someone who's left the club has no card, so their row doesn't open
  let open = $state<number | null>(null);
  const opened = $derived(db.members.find((m) => m.player.id === open));

  /** The report as a spreadsheet: one row per member, a column per bucket. */
  function exportCsv() {
    const cell = (v: string | number) => `"${String(v).replace(/"/g, '""')}"`;
    const money = (p: number) => (p / 100).toFixed(2);
    const lines = [
      ["Name", "Reference", ...BUCKETS.map((b, i) => `${b} (${BUCKET_HINT[i]})`), "Total"],
      ...rows.map((r) => [r.player.name, r.reference, ...r.amounts.map(money), money(r.total)]),
      ["Total", "", ...totals.map(money), money(grand)],
    ];
    const blob = new Blob([lines.map((l) => l.map(cell).join(",")).join("\r\n")], { type: "text/csv" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `unpaid-fees-${londonToday()}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  }
</script>

<!-- One list, the page's subject: it takes the height left and scrolls inside (.page.fit) -->
<div class="page fit">
  <PageHeader
    title="Unpaid fees"
    eyebrow="Aged receivables"
    subtitle="Who owes what, and for how long. Settle up before the gong."
  />

  <div class="total">
    <span class="eyebrow">Total out</span>
    <span class="display num amount">{pounds(grand)}</span>
  </div>

  <div class="buckets">
    {#each BUCKETS as b, i (b)}
      <div class="bucket">
        <span
          class="bar"
          style:height="{Math.max(6, (totals[i] / max) * 100)}%"
          class:amber={tone[i] === "amber"}
          class:red={tone[i] === "red"}
        ></span>
        <span class="display num value">{pounds(totals[i])}</span>
        <span class="eyebrow">{b}</span>
        <span class="hint">{BUCKET_HINT[i]}</span>
      </div>
    {/each}
  </div>

  <div class="list scroll-fill">
    {#each rows as r (r.memberId)}
      <button
        type="button"
        class="row"
        aria-haspopup="dialog"
        disabled={!db.members.some((m) => m.player.id === r.memberId)}
        onclick={() => (open = r.memberId)}
      >
        <span class="grow"><span class="title">{r.player.name}</span><span class="sub num">{r.reference}</span></span>
        <span class="badge {tone[r.oldest]}">{BUCKETS[r.oldest]}</span>
        <span class="num amt">{pounds(r.total)}</span>
        <Icon name="chevronRight" size={18} />
      </button>
    {:else}
      <p class="row hint">Nobody owes a penny. Honour is satisfied.</p>
    {/each}
  </div>

  {#if rows.length}
    <div class="actions">
      <button class="btn outline" onclick={exportCsv}>Export CSV</button>
    </div>
  {/if}
</div>

{#if opened && admin}
  {#key opened.player.id}
    <MemberSheet memberId={opened.player.id} tab="dues" onclose={() => (open = null)} />
  {/key}
{:else if opened}
  <PlayerCardZoom
    player={opened.player}
    showRating={can(perms, "read:Rating")}
    bio={opened.player.bio}
    onclose={() => (open = null)}
  />
{/if}

<style>
  .total {
    display: grid;
    gap: var(--s-1);
    padding: 0 var(--s-1);
  }
  .amount {
    font-size: 3rem;
    color: var(--fg);
  }
  .buckets {
    display: grid;
    grid-template-columns: repeat(4, minmax(0, 1fr));
    border-block: 1px solid var(--border);
  }
  .bucket {
    display: grid;
    grid-template-rows: 3.5rem auto auto auto;
    align-items: end;
    gap: var(--s-1);
    padding: var(--s-4) var(--s-3);
  }
  .bucket + .bucket {
    border-left: 1px solid var(--border);
  }
  .bar {
    display: block;
    width: 100%;
    max-width: 2.5rem;
    border-radius: 3px 3px 0 0;
    background: var(--fg-subtle);
    transition: height var(--t-slow) var(--ease);
  }
  .bar.amber {
    background: var(--caution);
  }
  .bar.red {
    background: var(--red);
  }
  .value {
    font-size: 1.3rem;
    color: var(--fg);
  }
  .amt {
    min-width: 3rem;
    text-align: right;
    color: var(--fg);
    font-weight: 600;
  }
  .actions {
    display: flex;
    gap: var(--s-2);
  }
  @media (max-width: 420px) {
    .bucket {
      padding-inline: var(--s-2);
    }
    .bucket .hint {
      display: none;
    }
  }
</style>
