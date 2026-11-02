<script lang="ts">
  // Privacy, signed in: the app's own notice, linked from Profile → Your data. Signed out, the sign-in screen
  // shows the same one.
  import PageHeader from "../lib/PageHeader.svelte";
  import PrivacyNotice from "../lib/PrivacyNotice.svelte";
</script>

<div class="page">
  <PageHeader title="Privacy" subtitle="What the app holds about you, who sees it, and for how long." />
  <PrivacyNotice />
</div>
