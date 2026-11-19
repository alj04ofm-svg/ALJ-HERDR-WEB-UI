import { useEffect, useState } from "react";
import { sanitizeTabVisits, TAB_VISITS_KEY, type TabVisits } from "./tabRecency.ts";

function loadVisits(): TabVisits {
  try { return sanitizeTabVisits(JSON.parse(localStorage.getItem(TAB_VISITS_KEY) ?? "null"), Date.now()); }
  catch { return {}; }
}

/** One minute clock for the whole sidebar, suspended while the page is hidden. */
export function useTabVisits(selectedTab: string | null): { visits: TabVisits; now: number } {
  const [visits, setVisits] = useState(loadVisits);
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    let timer: ReturnType<typeof setInterval> | undefined;
    const refresh = () => {
      if (document.visibilityState !== "visible") return;
      const time = Date.now();
      setNow(time);
      if (selectedTab && document.hasFocus()) setVisits((current) => sanitizeTabVisits({ ...current, [selectedTab]: time }, time));
    };
    const visibility = () => {
      if (timer !== undefined) clearInterval(timer);
      timer = undefined;
      if (document.visibilityState === "visible") {
        refresh();
        timer = setInterval(refresh, 60_000);
      }
    };
    const sync = (event: StorageEvent) => {
      if (event.key === TAB_VISITS_KEY) setVisits(loadVisits());
    };
    visibility();
    document.addEventListener("visibilitychange", visibility);
    window.addEventListener("focus", refresh);
    window.addEventListener("storage", sync);
    return () => {
      if (timer !== undefined) clearInterval(timer);
      document.removeEventListener("visibilitychange", visibility);
      window.removeEventListener("focus", refresh);
      window.removeEventListener("storage", sync);
    };
  }, [selectedTab]);
  useEffect(() => {
    try { localStorage.setItem(TAB_VISITS_KEY, JSON.stringify(visits)); }
    catch { /* A blocked/full store keeps this session's viewing history in memory. */ }
  }, [visits]);
  return { visits, now };
}
