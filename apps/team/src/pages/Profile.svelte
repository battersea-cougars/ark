<script lang="ts">
  // You (ADR 0022): only your own things. Your card on top (photo, name, position, roles, and what you owe), then three
  // tabs, so a phone isn't one long scroll (#202): Details (phone, position, the name you go by, bio: one form, its Save
  // pinned at the foot of the screen, ADR 0065), Account (the role switch and your everyday role, your sign-in email
  // and passkeys, your data, sign out) and Alerts (notifications). Account and Alerts save as you tap. Your name is an
  // admin's to change, since the roster goes by it. The phone's last tab and a desktop's avatar, top right, open it.
  // Settings is the gear, in this page's bar on a phone (lib/SettingsButton) and at the foot of a desktop's dock.
  import Icon from "../app/shell/Icon.svelte";
  import { goesBy, shortName } from "../lib/names";
  import { POSITIONS, POSITION_ICONS, emailFor, phoneFor, type Position } from "../demo/data";
  import { fullRole, impersonating, me, realGranted, session, setElevated, shownRoles } from "../demo/session.svelte";
  import { owedBy } from "../demo/dues.svelte";
  import { pounds } from "../lib/dates";
  import { api } from "../app/api";
  import { db } from "../demo/store.svelte";
  import Choice from "../lib/Choice.svelte";
  import Avatar from "../lib/Avatar.svelte";
  import { shrinkPhoto } from "../lib/photo";
  import { saveEverydayRole, savePhoto, saveProfile } from "../app/backend.svelte";
  import RoleSwitch from "../lib/RoleSwitch.svelte";
  import YourData from "../lib/YourData.svelte";
  import ChangeEmail from "../lib/ChangeEmail.svelte";
  import NotificationPrefs from "../lib/NotificationPrefs.svelte";
  import Passkeys from "../lib/Passkeys.svelte";
  import { phone } from "../lib/viewport.svelte";
  import PageHeader from "../lib/PageHeader.svelte";
  import { APP_BUILD, APP_VERSION } from "../app/build";
  import SettingsButton from "../lib/SettingsButton.svelte";
  import { Edits } from "../lib/dirty.svelte";
  import SaveBar from "../lib/SaveBar.svelte";

  const who = me();
  let form = $state({ phone: phoneFor(who.id) ?? "", position: who.position, bio: who.bio ?? "" });

  // The name you go by, in the app and on the website (apps/team/worker/members/README.md): ready-made forms of your name, or a nickname. Saved as the text itself;
  // the default (first name and initial) is saved as nothing, so it follows a change to your name.
  const [firstName, ...rest] = who.name.trim().split(/\s+/);
  const lastName = rest.at(-1);
  const NAME_FORMS = [
    { id: "initial", label: lastName ? `${firstName} ${lastName[0].toUpperCase()}.` : firstName },
    ...(lastName ? [{ id: "full", label: who.name.trim() }] : []),
    ...(lastName ? [{ id: "first", label: firstName }] : []),
    { id: "nickname", label: "A nickname" },
  ];
  const saved = who.webName?.trim() || "";
  const savedForm = !saved
    ? "initial"
    : (NAME_FORMS.find((f) => f.id !== "nickname" && f.label === saved)?.id ?? "nickname");
  let nameForm = $state(savedForm);
  let nickname = $state(savedForm === "nickname" ? saved : "");
  const webName = $derived(
    nameForm === "initial"
      ? ""
      : nameForm === "nickname"
        ? nickname.trim()
        : (NAME_FORMS.find((f) => f.id === nameForm)?.label ?? ""),
  );
  const locked = impersonating();
  // Your details' unsaved changes: Save lights up, and leaving the page asks first (lib/dirty.svelte.ts)
  const edits = new Edits();
  edits.watch(() => ({ form, nameForm, nickname }));
  const BIO_MAX = 160;

  // The page's tabs: Details first, since it's the one with something to type
  const TABS = [
    { id: "details", label: "Details" },
    { id: "account", label: "Account" },
    { id: "alerts", label: "Alerts" },
  ] as const;
  type Tab = (typeof TABS)[number]["id"];
  // The address says which (/me#account, /me#alerts), so a link or a reload lands on it; Details has none
  const fromHash = (): Tab => TABS.find((t) => `#${t.id}` === location.hash)?.id ?? "details";
  let tab = $state<Tab>(fromHash());
  function show(t: Tab) {
    tab = t;
    history.replaceState(history.state, "", t === "details" ? location.pathname : `#${t}`);
  }
  $effect(() => {
    const follow = () => (tab = fromHash());
    addEventListener("hashchange", follow);
    return () => removeEventListener("hashchange", follow);
  });

  // Your everyday role (ADR 0024): anyone with more than Member can open the app as a lesser role, so ratings and admin
  // screens stay hidden while they show someone the app. The switch under your card (and at the top of Settings) goes
  // between the two; the gear switches you up on the way into Settings.
  // The choices are roles that can do less than you can.
  const full = fullRole();
  const mine = realGranted();
  const everydayOptions = $derived([
    { value: "full", label: `${full} (everything you can do)` },
    ...db.roles
      .filter((r) => r.name !== full && (mine.has("manage:all") || r.actions.every((a) => mine.has(a))))
      .map((r) => ({ value: String(r.id), label: r.name })),
  ]);
  function setEveryday(value: string) {
    const id = value === "full" ? null : Number(value);
    session.everyday = id;
    setElevated(false);
    saveEverydayRole(id);
  }
  const owed = $derived(owedBy(who.id));

  // Your photo (apps/team/worker/members/README.md): from the phone's camera or its photos (a plain file picker offers both), shrunk here to a
  // small square and saved at once, apart from the details' Save. It's in the club's copy, so it shows everywhere.
  const hasPhoto = $derived(!!db.members.find((m) => m.player.id === who.id)?.player.photoAt);
  let photoFile = $state<HTMLInputElement | undefined>();
  let photoBusy = $state(false);
  let photoError = $state("");
  async function pickPhoto(input: HTMLInputElement) {
    const f = input.files?.[0];
    input.value = "";
    photoError = "";
    if (!f) return;
    photoBusy = true;
    try {
      await savePhoto(await shrinkPhoto(f));
    } catch {
      photoError = "That picture couldn't be read. Try a JPEG or PNG.";
    } finally {
      photoBusy = false;
    }
  }
  async function removePhoto() {
    photoBusy = true;
    await savePhoto(null);
    photoBusy = false;
  }
  // Off this device, or every browser and phone you're signed in on (#72); the app reloads to the sign-in screen
  async function signOut(everywhere = false) {
    // Offline or already signed out: the reload shows which
    await api("POST", everywhere ? "/api/auth/sign-out-everywhere" : "/api/auth/sign-out").catch(() => {});
    location.replace("/");
  }
  function save(e: SubmitEvent) {
    e.preventDefault();
    edits.run(() =>
      saveProfile({
        ...form,
        phone: form.phone.trim(),
        bio: form.bio.trim(),
        webName,
      }),
    );
  }
</script>

<div class="page you" class:docked={tab === "details" && !locked}>
  <!-- A phone's gear: top right in this page's bar (a desktop's sits beside your avatar, Shell) -->
  {#snippet gear()}<SettingsButton />{/snippet}
  <PageHeader title="You" actions={phone.current ? gear : undefined} />
  <!-- Your card: who you are, plain words; your photo is a button that changes it -->
  <header class="card">
    {#if locked}
      <Avatar player={who} big />
    {:else}
      <button
        type="button"
        class="photo-btn"
        aria-label={hasPhoto ? "Change your photo" : "Add a photo"}
        disabled={photoBusy}
        onclick={() => photoFile?.click()}
      >
        <Avatar player={who} big />
        <span class="photo-badge" aria-hidden="true"><Icon name={hasPhoto ? "refresh" : "plus"} size={12} /></span>
      </button>
    {/if}
    <div class="who">
      <p class="name">{goesBy(who)}</p>
      <p class="hint">{POSITIONS[who.position]} · {shownRoles(who.id).join(" · ")}</p>
      <!-- What you owe, on every tab: the dues page is one tap away -->
      <a class="dues" class:owing={owed > 0} href="/me/tab"
        >{owed > 0 ? `You owe ${pounds(owed)}` : "All paid up"}<span class="hint"> · Your dues</span><Icon
          name="chevronRight"
          size={14}
        /></a
      >
      {#if !locked}
        <div class="photo-run">
          <button type="button" class="btn sm outline" disabled={photoBusy} onclick={() => photoFile?.click()}
            >{photoBusy ? "Saving…" : hasPhoto ? "Change photo" : "Add a photo"}</button
          >
          {#if hasPhoto}
            <button type="button" class="btn sm ghost" disabled={photoBusy} onclick={removePhoto}>Remove</button>
          {/if}
        </div>
      {/if}
    </div>
    <!-- No `capture`: a phone offers the camera, its photos or its files -->
    <input
      class="photo-file"
      type="file"
      accept="image/*"
      bind:this={photoFile}
      onchange={(e) => pickPhoto(e.currentTarget)}
    />
  </header>
  {#if photoError}<p class="error small">{photoError}</p>{/if}

  <div class="tablist" role="tablist" aria-label="You">
    {#each TABS as t (t.id)}
      <button
        type="button"
        role="tab"
        id="you-tab-{t.id}"
        aria-selected={tab === t.id}
        aria-controls="you-panel"
        onclick={() => show(t.id)}
      >
        {t.label}{#if t.id === "details" && edits.dirty && tab !== "details"}<span
            class="dirty-dot"
            aria-label="unsaved changes"
          ></span>{/if}
      </button>
    {/each}
  </div>

  <div class="tab-body" id="you-panel" role="tabpanel" aria-labelledby="you-tab-{tab}">
    {#if tab === "details"}
      <form id="you-form" class="form" onsubmit={save}>
        <fieldset disabled={locked}>
          <label class="field">Phone <input class="input" type="tel" maxlength="30" bind:value={form.phone} /></label>
          <div class="field">
            <span id="position">Position</span>
            <div class="seg block" role="group" aria-labelledby="position">
              {#each Object.entries(POSITIONS) as [v, label] (v)}
                <button
                  type="button"
                  aria-pressed={form.position === v}
                  onclick={() => (form.position = v as Position)}
                >
                  <Icon name={POSITION_ICONS[v as Position]} size={18} />{label}
                </button>
              {/each}
            </div>
          </div>
          <div class="field">
            <span id="web-name">The name you go by <span class="hint">· in the app and on the website</span></span>
            <div class="seg block names" role="group" aria-labelledby="web-name">
              {#each NAME_FORMS as f (f.id)}
                <button type="button" aria-pressed={nameForm === f.id} onclick={() => (nameForm = f.id)}
                  >{f.label}</button
                >
              {/each}
            </div>
            {#if nameForm === "nickname"}
              <input
                class="input"
                maxlength="40"
                placeholder="e.g. The Wall"
                aria-label="Nickname"
                bind:value={nickname}
                required
              />
            {/if}
          </div>
          <label class="field">
            <span>Bio <span class="hint">· on the back of your player card</span></span>
            <textarea
              class="input"
              rows="3"
              maxlength={BIO_MAX}
              placeholder="Shoots left. Blames the wheels."
              bind:value={form.bio}></textarea>
          </label>
        </fieldset>
        {#if locked}
          <p class="hint">Read-only while you're viewing as {shortName(who)}.</p>
        {:else}
          <!-- A page's Save: pinned at the foot of the screen, above a phone's tabs, so it's always in reach (ADR 0065) -->
          <div class="save-dock" class:phone={phone.current}><SaveBar {edits} form="you-form" /></div>
        {/if}
      </form>
    {:else if tab === "account"}
      {#if !locked}<RoleSwitch />{/if}
      {#if full !== "Member" && !locked}
        <!-- Which of your roles the app opens as; the switch above goes between it and your full role -->
        <label class="field">
          The app opens as
          <Choice
            id="everyday-role"
            value={session.everyday === null ? "full" : String(session.everyday)}
            options={everydayOptions}
            onchange={setEveryday}
          />
          <span class="hint">Handy when you show someone the app: ratings and {full} screens stay hidden.</span>
        </label>
      {/if}

      <section class="signing-in" aria-labelledby="signing-in-title">
        <h2 class="section-title" id="signing-in-title">Signing in</h2>
        <div class="list"><ChangeEmail email={emailFor(who)} disabled={locked} /></div>
      </section>

      <!-- Your passkeys (ADR 0023): only your own, so not while you're viewing as someone -->
      {#if !locked}<Passkeys />{/if}

      <YourData disabled={locked}>
        <button class="row" type="button" disabled={locked} onclick={() => signOut()}>
          <span class="glyph"><Icon name="signOut" /></span>
          <span class="grow"><span class="title">Sign out</span><span class="sub">Of this device</span></span>
        </button>
        <button class="row" type="button" disabled={locked} onclick={() => signOut(true)}>
          <span class="glyph"><Icon name="signOut" /></span>
          <span class="grow"
            ><span class="title">Sign out everywhere</span><span class="sub">Every browser and phone, this one too</span
            ></span
          >
        </button>
      </YourData>

      <!-- Which build you're on (ADR 0022): the version for people, the build for finding the exact code -->
      <p class="version hint num">Cougars Fresh Meat {APP_VERSION} · {APP_BUILD}</p>
    {:else}
      <NotificationPrefs disabled={locked} />
    {/if}
  </div>
</div>

<style>
  /* Your name in the display face, as the member editor and the back of your card show it */
  .card {
    display: flex;
    align-items: center;
    gap: var(--s-4);
  }
  .who {
    display: grid;
    gap: var(--s-1);
    min-width: 0;
  }
  /* Your photo, as a button: a small badge in its corner says it changes */
  .photo-btn {
    position: relative;
    flex-shrink: 0;
    padding: 0;
    border: 0;
    border-radius: 50%;
    background: none;
    cursor: pointer;
  }
  .photo-badge {
    position: absolute;
    right: -2px;
    bottom: -2px;
    display: grid;
    place-items: center;
    width: 1.35rem;
    height: 1.35rem;
    border-radius: 50%;
    background: var(--surface-2);
    color: var(--fg);
    box-shadow: 0 0 0 2px var(--bg);
  }
  .photo-run {
    display: flex;
    flex-wrap: wrap;
    gap: var(--s-2);
    margin-top: var(--s-1);
  }
  .photo-file {
    display: none;
  }
  .error {
    margin: 0;
    color: var(--red-hot);
  }
  .who p {
    margin: 0;
  }
  .name {
    color: var(--fg);
    font-family: var(--font-display);
    font-size: clamp(1.6rem, 3vw, 2.1rem);
    font-style: italic;
    font-weight: 400;
    letter-spacing: 0.01em;
    line-height: 1.05;
    text-transform: uppercase;
  }
  /* One line: switching role swaps the words, and nothing under them may move */
  .who .hint {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  /* What you owe, under your roles: green when you're square, your own words when you're not */
  .dues {
    display: inline-flex;
    align-items: center;
    gap: var(--s-1);
    width: fit-content;
    color: var(--green-ink);
    font-size: var(--text-sm);
    text-decoration: none;
  }
  .dues.owing {
    color: var(--caution-ink);
  }
  .dues .hint {
    color: var(--fg-muted);
  }
  /* The tabs sit on a hairline, the page's sections under them */
  .tablist {
    margin-top: var(--s-2);
    border-bottom: 1px solid var(--border);
  }
  .dirty-dot {
    width: 0.45rem;
    height: 0.45rem;
    border-radius: 50%;
    background: var(--action);
  }
  /* With the Save dock: the page is at least the screen's height, the form stretching to it, so the dock sits at the
     foot of the screen even when the form is short, and the page's own bottom margin goes under the dock instead */
  .you.docked {
    display: flex;
    flex-direction: column;
    min-height: calc(100dvh - var(--chrome-h, 0px) - var(--tab-h));
    padding-bottom: 0;
  }
  /* A desktop has no tabs at the foot */
  @media (min-width: 901px) {
    .you.docked {
      min-height: calc(100dvh - var(--chrome-h, 0px));
    }
  }
  .docked .tab-body,
  .docked #you-form {
    display: flex;
    flex: 1;
    flex-direction: column;
    gap: var(--s-4);
  }
  .docked .save-dock {
    margin-top: auto;
  }
  .tab-body {
    display: grid;
    gap: var(--s-4);
    align-content: start;
  }
  .section-title {
    margin: var(--s-2) 0 var(--s-2);
  }
  /* A page's Save (ADR 0065): it sticks to the foot of the screen while the form runs on under it. Solid, like the
     tabs it sits on. On a phone it runs edge to edge, just above them (the page scrolls above the tabs). */
  .save-dock {
    position: sticky;
    bottom: 0;
    z-index: 3;
    display: flex;
    padding: var(--s-3) 0;
    border-top: 1px solid var(--border);
    background: var(--bg);
  }
  .save-dock.phone {
    margin-inline: calc(-1 * var(--gutter));
    padding-inline: var(--gutter);
  }
  /* A toast shows over the dock, not under it (app/shell/Shell.svelte) */
  :global(:root:has(.save-dock.phone)) {
    --above-tabs: 4.25rem;
  }
  .sub {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .row:disabled {
    cursor: default;
    opacity: 0.55;
  }
  /* Your name on the website: four choices, one of them your full name, so they wrap on a phone */
  .seg.names > button {
    flex: 1 1 auto;
  }
  .version {
    margin: var(--s-2) 0 0;
    font-size: var(--text-xs);
    text-align: center;
  }
  fieldset {
    display: grid;
    gap: var(--s-4);
    margin: 0;
    padding: 0;
    border: 0;
  }
</style>
