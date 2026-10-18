// Play on a video card (components/VideoCard.astro): swap the thumbnail for YouTube's player, which only loads now.
// One handler on the document, so cards added later play too (the home page's reel swaps in live ones). Loaded by
// both the card and the reel: a page built with no videos still has it when the reel brings some in. A module runs
// once however many components import it.
document.addEventListener("click", (e) => {
  const button = (e.target as Element).closest(".video .play");
  const player = button?.closest<HTMLElement>(".player");
  if (!player?.dataset.embed) return;
  const iframe = document.createElement("iframe");
  iframe.src = player.dataset.embed;
  iframe.title = button!.getAttribute("aria-label") ?? "YouTube video";
  iframe.allow = "autoplay; encrypted-media; picture-in-picture; fullscreen";
  iframe.allowFullscreen = true;
  player.replaceChildren(iframe);
});
