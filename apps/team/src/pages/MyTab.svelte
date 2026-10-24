<script lang="ts">
  // Your dues (ADR 0007): what you owe, your plan (this quarter's, and next quarter's to choose), how to pay, and the
  // ledger: every charge and payment, with what you owed after each.
  import Ledger from "../lib/Ledger.svelte";
  import Icon from "../app/shell/Icon.svelte";
  import { PLAN_NAMES, referenceFor, type Plan } from "../demo/data";
  import { creditOf, owedBy, unpaidCharges } from "../demo/dues.svelte";
  import { impersonating, me } from "../demo/session.svelte";
  import { db } from "../demo/store.svelte";
  import { choosePlan } from "../app/backend.svelte";
  import { feeOn, nextQuarter, quarterMonths, quarterOf, quarterStart } from "../lib/dues";
  import { formatDayDate, londonToday, pounds } from "../lib/dates";

  const who = $derived(me());
  const unpaid = $derived(unpaidCharges(who.id));
  const owed = $derived(owedBy(who.id));
  // Paid in and not yet spent: it pays your next charge
  const credit = $derived(creditOf(who.id));
  // Viewing as someone else: look, don't change
  const locked = impersonating();

  // Your plan (ADR 0007): this quarter's is fixed; next quarter's is yours to choose until it starts. Today is checked
  // every minute, so a page left open moves on; the server checks it too, and says no to a quarter that's started.
  let today = $state(londonToday());
  $effect(() => {
    const t = setInterval(() => (today = londonToday()), 60_000);
    return () => clearInterval(t);
  });
  const thisQuarter = $derived(quarterOf(today));
  const next = $derived(nextQuarter(thisQuarter));
  const nextStarts = $derived(quarterStart(next));
  const myRow = $derived(db.members.find((m) => m.player.id === who.id));
  const rate = $derived(feeOn(db.fees, nextStarts));
  // What a night costs then, on the main training (the first that's running)
  const nightly = $derived.by(() => {
    const series = db.series.find((s) => s.active);
    return series ? feeOn(series.fees, nextStarts) : 0;
  });
  const planName = (p: Plan | undefined) => PLAN_NAMES[p ?? "Pay as you go"];
  const keeper = $derived(myRow?.plan === "Keeper");
  // Where to pay (ADR 0007)
  const bank = $derived(db.settings.bank);
</script>

<div class="page">
  <h1 class="sr-only">Dues</h1>
  <header class="total">
    <p class="eyebrow">{owed > 0 ? "You owe" : "All square"}</p>
    <p class="display amount num" class:zero={owed <= 0}>{pounds(owed)}</p>
    <p class="hint">
      {unpaid.length ? `${unpaid.length} not paid yet` : "Nothing owed"}{credit
        ? ` · ${pounds(credit)} in credit, for what's next`
        : ""}
    </p>
  </header>

  <div class="panel feature pad pay">
    <h2>Pay by bank transfer</h2>
    <!-- The club's account (Unpaid fees → Manage → Bank details, ADR 0007); never made up while it isn't there -->
    <dl class="num">
      <dt>Name</dt>
      <dd>{bank?.name ?? "—"}</dd>
      <dt>Sort code</dt>
      <dd>{bank?.sortCode ?? "—"}</dd>
      <dt>Account</dt>
      <dd>{bank?.account ?? "—"}</dd>
      <dt>Reference</dt>
      <dd class="ref">{referenceFor(who.id)}</dd>
    </dl>
    <p class="hint">
      {bank
        ? "Always use your reference, so your payment is matched to you."
        : "The club's bank details aren't in the app yet: ask the treasurer. Always use your reference."}
    </p>
  </div>

  <section class="plan">
    <h2 class="section-title">Your plan</h2>
    <div class="list">
      <div class="row">
        <span class="grow">
          <span class="title">This quarter · {quarterMonths(thisQuarter)}</span>
        </span>
        <!-- The plan at a glance: its icon and name, as next quarter's tiles show them -->
        <span class="badge plan-badge">
          <Icon name={myRow?.plan === "Subscription" ? "calendar" : keeper ? "net" : "skate"} size={14} />{planName(
            myRow?.plan,
          )}
        </span>
      </div>
      {#if keeper}
        <div class="row">
          <span class="grow">
            <span class="title">Keepers play free</span>
            <span class="sub">Training's on the house.</span>
          </span>
        </div>
      {:else}
        <div class="row next">
          <span class="grow">
            <span class="title">Next quarter · {quarterMonths(next)}</span>
            <span class="sub">Change it until {formatDayDate(`${nextStarts}T12:00:00Z`)}</span>
          </span>
          <div class="seg block tiles" role="group" aria-label="Next quarter's plan">
            {#each [["Pay as you go", false], ["Subscription", true]] as const as [plan, quarterly] (plan)}
              <button
                type="button"
                disabled={locked}
                aria-pressed={myRow?.planNext === plan}
                onclick={() => myRow?.planNext !== plan && choosePlan(next, quarterly)}
              >
                <Icon name={quarterly ? "calendar" : "skate"} size={22} />
                <span class="name">{quarterly ? "Quarterly" : "Pay as you go"}</span>
                <span class="sub"
                  >{quarterly
                    ? `${rate ? `${pounds(rate)} ` : ""}a quarter`
                    : `${nightly ? `${pounds(nightly)} ` : ""}a night`}</span
                >
              </button>
            {/each}
          </div>
        </div>
      {/if}
    </div>
  </section>

  <h2 class="section-title">Charges and payments</h2>
  <Ledger memberId={who.id} />
</div>

<style>
  /* Beside next quarter's tiles, its title takes a second line rather than "Next quarter · Jan–M…" */
  .next .title {
    white-space: normal;
  }
  .plan {
    display: grid;
    gap: var(--s-3);
  }
  .plan .section-title {
    margin: var(--s-4) 0 0;
  }
  .plan-badge {
    height: 1.75rem;
    color: var(--fg);
    font-size: var(--text-sm);
  }
  .row.next {
    flex-wrap: wrap;
  }
  .row.next .seg {
    flex: 1 1 24rem;
  }
  .total {
    display: grid;
    gap: var(--s-2);
    padding: var(--s-2) var(--s-1) 0;
  }
  .amount {
    font-size: clamp(3.5rem, 18vw, 5rem);
    color: var(--red-hot);
  }
  .amount.zero {
    color: var(--green);
  }
  .pay h2 {
    font-size: var(--text-md);
    font-weight: 600;
  }
  dl {
    display: grid;
    grid-template-columns: auto 1fr;
    gap: var(--s-2) var(--s-5);
    margin: var(--s-4) 0;
  }
  dt {
    color: var(--fg-muted);
  }
  dd {
    margin: 0;
    color: var(--fg);
  }
  .ref {
    font-weight: 700;
    letter-spacing: 0.04em;
  }
</style>
