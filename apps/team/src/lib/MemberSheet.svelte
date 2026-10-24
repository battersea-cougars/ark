<script lang="ts">
  import { Edits } from "./dirty.svelte";
  import SaveBar from "./SaveBar.svelte";
  import { requestClose } from "./overlay";
  import { goesBy, shortName } from "./names";
  // A member, opened for an admin (Teammates: a tap on their card or row, or a link to /club/:id). It
  // fills the space the page has, beside the dock and under the top bar (on a phone, the whole screen), the way
  // Gwenda's editors do: a header with who they are and a close button top right, then a body that scrolls on its
  // own. Tabs along the header's foot: Details, Attendance and Dues, each with the whole card. The card they were
  // tapped on turns away as it opens, and back as it closes. Their details and attendance are a draft until Save, in
  // a footer that stays at the bottom (as Gwenda's editors have); closing with changes asks first. Dues (a payment, a
  // quarter charged, taken back) save as they're made.
  import { onMount, tick } from "svelte";
  import Icon from "../app/shell/Icon.svelte";
  import { pageColumnStyle } from "./page-column";
  import { EASE_IN, EASE_OUT, prefersReducedMotion } from "../app/motion";
  import PlayerCard from "./PlayerCard.svelte";
  import {
    attendanceOf,
    chargeQuarter,
    markAttendance,
    recalculateDues,
    recordPayment,
    adjustDues,
    saveContact,
    eraseMember,
    saveMember,
    signOutMember,
    sendAppLink,
    removeMemberPasskeys,
    setQuarterly,
    setMemberEveryday,
    type AttendanceRow,
  } from "../app/backend.svelte";
  import { POSITIONS, REAL_ID, emailFor, phoneFor, referenceFor, type Position } from "../demo/data";
  import { chargesFor, creditOf, owedBy } from "../demo/dues.svelte";
  import { db } from "../demo/store.svelte";
  import { granted, me, session } from "../demo/session.svelte";
  import { can } from "../access/actions";
  import Ledger from "./Ledger.svelte";
  import { api } from "../app/api";
  import type { Passkey } from "../app/passkeys";
  import Sheet from "./Sheet.svelte";
  import RemindReview from "./RemindReview.svelte";
  import MoneyField from "./MoneyField.svelte";
  import DateField from "./DateField.svelte";
  import { feeOn, leftOn } from "./dues";
  import { formatDayDate, londonISO, londonToday, pounds } from "./dates";
  import { registerClosed } from "./register-closes";
  import { initials } from "./initials";
  import Select from "./Select.svelte";

  // Opens in the page's own column (desktop), the same width as the cards under it
  // …measured again when the window changes size, so it keeps to the page as the page reflows
  let colStyle = $state(pageColumnStyle());
  let settle: ReturnType<typeof setTimeout> | undefined;
  function remeasure() {
    colStyle = pageColumnStyle();
    // The page's sides ease across when the window crosses a width (the settings list grows): again once they land
    clearTimeout(settle);
    settle = setTimeout(() => (colStyle = pageColumnStyle()), 400);
  }
  let {
    memberId,
    source,
    tab = "details",
    onclose,
  }: {
    memberId: number;
    /** The card that was tapped: it turns away as this opens. None (a row, a link) and this just grows in. */
    source?: HTMLElement;
    /** Which tab it opens on: Unpaid fees opens it on their dues */
    tab?: "details" | "attendance" | "dues";
    onclose: () => void;
  } = $props();

  const member = $derived(db.members.find((m) => m.player.id === memberId)!);

  // Their details as they were when it opened, and as edited here. The sheet is made afresh for each member
  // (Teammates and Members key it), so they're read once, as it opens, and again after a save.
  const current = () => ({
    name: member.player.name,
    webName: member.player.webName ?? "",
    role: member.roles[0] ?? "Member",
    // The role their app opens as: "full", or a role's id
    everyday: member.everydayRoleId == null ? "full" : String(member.everydayRoleId),
    plan: member.plan,
    position: member.player.position,
    rating: member.player.rating,
    cougar: member.player.cougar,
    email: emailFor(member.player) === "No email yet" ? "" : emailFor(member.player),
    phone: phoneFor(memberId) ?? "",
  });
  // What their app can open as: their full role, or a role that can do less than it (the server checks the same)
  const everydayOptions = $derived.by(() => {
    const full = db.roles.find((r) => r.name === draft.role);
    const theirs = new Set(full?.actions ?? []);
    const less = (actions: readonly string[]) =>
      theirs.has("manage:all") || actions.every((a) => theirs.has(a as never));
    return [
      { value: "full", label: `Their full role (${draft.role})` },
      ...db.roles
        .filter((r) => r.name !== draft.role && less(r.actions))
        .map((r) => ({ value: String(r.id), label: r.name })),
    ];
  });
  let saved = $state(current());
  let draft = $state(current());
  const tidyName = (n: string) => n.trim().replace(/\s+/g, " ");
  // Attendance taps, held until Save too: a session's id → whether they came
  let marks = $state<Record<number, boolean>>({});
  const ratingOk = $derived(Number.isInteger(draft.rating) && draft.rating >= 0 && draft.rating <= 100);
  // Unsaved changes (lib/dirty.svelte.ts): their details as they'd be saved (names tidied, spaces trimmed) and the
  // Fridays tapped, against what they were when it opened or last saved. Closing with some asks first, in the footer
  const edits = new Edits();
  edits.watch(() => ({
    details: Object.fromEntries(
      Object.entries(draft).map(([k, v]) => [k, k === "name" ? tidyName(String(v)) : String(v).trim()]),
    ),
    marks,
  }));
  const changed = $derived(edits.dirty);
  let busy = $state(false);
  const canSave = $derived(changed && ratingOk && !!tidyName(draft.name) && !busy);

  // Only what changed goes to the server (app/backend.svelte.ts). A member has one role of their own, plus Member.
  async function saveDetails(): Promise<boolean> {
    if (!canSave) return false;
    busy = true;
    try {
      const d = {
        ...draft,
        name: tidyName(draft.name),
        webName: tidyName(draft.webName),
        email: draft.email.trim(),
        phone: draft.phone.trim(),
      };
      const results: unknown[] = [];
      if (
        d.name !== saved.name ||
        d.webName !== saved.webName ||
        d.role !== saved.role ||
        d.position !== saved.position ||
        d.rating !== saved.rating ||
        d.cougar !== saved.cougar
      ) {
        Object.assign(member.player, {
          name: d.name,
          webName: d.webName || null,
          position: d.position,
          rating: d.rating,
          cougar: d.cougar,
        });
        member.roles = d.role === "Member" ? ["Member"] : [d.role, "Member"];
        results.push(await saveMember(member));
      }
      // Their everyday role; none once they're only a Member, since there's nothing to open as
      const everyday = d.role === "Member" ? "full" : d.everyday;
      if (everyday !== saved.everyday) {
        member.everydayRoleId = everyday === "full" ? null : Number(everyday);
        results.push(await setMemberEveryday(memberId, member.everydayRoleId));
        // Your own: the app follows it now, as Profile's does
        if (memberId === REAL_ID) session.everyday = member.everydayRoleId;
      }
      // (A keeper plays free: no plan to set, whatever was picked before the position changed)
      if (d.plan !== saved.plan && d.position !== "G" && d.plan !== "Keeper") {
        member.plan = d.plan;
        results.push(await setQuarterly(memberId, d.plan === "Subscription"));
      }
      if (d.email !== saved.email || d.phone !== saved.phone)
        results.push(await saveContact(memberId, d.email, d.phone));
      // Each Friday tapped, through the register's rules (a sign-up becomes a no-show or back, anyone else is
      // added or taken off), all in one request
      if (Object.keys(marks).length)
        results.push(
          await markAttendance(
            memberId,
            Object.entries(marks).map(([sessionId, here]) => ({ sessionId: Number(sessionId), here })),
          ),
        );
      // A failed save says so (the shell's note) and reloads the club; the draft stays, to try again
      if (results.includes(null)) return false;
      saved = current();
      draft = current();
      if (Object.keys(marks).length) {
        marks = {};
        await load(memberId, year);
      }
      return true;
    } finally {
      busy = false;
    }
  }
  /** Back to what's saved, without closing. */
  function discard() {
    draft = { ...saved };
    marks = {};
  }
  const saveIt = () => canSave && edits.run(saveDetails);

  // Their attendance, a quarter at a time (Jan–Mar, Apr–Jun…), from the first quarter any training ran to this one.
  // Tap a Friday to say whether they came; it shows at once and is sent with Save.
  const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const today = londonToday();
  const thisYear = Number(today.slice(0, 4));
  const thisQuarter = thisYear * 4 + Math.floor((Number(today.slice(5, 7)) - 1) / 3);
  const firstQuarter = $derived(
    4 * Math.min(thisYear, ...db.series.map((s) => Number(s.startsOn.slice(0, 4))).filter(Number.isFinite)),
  );
  let quarter = $state(thisQuarter);
  const year = $derived(Math.floor(quarter / 4));
  const firstMonth = $derived((quarter % 4) * 3);
  const quarterLabel = $derived(`${MONTHS[firstMonth]}–${MONTHS[firstMonth + 2]} ${year}`);
  let attendance = $state<AttendanceRow[] | null>(null);
  // A year's rows at a time; a slow answer for a year no longer shown is dropped
  const load = (id: number, y: number) =>
    attendanceOf(id, String(y))
      .then((rows) => y === year && (attendance = rows))
      .catch(() => y === year && (attendance = []));
  $effect(() => {
    const y = year;
    attendance = null;
    load(memberId, y);
  });
  // The quarter's three months, each with its trainings in date order
  const months = $derived(
    [0, 1, 2].map((k) => {
      const m = firstMonth + k;
      const days = (attendance ?? [])
        .filter((r) => Number(r.heldOn.slice(5, 7)) - 1 === m)
        .reverse()
        .map(asMarked);
      return [MONTHS[m], days] as const;
    }),
  );
  const inQuarter = $derived(months.flatMap(([, days]) => days));
  const came = (r: AttendanceRow) => r.signup === "in" && r.attended !== false;
  function outcome(r: AttendanceRow): { label: string; kind: string } {
    if (r.cancelled) return { label: "Cancelled", kind: "cancelled" };
    if (came(r)) return { label: r.walkIn ? "Came (walk-in)" : "Came", kind: "came" };
    if (r.signup === "in") return { label: "No-show", kind: "noshow" };
    if (r.signup === "out") return { label: "Not there (said out)", kind: "" };
    if (r.signup === "waitlist") return { label: "Not there (waitlist)", kind: "" };
    return { label: "Not there", kind: "" };
  }

  // A row as it will be once saved: ticking makes them in and here; unticking a sign-up makes a no-show, and a
  // walk-in comes off
  function asMarked(r: AttendanceRow): AttendanceRow {
    const here = marks[r.sessionId];
    if (here === undefined) return r;
    if (here) return { ...r, signup: "in", attended: true };
    return r.walkIn ? { ...r, signup: null, attended: null, walkIn: false } : { ...r, attended: false };
  }
  // A night's register closes at 6am the morning after (lib/register-closes.ts, #11): its day is shown, not changed
  const closed = (r: AttendanceRow) => registerClosed(r.heldOn);
  function toggleCame(r: AttendanceRow) {
    const was = attendance?.find((x) => x.sessionId === r.sessionId);
    if (!was || was.cancelled || closed(was)) return;
    const here = !came(r);
    // Back to how it was saved: nothing to send
    if (here === came(was)) delete marks[r.sessionId];
    else marks[r.sessionId] = here;
  }

  const charges = $derived(chargesFor(memberId));
  const owed = $derived(owedBy(memberId));
  // Everything paid towards their charges, part payments too, and money not yet spent on one
  const paidTotal = $derived(charges.reduce((s, c) => s + c.pence - leftOn(c), 0));
  const credit = $derived(creditOf(memberId));

  // Dues (ADR 0007): who sees Unpaid fees sees a member's charges; who records payments marks them
  const perms = $derived(granted());
  const seesDues = $derived(can(perms, "read:Dues") || can(perms, "record:Payment"));
  const recordsPayments = $derived(can(perms, "record:Payment"));

  // Charging a quarter by hand: this one or one of the last four, at today's quarterly rate unless changed
  const quarterKey = (n: number) => `${Math.floor(n / 4)}-Q${(n % 4) + 1}`;
  const quarterName = (n: number) => `Q${(n % 4) + 1} ${Math.floor(n / 4)}`;
  let charging = $state(false);
  let chargeWhich = $state(String(thisQuarter));
  let chargeAmount = $state("");
  const chargeOptions = $derived(
    [0, 1, 2, 3, 4].map((back) => {
      const n = thisQuarter - back;
      const taken = charges.some((c) => c.quarter === quarterKey(n));
      return { value: String(n), label: `${quarterName(n)}${taken ? " (charged)" : ""}`, disabled: taken };
    }),
  );
  function startCharge() {
    chargeWhich = chargeOptions.find((o) => !o.disabled)?.value ?? String(thisQuarter);
    // The quarterly rate in force today
    chargeAmount = String(feeOn(db.fees, londonToday()) / 100 || "");
    charging = true;
  }
  async function addQuarter(e: SubmitEvent) {
    e.preventDefault();
    const pence = Math.round(Number(chargeAmount) * 100);
    if (!pence || pence < 0) return;
    if (await chargeQuarter(memberId, quarterKey(Number(chargeWhich)), pence)) charging = false;
  }

  // A payment of any amount (a lump sum): it pays the oldest charges first, and what's left over is credit
  let paying = $state(false);
  // Below the details: their attendance, or (for whoever sees dues) their payments
  // The Dues tab's pinned totals: how tall, so each list's heading pins just under them
  let moneyHeight = $state(0);
  // svelte-ignore state_referenced_locally
  let bodyTab = $state<"details" | "attendance" | "dues">(tab);
  let payAmount = $state("");
  let payVia = $state<"transfer" | "cash">("transfer");
  // The day it came in: today unless it was earlier (a transfer that landed last week)
  let payOn = $state(londonToday());
  function startPayment() {
    payAmount = owed ? String(owed / 100) : "";
    payVia = "transfer";
    payOn = londonToday();
    paying = true;
  }
  // Email them what they owe (ADR 0007), after seeing it
  let reminding = $state(false);
  // An adjustment (ADR 0007): add to or take off what they owe, saying why
  let adjusting = $state(false);
  let adjustWay = $state<"more" | "less">("less");
  let adjustAmount = $state("");
  let adjustReason = $state("");
  let adjustOn = $state(londonToday());
  function startAdjust() {
    adjustWay = "less";
    adjustAmount = "";
    adjustReason = "";
    adjustOn = londonToday();
    adjusting = true;
  }
  async function addAdjust(e: SubmitEvent) {
    e.preventDefault();
    const pence = Math.round(Number(adjustAmount) * 100);
    if (!Number.isFinite(pence) || pence <= 0 || !adjustReason.trim()) return;
    if (await adjustDues(memberId, adjustWay === "more" ? pence : -pence, adjustReason.trim(), adjustOn))
      adjusting = false;
  }
  async function addPayment(e: SubmitEvent) {
    e.preventDefault();
    const pence = Math.round(Number(payAmount) * 100);
    if (!Number.isFinite(pence) || pence <= 0) return;
    if (await recordPayment(memberId, pence, payVia, payOn)) paying = false;
  }

  // Opening is one turn: the tapped card lifts, grows towards the middle and turns edge-on; the panel carries the
  // turn on from there, opening out from that spot to fill the space (its back is the panel). Closing runs it
  // backwards. With no card to start from (a row, a link) the panel just zooms in. Without motion it just appears.
  let panel = $state<HTMLElement | undefined>();
  let turning = $state<HTMLElement | undefined>();
  const rectOf = (el?: HTMLElement) => (el?.isConnected ? el.getBoundingClientRect() : null);
  let from = $state<DOMRect | null>(null);
  let closing = $state(false);
  // Light placeholders while it turns; the real fields mount once it has landed, so the turn stays smooth
  let ready = $state(false);
  // …and the placeholders fade out under them, then go
  let gone = $state(false);
  const ZOOM_IN = [
    { transform: "scale(0.94)", filter: "blur(8px)", opacity: 0 },
    { transform: "none", filter: "blur(0)", opacity: 1 },
  ];
  const CARD_MS = 170;
  const PANEL_MS = 320;
  // Shallow depth: a light turn, not a heavy swing
  const DEPTH = "perspective(2400px)";

  function portal(node: HTMLElement) {
    document.body.append(node);
    return { destroy: () => node.remove() };
  }

  // Where the tapped card lies, before anything paints over it
  $effect.pre(() => {
    if (!closing && !prefersReducedMotion) from = rectOf(source);
  });

  // The turn's two halves, from the card's place (s) to the panel's (p). Halfway, edge-on, the card is a bigger
  // card between the two; the panel starts there, clipped to that card's shape.
  function turnFrames(s: DOMRect, p: DOMRect) {
    const k = Math.max(1, Math.min(p.width / s.width, p.height / s.height) * 0.25);
    const cx = (s.left + s.width / 2 + p.left + p.width / 2) / 2;
    const cy = (s.top + s.height / 2 + p.top + p.height / 2) / 2;
    const [w, h] = [s.width * k, s.height * k];
    const card = [
      { transform: `translate(0, 0) scale(1) ${DEPTH} rotateY(0deg)` },
      {
        // The move comes before the depth, so the card is seen square on and edge-on is a line, not a skewed side
        transform: `translate(${cx - (s.left + s.width / 2)}px, ${cy - (s.top + s.height / 2)}px) scale(${k}) ${DEPTH} rotateY(90deg)`,
      },
    ];
    const radius = getComputedStyle(panel!).borderTopLeftRadius;
    const origin = `${cx - p.left}px ${cy - p.top}px`;
    const inset = [cy - h / 2 - p.top, p.right - (cx + w / 2), p.bottom - (cy + h / 2), cx - w / 2 - p.left];
    const back = [
      {
        clipPath: `inset(${inset.map((n) => `${n}px`).join(" ")} round ${8 * k}px)`,
        transform: `${DEPTH} rotateY(-90deg)`,
        transformOrigin: origin,
      },
      {
        clipPath: `inset(0px 0px 0px 0px round ${radius})`,
        transform: `${DEPTH} rotateY(0deg)`,
        transformOrigin: origin,
      },
    ];
    return { card, back };
  }

  onMount(() => {
    panel?.focus({ preventScroll: true });
    if (prefersReducedMotion || !panel) return void ((from = null), (ready = gone = true));
    let grow: Animation;
    if (from && turning) {
      const { card, back } = turnFrames(from, panel.getBoundingClientRect());
      turning.animate(card, {
        duration: CARD_MS,
        easing: "cubic-bezier(0.4, 0, 1, 1)",
        fill: "forwards",
      }).onfinish = () => (from = null);
      grow = panel.animate(back, {
        duration: PANEL_MS,
        delay: CARD_MS,
        easing: "cubic-bezier(0, 0, 0.2, 1)",
        fill: "backwards",
      });
    } else {
      grow = panel.animate(ZOOM_IN, { duration: 440, easing: EASE_OUT });
    }
    grow.onfinish = () => (ready = true);
  });

  // Deleting their account, when they've asked (#30): done, the sheet closes with nothing left to save
  let erasing = $state(false);
  async function erase() {
    busy = true;
    const done = await eraseMember(member.player.id);
    busy = false;
    erasing = false;
    if (done) shut();
  }

  // The link to the app, sent after all (#164): someone added without it, or whose email went astray. One email a
  // tap, to the address saved (not one typed and unsaved)
  let sendingLink = $state(false);
  async function sendLink() {
    if (sendingLink) return;
    sendingLink = true;
    await sendAppLink(member.player.id, shortName(member.player));
    sendingLink = false;
  }

  // Signing them out everywhere (#72): a lost phone, a shared laptop. They sign in again with a code.
  let signingOut = $state(false);
  async function signOutEverywhere() {
    signingOut = true;
    await signOutMember(member.player.id);
    signingOut = false;
  }

  // Their passkeys (ADR 0023): by device and the day they added it; an admin removes them all (a lost or sold phone).
  // Their sign-ins stay: that's Sign out everywhere, beside it
  let theirPasskeys = $state<Passkey[] | null>(null);
  $effect(() => {
    const id = memberId;
    if (id === me().id) return;
    theirPasskeys = null;
    // A slow answer for someone no longer shown is dropped, as their attendance's is
    api<{ passkeys: Passkey[] }>("GET", `/api/members/${id}/passkeys`)
      .then((r) => id === memberId && (theirPasskeys = r.passkeys))
      .catch(() => id === memberId && (theirPasskeys = null));
  });
  const passkeysLine = $derived(
    theirPasskeys === null
      ? ""
      : theirPasskeys.length
        ? `Passkeys: ${theirPasskeys.map((p) => `${p.name}, ${formatDayDate(p.createdAt)}`).join("; ")}`
        : "No passkeys: they sign in with a code.",
  );
  let removingPasskeys = $state(false);
  async function removePasskeys() {
    removingPasskeys = true;
    if (await removeMemberPasskeys(memberId)) theirPasskeys = [];
    removingPasskeys = false;
  }

  // Closing with changes asks first (the footer, lib/SaveBar); Discard goes on to close
  function close() {
    requestClose(shut, edits.guard);
  }

  async function shut() {
    if (closing) return;
    closing = true;
    if (prefersReducedMotion || !panel) return onclose();
    // The card goes back where it came from, if it's still there
    from = rectOf(source);
    await tick();
    if (!from || !turning) {
      panel.animate([...ZOOM_IN].reverse(), { duration: 240, easing: EASE_IN, fill: "forwards" }).onfinish = () =>
        onclose();
      return;
    }
    const { card, back } = turnFrames(from, panel.getBoundingClientRect());
    panel.animate([...back].reverse(), { duration: 220, easing: "cubic-bezier(0.4, 0, 1, 1)", fill: "forwards" });
    turning.animate([...card].reverse(), {
      duration: CARD_MS + 30,
      delay: 220,
      easing: "cubic-bezier(0, 0, 0.2, 1)",
      fill: "both",
    }).onfinish = () => onclose();
  }

  function onkeydown(e: KeyboardEvent) {
    // A menu's own Escape (Select) closes just the menu
    if (e.key === "Escape" && !e.defaultPrevented) close();
  }
</script>

<svelte:window {onkeydown} onresize={remeasure} />

<div class="sheet-layer" class:closing use:portal>
  <button class="scrim" aria-label="Close" tabindex="-1" onclick={close}></button>
  {#if from}
    <div
      class="turning"
      bind:this={turning}
      style:left="{from.left}px"
      style:top="{from.top}px"
      style:width="{from.width}px"
      style:height="{from.height}px"
      aria-hidden="true"
    >
      <PlayerCard player={member.player} />
    </div>
  {/if}
  <div
    class="panel"
    style={colStyle}
    role="dialog"
    aria-modal="true"
    aria-label={goesBy(member.player)}
    tabindex="-1"
    bind:this={panel}
  >
    <!-- The header is the player: who they are, then their details in one row -->
    <header class="panel-head">
      <div class="who">
        <span class="avatar big">{initials(goesBy(member.player))}</span>
        <div class="titles">
          <p class="eyebrow">
            Member · {POSITIONS[draft.position]}{draft.position === "G"
              ? " · plays free"
              : draft.plan === "Subscription"
                ? " · Quarterly"
                : ""}
            {#if draft.cougar}<span class="badge red">Cougar</span>{/if}
          </p>
          <!-- Their name, editable in place -->
          <div class="name-line">
            <input
              class="name-edit"
              aria-label="Name"
              bind:value={draft.name}
              maxlength="80"
              onkeydown={(e) => e.key === "Enter" && e.currentTarget.blur()}
            />
          </div>
          <p class="sub">
            {#if goesBy(member.player) !== member.player.name}Goes by {goesBy(member.player)} ·
            {/if}{emailFor(member.player)} · <span class="num">{referenceFor(memberId)}</span>
          </p>
        </div>
        <button class="btn ghost icon close close-x" aria-label="Close" onclick={close}>
          <Icon name="x" size={18} />
        </button>
      </div>
      <!-- Details, attendance and dues: each gets the whole card below the header -->
      <div class="tablist" role="tablist" aria-label="{shortName(member.player)}'s card">
        {#each [["details", "Details"], ["attendance", "Attendance"], ...(seesDues ? [["dues", "Dues"]] : [])] as [id, label] (id)}
          <button
            type="button"
            role="tab"
            id="member-tab-{id}"
            aria-selected={bodyTab === id}
            aria-controls="member-panel"
            onclick={() => (bodyTab = id as typeof bodyTab)}
          >
            {label}{#if id === "dues" && owed > 0}<span class="tab-owed num">{pounds(owed)}</span>{/if}
          </button>
        {/each}
      </div>
    </header>

    <!-- The rest of the card: the tab showing. It scrolls on its own, each section's heading staying in view. -->
    <div class="body">
      {#if bodyTab === "details"}
        <div class="stack" id="member-panel" role="tabpanel" aria-labelledby="member-tab-details">
          {#if !gone}
            <div class="details ph-layer" class:out={ready} aria-hidden="true" onanimationend={() => (gone = true)}>
              {#each ["contact", "club"] as g (g)}
                <div class="group">
                  <i class="ph line"></i>
                  <div class="fields {g}">
                    {#each g === "contact" ? [1, 2, 3] : [1, 2, 3, 4, 5, 6] as n (n)}<i class="ph field-ph"></i>{/each}
                  </div>
                </div>
              {/each}
            </div>
          {/if}
          {#if ready}
            <!-- Two groups: how to reach them and what to call them, then their place in the club -->
            <div class="details in">
              <div class="group">
                <h3 class="eyebrow">Contact</h3>
                <div class="fields contact">
                  <label class="field">
                    Goes by
                    <input
                      class="input"
                      maxlength="40"
                      autocomplete="off"
                      placeholder={member.player.name}
                      bind:value={draft.webName}
                    />
                  </label>
                  <label class="field email">
                    Email (they sign in with it)
                    <input
                      class="input"
                      type="email"
                      autocomplete="off"
                      placeholder="None yet"
                      bind:value={draft.email}
                    />
                  </label>
                  <label class="field">
                    Phone
                    <input class="input" type="tel" autocomplete="off" bind:value={draft.phone} />
                  </label>
                </div>
              </div>
              <div class="group">
                <h3 class="eyebrow">In the club</h3>
                <div class="fields club">
                  <label class="field">
                    Role
                    <Select
                      id="member-role"
                      value={draft.role}
                      onchange={(v) => (draft.role = v)}
                      options={db.roles.map((r) => ({ value: r.name, label: r.name }))}
                    />
                  </label>
                  {#if draft.role !== "Member"}
                    <!-- An admin who runs the app as a member day to day (ADR 0024): what it opens as -->
                    <label class="field">
                      Opens as
                      <Select
                        id="member-everyday"
                        value={draft.everyday}
                        onchange={(v) => (draft.everyday = v)}
                        options={everydayOptions}
                      />
                    </label>
                  {/if}
                  {#if draft.position === "G"}
                    <div class="field">
                      Plan
                      <p class="hint keeper-plan">
                        Keeper: plays training free. Tournaments are charged as for anyone.
                      </p>
                    </div>
                  {:else}
                    <label class="field">
                      Plan
                      <Select
                        id="member-plan"
                        value={draft.plan === "Keeper" ? "Pay as you go" : draft.plan}
                        onchange={(v) => (draft.plan = v as typeof draft.plan)}
                        options={[
                          { value: "Pay as you go", label: "Pay as you go" },
                          { value: "Subscription", label: "Quarterly Member" },
                        ]}
                      />
                    </label>
                  {/if}
                  <label class="field">
                    Position
                    <Select
                      id="member-position"
                      value={draft.position}
                      onchange={(v) => (draft.position = v as Position)}
                      options={Object.entries(POSITIONS).map(([value, label]) => ({ value, label }))}
                    />
                  </label>
                  <label class="field">
                    Rating
                    <input
                      class="input num"
                      type="number"
                      min="0"
                      max="100"
                      step="1"
                      aria-invalid={!ratingOk}
                      bind:value={draft.rating}
                    />
                  </label>
                  <div class="field">
                    <span id="member-team">Cougars team</span>
                    <!-- On or off: a switch, with what it means beside it -->
                    <button
                      type="button"
                      class="switch"
                      role="switch"
                      aria-checked={draft.cougar}
                      aria-labelledby="member-team"
                      onclick={() => (draft.cougar = !draft.cougar)}
                    >
                      <span class="track" aria-hidden="true"></span>
                      <span>{draft.cougar ? "On the Cougars" : "Not on it"}</span>
                    </button>
                  </div>
                </div>
              </div>
              {#if member.player.id !== me().id}
                <!-- A member who asked the club by email to delete their account (#30): as if they'd done it -->
                <div class="group">
                  <h3 class="eyebrow">Their account</h3>
                  {#if saved.email}
                    <!-- Added quietly, or the first email went astray (#164): the same "You're in" email -->
                    <button class="btn ghost sm start" type="button" disabled={sendingLink} onclick={sendLink}
                      >Send them the app link</button
                    >
                  {/if}
                  <!-- A lost phone, a shared laptop: every browser and phone they're on is signed out (#72) -->
                  <button class="btn ghost sm start" type="button" disabled={signingOut} onclick={signOutEverywhere}
                    >Sign out everywhere</button
                  >
                  <!-- Their passkeys (ADR 0023): a line of what they have, kept in place so it never moves the rest -->
                  <p class="hint passkeys-line">{passkeysLine}</p>
                  {#if theirPasskeys?.length}
                    <button
                      class="btn ghost sm start"
                      type="button"
                      disabled={removingPasskeys}
                      onclick={removePasskeys}>Remove their passkeys</button
                    >
                  {/if}
                  <button
                    class="btn ghost sm danger"
                    type="button"
                    aria-haspopup="dialog"
                    onclick={() => (erasing = true)}>Delete their account</button
                  >
                  <Sheet bind:open={erasing} title="Delete {shortName(member.player)}'s account?">
                    <p class="erase-note">
                      Only when they've asked. Their name, email, phone and roles go now, and they're signed out
                      everywhere. What the club must keep (that someone played, payments) stays, about a "Former
                      member".
                    </p>
                    {#snippet footer()}
                      <button class="btn ghost" type="button" onclick={() => (erasing = false)}>Keep it</button>
                      <button class="btn delete" type="button" disabled={busy} onclick={erase}>Delete it</button>
                    {/snippet}
                  </Sheet>
                </div>
              {/if}
            </div>
          {/if}
        </div>
      {:else}
        <div class="stack">
          {#if !gone}
            <div class="ph-layer" class:out={ready} aria-hidden="true" onanimationend={() => (gone = true)}>
              <section><i class="ph line"></i><i class="ph block"></i></section>
              <section><i class="ph line"></i><i class="ph rows"></i></section>
            </div>
          {/if}
          {#if ready}
            <div>
              {#if bodyTab === "attendance"}
                <div class="part in" id="member-panel" role="tabpanel" aria-labelledby="member-tab-attendance">
                  <div class="head-row pinned">
                    <h2>Attendance</h2>
                    <span class="steps" role="group" aria-label="Quarter">
                      <button
                        class="btn ghost icon"
                        aria-label="Quarter before"
                        disabled={quarter <= firstQuarter}
                        onclick={() => quarter--}
                      >
                        <Icon name="chevronLeft" size={18} />
                      </button>
                      <span class="step-label num" aria-live="polite">{quarterLabel}</span>
                      <button
                        class="btn ghost icon"
                        aria-label="Quarter after"
                        disabled={quarter >= thisQuarter}
                        onclick={() => quarter++}
                      >
                        <Icon name="chevronRight" size={18} />
                      </button>
                    </span>
                  </div>
                  <p class="legend hint">
                    <span><i class="dot came"></i>Came {inQuarter.filter(came).length}</span>
                    <span
                      ><i class="dot noshow"></i>No-show {inQuarter.filter((r) => r.signup === "in" && !came(r))
                        .length}</span
                    >
                    <span><i class="dot"></i>Not there</span>
                    <span>Played {member.player.played ?? 0} in all</span>
                    <span class="tap">Open till 6am the morning after</span>
                  </p>
                  <!-- The quarter as a calendar: a row per month, its trainings across it week by week -->
                  <div class="months">
                    {#each months as [month, days] (month)}
                      <span class="month">{month}</span>
                      <div class="weeks">
                        {#if attendance === null}
                          <span class="hint">Loading…</span>
                        {/if}
                        {#each days as r (r.sessionId)}
                          {@const o = outcome(r)}
                          <button
                            class="day {o.kind}"
                            class:closed={closed(r)}
                            disabled={r.cancelled}
                            aria-disabled={closed(r) || undefined}
                            title="{r.series}, {formatDayDate(londonISO(r.heldOn, '12:00'))}: {o.label}{closed(r)
                              ? ' (the register closed)'
                              : ''}"
                            aria-label="{r.series}, {formatDayDate(londonISO(r.heldOn, '12:00'))}: {o.label}{closed(r)
                              ? ' (the register closed)'
                              : ''}"
                            onclick={() => toggleCame(r)}
                          >
                            <span class="d num">{Number(r.heldOn.slice(8))}</span>
                          </button>
                        {:else}
                          {#if attendance !== null}<span class="hint">No trainings</span>{/if}
                        {/each}
                      </div>
                    {/each}
                  </div>
                </div>
              {:else}
                <div
                  class="part in"
                  id="member-panel"
                  role="tabpanel"
                  aria-labelledby="member-tab-dues"
                  style:--below="{moneyHeight}px"
                >
                  <!-- What they owe, what they've paid, and the jobs, pinned; then the ledger, its header pinned under them -->
                  <div class="money" bind:clientHeight={moneyHeight}>
                    <div class="stat">
                      <span class="eyebrow">Owes</span>
                      <span class="value num" class:owes={owed > 0}>{pounds(owed)}</span>
                    </div>
                    <div class="stat">
                      <span class="eyebrow">Paid</span>
                      <span class="value num">{pounds(paidTotal)}</span>
                    </div>
                    <div class="stat">
                      <span class="eyebrow">Credit</span>
                      <span class="value num">{pounds(credit)}</span>
                    </div>
                    {#if recordsPayments}
                      <span class="buttons">
                        <button class="btn sm primary" aria-haspopup="dialog" onclick={startPayment}>
                          <Icon name="pound" size={16} />Record a payment
                        </button>
                        <button class="btn sm" aria-haspopup="dialog" onclick={startAdjust}>
                          <Icon name="settings" size={16} />Adjust
                        </button>
                        <button class="btn sm" aria-haspopup="dialog" onclick={startCharge}>
                          <Icon name="plus" size={16} />Charge a quarter
                        </button>
                        <button
                          class="btn sm"
                          aria-haspopup="dialog"
                          disabled={owed <= 0}
                          title="See it first, then send: at most one a week"
                          onclick={() => (reminding = true)}
                        >
                          <Icon name="mail" size={16} />Email what they owe
                        </button>
                        <button
                          class="btn sm ghost"
                          title="Work their dues out again from who came and the fees as they are now"
                          onclick={() => recalculateDues(memberId)}
                        >
                          <Icon name="undo" size={16} />Recalculate
                        </button>
                      </span>
                    {/if}
                  </div>
                  <Ledger {memberId} editable={recordsPayments} />
                </div>
              {/if}
              {#if seesDues}
                <!-- Short forms that never grow: a bottom sheet (a centred one on desktop), not a side drawer -->
                <Sheet bind:open={charging} title="Charge {shortName(member.player)} a quarter">
                  <form class="form" onsubmit={addQuarter}>
                    <div class="field">
                      Quarter
                      <Select
                        id="charge-quarter"
                        aria-label="Quarter"
                        bind:value={chargeWhich}
                        options={chargeOptions}
                      />
                    </div>
                    <label class="field">
                      Amount
                      <MoneyField id="charge-amount" required bind:value={chargeAmount} />
                    </label>
                    <p class="hint">
                      Due from the quarter's first day. Quarterly Members are charged each quarter on their own; this is
                      for anyone else, or a quarter they missed.
                    </p>
                    <button class="btn primary">Charge</button>
                  </form>
                </Sheet>
                <Sheet bind:open={adjusting} title="Adjust {shortName(member.player)}'s dues">
                  <form class="form" onsubmit={addAdjust}>
                    <div class="field">
                      <span id="adjust-way">What it does</span>
                      <span class="seg block" role="group" aria-labelledby="adjust-way">
                        <button type="button" aria-pressed={adjustWay === "less"} onclick={() => (adjustWay = "less")}
                          ><Icon name="minus" size={18} />Take off what they owe</button
                        >
                        <button type="button" aria-pressed={adjustWay === "more"} onclick={() => (adjustWay = "more")}
                          ><Icon name="plus" size={18} />Add to what they owe</button
                        >
                      </span>
                    </div>
                    <div class="pay-row">
                      <label class="field">
                        Amount
                        <MoneyField id="adjust-amount" required bind:value={adjustAmount} />
                      </label>
                      <div class="field">
                        <span>On</span>
                        <DateField id="adjust-on" aria-label="On" max={londonToday()} required bind:value={adjustOn} />
                      </div>
                    </div>
                    <label class="field">
                      Why
                      <input
                        class="input"
                        maxlength="120"
                        required
                        placeholder="e.g. Reffed the Kumite"
                        bind:value={adjustReason}
                      />
                    </label>
                    <p class="hint">
                      It's a line on their ledger, with why, and it's on the record.
                      {#if adjustWay === "less"}It pays what they owe oldest first, like money in.{/if}
                    </p>
                    <button class="btn primary">Adjust</button>
                  </form>
                </Sheet>
                <!-- Their reminder (ADR 0007), seen before it goes -->
                <Sheet bind:open={reminding} title="Email {shortName(member.player)} what they owe">
                  {#if reminding}<RemindReview {memberId} onsent={() => (reminding = false)} />{/if}
                </Sheet>
                <Sheet bind:open={paying} title="Payment from {shortName(member.player)}">
                  <form class="form" onsubmit={addPayment}>
                    <div class="pay-row">
                      <label class="field">
                        Amount
                        <MoneyField id="pay-amount" required bind:value={payAmount} />
                      </label>
                      <div class="field">
                        <span id="pay-on">Paid on</span>
                        <DateField
                          id="pay-on-day"
                          aria-label="Paid on"
                          max={londonToday()}
                          required
                          bind:value={payOn}
                        />
                      </div>
                    </div>
                    <div class="field">
                      How
                      <span class="seg block" role="group" aria-label="How they paid">
                        <button type="button" aria-pressed={payVia === "transfer"} onclick={() => (payVia = "transfer")}
                          ><Icon name="bank" size={18} />Transfer</button
                        >
                        <button type="button" aria-pressed={payVia === "cash"} onclick={() => (payVia = "cash")}
                          ><Icon name="pound" size={18} />Cash</button
                        >
                      </span>
                    </div>
                    <p class="hint">
                      It pays what they owe oldest first. Anything over is kept as credit and pays their next charge.
                      {#if owed}They owe {pounds(owed)}.{/if}
                    </p>
                    <button class="btn primary">Record payment</button>
                  </form>
                </Sheet>
              {/if}
            </div>
          {/if}
        </div>
      {/if}
    </div>

    <!-- Always at the bottom: Save and Discard for their details; closing with changes asks here -->
    <footer class="panel-foot">
      <SaveBar
        {edits}
        onsave={saveIt}
        ready={ratingOk && !!tidyName(draft.name)}
        problem={ratingOk ? "" : "A rating is a whole number, 0 to 100"}
        start={changed ? undo : undefined}
      />
    </footer>
    {#snippet undo()}
      <button class="btn ghost" disabled={busy} onclick={discard}>Undo changes</button>
    {/snippet}
  </div>
</div>

<style>
  /* The space the page has: beside the dock, under the top bar. A phone gives it the whole screen. */
  .sheet-layer {
    position: fixed;
    inset: 0;
    z-index: 80;
  }
  .scrim {
    position: absolute;
    inset: 0;
    border: 0;
    padding: 0;
    background: color-mix(in srgb, var(--bg) 70%, transparent);
    backdrop-filter: blur(4px);
    -webkit-backdrop-filter: blur(4px);
    animation: fade-in 260ms var(--ease) both;
  }
  .closing .scrim {
    animation: fade-out 300ms 80ms var(--ease) both;
  }
  @keyframes fade-in {
    from {
      opacity: 0;
    }
  }
  @keyframes fade-out {
    to {
      opacity: 0;
    }
  }
  .turning {
    position: fixed;
    z-index: 2;
    pointer-events: none;
  }
  .turning :global(.slot) {
    height: 100%;
  }
  .panel {
    position: absolute;
    inset: 4.5rem var(--s-6) var(--s-6) 6.25rem;
    /* In the page's column when there is one: its left edge and width */
    left: var(--col-left, 6.25rem);
    right: auto;
    width: var(--col-width, calc(100% - 6.25rem - var(--s-6)));
    display: flex;
    flex-direction: column;
    overflow: hidden;
    border: 1px solid var(--border);
    border-radius: var(--r-xl);
    background: var(--surface-1);
    box-shadow: 0 30px 80px -30px rgb(0 0 0 / 0.8);
    transform-origin: 50% 40%;
    outline: none;
  }
  @media (max-width: 900px) {
    .panel {
      inset: 0;
      width: auto;
      border: 0;
      border-radius: 0;
    }
  }

  /* Header: the player. Who they are with the close button top right, then their details in one aligned row. */
  .panel-head {
    display: grid;
    gap: var(--s-4);
    padding: var(--s-5) var(--s-5) var(--s-4) var(--s-6);
    border-bottom: 1px solid var(--border);
  }
  .who {
    display: flex;
    align-items: center;
    gap: var(--s-4);
  }
  .titles {
    flex: 1;
    min-width: 0;
  }
  .close {
    align-self: flex-start;
  }
  .eyebrow .badge {
    margin-left: var(--s-1);
    letter-spacing: normal;
    text-transform: none;
  }
  .name-line {
    margin: var(--s-1) 0 0;
    color: var(--fg);
    font-family: var(--font-display);
    font-size: clamp(1.6rem, 3vw, 2.1rem);
    font-style: italic;
    font-weight: 400;
    line-height: 1.05;
    text-transform: uppercase;
  }
  .sub {
    margin-top: var(--s-1);
    overflow: hidden;
    color: var(--fg-muted);
    font-size: var(--text-sm);
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  /* Every field the same height, labels on one line: one row when there's room, two when not, one on a phone */
  /* The name as a heading until you go to change it */
  .name-edit {
    width: 100%;
    margin: 0 0 0 -0.35rem;
    padding: 0 0.35rem;
    border: 0;
    border-radius: var(--r-sm);
    background: transparent;
    color: inherit;
    font: inherit;
    letter-spacing: inherit;
    text-transform: inherit;
  }
  .name-edit:hover {
    background: color-mix(in srgb, var(--fg) 6%, transparent);
  }
  .name-edit:focus {
    outline: none;
    background: var(--field-bg);
    box-shadow: var(--field-edge);
  }
  /* Details: two groups, each a grid of same-height fields that wraps to fit; one column on a phone */
  .details {
    display: grid;
    gap: var(--s-6);
  }
  .group {
    display: grid;
    gap: var(--s-3);
  }
  .passkeys-line {
    min-height: 1.45em;
    margin: 0;
    font-size: var(--text-sm);
  }
  .fields {
    display: grid;
    gap: var(--s-4);
    align-items: start;
  }
  .fields.contact {
    grid-template-columns: minmax(0, 1fr) minmax(0, 1.5fr) minmax(0, 1fr);
  }
  .fields.club {
    grid-template-columns: repeat(3, minmax(0, 1fr));
  }
  @container (max-width: 52rem) {
    .fields.contact,
    .fields.club {
      grid-template-columns: repeat(2, minmax(0, 1fr));
    }
    .fields.contact .email {
      grid-column: 1 / -1;
      grid-row: 1;
    }
  }
  @container (max-width: 28rem) {
    .fields.contact,
    .fields.club {
      grid-template-columns: minmax(0, 1fr);
    }
  }
  @media (max-width: 600px) {
    .panel-head {
      padding: var(--s-4);
    }
    .avatar.big {
      display: none;
    }
  }

  .body {
    flex: 1;
    min-height: 0;
    padding: 0 var(--s-6) var(--s-6);
    overflow-y: auto;
    overscroll-behavior: contain;
    container-type: inline-size;
  }
  /* Details: their fields, from the top of the body */
  .body > .stack[role="tabpanel"] {
    padding-top: var(--s-5);
  }
  /* Save and Discard, along the bottom; on a phone, where the whole card scrolls, it stays there */
  .panel-foot {
    position: sticky;
    bottom: 0;
    z-index: 2;
    display: flex;
    align-items: center;
    justify-content: flex-end;
    gap: var(--s-2);
    padding: var(--s-3) var(--s-5);
    padding-bottom: max(var(--s-3), env(safe-area-inset-bottom));
    border-top: 1px solid var(--border);
    background: var(--surface-1);
  }
  @media (max-width: 600px) {
    .body {
      padding: 0 var(--s-4) var(--s-6);
    }
  }
  /* Sections divided by a rule, not boxed; the tab showing is one too */
  section,
  .part {
    display: grid;
    grid-template-columns: minmax(0, 1fr);
    gap: var(--s-3);
    align-content: start;
    padding-block: var(--s-5) var(--s-6);
  }
  section + section {
    border-top: 1px solid var(--border);
  }
  h2 {
    color: var(--fg);
    font-size: var(--text-md);
    font-weight: 600;
  }
  h3.eyebrow {
    margin-top: var(--s-2);
  }
  /* The real fields fade in exactly where they'll stay: the two groups in turn, or the tab showing */
  .details.in > *,
  .part.in {
    /* backwards, not both: a fill that outlives the fade keeps each field its own stacking context, and a later
       field would paint over an open Select menu */
    animation: field-in 320ms var(--ease) backwards;
  }
  .details.in > :nth-child(2) {
    animation-delay: 40ms;
  }
  .part.in {
    animation-delay: 140ms;
  }
  @keyframes field-in {
    from {
      opacity: 0;
    }
  }
  @media (prefers-reduced-motion: reduce) {
    .details.in > *,
    .part.in {
      animation: none;
    }
  }
  /* Placeholders and the real thing share one cell, so one can fade over the other */
  .stack {
    position: relative;
    display: grid;
  }
  .stack > * {
    grid-area: 1 / 1;
    min-width: 0;
  }
  .ph-layer {
    align-self: start;
    pointer-events: none;
  }
  /* Fading out, they no longer hold the space open, so the real fields set the size and nothing moves when they go */
  .ph-layer.out {
    position: absolute;
    inset: 0 0 auto;
    animation: fade-out 360ms 80ms var(--ease) both;
  }
  /* Placeholders: soft slabs where the fields will be */
  .ph {
    display: block;
    border-radius: var(--r-md);
    background: var(--surface-2);
  }
  .ph.line {
    width: 7rem;
    height: 1.1rem;
  }
  /* A label and a field: as tall as the real ones */
  .ph.field-ph {
    height: 4.375rem;
  }
  .ph.block {
    height: 11rem;
  }
  .ph.rows {
    height: 8rem;
  }
  .tab-owed {
    color: var(--red-hot);
  }
  /* Owes, paid and credit, big, with the jobs at the end of the row */
  .money {
    position: sticky;
    top: 0;
    z-index: 2;
    display: flex;
    flex-wrap: wrap;
    align-items: flex-end;
    gap: var(--s-4) var(--s-7);
    margin-top: calc(-1 * var(--s-5));
    padding-block: var(--s-5) var(--s-3);
    background: var(--surface-1);
  }
  .money .stat {
    display: grid;
    gap: var(--s-1);
  }
  .money .value {
    color: var(--fg);
    font-size: 1.6rem;
    font-weight: 600;
  }
  /* Record a payment: the amount and the day side by side, stacked on a phone */
  .pay-row {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(10rem, 1fr));
    gap: var(--s-4);
  }
  .money .value.owes {
    color: var(--red-hot);
  }
  .money .buttons {
    margin-left: auto;
  }
  .buttons {
    display: flex;
    flex-wrap: wrap;
    justify-content: flex-end;
    gap: var(--s-2);
  }
  /* A narrow phone: the quarter's arrows under the heading, rather than past the edge */
  .head-row {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    justify-content: space-between;
    gap: var(--s-1) var(--s-3);
  }
  /* A section's heading stays at the top of the body while its rows scroll under it */
  .head-row.pinned {
    position: sticky;
    top: var(--below, 0);
    z-index: 1;
    min-height: 2.75rem;
    margin-inline: calc(-1 * var(--s-2));
    padding: var(--s-2);
    background: var(--surface-1);
  }
  .steps {
    display: inline-flex;
    align-items: center;
    gap: var(--s-1);
  }
  /* Wide enough for any quarter, so the arrows never move */
  .step-label {
    min-width: 7.5rem;
    color: var(--fg);
    font-weight: 600;
    text-align: center;
  }
  .legend {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--s-2) var(--s-4);
  }
  .legend .tap {
    margin-left: auto;
  }
  .dot {
    display: inline-block;
    width: 0.6rem;
    height: 0.6rem;
    margin-right: var(--s-1);
    border-radius: 2px;
    background: color-mix(in srgb, var(--fg) 12%, transparent);
  }
  .dot.came {
    background: var(--green);
  }
  .dot.noshow {
    background: var(--red-hot);
  }
  /* The quarter as a calendar: month names down the side, a tile per training across, filled by what happened */
  .months {
    display: grid;
    grid-template-columns: 2.75rem 1fr;
    gap: var(--s-2) var(--s-3);
    align-items: center;
  }
  .month {
    color: var(--fg-muted);
    font-size: var(--text-xs);
    font-weight: 700;
    letter-spacing: 0.06em;
    text-transform: uppercase;
  }
  .weeks {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--s-2);
    min-height: 2.5rem;
  }
  .day {
    display: grid;
    place-items: center;
    width: 2.5rem;
    height: 2.5rem;
    padding: 0;
    border: 0;
    border-radius: var(--r-sm);
    background: color-mix(in srgb, var(--fg) 7%, transparent);
    color: var(--fg-muted);
    line-height: 1;
    transition: background-color var(--t-fast) var(--ease-in-out);
  }
  .day:hover:not(:disabled, .closed) {
    background: color-mix(in srgb, var(--fg) 14%, transparent);
  }
  .day .d {
    font-family: var(--font-display);
    font-size: var(--text-md);
  }
  .day.came {
    background: color-mix(in srgb, var(--green) 30%, transparent);
    color: var(--fg);
  }
  .day.noshow {
    background: color-mix(in srgb, var(--red) 30%, transparent);
    color: var(--fg);
  }
  /* Its register closed the morning after: shown as it was, not a tap */
  .day.closed {
    cursor: default;
  }
  .day.cancelled {
    opacity: 0.35;
    text-decoration: line-through;
  }
  /* Deleting their account: red words, and the one red fill is the tap that does it */
  .start,
  .danger {
    justify-self: start;
  }
  .danger {
    color: var(--red-hot);
  }
  .delete {
    background: var(--red);
    color: var(--on-red);
  }
  .delete:hover:not(:disabled) {
    background: var(--red-hot);
  }
  .erase-note {
    margin: 0;
  }
</style>
