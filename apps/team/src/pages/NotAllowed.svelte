<script lang="ts">
  // Shown when the member's role lacks the route's action (ADR 0024).
  import Icon from "../app/shell/Icon.svelte";
</script>

<div class="page">
  <div class="empty">
    <span class="mark"><Icon name="key" /></span>
    <h1>Not for this role</h1>
    <p class="hint">Your role doesn't include this page. An admin can add it under Settings → Roles.</p>
    <a class="btn outline" href="/">Home</a>
  </div>
</div>

<style>
  .empty {
    display: grid;
    justify-items: center;
    gap: var(--s-2);
    padding: var(--s-10) var(--s-4);
    text-align: center;
  }
  .mark {
    display: grid;
    place-items: center;
    width: 2.75rem;
    height: 2.75rem;
    margin-bottom: var(--s-2);
    border-radius: 50%;
    background: var(--red-wash);
    color: var(--red-hot);
  }
  h1 {
    font-size: var(--text-md);
    font-weight: 600;
  }
  .btn {
    margin-top: var(--s-3);
  }
</style>
