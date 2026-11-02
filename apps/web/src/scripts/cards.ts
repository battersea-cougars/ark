// Squad cards: press to flip, and (with a mouse) tilt towards the pointer.
// Delegated listeners, added once; they survive view-transition page swaps.
const MAX_TILT = 9; // degrees
const canTilt = () =>
  window.matchMedia("(hover: hover) and (pointer: fine)").matches &&
  !window.matchMedia("(prefers-reduced-motion: reduce)").matches;

const cardAt = (e: Event) => (e.target as Element | null)?.closest<HTMLElement>("[data-card]") ?? null;

// Pressing a card on the page picks it up, as the team app does: a copy lifts from where it lies to the middle of the
// screen, big enough to read, turning over to its back on the way. Pressing the big card turns it back and forth;
// the scrim, the close button or Escape puts it down again. Without motion it just appears.
const DURATION = 520;
const CLOSE = DURATION - 60;
const EASE = "cubic-bezier(0.22, 1, 0.36, 1)";
const reducedMotion = () => window.matchMedia("(prefers-reduced-motion: reduce)").matches;
let zoomed: {
  overlay: HTMLElement;
  lifted: HTMLElement;
  card: HTMLElement;
  source: HTMLElement;
  sourceSlot: HTMLElement;
} | null = null;

/**
 * How an element lies on the page: the turn and scale it gets from its own transforms and its ancestors' (the home
 * page's hand of cards turns each card). Only the 2D linear part matters, so translations are ignored.
 */
function lieOf(el: Element | null) {
  let m = new DOMMatrix();
  for (; el && el !== document.body; el = el.parentElement) {
    // The individual `rotate` and `scale` properties (the hand uses `rotate`) as well as `transform`
    const css = getComputedStyle(el);
    const own = new DOMMatrix(css.transform && css.transform !== "none" ? css.transform : undefined);
    if (css.rotate && css.rotate !== "none") own.rotateSelf(parseFloat(css.rotate));
    if (css.scale && css.scale !== "none") own.scaleSelf(parseFloat(css.scale));
    m = own.multiply(m);
  }
  return { deg: (Math.atan2(m.b, m.a) * 180) / Math.PI, scale: Math.hypot(m.a, m.b) };
}

/**
 * The page card's place, as a transform from the big card's own: centre to centre, its size and the turn it lies
 * at. Measured on the card alone (not with Close under it), so it lands exactly where it was.
 */
function fromSource(lifted: HTMLElement, sourceSlot: HTMLElement) {
  const a = sourceSlot.getBoundingClientRect();
  const b = lifted.getBoundingClientRect();
  const dx = a.left + a.width / 2 - (b.left + b.width / 2);
  const dy = a.top + a.height / 2 - (b.top + b.height / 2);
  const { deg, scale } = lieOf(sourceSlot);
  return `translate(${dx}px, ${dy}px) rotate(${deg}deg) scale(${(sourceSlot.offsetWidth * scale) / lifted.offsetWidth})`;
}

// The card turns over on its own transition; time it to the move, so both land together.
const turn = (card: HTMLElement, pressed: boolean, ms: number) => {
  card.style.transition = `transform ${ms}ms ${EASE}`;
  card.setAttribute("aria-pressed", String(pressed));
};

function pickUp(source: HTMLElement) {
  const sourceSlot = source.closest<HTMLElement>(".slot");
  if (!sourceSlot || zoomed) return;
  const overlay = document.createElement("div");
  overlay.className = "card-zoom";
  const scrim = document.createElement("button");
  scrim.className = "card-zoom-scrim";
  scrim.type = "button";
  scrim.tabIndex = -1;
  scrim.setAttribute("aria-label", "Close");
  const stage = document.createElement("div");
  stage.className = "card-zoom-stage";
  stage.setAttribute("role", "dialog");
  stage.setAttribute("aria-modal", "true");
  stage.setAttribute("aria-label", source.getAttribute("aria-label")?.replace(/: pick up card$/, "") ?? "Player");
  const lifted = sourceSlot.cloneNode(true) as HTMLElement;
  const card = lifted.querySelector<HTMLElement>("[data-card]")!;
  card.setAttribute("aria-pressed", "false");
  card.classList.remove("is-tilting");
  for (const v of ["--rx", "--ry"]) card.style.setProperty(v, "0deg");
  const close = document.createElement("button");
  close.className = "card-zoom-close label";
  close.type = "button";
  close.textContent = "Close";
  // appendChild, not append: the Workers types' Element.append only takes strings
  stage.appendChild(lifted);
  stage.appendChild(close);
  overlay.appendChild(scrim);
  overlay.appendChild(stage);
  document.body.appendChild(overlay);
  document.documentElement.classList.add("card-zoom-open");
  zoomed = { overlay, lifted, card, source, sourceSlot };
  close.focus({ preventScroll: true });
  void refresh(card, source);

  if (reducedMotion()) return card.setAttribute("aria-pressed", "true");
  const from = fromSource(lifted, sourceSlot);
  // The page card is the one being lifted: it isn't left behind while its copy travels
  sourceSlot.style.visibility = "hidden";
  // No tilting while it travels; once it's landed it tilts towards the pointer like any card
  overlay.classList.add("moving");
  lifted.animate([{ transform: from }, { transform: "none" }], { duration: DURATION, easing: EASE }).onfinish = () => {
    overlay.classList.remove("moving");
    card.style.transition = "";
  };
  requestAnimationFrame(() => turn(card, true, DURATION));
}

function putDown() {
  if (!zoomed || zoomed.overlay.classList.contains("closing")) return;
  const { overlay, lifted, card, source, sourceSlot } = zoomed;
  overlay.classList.add("closing");
  const done = () => {
    sourceSlot.style.visibility = "";
    overlay.remove();
    document.documentElement.classList.remove("card-zoom-open");
    zoomed = null;
    source.focus({ preventScroll: true });
  };
  if (reducedMotion() || !sourceSlot.isConnected) return done();
  // Level it out as it goes back down
  card.classList.remove("is-tilting");
  for (const v of ["--rx", "--ry"]) card.style.setProperty(v, "0deg");
  turn(card, false, CLOSE);
  lifted.animate([{ transform: "none" }, { transform: fromSource(lifted, sourceSlot) }], {
    duration: CLOSE,
    easing: EASE,
    fill: "forwards",
  }).onfinish = done;
}

document.addEventListener("click", (e) => {
  const target = e.target as Element | null;
  if (target?.closest(".card-zoom-scrim, .card-zoom-close")) return putDown();
  const card = cardAt(e);
  if (!card) return;
  if (card.closest(".card-zoom")) {
    card.setAttribute("aria-pressed", String(card.getAttribute("aria-pressed") !== "true"));
  } else {
    pickUp(card);
  }
});

document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") putDown();
});

// A roster player's card shows the details from the last build; when it's picked up, fetch the latest and change
// whatever differs, on the big card and the one on the page (docs/adr/0016-how-the-website-gets-its-data.md). Quietly does
// nothing if it fails.
async function refresh(...cards: HTMLElement[]) {
  const id = cards[0].dataset.playerId;
  if (!id) return;
  let player: { name: string; position: string | null; quote: string | null };
  try {
    const res = await fetch(`/api/players/${id}`);
    if (!res.ok) return;
    player = await res.json();
  } catch {
    // Offline or blocked: the card keeps what the page was built with (the server reports its own failures)
    return;
  }
  const set = (field: string, text: string) => {
    for (const el of cards.flatMap((c) => [...c.querySelectorAll<HTMLElement>(`[data-field="${field}"]`)])) {
      if (el.textContent !== text) el.textContent = text;
      el.hidden = !text;
    }
  };
  set("name", player.name);
  if (player.position) set("position", player.position);
  set("quote", player.quote ? `“${player.quote}”` : "");
  for (const c of cards) c.setAttribute("aria-label", `${player.name}: pick up card`);
}

document.addEventListener("pointermove", (e) => {
  const card = cardAt(e);
  // Not while a picked-up card travels: tilting would fight its move and its turn
  if (!card || !canTilt() || card.closest(".card-zoom.moving, .card-zoom.closing")) return;
  const r = card.getBoundingClientRect();
  const x = (e.clientX - r.left) / r.width;
  const y = (e.clientY - r.top) / r.height;
  const flipped = card.getAttribute("aria-pressed") === "true";
  card.classList.add("is-tilting");
  card.style.setProperty("--ry", `${(x - 0.5) * 2 * MAX_TILT}deg`);
  card.style.setProperty("--rx", `${(0.5 - y) * 2 * MAX_TILT * (flipped ? -1 : 1)}deg`);
  card.style.setProperty("--mx", `${x * 100}%`);
  card.style.setProperty("--my", `${y * 100}%`);
});

document.addEventListener(
  "pointerleave",
  (e) => {
    const card = e.target instanceof Element && e.target.matches("[data-card]") ? (e.target as HTMLElement) : null;
    if (!card) return;
    card.classList.remove("is-tilting");
    card.style.setProperty("--rx", "0deg");
    card.style.setProperty("--ry", "0deg");
  },
  true,
);
