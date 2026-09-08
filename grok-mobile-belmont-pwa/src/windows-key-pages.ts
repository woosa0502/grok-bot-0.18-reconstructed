/** Stable key pages: no scroll offset, moving surface, or animation is needed. */
export function keyPageLayout(count: number, width: number, minimum: number, requestedPage: number) {
  const columns = Math.max(1, Math.min(count || 1, Math.floor((Math.max(0, width) + 6) / (minimum + 6))));
  const pages = Math.max(1, Math.ceil(count / columns));
  const page = Math.max(0, Math.min(pages - 1, requestedPage));
  return { columns, pages, page, start: page * columns, end: Math.min(count, (page + 1) * columns) };
}

/** A deliberate horizontal swipe, not tap jitter or vertical scrolling. */
export function keyPageDirection(dx: number, dy: number): -1 | 0 | 1 {
  if (Math.abs(dx) < 32 || Math.abs(dx) <= Math.abs(dy) * 1.5) return 0;
  return dx < 0 ? 1 : -1;
}
