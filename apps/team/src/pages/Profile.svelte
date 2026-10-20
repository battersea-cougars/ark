<script lang="ts">
  // Your profile. You change your phone, position and bio (the back of your player card), and how your name shows
  // on the website's roster; your name and email are an admin's to change, since sign-in and the roster go by them.
  // On a phone it's the last tab (You), one page for everything that isn't a tab: you first (your card, which opens
  // your account, then your details), then your dues and the club's pages, then every Settings page you can open.
  // The gear in the bar is the way into Settings, as beside a desktop's badge; in your everyday role it switches you
  // up on the way (lib/SettingsButton).
  import Icon from "../app/shell/Icon.svelte";
  import { goesBy, shortName } from "../lib/names";
  import { POSITIONS, POSITION_ICONS, emailFor, phoneFor, type Position } from "../demo/data";
  import { fullRole, impersonating, me, realGranted, session, setElevated, shownRoles } from "../demo/session.svelte";
  import { db } from "../demo/store.svelte";
  import Choice from "../lib/Choice.svelte";
  import { initials } from "../lib/initials";
  import { saveEverydayRole, saveProfile } from "../app/backend.svelte";
  import AccountMenu from "../app/shell/AccountMenu.svelte";
  import MoreLinks from "../lib/MoreLinks.svelte";
  import YourData from "../lib/YourData.svelte";
  import NotificationPrefs from "../lib/NotificationPrefs.svelte";
  import { phone } from "../lib/viewport.svelte";
  import PageHeader from "../lib/PageHeader.svelte";
  import { APP_BUILD, APP_VERSION } from "../app/build";
  import SettingsButton from "../lib/SettingsButton.svelte";

  const who = me();
  let form = $state({ phone: phoneFor(who.id) ?? "", position: who.position, bio: who.bio ?? "" });

  // The name you go by, in the app and on the website (ADR 0043): ready-made forms of your name, or a nickname. Saved as the text itself;
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
  const BIO_MAX = 160;

  // Your everyday role (ADR 0024): anyone with more than Member can open the app as a lesser role, so ratings and admin
  // screens stay hidden while they show someone the app; Settings (the gear) switches them up, and their card's or
  // badge's menu switches them back.
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
  function save(e: SubmitEvent) {
    e.preventDefault();
    saveProfile({ ...form, phone: form.phone.trim(), bio: form.bio.trim(), webName });
  }
</script>

<div class="page">
  {#if phone.current}
    <PageHeader title="Profile">
      {#snippet actions()}
        <SettingsButton />
      {/snippet}
    </PageHeader>
    <AccountMenu card />
  {:else}
    <header class="head">
      <span class="avatar big">{initials(goesBy(who))}</span>
      <div>
        <h1>{goesBy(who)}</h1>
        {#if goesBy(who) !== who.name}<p class="hint">{who.name}</p>{/if}
        <p class="roles">
          {#each shownRoles(who.id) as r (r)}<span class="badge" class:red={r === "Admin"}>{r}</span>{/each}
        </p>
      </div>
    </header>
  {/if}
  <form class="form" onsubmit={save}>
    <fieldset disabled={locked}>
      <label class="field">
        <span>Email <span class="hint">· ask an admin to change it</span></span>
        <input class="input" type="email" value={emailFor(who)} readonly />
      </label>
      <label class="field">Phone <input class="input" type="tel" maxlength="30" bind:value={form.phone} /></label>
      <div class="field">
        <span id="position">Position</span>
        <div class="seg block" role="group" aria-labelledby="position">
          {#each Object.entries(POSITIONS) as [v, label] (v)}
            <button type="button" aria-pressed={form.position === v} onclick={() => (form.position = v as Position)}>
              <Icon name={POSITION_ICONS[v as Position]} size={18} />{label}
            </button>
          {/each}
        </div>
      </div>
      <div class="field">
        <span id="web-name">The name you go by <span class="hint">· in the app, and on the website's roster</span></span
        >
        <div class="seg block wrap" role="group" aria-labelledby="web-name">
          {#each NAME_FORMS as f (f.id)}
            <button type="button" aria-pressed={nameForm === f.id} onclick={() => (nameForm = f.id)}>{f.label}</button>
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
      <button class="btn primary">Save</button>
    </fieldset>
    {#if locked}<p class="hint">Read-only while you're viewing as {shortName(who)}.</p>{/if}
  </form>

  {#if full !== "Member" && !locked}
    <section class="everyday">
      <h2 class="section-title">Everyday role</h2>
      <label class="field">
        The app opens as
        <Choice
          id="everyday-role"
          value={session.everyday === null ? "full" : String(session.everyday)}
          options={everydayOptions}
          onchange={setEveryday}
        />
      </label>
      <p class="hint">
        Handy when you show someone the app: ratings and {full} screens stay hidden. Settings (the gear, top right) switches
        you up until you switch back on your {phone.current ? "card" : "badge"} or close the app.
      </p>
    </section>
  {/if}

  <NotificationPrefs disabled={locked} />
  <YourData disabled={locked} />

  <!-- Then everything else: your dues, the club's pages, and Settings (the gear's way in, listed) -->
  {#if phone.current}<div class="links"><MoreLinks except="profile" /></div>{/if}

  <!-- Which build you're on (ADR 0104): the version for people, the build for finding the exact code -->
  <p class="version hint num">Cougars Fresh Meat {APP_VERSION} · {APP_BUILD}</p>
</div>

<style>
  /* The lists, after your details */
  .links {
    display: grid;
    gap: var(--s-3);
    margin-top: var(--s-4);
  }
  /* Your name on the website: four choices, one of them your full name, so they wrap on a phone */
  .seg.wrap > button {
    flex: 1 1 auto;
  }
  .head {
    display: flex;
    align-items: center;
    gap: var(--s-4);
  }
  /* Your name in the display face, as the member editor and the back of your card show it */
  h1 {
    font-family: var(--font-display);
    font-size: clamp(1.6rem, 3vw, 2.1rem);
    font-style: italic;
    font-weight: 400;
    letter-spacing: 0.01em;
    line-height: 1.05;
    text-transform: uppercase;
  }
  .roles {
    display: flex;
    gap: var(--s-1);
    margin-top: var(--s-2);
  }
  .everyday {
    display: grid;
    gap: var(--s-3);
  }
  .everyday .section-title {
    margin: var(--s-4) 0 0;
  }
  .version {
    margin: var(--s-6) 0 0;
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
