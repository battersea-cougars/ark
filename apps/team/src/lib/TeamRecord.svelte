<script lang="ts">
  // A team's record so far (ADR 0074), the one way it's written everywhere: won, drawn, lost as 1-0-0, then the
  // points (1-0-0 · 3 Pts), figures tabular. Under a team's name on a match card (lib/FixtureRow), its matchup
  // (Matchup) and the teams' list (TournamentTeams). Short enough to stay on one line on a phone.
  let { w, d, l, pts }: { w: number; d: number; l: number; pts?: number } = $props();
</script>

<span class="record num" title="Won-drawn-lost"
  ><span class="sr-only"
    >{w} won, {d} drawn, {l} lost{pts === undefined ? "" : `, ${pts} ${pts === 1 ? "point" : "points"}`}</span
  ><span aria-hidden="true"
    >{w}-{d}-{l}{#if pts !== undefined}<span class="sep">·</span><b>{pts}</b><abbr>Pts</abbr>{/if}</span
  ></span
>

<style>
  .record {
    color: var(--fg-body);
    font-size: var(--text-sm);
    font-weight: 400;
    white-space: nowrap;
  }
  /* The table's heading: small capitals, spaced, quieter than the figure */
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
</style>
