<script lang="ts">
  // A member's dues as a ledger (ADR 0007), the way a bank statement reads: every charge and payment by date, newest
  // first, with what they owe after each. Its header stays in view as it scrolls, under whatever is pinned above it
  // (--below; on a page, the shell's top bar). Whoever records payments can take back a payment or a quarter charged
  // by hand, each with a second tap so a stray one can't.
  import { untrack } from "svelte";
  import Icon from "../app/shell/Icon.svelte";
  import { removeCharge, removePayment } from "../app/backend.svelte";
  import { ledgerOf } from "../app/ledger.svelte";
  import { db } from "../demo/store.svelte";
  import { reportUnexpected } from "../app/errors.early";
  import { labelFor } from "../demo/dues.svelte";
  import { formatDayDate, pounds } from "./dates";
  import { loadMore } from "./load-more";

  let { memberId, editable = false }: { memberId: number; editable?: boolean } = $props();

  // Read a page at a time, newest first (#177, app/ledger.svelte.ts): again when dues change, as far as it was read
  const book = $derived(ledgerOf(memberId));
  $effect(() => {
    void [db.dues, db.charges];
    untrack(() => book.show()).catch((e) => reportUnexpected(e, "Couldn't read the ledger"));
  });
  const lines = $derived(book.lines);
  const day = (d: string) => formatDayDate(`${d}T12:00:00Z`);
  /** Owed after it, or below nothing, credit. */
  const balance = (p: number) => (p < 0 ? `${pounds(-p)} credit` : pounds(p));

  // The line waiting for its second tap
  let arming = $state<string | null>(null);
  function takeBack(key: string, go: () => unknown) {
    if (arming !== key) return void (arming = key);
    arming = null;
    go();
  }
</script>

<div class="ledger">
  <table>
    <thead>
      <tr>
        <th class="date">Date</th>
        <th>What</th>
        <th class="r">Charged</th>
        <th class="r">Paid</th>
        <th class="r">Owes</th>
        {#if editable}<th class="act"><span class="sr-only">Take back</span></th>{/if}
      </tr>
    </thead>
    <tbody>
      {#each lines as l (`${l.kind}${l.kind === "charge" ? l.charge.id : l.payment.id}`)}
        {@const key = `${l.kind}${l.kind === "charge" ? l.charge.id : l.payment.id}`}
        {@const label = l.kind === "charge" ? labelFor(l.charge) : null}
        <tr class={l.kind}>
          <td class="date num">{day(l.on)}</td>
          <td class="what">
            <span class="title">
              {#if label}
                <span class="chip" style:--tone="var(--tone-{label.tone})"><Icon name={label.icon} size={14} /></span
                >{label.title}
              {:else}
                {@const p = l.kind === "payment" ? l.payment : null}
                {#if p?.via === "adjustment"}
                  <span class="chip" style:--tone="var(--tone-amber)"><Icon name="settings" size={14} /></span
                  >{p.reason ?? "Adjustment"}
                {:else}
                  <span class="chip paid"><Icon name="pound" size={14} /></span>Payment, {p?.via === "cash"
                    ? "cash"
                    : "transfer"}
                {/if}
              {/if}
            </span>
            <span class="on num">{day(l.on)}</span>
          </td>
          <td class="r num">{l.kind === "charge" ? pounds(l.pence) : ""}</td>
          <td class="r num in">{l.kind === "payment" ? pounds(l.pence) : ""}</td>
          <td class="r num bal" class:credit={l.balance < 0}>{balance(l.balance)}</td>
          {#if editable}
            <td class="act">
              {#if l.kind === "payment" || (l.charge.byHand && !l.charge.paidPence)}
                <button
                  class="btn sm ghost"
                  class:armed={arming === key}
                  aria-label={arming === key ? "Tap again to take it back" : "Take back"}
                  onclick={() =>
                    takeBack(key, () =>
                      l.kind === "payment" ? removePayment(l.payment.id) : removeCharge(l.charge.id),
                    )}
                  onblur={() => arming === key && (arming = null)}
                >
                  {#if arming === key}Sure?{:else}<Icon name="x" size={14} />{/if}
                </button>
              {/if}
            </td>
          {/if}
        </tr>
      {:else}
        <!-- Its first page on its way: a row's space, said once it's come -->
        <tr><td colspan={editable ? 6 : 5} class="none">{book.read ? "Nothing charged or paid yet." : "\u00a0"}</td></tr
        >
      {/each}
    </tbody>
  </table>
  {#if book.next}<div class="more" use:loadMore={() => book.more()}></div>{/if}
</div>

<style>
  .ledger {
    border-radius: var(--r-lg);
    background: var(--panel-bg);
  }
  table {
    width: 100%;
    border-collapse: separate;
    border-spacing: 0;
  }
  th,
  td {
    padding: var(--s-3);
    text-align: left;
    vertical-align: middle;
    white-space: nowrap;
  }
  .r {
    text-align: right;
  }
  /* The header stays in view, just under whatever is pinned above it */
  thead th {
    position: sticky;
    top: var(--below, var(--chrome-h, 0px));
    z-index: 1;
    padding-block: var(--s-2);
    background: var(--surface-2);
    color: var(--fg-muted);
    font-size: var(--text-2xs);
    font-weight: 600;
    letter-spacing: var(--tracking-label);
    text-transform: uppercase;
  }
  thead th:first-child {
    border-top-left-radius: var(--r-lg);
  }
  thead th:last-child {
    border-top-right-radius: var(--r-lg);
  }
  tbody td {
    border-top: 1px solid var(--border);
    color: var(--fg-body);
  }
  tbody tr:first-child td {
    border-top: 0;
  }
  .date {
    width: 1px;
    color: var(--fg-muted);
  }
  .what {
    width: 100%;
    white-space: normal;
  }
  .title {
    display: flex;
    align-items: center;
    gap: var(--s-2);
    color: var(--fg);
  }
  .chip {
    display: grid;
    place-items: center;
    flex: none;
    width: 1.75rem;
    height: 1.75rem;
    border-radius: var(--r-sm);
    background: color-mix(in srgb, var(--tone, var(--fg)) 16%, transparent);
    color: var(--tone, var(--fg-muted));
  }
  .chip.paid {
    color: var(--green-ink);
  }
  /* The date under what it was, on a phone, where there's no Date column */
  .on {
    display: none;
    color: var(--fg-muted);
    font-size: var(--text-xs);
  }
  .in {
    color: var(--green-ink);
  }
  .bal {
    color: var(--fg);
    font-weight: 600;
  }
  .bal.credit {
    color: var(--green-ink);
  }
  .act {
    width: 1px;
    padding-left: 0;
  }
  /* The same width armed or not, so the second tap lands where the first did */
  .act .btn {
    min-width: 4rem;
    justify-content: center;
  }
  .act .btn.armed {
    color: var(--red-hot);
  }
  .none {
    color: var(--fg-muted);
  }
  .more {
    height: 1px;
  }
  @media (max-width: 600px) {
    th,
    td {
      padding-inline: var(--s-2);
    }
    .date {
      display: none;
    }
    .on {
      display: block;
      margin: 2px 0 0 calc(1.75rem + var(--s-2));
    }
  }
</style>
