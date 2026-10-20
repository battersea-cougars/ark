// The Kumite calls (scripts/kumite-egg.ts): the gong, 組手 slamming in red, and a line from the film. Over in four
// seconds, or at any key or tap. With reduced motion: no flash or shake, it fades in and out. The kanji are in the
// Kumite poster's own brush font (its subset has them), so they show on devices without Japanese fonts.
import brush from "../assets/fonts/YujiBoku-kumite.woff2?url";

/** A struck gong: a low hum and its uneven overtones, dying away. Made here, so nothing is fetched. */
function gong(audio: AudioContext) {
  const now = audio.currentTime;
  const out = audio.createGain();
  out.gain.setValueAtTime(0.0001, now);
  out.gain.exponentialRampToValueAtTime(0.35, now + 0.02);
  out.gain.exponentialRampToValueAtTime(0.0001, now + 4);
  out.connect(audio.destination);
  for (const [ratio, level] of [
    [1, 1],
    [2.76, 0.5],
    [5.4, 0.25],
    [8.93, 0.12],
  ]) {
    const tone = audio.createOscillator();
    const gain = audio.createGain();
    tone.frequency.value = 98 * ratio;
    gain.gain.value = level;
    tone.connect(gain).connect(out);
    tone.start(now);
    tone.stop(now + 4);
  }
}

export async function play(audio: AudioContext) {
  if (document.querySelector("[data-kumite-egg]")) return;
  gong(audio);
  // The brush font: there in a moment (cached if the Kumite page was seen); never wait long for it
  const face = new FontFace("Kumite Brush", `url(${brush})`);
  document.fonts.add(face);
  await Promise.race([face.load().catch(() => {}), new Promise((r) => setTimeout(r, 400))]);
  const calm = matchMedia("(prefers-reduced-motion: reduce)").matches;
  const egg = document.createElement("div");
  egg.dataset.kumiteEgg = "";
  egg.setAttribute("role", "presentation");
  egg.innerHTML = `<p class="kanji" lang="ja">組手</p><p class="word">Kumite</p><p class="line">You have been chosen.</p>`;
  Object.assign(egg.style, {
    position: "fixed",
    inset: "0",
    zIndex: "1000",
    display: "grid",
    placeContent: "center",
    justifyItems: "center",
    gap: "0.5rem",
    background: "rgb(6 6 6 / 0.9)",
    color: "var(--red-hot)",
    textAlign: "center",
    cursor: "pointer",
  });
  const style = document.createElement("style");
  style.textContent = `
    [data-kumite-egg] p { margin: 0 }
    [data-kumite-egg] .kanji { font-family: "Kumite Brush", serif; font-size: clamp(7rem, 30vw, 18rem); line-height: 1;
      text-shadow: 0 0 40px rgb(244 64 74 / 0.6) }
    [data-kumite-egg] .word { font-family: var(--display); font-size: clamp(2rem, 6vw, 4rem);
      text-transform: uppercase; letter-spacing: 0.3em; color: var(--text) }
    [data-kumite-egg] .line { font-family: var(--osd); font-size: 1.6rem; text-transform: uppercase;
      letter-spacing: 0.1em; color: #ffd60a }
    @keyframes kumite-slam { 0% { transform: scale(2.4); opacity: 0 } 60% { transform: scale(0.94); opacity: 1 }
      100% { transform: scale(1) } }
    @keyframes kumite-shake { 0%, 100% { translate: 0 } 25% { translate: -6px 3px } 50% { translate: 5px -4px }
      75% { translate: -3px -2px } }
    @keyframes kumite-flash { 0% { background: rgb(244 64 74 / 0.6) } 100% { background: rgb(6 6 6 / 0.9) } }`;
  egg.appendChild(style);
  if (calm) egg.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 400 });
  else {
    egg.style.animation = "kumite-flash 0.5s ease-out, kumite-shake 0.35s 0.25s 2";
    egg.querySelector<HTMLElement>(".kanji")!.style.animation = "kumite-slam 0.5s cubic-bezier(0.2, 0.9, 0.3, 1.2)";
  }
  document.body.appendChild(egg);

  let closed = false;
  const close = () => {
    if (closed) return;
    closed = true;
    removeEventListener("keydown", close);
    egg.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 300 }).finished.then(() => egg.remove());
    void audio.close().catch(() => {});
  };
  egg.addEventListener("click", close);
  setTimeout(() => addEventListener("keydown", close, { once: true }), 300);
  setTimeout(close, 4000);
}
