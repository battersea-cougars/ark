<script lang="ts">
  import PageHeader from "../lib/PageHeader.svelte";
  import Drawer from "../lib/Drawer.svelte";
  import DateField from "../lib/DateField.svelte";
  import Icon from "../app/shell/Icon.svelte";
  import { db } from "../demo/store.svelte";
  import { setSubscriptionFee } from "../app/backend.svelte";
  import { formatDayDate, londonToday, pounds } from "../lib/dates";
  import { feeOn } from "../lib/dues";

  // The quarterly rate (ADR 0007). Session fees are set on each training, tournament fees on each tournament.
  // A new rate is set in a side drawer, as every quick form is: the page stays where it is
  let adding = $state(false);
  let amount = $state("");
  let from = $state(londonToday());

  async function add(e: SubmitEvent) {
    e.preventDefault();
    const pence = Math.round(Number(amount) * 100);
    if (!Number.isFinite(pence) || pence < 0 || !from) return;
    if (await setSubscriptionFee(pence, from)) {
      amount = "";
      adding = false;
    }
  }
  const today = londonToday();
  const now = $derived(feeOn(db.fees, today));
  // Newest first; the one in force today is marked, later ones are still to come
  const history = $derived([...db.fees].reverse());
  const inForce = $derived(db.fees.filter((f) => f.from <= today).at(-1)?.from);
  const day = (d: string) => formatDayDate(`${d}T12:00:00Z`);
</script>

<!-- One list, the page's subject: it takes the height left and scrolls inside (.page.fit) -->
<div class="page fit">
  <PageHeader title="Quarterly rate">
    {#snippet sub()}
      What Quarterly Members pay each quarter. A new rate applies from its date; charges already made keep theirs.
      Session fees are set on each <a href="/settings/training">training</a>, tournament fees on each
      <a href="/settings/tournaments">tournament</a>.
    {/snippet}
    {#snippet actions()}
      <button class="btn sm primary" aria-haspopup="dialog" onclick={() => (adding = true)}>
        <Icon name="plus" size={16} />Rate
      </button>
    {/snippet}
  </PageHeader>

  <!-- Empty, the strip and the list would be bare hairlines -->
  {#if db.fees.length}
    <div class="stats">
      <div class="stat">
        <span class="eyebrow">A quarter, now</span>
        <span class="value num">{now ? pounds(now) : "None"}</span>
        {#if inForce}<span class="hint">from {day(inForce)}</span>{/if}
      </div>
    </div>

    <h2 class="section-title">History</h2>
    <div class="list scroll-fill">
      <div class="table-head"><span>Rate</span><span>From</span><span></span></div>
      {#each history as f (f.from)}
        <div class="table-row" class:old={inForce !== undefined && f.from < inForce}>
          <span class="rate num">{pounds(f.pence)} a quarter</span>
          <span class="num">{day(f.from)}</span>
          <span
            >{#if f.from > today}<span class="badge">To come</span>{:else if f.from === inForce}<span
                class="badge green">Now</span
              >{/if}</span
          >
        </div>
      {/each}
    </div>
  {:else}
    <p class="hint">No rate set yet, so Quarterly Members aren't charged.</p>
  {/if}

  <Drawer bind:open={adding} title="New quarterly rate">
    <form class="form" onsubmit={add}>
      <div class="two">
        <label class="field">
          Amount (£)
          <input class="input num" inputmode="decimal" placeholder="e.g. 60" required bind:value={amount} />
        </label>
        <div class="field">From <DateField id="fee-from" aria-label="From" required bind:value={from} /></div>
      </div>
      <p class="hint">
        Quarterly Members are charged this for each quarter from that date, on the quarter's first day (or the day they
        join).
      </p>
      <button class="btn primary">Set rate</button>
    </form>
  </Drawer>
</div>

<style>
  /* The rate, from when, and whether it's the one now */
  .list {
    --cols: minmax(0, 1fr) minmax(0, 1fr) 5rem;
  }
  .table-row + .table-row {
    border-top: 1px solid var(--border);
  }
  .rate {
    color: var(--fg);
    font-weight: 500;
  }
  .old > :not(:last-child) {
    opacity: 0.55;
  }
</style>
