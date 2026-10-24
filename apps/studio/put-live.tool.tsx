// "Put changes live" (#107): a tab in the Studio's top bar saying when published changes reach the website, and
// linking to the team app's Settings → Website, whose Rebuild now puts them live at once (ADR 0004, ADR 0100). The
// Studio holds no token that can rebuild anything: the team app does it, as the club's GitHub App.
import type { Tool } from "sanity";

const STYLE = { maxWidth: "36rem", padding: "2rem 1.5rem", lineHeight: 1.5, fontFamily: "inherit" } as const;

function PutLive({ teamUrl }: { teamUrl: string }) {
  return (
    <div style={STYLE}>
      <h1 style={{ fontSize: "1.5rem", margin: "0 0 1rem" }}>Put your changes live</h1>
      <p>
        Nothing you publish here is on the website until it rebuilds. It rebuilds by itself every morning, so a change
        published today is there tomorrow.
      </p>
      <p>
        <strong>To put it live now:</strong> open the team app's <em>Settings → Website</em> and press{" "}
        <strong>Rebuild now</strong>. The website shows your changes about five minutes later.
      </p>
      <p>
        <a href={`${teamUrl}/settings/website`} target="_blank" rel="noopener noreferrer">
          Open Settings → Website in the team app ↗
        </a>
      </p>
      <p style={{ opacity: 0.7 }}>
        Photos (Instagram) and videos (YouTube) never wait for a rebuild: they're on the website within ten minutes.
      </p>
    </div>
  );
}

/** The tool, for the team app at `teamUrl` (this Studio's environment's). */
export const putLiveTool = (teamUrl: string): Tool => ({
  name: "put-live",
  title: "Put changes live",
  component: () => <PutLive teamUrl={teamUrl} />,
});
