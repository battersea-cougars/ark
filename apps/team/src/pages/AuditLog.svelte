<script lang="ts">
  // Settings → Audit log (ADR 0095): the record of who changed what, and when. Sign-ins, every change made with more
  // than being signed in (members, roles, money, training, the Kumite, the club's settings) and every request refused
  // for want of an action, newest first, in plain words, a page at a time. A table like the app's others: a row per
  // entry (when, what, its area), a search over who and what, and chips by area. Read when the page opens; Refresh
  // reads it again.
  import { api } from "../app/api";
  import Icon from "../app/shell/Icon.svelte";
  import type { IconName } from "../app/shell/icons";
  import PageHeader from "../lib/PageHeader.svelte";
  import SearchField from "../lib/SearchField.svelte";
  import { flip } from "svelte/animate";
  import { cardMoveMs, easeOut, sift } from "../app/motion";
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
  // Why a reconnect didn't take (Settings → Email)
  const RECONNECT_TRIED: Record<string, string> = {
    denied: "Google's page was cancelled",
    "no-send": '"Send email on your behalf" wasn\'t ticked',
    club: "it was the club's own account",
    expired: "it took too long, or came back to another browser",
    failed: "Google gave no new token",
  };
  // Why a test email didn't go (Settings → Email)
  const TEST_RESULT: Record<string, string> = {
    logged: "no email is set up there, so it was logged",
    cancelled: "Google had cancelled the token",
    paused: "Gmail was busy",
    failed: "Gmail didn't take it",
    refused: "the app refused to send it",
  };
  /** A count and its noun: 1 match, 2 matches. */
  const count = (n: unknown, one: string, many = `${one}s`) => `${Number(n ?? 0)} ${Number(n ?? 0) === 1 ? one : many}`;
  const num = (v: unknown) => (typeof v === "number" ? v : 0);
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
        return d.everywhere ? `${who} signed out everywhere` : `${who} signed out`;
      case "member.signed_out":
        return `${who} signed ${about} out everywhere (${num(from?.sessions)} sign-in${num(from?.sessions) === 1 ? "" : "s"} ended)`;
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
        return `${who} changed the quarterly membership's price: ${rates(d.from)} → ${rates(d.to)}`;
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
      // The club's email (ADR 0027): a new Gmail token, kept sealed in the database ({ account })
      case "mail.reconnected":
        return `${who} reconnected the club's email, sending as ${str(to?.account)}`;
      // A trip through Google that didn't reconnect ({ outcome }: denied, no-send, club, expired, failed)
      case "mail.reconnect_tried":
        return `${who} tried to reconnect the club's email: ${RECONNECT_TRIED[str(to?.outcome)] ?? "it didn't work"}`;
      // "Send a test email" ({ to, result: sent, logged, cancelled, paused, failed, refused })
      case "mail.test_sent":
        return to?.result === "sent"
          ? `${who} sent a test email to ${str(to?.to)}`
          : `${who} tried a test email to ${str(to?.to)}: ${TEST_RESULT[str(to?.result)] ?? "it didn't go"}`;
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
      case "draft.reopened": {
        // Reopened, keeping the fixtures or clearing them: what went, from the counts before and after
        const went = Number(from?.games ?? 0) - Number(to?.games ?? 0);
        const results = Number(from?.results ?? 0) - Number(to?.results ?? 0);
        return went > 0
          ? `${who} reopened the draft for ${str(to?.name)}, clearing ${count(went, "match", "matches")}${results ? ` and ${count(results, "result")}` : ""}`
          : `${who} reopened the draft for ${str(to?.name)}`;
      }
      case "fixtures.cleared":
        return `${who} cleared the Fight Card for ${str(from?.name)}: ${count(from?.games, "match", "matches")}, ${count(from?.results, "result")}`;
      case "draft.finished":
        return `${who} closed the draft for ${str(to?.name)}: ${count(to?.games, "match", "matches")} on the Fight Card`;
      case "game.keeper_changed":
        // An admin's say over someone's scoresheet (#116): taken over, or freed
        return to?.keeper
          ? `${who} took over scoring Game ${Number(to.game)}${from?.keeper ? ` from ${str(from.keeper)}` : ""}`
          : `${who} freed Game ${Number(from?.game)}'s scoresheet${from?.keeper ? ` from ${str(from.keeper)}` : ""}`;
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
      case "tournament.award_revealed":
        return `${who} revealed ${str(to?.award)} at ${str(to?.name)}'s after-party: ${Number(to?.revealed ?? 0)} out`;
      case "tournament.moved": {
        // Move to… (ADR 0074): from one status to another in one go, and what it did on the way
        const STAGE: Record<string, string> = {
          signup: "Sign-up open",
          draft: "Draft open",
          teams: "Teams set",
          fixtures: "Fixtures set",
          day: "the day",
          afters: "the after-party",
        };
        const done = Array.isArray(d.done) ? (d.done as string[]).join(", ") : "";
        return `${who} moved ${str(to?.name ?? from?.name)} from ${STAGE[str(from?.stage)] ?? str(from?.stage)} to ${STAGE[str(to?.stage)] ?? str(to?.stage)}${done ? `: ${done}` : ""}`;
      }
      case "tournament.simulated":
        return `${who} played ${str(to?.name)} on at random (dev only): ${Number(to?.played ?? 0)} of ${Number(to?.games ?? 0)} matches played`;
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

  // Areas, to read one part of the club's record at a time (#80): by the event's name, each with its chip's icon
  const AREAS = [
    ["Members", "user"],
    ["Money", "pound"],
    ["Training", "stick"],
    ["Kumite", "swords"],
    ["Settings", "settings"],
  ] as const satisfies readonly (readonly [string, IconName])[];
  type Area = (typeof AREAS)[number][0];
  const iconOf = Object.fromEntries(AREAS) as Record<Area, IconName>;
  function areaOf(action: string): Area | null {
    if (/^(charge|payment|dues|fees)\.|^member\.(paid|plan|quarterly)$/.test(action)) return "Money";
    if (/^(sign_in|sign_out|access|member|members|role|refused)\b/.test(action)) return "Members";
    if (/^(training|session|sessions|teams|register|signups)\./.test(action)) return "Training";
    if (/^(tournament|tournament_series|draft|game|fixtures|team)\./.test(action)) return "Kumite";
    if (/^(venue|settings|quip|dev_mail|mail|announcement|event)\./.test(action)) return "Settings";
    return null;
  }
  let area = $state<Area | null>(null);

  // Each entry read once, in words, so the search looks through what you see: who, what, and the area
  const rows = $derived(entries.map((e) => ({ ...e, said: said(e), area: areaOf(e.action) })));
  // The search finds an entry by who did it, what they did or to whom, as on the other tables
  let query = $state("");
  const shown = $derived.by(() => {
    const words = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
    return rows.filter((r) => {
      if (area && r.area !== area) return false;
      const text = `${r.said} ${r.area ?? ""} ${r.action}`.toLowerCase();
      return words.every((w) => text.includes(w));
    });
  });
  const earlier = () => load(entries[entries.length - 1].id);
</script>

<!-- One list, the page's subject: it takes the height left and scrolls inside (.page.fit), its header row the
     table's own, above the rows and never a bar they pass under -->
<div class="page fit">
  <PageHeader
    title="Audit log"
    subtitle="Who changed what, and when: everything an admin, a team maker, a scorer or a treasurer does."
    active={area ? 1 : 0}
    onclear={() => (area = null)}
  >
    {#snippet actions()}
      <button class="btn sm ghost" onclick={() => load()} disabled={loading}
        ><Icon name="refresh" size={16} />Refresh</button
      >
    {/snippet}
    {#snippet filters()}
      <div class="filters" role="group" aria-label="Area">
        <button class="filter" aria-pressed={area === null} onclick={() => (area = null)}
          ><Icon name="list" size={16} />Everything</button
        >
        {#each AREAS as [a, icon] (a)}
          <button class="filter" aria-pressed={area === a} onclick={() => (area = a)}
            ><Icon name={icon} size={16} />{a}</button
          >
        {/each}
      </div>
    {/snippet}
  </PageHeader>

  {#if error}
    <p class="error">{error}</p>
  {/if}

  <div class="table scroll-fill">
    <div class="table-head">
      <span>When</span>
      <span>What</span>
      <span class="col-area">Area</span>
      <!-- Find an entry: a magnifier at the end of the row that widens into the field when you tap it -->
      <div class="finder">
        <SearchField bind:value={query} placeholder="Search who or what" label="Search the log" collapsible />
      </div>
    </div>
    <div class="list rows">
      <!-- A search or a chip sifts rows; the rest glide to their places (as on Roles and Unpaid fees) -->
      {#each shown as r (r.id)}
        <div class="slot" animate:flip={{ duration: cardMoveMs, easing: easeOut }} in:sift out:sift={{ out: true }}>
          <div class="table-row entry">
            <time class="when num" datetime={r.at}
              ><span class="day">{formatDayDate(r.at)}</span><span class="time">{formatTime(r.at)}</span></time
            >
            <span class="what" class:notable={notable(r)}>
              {#if notable(r)}<Icon name="alert" size={14} />{/if}
              <span>{r.said}</span>
            </span>
            <span class="col-area">
              {#if r.area}<Icon name={iconOf[r.area]} size={14} />{r.area}{/if}
            </span>
          </div>
        </div>
      {:else}
        <p class="hint none">
          {#if !entries.length}
            {loading ? "Reading the record…" : "Nothing on the record yet."}
          {:else if query.trim()}
            Nothing matches “{query.trim()}”{area ? ` in ${area}` : ""} so far{more
              ? ": Earlier reads further back"
              : ""}.
          {:else}
            Nothing for {area} so far{more ? ": Earlier reads further back" : ""}.
          {/if}
        </p>
      {/each}
      <!-- The API reads a page at a time: Earlier reads the next, at the foot of the rows (the same room while it
           reads, so nothing moves) -->
      {#if more}
        <div class="earlier">
          <button class="btn ghost sm" onclick={earlier} disabled={loading}>{loading ? "Reading…" : "Earlier"}</button>
        </div>
      {/if}
    </div>
  </div>
</div>

<style>
  /* The table: glass, its header row on top and the rows scrolling under it, inside the edge */
  .table {
    display: flex;
    flex-direction: column;
    overflow: hidden;
    border-radius: var(--r-table);
    background: var(--glass);
    backdrop-filter: var(--blur);
    -webkit-backdrop-filter: var(--blur);
    /* When, what happened, and its area */
    --cols: 9.5rem minmax(0, 1fr) 7.5rem;
  }
  .page.fit .table.scroll-fill {
    overflow: hidden;
  }
  .rows {
    flex: 0 1 auto;
    min-height: 0;
    overflow-y: auto;
    overscroll-behavior: contain;
    align-content: start;
    border-radius: 0;
    background: none;
    backdrop-filter: none;
    -webkit-backdrop-filter: none;
  }
  /* The day, then the time, on one line: the rows stay one line high where there's room */
  .when {
    display: flex;
    gap: var(--s-2);
    align-items: baseline;
    color: var(--fg-muted);
    font-size: var(--text-sm);
  }
  .time {
    color: var(--fg);
  }
  .what {
    display: flex;
    gap: var(--s-1);
    align-items: baseline;
    min-width: 0;
    overflow-wrap: anywhere;
  }
  /* A refusal or something that can't be put back: an icon says so, the words stay as they are */
  .what.notable :global(svg) {
    flex-shrink: 0;
    align-self: center;
    color: var(--caution);
  }
  .entry .col-area {
    display: inline-flex;
    gap: var(--s-1);
    align-items: center;
    color: var(--fg-muted);
    font-size: var(--text-sm);
  }
  .none {
    margin: 0;
    padding: var(--s-4);
  }
  .earlier {
    display: flex;
    justify-content: center;
    padding: var(--s-2);
    background: var(--rule) top / 100% 1px no-repeat;
  }
  /* A phone: the area goes (the chips say it); the time sits over the day, narrow, at the top of the words */
  @media (max-width: 900px) {
    .entry {
      align-items: start;
    }
    .when {
      display: grid;
      gap: 0.1rem;
    }
    .time {
      order: -1;
    }
    .day {
      font-size: var(--text-xs);
    }
    .table {
      --cols: 4.25rem minmax(0, 1fr);
    }
    .table-head,
    .table-row {
      gap: var(--s-3);
    }
    .col-area,
    .entry .col-area {
      display: none;
    }
  }
</style>
