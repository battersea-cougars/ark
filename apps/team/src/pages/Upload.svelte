<script lang="ts">
  import PageHeader from "../lib/PageHeader.svelte";
  import { can } from "../access/actions";
  import { granted } from "../demo/session.svelte";
  import Icon from "../app/shell/Icon.svelte";

  const perms = $derived(granted());
  let files = $state<{ name: string; url: string }[]>([]);
  let album = $state("Friday hockey");

  function pick(e: Event) {
    const list = (e.currentTarget as HTMLInputElement).files ?? [];
    files = [...files, ...[...list].map((f) => ({ name: f.name, url: URL.createObjectURL(f) }))];
  }
</script>

<div class="page">
  <PageHeader title="Upload" subtitle="Photos go to a website album. Videos go straight to the club YouTube channel." />
  <label class="drop">
    <span class="mark"><Icon name="upload" /></span>
    <span class="title">Add photos</span>
    <span class="hint">Tap to choose from your phone</span>
    <input type="file" multiple accept="image/*" onchange={pick} />
  </label>

  {#if files.length}
    <label class="field rise">Album <input class="input" bind:value={album} /></label>
    <div class="grid rise">
      {#each files as f (f.url)}
        <figure>
          <img src={f.url} alt={f.name} />
          <figcaption class="hint">→ {album}</figcaption>
        </figure>
      {/each}
    </div>
    <button class="btn primary block" disabled>Upload {files.length} (coming soon)</button>
  {/if}

  <!-- Videos are uploaded on YouTube itself, signed in with your own access to the club channel (ADR 0016). -->
  {#if can(perms, "upload:Video")}
    <section class="videos">
      <h2 class="title">Videos</h2>
      <p class="hint">
        Upload on YouTube, as the club channel: Unlisted, and add it to one playlist: Friday Hockey, Kumite, or Website
        for anything else. It's on the website within about 10 minutes, or at once when an admin presses Refresh photos
        and videos in Settings → Website.
      </p>
      <a class="btn outline block" href="https://www.youtube.com/upload" target="_blank" rel="noopener noreferrer">
        <Icon name="play" size={18} /> Upload on YouTube
      </a>
    </section>
  {/if}
</div>

<style>
  .drop {
    display: grid;
    justify-items: center;
    gap: var(--s-1);
    padding: var(--s-10) var(--s-4);
    border: 1px dashed var(--border-strong);
    border-radius: var(--r-lg);
    background: var(--surface-1);
    text-align: center;
    cursor: pointer;
    transition:
      border-color var(--t) var(--ease-in-out),
      background-color var(--t) var(--ease-in-out);
  }
  .drop:hover {
    border-color: var(--red-border);
    background: var(--red-wash);
  }
  .drop input {
    position: absolute;
    width: 1px;
    height: 1px;
    opacity: 0;
  }
  .mark {
    display: grid;
    place-items: center;
    width: 3rem;
    height: 3rem;
    margin-bottom: var(--s-2);
    border-radius: 50%;
    background: var(--red-wash);
    color: var(--red-hot);
  }
  .title {
    color: var(--fg);
    font-weight: 500;
  }
  .grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(7rem, 1fr));
    gap: var(--s-2);
  }
  figure {
    margin: 0;
  }
  .videos {
    display: grid;
    gap: var(--s-2);
    margin-top: var(--s-6);
  }
  .videos h2 {
    margin: 0;
    font-size: inherit;
  }
  img {
    width: 100%;
    aspect-ratio: 1;
    object-fit: cover;
    border-radius: var(--r-md);
    background: var(--surface-1);
  }
</style>
