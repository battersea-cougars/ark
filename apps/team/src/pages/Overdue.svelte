<script lang="ts">
  // Unpaid fees, the aged-receivables report (ADR 0007): every unpaid charge, added up per member and by how
  // long it's been owed. Marking a charge paid on a member's profile takes it off here. A tap on someone opens their
  // card over the page, as on Teammates: admins get the member sheet on its Dues tab. Send reminders is the page's one
  // main button, for whoever records payments: it opens the preview (who gets one, who's held), then sends. Nothing
  // sends them on its own (ADR 0007; a configurable schedule is #143). Manage (ADR 0065) keeps the bank details.
  import Icon from "../app/shell/Icon.svelte";
  import PageHeader from "../lib/PageHeader.svelte";
  import { csvCell } from "../lib/csv";
  import MemberSheet from "../lib/MemberSheet.svelte";
  import PlayerCardZoom from "../lib/PlayerCardZoom.svelte";
  import { can } from "../access/actions";
  import { granted } from "../demo/session.svelte";
  import { PLAYERS, referenceFor } from "../demo/data";
  import { db } from "../demo/store.svelte";
  import { BUCKETS, agedOf } from "../lib/dues";
  import { londonToday, pounds } from "../lib/dates";
  import { listScroll } from "../lib/list-scroll";
  import SearchField from "../lib/SearchField.svelte";
  import { flip } from "svelte/animate";
  import { cardMoveMs, easeOut, sift } from "../app/motion";
  import ManageMenu from "../lib/ManageMenu.svelte";
  import type { ManageItem } from "../lib/ManageList.svelte";
  import Drawer from "../lib/Drawer.svelte";
  import BankSheet from "../lib/BankSheet.svelte";
  import RemindReview from "../lib/RemindReview.svelte";

  const rows = $derived(
    agedOf(db.dues).map((r) => ({
      ...r,
      player: PLAYERS.find((p) => p.id === r.memberId) ?? { id: r.memberId, name: "Someone who's left" },
      reference: referenceFor(r.memberId),
    })),
  );
  const totals = $derived(BUCKETS.map((_, i) => rows.reduce((s, r) => s + r.amounts[i], 0)));
  const grand = $derived(totals.reduce((a, b) => a + b, 0));
  const max = $derived(Math.max(1, ...totals));
  const tone = ["", "amber", "red", "red"];
  // The search finds someone by name or payment reference; the totals above stay the whole club's
  let query = $state("");
  const shown = $derived.by(() => {
    const words = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
    return rows.filter((r) => {
      const text = `${r.player.name} ${r.reference}`.toLowerCase();
      return words.every((w) => text.includes(w));
    });
  });

  const perms = $derived(granted());
  const admin = $derived(can(perms, "manage:Member"));
  // Whoever records payments sends reminders (the main button); whoever sets fees keeps the bank details (Manage)
  const reminds = $derived(can(perms, "record:Payment"));
  const setsFees = $derived(can(perms, "manage:Fees"));
  let manageOpen = $state(false);
  let reminding = $state(false);
  let banking = $state(false);
  // A tool opens its own drawer or sheet: the menu gets out of the way first
  const manageItems: ManageItem[] = $derived([
    {
      icon: "bank",
      label: "Bank details",
      sub: db.settings.bank
        ? `${db.settings.bank.sortCode} · ${db.settings.bank.account}`
        : "Not filled in yet: reminders need them.",
      run: () => (banking = true),
    },
  ]);
  // Whose card is open; someone who's left the club has no card, so their row doesn't open
  let open = $state<number | null>(null);
  const opened = $derived(db.members.find((m) => m.player.id === open));

  /** The report as a spreadsheet: one row per member, a column per bucket. */
  function exportCsv() {
    const money = (p: number) => (p / 100).toFixed(2);
    const lines = [
      ["Name", "Reference", ...BUCKETS, "Total"],
      ...rows.map((r) => [r.player.name, r.reference, ...r.amounts.map(money), money(r.total)]),
      ["Total", "", ...totals.map(money), money(grand)],
    ];
    const blob = new Blob([lines.map((l) => l.map(csvCell).join(",")).join("\r\n")], { type: "text/csv" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `unpaid-fees-${londonToday()}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  }
</script>

<div class="page">
  <PageHeader
    title="Unpaid fees"
    eyebrow="Aged receivables"
    subtitle="Who owes what, and for how long. Settle up before the gong."
  >
    {#snippet actions()}
      {#if rows.length}
        <button class="btn sm outline" onclick={exportCsv}><Icon name="download" size={16} />Export CSV</button>
      {/if}
      {#if reminds}
        <!-- The page's one main button: greyed while nobody owes, so nothing moves when someone does -->
        <button class="btn sm primary" aria-haspopup="dialog" disabled={!rows.length} onclick={() => (reminding = true)}
          ><Icon name="mail" size={16} />Send reminders</button
        >
      {/if}
      {#if setsFees}
        <button
          class="btn sm ghost icon"
          aria-haspopup="dialog"
          aria-label="Manage unpaid fees"
          title="Manage"
          onclick={() => (manageOpen = true)}><Icon name="settings" size={18} /></button
        >
      {/if}
    {/snippet}
  </PageHeader>

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
      </div>
    {/each}
  </div>

  <!-- The page scrolls until the table's header reaches the top, then on through the rows, the box under it
       showing them pass (lib/list-scroll.ts), as on Friday's Who's coming -->
  <div class="hybrid" use:listScroll>
    <div class="stuck">
      <div class="table-head list-tabs">
        <span>Member</span>
        <span class="col-ref">Reference</span>
        <span>Owed for</span>
        <span class="amt">Total</span>
        <!-- Find someone: a magnifier at the end of the row that widens into the field when you tap it -->
        {#if rows.length}
          <div class="finder">
            <SearchField bind:value={query} placeholder="Search members" label="Search members" collapsible />
          </div>
        {/if}
      </div>
      <div class="list-box">
        <!-- A search sifts rows; the rest glide to their places (as on Friday) -->
        <div class="list">
          {#each shown as r (r.memberId)}
            <div class="slot" animate:flip={{ duration: cardMoveMs, easing: easeOut }} in:sift out:sift={{ out: true }}>
              <button
                type="button"
                class="table-row"
                aria-haspopup="dialog"
                disabled={!db.members.some((m) => m.player.id === r.memberId)}
                onclick={() => (open = r.memberId)}
              >
                <span class="name">{r.player.name}</span>
                <span class="col-ref num">{r.reference}</span>
                <span><span class="badge {tone[r.oldest]}">{BUCKETS[r.oldest]}</span></span>
                <span class="num amt">{pounds(r.total)}</span>
                <Icon name="chevronRight" size={18} />
              </button>
            </div>
          {:else}
            <p class="hint none">
              {rows.length ? `Nobody matches “${query.trim()}”.` : "Nobody owes a penny. Honour is satisfied."}
            </p>
          {/each}
        </div>
      </div>
    </div>
    <div class="list-spacer"></div>
  </div>
</div>

<ManageMenu bind:open={manageOpen} title="Manage unpaid fees" items={manageItems} />

<!-- A list that grows with the club: a side drawer (full screen on a phone) -->
<Drawer bind:open={reminding} wide title="Send reminders" sub="Who gets one, and what it says, before anything goes">
  {#if reminding}
    <RemindReview
      onsent={() => (reminding = false)}
      onbank={setsFees ? () => ((reminding = false), (banking = true)) : undefined}
    />
  {/if}
</Drawer>
<BankSheet bind:open={banking} />

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
  /* Manage's tools, as on Members and Training */
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
    grid-template-rows: 3.5rem auto auto;
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
  /* Who, their payment reference, how long the oldest has been owed, the total, and the chevron's room */
  .hybrid {
    --cols: minmax(0, 1fr) 9rem 7rem 5rem 18px;
  }
  .table-head > .amt {
    color: inherit;
    font-weight: inherit;
  }
  .name {
    overflow: hidden;
    color: var(--fg);
    font-weight: 500;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .col-ref {
    color: var(--fg-muted);
    font-size: var(--text-xs);
  }
  .none {
    margin: 0;
    padding: var(--s-4);
  }
  /* A phone: the reference goes (it's on their card) */
  @media (max-width: 900px) {
    .hybrid {
      --cols: minmax(0, 1fr) auto 4.5rem 18px;
    }
    .table-head,
    .table-row {
      gap: var(--s-3);
    }
    .col-ref {
      display: none;
    }
  }
  @media (max-width: 420px) {
    .bucket {
      padding-inline: var(--s-2);
    }
    /* Beside "Over 90 days", a name takes two lines rather than "Va…" */
    .name {
      display: -webkit-box;
      -webkit-box-orient: vertical;
      -webkit-line-clamp: 2;
      line-clamp: 2;
      white-space: normal;
    }
  }
</style>
