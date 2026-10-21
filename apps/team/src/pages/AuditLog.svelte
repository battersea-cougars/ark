<script lang="ts">
  // Settings → Audit log (ADR 0095): the record of who changed what, and when. Sign-ins, every change made with more
  // than being signed in (members, roles, money, training, the Kumite, the club's settings) and every request refused
  // for want of an action, newest first, in plain words, a page at a time, filterable by area. Read when the page
  // opens; Refresh reads it again.
  import { api } from "../app/api";
  import Icon from "../app/shell/Icon.svelte";
  import PageHeader from "../lib/PageHeader.svelte";
  import { ACTIONS, type Action } from "../access/actions";
  import { formatDayDate, formatTime, pounds } from "../lib/dates";

  interface Entry {
    id: number;
    at: string;
    by: { id: number; name: string } | null;
    action: string;
    detail: Record<string, unknown>;
    about: string | null;
  }

  let entries = $state<Entry[]>([]);
  let more = $state(false);
  let loading = $state(false);
  let error = $state("");

  async function load(before?: number) {
    loading = true;
    error = "";
    try {
      const page = await api<{ entries: Entry[]; more: boolean }>(
        "GET",
        before ? `/api/audit?before=${before}` : "/api/audit",
      );
      entries = before ? [...entries, ...page.entries] : page.entries;
      more = page.more;
    } catch (e) {
      error = e instanceof Error ? e.message : String(e);
    } finally {
      loading = false;
    }
  }
  $effect(() => {
    void load();
  });

  const label = (a: unknown) => (typeof a === "string" && a in ACTIONS ? ACTIONS[a as Action].name : String(a));
  const list = (v: unknown) => (Array.isArray(v) && v.length ? v.map(label).join(", ") : "nothing");
  const str = (v: unknown) => (typeof v === "string" && v ? v : "none");
  const pence = (v: unknown) => (typeof v === "number" ? pounds(v) : "?");
  const rates = (v: unknown) =>
    Array.isArray(v) && v.length
      ? v.map((f: { pence: number; from: string }) => `${pounds(f.pence)} from ${f.from}`).join(", ")
      : "none";

  /** The entry in plain words: who, then what. Changes carry what they were (`from`) and are (`to`), ADR 0095. */
  function said(e: Entry): string {
    const d = e.detail;
    const who = e.by?.name ?? "Someone";
    const about = e.about ?? "a member";
    const from = (d.from ?? null) as Record<string, unknown> | null;
    const to = (d.to ?? null) as Record<string, unknown> | null;
    switch (e.action) {
      case "sign_in":
        return `${who} signed in`;
      case "sign_out":
        return `${who} signed out`;
      case "sign_in.capped":
        return `${who}'s sign-in stopped for the day: too many wrong codes`;
      case "access.requested":
        return `${who} asked to join`;
      case "member.added":
        return `${who} added ${about} (${str(to?.email)})`;
      case "members.imported": {
        const added = (to?.added as string[] | undefined) ?? [];
        return `${who} imported ${added.length} member${added.length === 1 ? "" : "s"} from a file: ${list(added)}`;
      }
      case "member.updated": {
        const changes: string[] = [];
        if (from?.status !== to?.status) changes.push(`${str(from?.status)} → ${str(to?.status)}`);
        if (JSON.stringify(from?.roles) !== JSON.stringify(to?.roles))
          changes.push(`roles ${list(from?.roles)} → ${list(to?.roles)}`);
        return `${who} changed ${about}: ${changes.join("; ") || "nothing"}`;
      }
      case "member.email":
        return `${who} changed ${about}'s sign-in email: ${str(d.from)} → ${str(d.to)}`;
      case "announcement.posted":
        return `${who} posted “${str(to?.title)}”, on Home until ${str(to?.endsOn)}`;
      case "announcement.removed":
        return `${who} took down “${str(from?.title)}”`;
      case "member.plan":
        return `${who} chose ${to?.quarterly ? "Quarterly" : "pay as you go"} for ${str(to?.quarter)}`;
      case "member.everyday":
        return d.to
          ? `${who} set ${about}'s app to open as ${str(d.to)}`
          : `${who} set ${about}'s app to open in their full role`;
      case "member.quarterly":
        return d.to ? `${who} made ${about} a Quarterly Member` : `${who} ended ${about}'s quarterly membership`;
      // Dues (ADR 0007): a charge reads { memberId, what (a training, tournament or quarter), pence, dueOn, paid }
      case "charge.paid": {
        const c = (to ?? from) as Record<string, unknown> | null;
        const what = `${str(c?.what)} on ${str(c?.dueOn)}`;
        return to?.paid
          ? `${who} marked ${about}'s ${what} paid (${str(to.paid)})`
          : `${who} took back ${about}'s payment for ${what}`;
      }
      // A lump sum: what they owed before and after, charge by charge ({ id, left })
      case "member.paid": {
        const owed = (v: unknown) =>
          Array.isArray(v) ? v.reduce((s, c) => s + Number((c as { left?: number }).left ?? 0), 0) : 0;
        return `${who} recorded a payment from ${about}, paying off ${pence(owed(d.from) - owed(d.to))}`;
      }
      case "dues.adjusted": {
        const p = Number(to?.pence ?? 0);
        return `${who} ${p > 0 ? "added" : "took"} ${pence(Math.abs(p))} ${p > 0 ? "to" : "off"} what ${about} owes: ${str(to?.reason)}`;
      }
      case "payment.removed":
        return `${who} took back ${about}'s payment of ${pence(from?.pence)} (${str(from?.via)}, ${str(from?.receivedOn)})`;
      case "charge.added":
        return `${who} charged ${about} ${pence(to?.pence)} for ${str(to?.what)}`;
      case "charge.removed":
        return `${who} took back ${about}'s charge for ${str(from?.what)}`;
      // Reminders of what they owe: who was emailed ({ memberIds }); one is about them
      case "dues.reminded": {
        const ids = (to?.memberIds as number[] | undefined) ?? [];
        return ids.length === 1
          ? `${who} emailed ${about} what they owe`
          : `${who} emailed ${ids.length} member${ids.length === 1 ? "" : "s"} what they owe`;
      }
      case "settings.bank":
        return `${who} changed the club's bank details`;
      case "fees.quarterly":
        return `${who} changed the quarterly rate: ${rates(d.from)} → ${rates(d.to)}`;
      case "role.created":
        return `${who} made the role ${str(to?.name)}: ${list(to?.actions)}`;
      case "role.updated":
        return `${who} changed the role ${str(to?.name)}: ${list(from?.actions)} → ${list(to?.actions)}`;
      case "dev_mail.changed": {
        const was = new Set((d.from as string[] | null) ?? []);
        const now = new Set((d.to as string[] | null) ?? []);
        const added = [...now].filter((a) => !was.has(a));
        const gone = [...was].filter((a) => !now.has(a));
        return [
          added.length ? `${who} let ${added.join(", ")} get their own email here` : "",
          gone.length ? `${who} took ${gone.join(", ")} off their own email here` : "",
        ]
          .filter(Boolean)
          .join("; ");
      }
      case "tournament.deleted":
        return `${who} deleted the tournament ${str(from?.name)} (${str(from?.heldOn)})`;
      case "session.reset":
        return `${who} reset the session on ${str(from?.heldOn)}: ${from?.signups ?? 0} sign-ups gone`;
      case "draft.reset":
        return `${who} reset a draft: ${from?.picks ?? 0} picks taken back`;
      case "refused":
        return `${who} was refused ${str(d.method)} ${str(d.path)}: needs "${label(d.action)}"`;
      case "event.created":
        return `${who} added ${str(to?.title)} to the calendar`;
      case "event.updated":
        return `${who} edited ${str(to?.title ?? from?.title)}`;
      case "event.cancelled":
        return to?.cancelledAt ? `${who} cancelled ${str(to?.title)}` : `${who} put ${str(to?.title)} back on`;
      case "dues.recalculated":
        return `${who} worked out ${about}'s dues again: ${pounds(Number(to?.pence ?? 0))} over ${Number(to?.charges ?? 0)} charges`;
      case "signups.changed":
        return `${who} changed who's in for an event`;
      case "venue.added":
        return `${who} added the venue ${str(to?.name)}`;
      case "venue.updated":
        return `${who} edited the venue ${str(to?.name ?? from?.name)}`;
      case "settings.updated":
        return `${who} set live pages to check every ${Number(to?.liveRefreshSeconds ?? 0)} seconds`;
      case "quip.added":
        return `${who} added a quip: “${str(to?.text)}”`;
      case "quip.updated":
        return `${who} changed a quip to “${str(to?.text)}”`;
      case "quip.removed":
        return `${who} removed the quip “${str(from?.text)}”`;
      case "training.created":
        return `${who} set up ${str(to?.name)}`;
      case "training.updated":
        return `${who} edited ${str(to?.name ?? from?.name)} (its days, times, places or fees)`;
      case "sessions.added":
        return `${who} added sessions, up to ${str(to?.lastOn)}`;
      case "session.cancelled":
        return to?.cancelledAt
          ? `${who} cancelled the session on ${str(to?.heldOn)}`
          : `${who} put the session on ${str(to?.heldOn)} back on`;
      case "teams.published":
        return `${who} published the night's teams`;
      case "teams.removed":
        return `${who} cleared the night's teams`;
      case "register.marked":
        return `${who} marked the register`;
      case "attendance.marked":
        return `${who} recorded ${about}'s attendance`;
      case "draft.pick_undone":
        return `${who} undid the last pick in the draft`;
      case "draft.drawn":
        return `${who} drew the draft's pick order: ${
          Array.isArray(d.to)
            ? (d.to as { captain?: string }[]).map((t, i) => `${i + 1} ${str(t.captain)}`).join(", ")
            : ""
        }`;
      case "draft.picked_for":
        // Whoever ran the draft picked for a captain: said as theirs, for that captain's team (ADR 0060)
        return `${who} picked ${str(to?.player) || about} for ${str(to?.captain)}'s team`;
      case "draft.opened":
        return `${who} opened the draft for ${str(to?.name)}`;
      case "draft.closed":
        return `${who} closed the draft for ${str(to?.name)}`;
      case "game.scored":
        return `${who} recorded a result: ${Number(to?.homeGoals ?? 0)}–${Number(to?.awayGoals ?? 0)}`;
      case "tournament_series.created":
        return `${who} set up the tournament series ${str(to?.name)}`;
      case "tournament_series.updated":
        return `${who} edited the tournament series ${str(to?.name ?? from?.name)}`;
      case "tournament.created":
        return `${who} scheduled ${str(to?.name)}`;
      case "tournament.updated":
        return `${who} edited ${str(to?.name ?? from?.name)}`;
      case "tournament.winners":
        return `${who} set a tournament's winners`;
      case "fixtures.made":
        return `${who} made the fight card: ${Number(to?.games ?? 0)} games`;
      case "team.players":
        return `${who} changed a tournament team's players`;
      default:
        return `${who}: ${e.action} ${JSON.stringify(d)}`;
    }
  }

  /** A refusal, a stopped sign-in, or something undone that can't be put back: worth a second look. */
  const notable = (e: Entry) =>
    ["refused", "sign_in.capped", "tournament.deleted", "session.reset", "draft.reset"].includes(e.action);
  const day = (e: Entry) => e.at.slice(0, 10);

  // Areas, to read one part of the club's record at a time (#80): by the event's name
  const AREAS = ["Members", "Money", "Training", "Kumite", "Settings"] as const;
  type Area = (typeof AREAS)[number];
  function areaOf(action: string): Area | null {
    if (/^(charge|payment|dues|fees)\.|^member\.(paid|plan|quarterly)$/.test(action)) return "Money";
    if (/^(sign_in|sign_out|access|member|members|role|refused)\b/.test(action)) return "Members";
    if (/^(training|session|sessions|teams|register|signups)\./.test(action)) return "Training";
    if (/^(tournament|tournament_series|draft|game|fixtures|team)\./.test(action)) return "Kumite";
    if (/^(venue|settings|quip|dev_mail|announcement|event)\./.test(action)) return "Settings";
    return null;
  }
  let area = $state<Area | null>(null);
  const shown = $derived(area ? entries.filter((e) => areaOf(e.action) === area) : entries);
</script>

<div class="page">
  <PageHeader
    title="Audit log"
    subtitle="Who changed what, and when: everything an admin, a team maker, a scorer or a treasurer does."
  >
    {#snippet actions()}
      <button class="btn sm" onclick={() => load()} disabled={loading}><Icon name="undo" size={16} />Refresh</button>
    {/snippet}
    {#snippet toolbar()}
      <div class="filters" role="group" aria-label="Area">
        <button class="filter" aria-pressed={area === null} onclick={() => (area = null)}>Everything</button>
        {#each AREAS as a (a)}
          <button class="filter" aria-pressed={area === a} onclick={() => (area = a)}>{a}</button>
        {/each}
      </div>
    {/snippet}
  </PageHeader>

  {#if error}
    <p class="error">{error}</p>
  {:else if !entries.length}
    <p class="hint">{loading ? "Reading the record…" : "Nothing on the record yet."}</p>
  {:else if !shown.length}
    <p class="hint">Nothing for {area} so far{more ? ": Earlier reads further back" : ""}.</p>
    {#if more}
      <button class="btn ghost older" onclick={() => load(entries[entries.length - 1].id)} disabled={loading}>
        {loading ? "Reading…" : "Earlier"}
      </button>
    {/if}
  {:else}
    <ol class="log">
      {#each shown as e, i (e.id)}
        {#if i === 0 || day(e) !== day(shown[i - 1])}
          <li class="day"><h2 class="section-title">{formatDayDate(e.at)}</h2></li>
        {/if}
        <li class="entry" class:notable={notable(e)}>
          <time class="when num" datetime={e.at}>{formatTime(e.at)}</time>
          <span class="what">
            {#if notable(e)}<Icon name="alert" size={14} />{/if}
            {said(e)}
          </span>
        </li>
      {/each}
    </ol>
    {#if more}
      <button class="btn ghost older" onclick={() => load(entries[entries.length - 1].id)} disabled={loading}>
        {loading ? "Reading…" : "Earlier"}
      </button>
    {/if}
  {/if}
</div>

<style>
  .log {
    list-style: none;
    margin: 0;
    padding: 0;
    display: grid;
    gap: var(--s-1);
  }
  .day {
    margin-top: var(--s-3);
  }
  .day:first-child {
    margin-top: 0;
  }
  .day .section-title {
    margin: 0 0 var(--s-1);
  }
  .entry {
    display: grid;
    grid-template-columns: 3.25rem 1fr;
    gap: var(--s-2);
    align-items: baseline;
    padding: var(--s-1) var(--s-2);
    border-radius: var(--r-md);
  }
  .entry.notable {
    background: var(--surface-2);
  }
  .when {
    color: var(--fg-muted);
    font-size: var(--text-sm);
  }
  .what {
    display: inline-flex;
    gap: var(--s-1);
    align-items: baseline;
    min-width: 0;
    overflow-wrap: anywhere;
  }
  .older {
    justify-self: start;
    margin-top: var(--s-3);
  }
</style>
