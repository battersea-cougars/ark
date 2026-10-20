<script lang="ts">
  // Email members what they owe (ADR 0007): who gets one, and what it says, before anything goes. Everyone who owes
  // (Unpaid fees → Manage), or one member (their card's Dues tab). Anyone reminded in the last week is held back, and
  // so is anyone with no email; the server checks both again. Opened in a drawer or a sheet by the page it's on.
  import Icon from "../app/shell/Icon.svelte";
  import { previewReminders, sendReminders, type ReminderPreview } from "../app/backend.svelte";
  import { BUCKETS } from "./dues";
  import { formatDayDate, pounds } from "./dates";

  let {
    memberId,
    onsent,
    onbank,
  }: {
    /** Just this member; otherwise everyone who owes. */
    memberId?: number;
    /** After a send: how many went. */
    onsent: (queued: number) => void;
    /** No bank details yet, and this person may fill them in. */
    onbank?: () => void;
  } = $props();

  let preview = $state<ReminderPreview | null>(null);
  let failed = $state("");
  let busy = $state(false);
  // Whose email is shown: the one asked for, or the first who owes
  let showing = $state<number | null>(null);
  let letter = $state<ReminderPreview["letter"]>(null);

  async function load(who?: number) {
    try {
      const p = await previewReminders(who);
      if (!preview || who === undefined) preview = p;
      letter = p.letter;
      showing = p.letter?.memberId ?? null;
      failed = "";
    } catch (e) {
      failed = e instanceof Error ? e.message : "Couldn't read who owes.";
    }
  }
  // svelte-ignore state_referenced_locally
  load(memberId);

  const people = $derived((preview?.people ?? []).filter((p) => memberId === undefined || p.memberId === memberId));
  const going = $derived(people.filter((p) => p.email && !p.held));
  const held = $derived(people.filter((p) => p.held).length);
  const noEmail = $derived(people.filter((p) => !p.email).length);
  const tone = ["", "amber", "red", "red"];
  const when = (at: string) => formatDayDate(at);

  async function send() {
    busy = true;
    const r = await sendReminders(going.map((p) => p.memberId));
    busy = false;
    if (r) onsent(r.queued);
  }
</script>

<div class="review">
  {#if failed}
    <p class="hint warn"><Icon name="alert" size={16} />{failed}</p>
  {:else if !preview}
    <p class="hint">Working out who owes…</p>
  {:else}
    {#if !preview.ready}
      <div class="needs">
        <p class="hint warn">
          <Icon name="alert" size={16} />The email says where to pay, so the club's bank details come first.
        </p>
        {#if onbank}<button class="btn sm" onclick={onbank}><Icon name="bank" size={16} />Add bank details</button>{/if}
      </div>
    {/if}

    <section>
      <h3 class="section-title">
        {going.length ? `${going.length} ${going.length === 1 ? "email" : "emails"} to go` : "Nobody to email"}
      </h3>
      <p class="hint small">
        {#if !people.length}Nobody owes a penny.{:else}
          {held ? `${held} had one this week, so not again yet. ` : ""}{noEmail
            ? `${noEmail} with no email address. `
            : ""}At most one a week each; the hourly reminders count too.
        {/if}
      </p>
      {#if people.length}
        <div class="people">
          {#each people as p (p.memberId)}
            <button
              type="button"
              class="person"
              class:off={!p.email || p.held}
              aria-pressed={showing === p.memberId}
              onclick={() => load(p.memberId)}
            >
              <span class="who">
                <span class="name">{p.name}</span>
                <span class="sub">
                  {#if !p.email}No email address{:else if p.held}Had one {when(p.lastAt!)}{:else if p.lastAt}Last
                    reminded {when(p.lastAt)}{:else}Not reminded yet{/if}
                </span>
              </span>
              <span class="badge {tone[p.stage]}">{BUCKETS[p.stage]}</span>
              <span class="num amt">{pounds(p.pence)}</span>
            </button>
          {/each}
        </div>
      {/if}
    </section>

    {#if letter}
      <section>
        <h3 class="section-title">What it says</h3>
        <div class="letter">
          <p class="subject">{letter.subject}</p>
          <pre>{letter.text}</pre>
        </div>
        <p class="hint small">Plain text, as above, with the same in the club's colours for apps that show it.</p>
      </section>
    {/if}
  {/if}

  <div class="send">
    <button class="btn primary" disabled={busy || !preview?.ready || !going.length} onclick={send}>
      <Icon name="mail" size={16} />{going.length === 1 && memberId !== undefined
        ? "Send it"
        : `Send ${going.length || ""} ${going.length === 1 ? "email" : "emails"}`.replace("  ", " ")}
    </button>
  </div>
</div>

<style>
  .review {
    display: grid;
    gap: var(--s-5);
  }
  section {
    display: grid;
    gap: var(--s-2);
  }
  .section-title {
    margin: 0;
  }
  .needs {
    display: grid;
    justify-items: start;
    gap: var(--s-2);
  }
  .people {
    display: grid;
  }
  .person {
    display: grid;
    grid-template-columns: minmax(0, 1fr) auto 4.5rem;
    align-items: center;
    gap: var(--s-3);
    min-height: 3.25rem;
    padding: var(--s-2) var(--s-3);
    border: 0;
    border-radius: var(--r-md);
    background: transparent;
    color: var(--fg-muted);
    font: inherit;
    text-align: left;
  }
  .person[aria-pressed="true"] {
    background: var(--surface-2);
  }
  .person.off .name,
  .person.off .amt {
    opacity: 0.55;
  }
  .who {
    display: grid;
    min-width: 0;
  }
  .name {
    overflow: hidden;
    color: var(--fg);
    font-weight: 500;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .sub {
    overflow: hidden;
    font-size: var(--text-xs);
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .amt {
    color: var(--fg);
    font-weight: 600;
    text-align: right;
  }
  .letter {
    padding: var(--s-4);
    border-radius: var(--r-md);
    background: var(--surface-2);
  }
  .subject {
    margin: 0 0 var(--s-3);
    color: var(--fg);
    font-weight: 600;
  }
  pre {
    margin: 0;
    overflow-x: auto;
    color: var(--fg-muted);
    font-family: ui-monospace, "SF Mono", Menlo, monospace;
    font-size: var(--text-xs);
    line-height: 1.6;
    white-space: pre;
  }
  .send {
    position: sticky;
    bottom: 0;
    display: flex;
    justify-content: flex-end;
    padding-top: var(--s-2);
  }
</style>
