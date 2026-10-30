// The Kumite's motif on its results, as in the team app (apps/team/src/lib/motif.ts, ADR 0074): kanji beside the
// section titles and a red seal on the champions, in Noto Serif JP Black cut to the team app's characters (the same
// font file). Only the Kumite: a result in another series, or none, has no motif.
import kanjiFont from "../../assets/fonts/KumiteKanji.woff2?url";

const KUMITE_KANJI = {
  /** The final. */
  final: "決勝",
  /** Matches: the fight card. */
  fights: "試合",
  /** Prize: the awards. */
  awards: "賞",
  /** Victory: the champions' seal. */
  champions: "優勝",
} as const;

/** The kanji for this series and part of the page, or nothing for a series without the motif. */
export const kanjiFor = (series: { slug: string } | null, key: keyof typeof KUMITE_KANJI) =>
  series?.slug === "kumite" ? KUMITE_KANJI[key] : "";

/** The kanji's face, for a page that shows any (an inline style, as the poster's brush face). */
export const kanjiFace = `@font-face{font-family:"Kumite Kanji";src:url(${kanjiFont}) format("woff2");font-weight:900;font-display:swap}`;
