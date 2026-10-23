<script lang="ts">
  // A team's record so far, in the table's own words (lib/BoardTable, ADR 0074): won, drawn, lost in that order, then
  // points, each figure with the table's column letter after it (1W 0D 0L · 3 Pts), figures tabular, the letters as
  // the table's headings are. Under a team's name on a match card (lib/FixtureRow) and its matchup (Matchup).
  let { w, d, l, pts }: { w: number; d: number; l: number; pts?: number } = $props();
</script>

<span
  class="record num"
  aria-label="{w} won, {d} drawn, {l} lost{pts === undefined ? '' : `, ${pts} ${pts === 1 ? 'point' : 'points'}`}"
  ><span aria-hidden="true"
    >{w}<abbr>W</abbr>&#8201;{d}<abbr>D</abbr>&#8201;{l}<abbr>L</abbr>{#if pts !== undefined}<span class="sep">·</span
      ><b>{pts}</b><abbr>Pts</abbr>{/if}</span
  ></span
>

<style>
  .record {
    color: var(--fg-body);
    font-size: var(--text-sm);
    font-weight: 400;
    white-space: nowrap;
  }
  /* The table's headings: small capitals, spaced, quieter than the figures */
  abbr {
    margin-left: 0.12em;
    color: var(--fg-muted);
    font-size: var(--text-2xs);
    font-weight: 600;
    letter-spacing: var(--tracking-label);
    text-decoration: none;
    text-transform: uppercase;
  }
  .sep {
    padding: 0 0.4em;
    color: var(--fg-subtle);
  }
  /* Points, as the table's last column: the figure that counts, bright */
  b {
    color: var(--fg);
    font-weight: 700;
  }
  /* A phone: a match card's side is narrow, so the letters sit closer and the line keeps its points */
  @media (max-width: 600px) {
    abbr {
      margin-left: 0.05em;
      letter-spacing: 0.02em;
    }
    .sep {
      padding: 0 0.25em;
    }
  }
</style>
