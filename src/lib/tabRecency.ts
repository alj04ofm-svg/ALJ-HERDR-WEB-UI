import { paneStorageId } from "../../shared/machines.ts";

/** Device-local viewing history, independent of the agent's working/idle status. */
export type TabVisits = Readonly<Record<string, number>>;
export const TAB_VISITS_KEY = "herdr-web-ui:tab-visits:v1";
const MAX_VISITS = 1000;
const RETENTION_MS = 90 * 24 * 60 * 60 * 1000;
export const tabVisitId = (machineId: string, workspaceId: string, tabId: string): string =>
  paneStorageId(machineId, JSON.stringify([workspaceId, tabId]));

export function sanitizeTabVisits(value: unknown, now: number): TabVisits {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return Object.fromEntries(Object.entries(value)
    .filter((entry): entry is [string, number] => typeof entry[1] === "number" && Number.isFinite(entry[1]) && entry[1] > 0 && entry[1] <= now && now - entry[1] <= RETENTION_MS)
    .sort((a, b) => b[1] - a[1]).slice(0, MAX_VISITS));
}

/** Unknown/future timestamps stay unknown; show a label only after five minutes away. */
export function tabAwayAge(viewedAt: number | undefined, now: number): { count: number; unit: "minute" | "hour" | "day" } | null {
  if (!viewedAt || viewedAt <= 0 || !Number.isFinite(viewedAt) || !Number.isFinite(now) || viewedAt > now) return null;
  const minutes = Math.floor((now - viewedAt) / 60_000);
  if (minutes < 5) return null;
  if (minutes < 60) return { count: minutes, unit: "minute" };
  if (minutes < 1440) return { count: Math.floor(minutes / 60), unit: "hour" };
  return { count: Math.floor(minutes / 1440), unit: "day" };
}
