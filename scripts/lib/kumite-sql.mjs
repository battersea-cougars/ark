// The Kumite as the website shows it (ADR 0044, 0042), read from the club's D1 at build time (scripts/club-snapshot.mjs):
// its awards and the next one's date and place. Each Kumite keeps its own awards (ADR 0030), so the website shows a
// Kumite's own: the next public one's, else the last public one held's; the series' only before there's been any (they
// are the defaults a new Kumite copies).

const DAY = /^\d{4}-\d{2}-\d{2}$/;

/** The query, as of `today` (YYYY-MM-DD; none: the database's today). */
export function kumiteSql(today) {
  if (today !== undefined && !DAY.test(today)) throw new Error(`kumiteSql: ${today} isn't a day`);
  const on = today ? `'${today}'` : "date('now')";
  return `SELECT y.awards seriesAwards,
            (SELECT json_object('startsAt', a.starts_at, 'venue', a.venue, 'dateTbc', a.date_tbc, 'season', a.season,
                                'awards', t.awards)
             FROM agenda a JOIN tournaments t ON t.id = a.source_id
             WHERE a.source = 'tournament' AND a.kind = 'tournament' AND a.public = 1 AND t.type_id = y.id
               AND a.day >= ${on}
             ORDER BY a.starts_at LIMIT 1) next,
            (SELECT t.awards FROM tournaments t
             WHERE t.type_id = y.id AND t.public = 1 AND t.held_on < ${on}
             ORDER BY t.held_on DESC, t.id DESC LIMIT 1) lastAwards
          FROM tournament_types y WHERE y.slug = 'kumite'`;
}

/** The snapshot from the query's rows: null when there's no Kumite series. */
export function kumiteFrom(rows) {
  const row = rows[0];
  if (!row) return null;
  const next = row.next ? JSON.parse(row.next) : null;
  return {
    awards: JSON.parse(next?.awards ?? row.lastAwards ?? row.seriesAwards),
    next: next && {
      startsAt: next.startsAt,
      venue: next.venue,
      dateTbc: Boolean(next.dateTbc),
      season: next.season,
    },
  };
}
