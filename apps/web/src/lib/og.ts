// Open Graph cards: the 1200×630 picture a link shows when it's shared (WhatsApp, Facebook, iMessage). Drawn at
// build time like the rink's scoreboard: a scoreboard line, the page title in poster capitals, the red label and the
// cougar. satori turns the layout into an SVG (text as shapes, so the site's own fonts), sharp makes a PNG.
// Build only (prerendered /og/* routes): it reads files from disk and never runs on the Worker.
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import satori from "satori";
import sharp from "sharp";

export const OG_WIDTH = 1200;
export const OG_HEIGHT = 630;

export interface Card {
  /** Poster title, in capitals: the page or event name. */
  title: string;
  /** The scoreboard line, top left: a day and time, a date, a section. */
  osd?: string;
  /** The bottom line: where and when. */
  footer?: string;
  /** The Kumite's underground look: blacker, sticker-yellow display text. */
  night?: boolean;
}

const BONE = "#ece8e1";
const RED = "#e5131f";
const CREAM = "#f3efe6";

// The build runs in apps/web (npm workspaces); the files are those the site already ships, as TTF for satori.
const asset = (path: string) => readFile(resolve(process.cwd(), "src/assets", path));
let loaded: Promise<{ anton: Buffer; mark: string }> | undefined;
const load = () =>
  (loaded ??= Promise.all([
    asset("fonts/Anton.ttf"),
    // The head only: the red label carries the name, so the logo's own wordmark would say it twice.
    asset("cougars.png").then((png) =>
      sharp(png).extract({ left: 0, top: 0, width: 1355, height: 610 }).resize({ height: 420 }).png().toBuffer(),
    ),
  ]).then(([anton, mark]) => ({ anton, mark: `data:image/png;base64,${mark.toString("base64")}` })));

type Node = { type: string; props: Record<string, unknown> };
const el = (type: string, style: Record<string, unknown>, ...children: (Node | string)[]): Node => ({
  type,
  props: { style, children },
});
const div = (style: Record<string, unknown>, ...children: (Node | string)[]) =>
  el("div", { display: "flex", ...style }, ...children);

// Long titles step down so they fit in three lines beside the cougar.
const titleSize = (title: string) =>
  title.length <= 10 ? 150 : title.length <= 18 ? 118 : title.length <= 32 ? 92 : 72;

export async function renderCard(card: Card): Promise<Buffer> {
  const { anton, mark } = await load();
  const ink = card.night ? "#ffd60a" : BONE;
  const scoreboard = (text: string) =>
    div({ fontFamily: "Anton", fontSize: 34, color: card.night ? ink : RED, letterSpacing: 4 }, text);

  const tree = div(
    {
      width: OG_WIDTH,
      height: OG_HEIGHT,
      position: "relative",
      flexDirection: "column",
      justifyContent: "space-between",
      padding: "48px 64px 44px",
      backgroundColor: card.night ? "#060606" : "#0d0d0f",
      overflow: "hidden",
    },
    // The cougar, half off the frame on the right.
    el("img", { position: "absolute", right: -150, top: 230, height: 420, opacity: card.night ? 0.3 : 0.5 }, ""),
    // The scoreboard line: the day and time, or the section, in the poster capitals
    div({ alignItems: "center", minHeight: 48 }, ...(card.osd ? [scoreboard(card.osd.toUpperCase())] : [])),
    div(
      { flexDirection: "column", gap: 28, maxWidth: 820 },
      div(
        {
          fontFamily: "Anton",
          fontSize: titleSize(card.title),
          lineHeight: 1.02,
          color: ink,
          textTransform: "uppercase",
          letterSpacing: 1,
        },
        card.title,
      ),
      // The club's label: logo red, cream edge, slanted like the wordmark.
      div(
        {
          alignSelf: "flex-start",
          transform: "skewX(-9deg) rotate(-1deg)",
          backgroundColor: RED,
          borderLeft: `10px solid ${CREAM}`,
          padding: "10px 26px 8px",
        },
        div({ fontFamily: "Anton", fontSize: 38, color: "#fff", letterSpacing: 3 }, "BATTERSEA COUGARS"),
      ),
    ),
    div(
      { fontFamily: "Anton", fontSize: 28, color: "rgba(236,232,225,0.7)", letterSpacing: 3 },
      (card.footer ?? "").toUpperCase(),
    ),
  );
  // satori wants the image's source as a prop, not a style.
  (tree.props.children as Node[])[0].props.src = mark;

  const svg = await satori(tree as Parameters<typeof satori>[0], {
    width: OG_WIDTH,
    height: OG_HEIGHT,
    fonts: [{ name: "Anton", data: anton, weight: 400, style: "normal" }],
  });
  return sharp(Buffer.from(svg)).png({ compressionLevel: 9, palette: true, quality: 90 }).toBuffer();
}
