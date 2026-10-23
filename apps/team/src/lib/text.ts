// Text as people see it: cut, counted and compared by whole characters, so an emoji or an accented letter is never
// split in half (a lone half shows as a broken glyph, or as ��� once stored). Used by the app and the worker.

const segmenter = new Intl.Segmenter(undefined, { granularity: "grapheme" });

/** Its characters as a reader counts them: "🦁 Leo" is ["🦁", " ", "L", "e", "o"], a flag or "é" one each. */
export const characters = (text: string): string[] => Array.from(segmenter.segment(text), (s) => s.segment);

/** The first `count` characters, never half of one. */
export const firstCharacters = (text: string, count: number) => characters(text).slice(0, count).join("");

/** Its first character ("" for none): "🦁 Leo" is "🦁". */
export const firstCharacter = (text: string) => firstCharacters(text, 1);
