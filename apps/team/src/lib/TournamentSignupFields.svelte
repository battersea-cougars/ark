<script lang="ts">
  // A tournament's sign-up (ADR 0030, 0074): when it opens, and with `more` (the editor, or the wizard's Advanced)
  // when it closes, its places, its fee and whether it's on the website. Two to a row, in pairs: opens and closes,
  // places and fee, then the website, so what `more` shows comes in beside and under what's there, never above it. Its
  // stage isn't here: it moves on from its own page (Manage: Close sign-up, Move to…).
  import FormSection from "./FormSection.svelte";
  import Select from "./Select.svelte";
  import DateField from "./DateField.svelte";
  import { pounds } from "./dates";
  import { formDay, type TournamentForm } from "./tournament-form";

  let {
    form = $bindable(),
    id,
    more = true,
    required = false,
    charged = false,
    collected = null,
  }: {
    form: TournamentForm;
    /** The fields' ids start with it ("quick", "date"): the fee's is `{id}-fee` */
    id: string;
    /** Every field; false: only when it opens */
    more?: boolean;
    /** When it opens must be said (a new one) */
    required?: boolean;
    /** Anyone's paid: the fee is fixed */
    charged?: boolean;
    /** What's been paid of what's due, once anyone's been charged */
    collected?: { people: number; paid: number; due: number } | null;
  } = $props();

  const day = $derived(formDay(form));
</script>

<FormSection
  title="Sign-up"
  description="Members say they're in from the day it opens till it closes (empty: up to the day)."
>
  <div class="cols">
    <div class="field">
      Sign-up opens
      <DateField
        id="{id}-signup-opens"
        aria-label="Sign-up opens"
        placeholder="Not set"
        {required}
        max={day}
        bind:value={form.signupOpensOn}
      />
    </div>
    {#if more}
      <div class="field">
        Sign-up closes
        <DateField
          id="{id}-signup-closes"
          aria-label="Sign-up closes"
          placeholder="Not set"
          min={form.signupOpensOn || undefined}
          max={day}
          bind:value={form.signupClosesOn}
        />
      </div>
      <label class="field">Places <input class="input num" type="number" min="0" bind:value={form.capacity} /></label>
      <label class="field"
        >Fee (£) <input id="{id}-fee" class="input num" inputmode="decimal" bind:value={form.fee} disabled={charged} />
        {#if charged}<span class="hint small">Already charged: the fee is fixed.</span>{/if}</label
      >
      <div class="field">
        Website
        <Select
          id="{id}-public"
          value={form.public ? "yes" : "no"}
          onchange={(v) => (form.public = v === "yes")}
          options={[
            { value: "yes", label: "On the website" },
            { value: "no", label: "Members only" },
          ]}
          aria-label="Website"
        />
      </div>
    {/if}
  </div>
  {#if more && collected?.people}
    <p class="num">Collected {pounds(collected.paid)} of {pounds(collected.due)}</p>
  {/if}
</FormSection>

<style>
  .cols {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: var(--s-5) var(--s-4);
    align-items: start;
  }
</style>
