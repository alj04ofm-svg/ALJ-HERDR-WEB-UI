import { availableParallelism, freemem, loadavg, platform, totalmem, uptime } from "node:os";
import { readFile, statfs } from "node:fs/promises";
import type { ServerHealth } from "../shared/protocol.ts";

/** Fixed local sources only. No shell, process arguments, environment, manager tokens or actions. */
export async function readServerHealth(): Promise<ServerHealth> {
  const os = platform();
  const [memory, disk] = await Promise.all([
    os === "linux" ? readFile("/proc/meminfo", "utf8").catch(() => "") : Promise.resolve(""),
    statfs(os === "win32" ? process.cwd() : "/").catch(() => null),
  ]);
  const bytes = (key: string): number | null => {
    const match = memory.match(new RegExp(String.raw`^${key}:\s+(\d+) kB$`, "m"));
    return match ? Number(match[1]) * 1024 : null;
  };
  const swapTotal = bytes("SwapTotal");
  const swapFree = bytes("SwapFree");
  return {
    measured_at: new Date().toISOString(), platform: os, uptime_seconds: uptime(),
    cpu_count: availableParallelism(),
    load_average: os === "win32" ? null : loadavg().slice(0, 3) as [number, number, number],
    memory: { total_bytes: bytes("MemTotal") ?? totalmem(), available_bytes: bytes("MemAvailable") ?? freemem() },
    swap: swapTotal !== null && swapFree !== null ? { total_bytes: swapTotal, free_bytes: swapFree } : null,
    disk: disk ? { total_bytes: disk.blocks * disk.bsize, available_bytes: disk.bavail * disk.bsize } : null,
  };
}

/** Reads occur on demand, shared across open clients; never runs a background collector. */
export function serverHealthReader(read = readServerHealth): () => Promise<ServerHealth> {
  let cached: ServerHealth | null = null;
  let expires = 0;
  let pending: Promise<ServerHealth> | null = null;
  return () => {
    if (cached && Date.now() < expires) return Promise.resolve(cached);
    return pending ??= read().then((value) => { cached = value; expires = Date.now() + 10_000; return value; }).finally(() => { pending = null; });
  };
}
