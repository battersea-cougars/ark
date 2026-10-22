<script lang="ts">
  // The team app's privacy notice (#30, ADR 0029): what the app holds about members, who sees it, how long it's kept,
  // and how to get it or delete it. The website's /privacy covers the website only. Shown on the sign-in screen
  // (anyone, before they sign in) and at /privacy in the app. Every line describes something the code does: change it
  // with the behaviour (worker/settings/retention.ts, members/members.erase.ts, ADR 0106 for backups). The club's
  // address isn't kept in the code: the website's privacy page shows it, from the Studio.
  const CLUB_CONTACT = "https://batterseacougars.com/privacy/";
</script>

<div class="notice">
  <h2>Who we are</h2>
  <p>
    Battersea Cougars Inline Hockey Club. This app is how members sign up for training and tournaments, and how the club
    runs them and keeps track of fees. Questions about your details go to the club: its email address is on the
    <a href={CLUB_CONTACT} target="_blank" rel="noopener">website's privacy page</a>.
  </p>

  <h2>What the app holds about you</h2>
  <p>
    Your name and the name you go by, your email address (to sign in), your phone number if you give it, your position
    and the bio on your player card; which sessions, tournaments and events you signed up for and played; what you owe
    and have paid, and the reference your bank transfers use; and information the club's organisers keep to help pick
    teams, which other members don't see.
  </p>

  <h2>Who sees it</h2>
  <p>
    Other members see the name you go by, your position, your bio and what you've signed up for. Your email and phone
    are seen only by you and the club's admins. Sign-in codes and the club's notices are emailed through Google's Gmail.
  </p>

  <h2>Signing in</h2>
  <p>
    The app sets the cookies it needs to work: one while you sign in, one to keep you signed in. It remembers which
    browser each sign-in is on, so you can tell your devices apart. Sign-in codes are kept for 30 days, and a sign-in
    for 30 days after you sign out or it runs out. If you add a passkey, the club keeps only its public half, what
    device it was made on and when it was last used, until you or an admin remove it; your face or fingerprint never
    leaves your device. A request to join that nobody has answered is forgotten after 30 days. A record of who changed
    what in the app (who was made an admin, say) is kept for 2 years.
  </p>
  <p>
    To keep bots out, asking for a code and asking to join use Cloudflare Turnstile, which checks your browser looks
    like a person's and sets no cookies (<a
      href="https://www.cloudflare.com/turnstile-privacy-policy/"
      target="_blank"
      rel="noopener">Cloudflare's Turnstile privacy notice</a
    >).
  </p>

  <h2>Where it's kept, and for how long</h2>
  <p>
    On Cloudflare, in Western Europe, for as long as you're in the club, until you delete your account or ask us to. The
    club's database is backed up every night, encrypted, on GitHub, and each backup is kept for 90 days, so a deleted
    account is gone from the backups 90 days later.
  </p>

  <h2>Your data, and deleting your account</h2>
  <p>
    In the app, Profile → Your data: download everything the app holds about you, or delete your account. Deleting
    removes your name, email, phone and everything else that says who you are, straight away. What the club must keep
    for its accounts (payments) and its numbers (that someone played a session) stays, about a "Former member" nobody
    can name.
  </p>

  <h2>Your rights</h2>
  <p>
    You can ask to see, correct or delete what we hold about you: email the club (its address is on the
    <a href={CLUB_CONTACT} target="_blank" rel="noopener">website's privacy page</a>). If you're unhappy with how we've
    handled it, the
    <a href="https://ico.org.uk/make-a-complaint/" target="_blank" rel="noopener">Information Commissioner's Office</a>
    takes complaints from anyone in the UK.
  </p>
</div>

<style>
  .notice {
    display: grid;
    gap: var(--s-2);
    max-width: 42rem;
  }
  h2 {
    margin: var(--s-4) 0 0;
    font-size: var(--text-md);
  }
  h2:first-child {
    margin-top: 0;
  }
  p {
    margin: 0;
    color: var(--fg-body);
  }
  a {
    color: var(--fg);
    text-decoration: underline;
    text-underline-offset: 0.2em;
  }
</style>
