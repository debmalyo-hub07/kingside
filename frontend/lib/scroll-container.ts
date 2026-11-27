// SPDX-License-Identifier: AGPL-3.0-or-later

export interface ScrollContainerLike {
  scrollTop: number;
  clientHeight: number;
  scrollTo: (options: { top: number; behavior?: ScrollBehavior }) => void;
  getBoundingClientRect: () => Pick<DOMRect, "top" | "bottom">;
}

export interface ScrollTargetLike {
  getBoundingClientRect: () => Pick<DOMRect, "top" | "bottom">;
}

/**
 * Computes the target `scrollTop` inside `scroller` to bring `child` into view (`block: "nearest"`
 * semantics) without ever scrolling ancestor or document viewports. Returns `null` when already
 * visible or when the container is collapsed (`clientHeight <= 0`).
 */
export function computeContainerScrollTop(
  scroller: ScrollContainerLike,
  child: ScrollTargetLike,
  padding = 4,
): number | null {
  if (scroller.clientHeight <= 0) return null;
  const sRect = scroller.getBoundingClientRect();
  const cRect = child.getBoundingClientRect();
  const relativeTop = cRect.top - sRect.top + scroller.scrollTop;
  const relativeBottom = cRect.bottom - sRect.top + scroller.scrollTop;
  const viewTop = scroller.scrollTop;
  const viewBottom = viewTop + scroller.clientHeight;

  if (relativeTop < viewTop + padding) {
    return Math.max(0, relativeTop - padding);
  }
  if (relativeBottom > viewBottom - padding) {
    return Math.max(0, relativeBottom - scroller.clientHeight + padding);
  }
  return null;
}

/**
 * Scrolls `child` into view inside `scroller` ONLY (never calls `Element.scrollIntoView`, which
 * scrolls outer document viewports on mobile).
 */
export function scrollChildIntoContainer(
  scroller: ScrollContainerLike | null | undefined,
  child: ScrollTargetLike | null | undefined,
  options?: { smooth?: boolean; padding?: number },
): void {
  if (!scroller || !child) return;
  const nextTop = computeContainerScrollTop(scroller, child, options?.padding);
  if (nextTop === null) return;
  const reduced =
    typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
  const behavior: ScrollBehavior = options?.smooth !== false && !reduced ? "smooth" : "auto";
  scroller.scrollTo({ top: nextTop, behavior });
}
