// Site-wide motion, deliberately minimal: fade-in on scroll and the frosted
// header. Lifecycle pattern from gwenda-hackney/ark: one init per
// astro:page-load; an AbortController tears down the previous page's listeners.

const root = document.documentElement;
const reduced = () => matchMedia("(prefers-reduced-motion: reduce)").matches;
let pageAbort: AbortController | null = null;
let io: IntersectionObserver | null = null;

function onPage() {
  pageAbort?.abort();
  pageAbort = new AbortController();
  io?.disconnect();
  reveal();
  header(pageAbort.signal);
  sectionSpy(pageAbort.signal);
}

/**
 * Home page: underline the nav link for the section in view, run the header clock
 * (each section carries data-time / data-title) and turn the header dark for
 * sections marked data-night (the Kumite).
 */
function sectionSpy(signal: AbortSignal) {
  const header = document.querySelector<HTMLElement>("[data-header]");
  const clockTime = document.querySelector<HTMLElement>("[data-clock-time]");
  const clockLabel = document.querySelector<HTMLElement>("[data-clock-label]");
  const links = [...document.querySelectorAll<HTMLAnchorElement>('[data-section-link][href^="#"]')];
  // Home is lit only at the top of the home page: once a section is, that section alone is
  const homeLinks = [...document.querySelectorAll<HTMLAnchorElement>("[data-home-link]")];
  const sections = [...document.querySelectorAll<HTMLElement>("main section[data-title]")];
  // A whole page can be underground (the Kumite page)
  header?.classList.toggle("night", document.querySelector("main [data-night-page]") !== null);
  if (!sections.length) return;
  const initial = { time: clockTime?.textContent ?? "", label: clockLabel?.textContent ?? "" };
  let raf = 0;
  let last: HTMLElement | null | undefined;
  const update = () => {
    raf = 0;
    const line = innerHeight * 0.35; // a section is "on" once its top passes this line
    let active: HTMLElement | null = null;
    let best = -Infinity;
    for (const s of sections) {
      const r = s.getBoundingClientRect();
      if (r.top <= line && r.bottom > line && r.top > best) [active, best] = [s, r.top];
    }
    if (active === last) return;
    last = active;
    for (const a of links) {
      if (active && a.hash.slice(1) === active.id) a.setAttribute("aria-current", "location");
      else a.removeAttribute("aria-current");
    }
    for (const a of homeLinks) {
      if (active) a.removeAttribute("aria-current");
      else a.setAttribute("aria-current", "page");
    }
    if (clockTime) clockTime.textContent = active?.dataset.time ?? initial.time;
    if (clockLabel) clockLabel.textContent = active?.dataset.title ?? initial.label;
    header?.classList.toggle("night", active?.hasAttribute("data-night") ?? false);
  };
  update();
  addEventListener("scroll", () => (raf ||= requestAnimationFrame(update)), { passive: true, signal });
  addEventListener("resize", () => (raf ||= requestAnimationFrame(update)), { passive: true, signal });
}

function reveal() {
  const els = document.querySelectorAll<HTMLElement>("[data-reveal]");
  if (reduced() || root.classList.contains("navigation-restore")) {
    els.forEach((el) => el.classList.add("is-in"));
    return;
  }
  io = new IntersectionObserver(
    (entries) =>
      entries.forEach((e) => {
        if (!e.isIntersecting) return;
        e.target.classList.add("is-in");
        io?.unobserve(e.target);
      }),
    { threshold: 0.12, rootMargin: "0px 0px -32px 0px" },
  );
  els.forEach((el) => io!.observe(el));
}

/** Frosted header once scrolled, with hysteresis so it doesn't flicker (from ark). */
function header(signal: AbortSignal) {
  const el = document.querySelector<HTMLElement>("[data-header]");
  if (!el) return;
  const showAt = 40;
  const hideAt = showAt * 0.6;
  let on = false;
  let raf = 0;
  const update = () => {
    raf = 0;
    const y = scrollY;
    if (!on && y > showAt) on = true;
    else if (on && y < hideAt) on = false;
    el.classList.toggle("is-scrolled", on);
  };
  update();
  addEventListener("scroll", () => (raf ||= requestAnimationFrame(update)), { passive: true, signal });
}

// Back/forward: land in the final state with no entrance animation (ark's navigation-restore).
let traversing = false;
document.addEventListener("astro:before-preparation", (e) => {
  traversing = e.navigationType === "traverse";
  // The click shows at once (global.css: the bar along the top, the page dimming) while the next page is fetched
  root.classList.add("is-navigating");
});
// The swap replaces every <html> attribute, so re-apply the class afterwards.
document.addEventListener("astro:after-swap", () => {
  root.classList.toggle("navigation-restore", traversing);
  landInView();
});
addEventListener("pageshow", (e) => e.persisted && root.classList.add("navigation-restore"));

/**
 * Arriving from another page, what's already in view is there at once: the page crossfade is its entrance, and a
 * scroll-reveal on top of it made every page seem slow to load. Done before the view transition snapshots the new
 * page; only what's further down fades in as you scroll to it.
 */
let landed: HTMLElement[] = [];
function landInView() {
  landed = [...document.querySelectorAll<HTMLElement>("[data-reveal]")].filter(
    (el) => el.getBoundingClientRect().top < innerHeight,
  );
  for (const el of landed) {
    el.style.transition = "none";
    el.classList.add("is-in");
  }
}

document.addEventListener("astro:page-load", () => {
  // Their own transitions (hover and the like) back once they've landed
  const settled = landed;
  landed = [];
  requestAnimationFrame(() => requestAnimationFrame(() => settled.forEach((el) => (el.style.transition = ""))));
  root.classList.remove("is-navigating");
  onPage();
  requestAnimationFrame(() => requestAnimationFrame(() => root.classList.remove("navigation-restore")));
});
