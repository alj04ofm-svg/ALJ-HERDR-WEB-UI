/** The sidebar's width when the user has dragged its edge: per device, like the PC folds. */
const KEY = "herdr-web-ui:sidebar-width";

const COMPACT_KEY = "herdr-web-ui:sidebar-compact-width";

export const SIDEBAR_MIN_WIDTH = 76;
export const SIDEBAR_EXPANDED_WIDTH = 224;
export const SIDEBAR_DEFAULT_COMPACT_WIDTH = 88;
export const SIDEBAR_MAX_WIDTH = 520;
/** one arrow key press on the focused edge */
export const SIDEBAR_WIDTH_STEP = 16;

/** The widest the sidebar may be in this window: it leaves at least a touch target outside a phone drawer. */
export function sidebarMaxWidth(viewportWidth: number): number {
  const room = viewportWidth > 768 ? Math.floor(viewportWidth / 2) : viewportWidth - 44;
  return Math.max(SIDEBAR_MIN_WIDTH, Math.min(SIDEBAR_MAX_WIDTH, room));
}

export function clampSidebarWidth(width: number, viewportWidth = Number.POSITIVE_INFINITY): number {
  return Math.round(Math.max(SIDEBAR_MIN_WIDTH, Math.min(sidebarMaxWidth(viewportWidth), width)));
}

/** Where a key moves the edge from `current`, or null for a key that is not the edge's. */
export function keyedSidebarWidth(current: number, key: string, viewportWidth = Number.POSITIVE_INFINITY): number | null {
  if (key === "ArrowLeft") return clampSidebarWidth(current - SIDEBAR_WIDTH_STEP, viewportWidth);
  if (key === "ArrowRight") return clampSidebarWidth(current + SIDEBAR_WIDTH_STEP, viewportWidth);
  if (key === "Home") return SIDEBAR_MIN_WIDTH;
  if (key === "End") return sidebarMaxWidth(viewportWidth);
  return null;
}

/** The stored value as a width, or null when nothing usable is stored (the default width applies). */
export function parseSidebarWidth(stored: string | null, compact = false): number | null {
  if (stored === null || !/^\d+$/.test(stored)) return null;
  const width = clampSidebarWidth(Number(stored));
  return compact ? Math.min(width, SIDEBAR_EXPANDED_WIDTH - 1) : Math.max(width, SIDEBAR_EXPANDED_WIDTH);
}

export function storedSidebarWidth(compact = false): number | null {
  try {
    return parseSidebarWidth(window.localStorage.getItem(compact ? COMPACT_KEY : KEY), compact);
  } catch {
    return null;
  }
}

/** null forgets the choice: the sidebar goes back to the density's own width. */
export function storeSidebarWidth(width: number | null, compact: boolean): void {
  try {
    const key = compact ? COMPACT_KEY : KEY;
    if (width === null) window.localStorage.removeItem(key);
    else window.localStorage.setItem(key, String(width));
  } catch {
    /* private mode: the width simply is not remembered */
  }
}
