// The end of a long list coming into view (or nearly: a screen ahead), for the next page of it (#175): History's past
// ones. Use: <div use:loadMore={() => list.more()}></div> after the list's last row.
export function loadMore(node: HTMLElement, more: () => unknown) {
  let ask = more;
  const seen = new IntersectionObserver((entries) => entries.some((e) => e.isIntersecting) && ask(), {
    rootMargin: "100% 0px",
  });
  seen.observe(node);
  return {
    update: (next: () => unknown) => (ask = next),
    destroy: () => seen.disconnect(),
  };
}
