// The Kumite's motif: Bloodsport, Frank Dux's underground Kumite in Hong Kong. Kanji beside its section headings and a
// red seal on its champions, in a font cut to just these characters (app.css "Kumite Kanji"). Only the Kumite: other
// series have no motif. Add a character here, and cut the font again with it.
import type { TournamentType } from "../demo/model";

export const KUMITE_KANJI = {
  /** Kumite: "grappling hands", the fights themselves. */
  onTheMat: "組手",
  /** The final. */
  final: "決勝",
  /** Matches. */
  fights: "試合",
  /** Fight. */
  results: "闘",
  /** Prize. */
  awards: "賞",
  /** Victory, the champions. */
  champions: "優勝",
  /** The draft's steps (its step card): lots, drawn for the order; open, the gong; decided, the teams sealed. */
  draw: "籤",
  open: "開",
  sealed: "決",
  /** Blood, martial, fist: kept for the draft and the board. */
  blood: "血",
  martial: "武",
  fist: "拳",
} as const;

export type MotifKey = keyof typeof KUMITE_KANJI;

/** The kanji for this series and part of the page, or nothing for a series without the motif. */
export const kanjiFor = (type: Pick<TournamentType, "slug"> | undefined, key: MotifKey) =>
  type?.slug === "kumite" ? KUMITE_KANJI[key] : "";
