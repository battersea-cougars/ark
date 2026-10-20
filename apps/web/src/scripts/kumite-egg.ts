// ↑ ↑ ↓ ↓ ← → ← → B A, anywhere on the site: the Kumite calls (scripts/kumite-egg.play.ts). One key listener; the
// rest only loads once the code is typed.
const CODE = [
  "ArrowUp",
  "ArrowUp",
  "ArrowDown",
  "ArrowDown",
  "ArrowLeft",
  "ArrowRight",
  "ArrowLeft",
  "ArrowRight",
  "b",
  "a",
];
let at = 0;

addEventListener("keydown", (e) => {
  const key = e.key.length === 1 ? e.key.toLowerCase() : e.key;
  at = key === CODE[at] ? at + 1 : key === CODE[0] ? 1 : 0;
  if (at < CODE.length) return;
  at = 0;
  // Started from the keypress, so the browser lets the gong sound
  const audio = new AudioContext();
  void import("./kumite-egg.play").then(({ play }) => play(audio));
});
