// SPDX-License-Identifier: AGPL-3.0-or-later

function matchesRoute(pathname: string, route: string): boolean {
  return pathname === route || pathname.startsWith(`${route}/`);
}

/**
 * Interactive board workspace routes lock to a `100dvh` app viewport on phones (`< 768px`)
 * with zero outer window scroll (`window.scrollY === 0`), slim header, and no footer/MobileDock.
 *
 * Note: `/practice` (`PracticeIndex`) intentionally stays a normal scrollable catalog page;
 * only `/practice/*` subpaths (`/practice/[id]`, `/practice/drills`) are locked workspaces.
 */
export function isMobileBoardWorkspace(pathname: string | null | undefined): boolean {
  if (!pathname) return false;
  return (
    matchesRoute(pathname, "/analysis") ||
    matchesRoute(pathname, "/review") ||
    matchesRoute(pathname, "/play") ||
    matchesRoute(pathname, "/puzzles") ||
    pathname.startsWith("/practice/") ||
    matchesRoute(pathname, "/editor") ||
    matchesRoute(pathname, "/openings") ||
    matchesRoute(pathname, "/endgames") ||
    pathname.startsWith("/g/")
  );
}

/** Wide 3-column desktop workspace routes (`max-w-[1600px]`). */
export function isWideWorkspace(pathname: string | null | undefined): boolean {
  if (!pathname) return false;
  return (
    matchesRoute(pathname, "/analysis") ||
    matchesRoute(pathname, "/review") ||
    matchesRoute(pathname, "/openings") ||
    matchesRoute(pathname, "/endgames")
  );
}
