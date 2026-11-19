import { Database } from "bun:sqlite";
import { existsSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import type { OpenCodeProviderInfo } from "../shared/protocol.ts";
import { opencodeDatabasePath } from "./opencode.ts";

type Row = Record<string, unknown>;
const record = (value: unknown): Row => value !== null && typeof value === "object" && !Array.isArray(value) ? value as Row : {};
const label = (value: unknown): string | null => typeof value === "string" && /^[\w .:/-]{1,120}$/.test(value) ? value : null;
const add = (previous: number | null, value: unknown): number | null => typeof value === "number" && Number.isFinite(value) && value >= 0 ? (previous ?? 0) + value : previous;
/** JSONC without evaluating code or replacing credential placeholders. */
export function parseOpenCodeConfig(source: string): Row {
  let plain = "";
  let quoted = false;
  for (let i = 0; i < source.length; i++) {
    const char = source[i]!;
    if (quoted) {
      plain += char;
      if (char === "\\") plain += source[++i] ?? "";
      else if (char === '"') quoted = false;
    } else if (char === '"') { quoted = true; plain += char; }
    else if (char === "/" && source[i + 1] === "/") {
      while (i < source.length && source[i] !== "\n") i++;
      plain += "\n";
    } else if (char === "/" && source[i + 1] === "*") {
      const end = source.indexOf("*/", i + 2);
      if (end < 0) return {};
      i = end + 1; plain += " ";
    } else plain += char;
  }
  let cleaned = ""; quoted = false;
  for (let i = 0; i < plain.length; i++) {
    const char = plain[i]!;
    if (quoted) {
      cleaned += char;
      if (char === "\\") cleaned += plain[++i] ?? "";
      else if (char === '"') quoted = false;
    } else {
      if (char === '"') quoted = true;
      if (char === "," && /^[\s]*[}\]]/.test(plain.slice(i + 1))) continue;
      cleaned += char;
    }
  }
  try { return record(JSON.parse(cleaned)); } catch { return {}; }
}
function configFile(path: string): Row {
  try { return statSync(path).size <= 1024 * 1024 ? parseOpenCodeConfig(readFileSync(path, "utf8")) : {}; } catch { return {}; }
}
/** Local metadata only. Never returns credentials, URLs, prompts or raw configuration. */
export function openCodeInventory(home: string, env: Record<string, string | undefined>): OpenCodeProviderInfo[] {
  const directory = env["OPENCODE_CONFIG_DIR"] || join(env["XDG_CONFIG_HOME"] || join(home, ".config"), "opencode");
  const configs = [join(directory, "opencode.json"), join(directory, "opencode.jsonc"), ...(env["OPENCODE_CONFIG"] ? [env["OPENCODE_CONFIG"]!] : [])];
  const providers = new Map<string, OpenCodeProviderInfo>();
  for (const path of configs) {
    for (const [id, value] of Object.entries(record(configFile(path).provider)).slice(0, 64)) {
      if (!label(id)) continue;
      const provider = record(value);
      providers.set(id, { id, name: label(provider.name) ?? id, models: Object.keys(record(provider.models)).filter((name) => label(name)).slice(0, 32), configured: true, activity: null });
    }
  }
  const path = opencodeDatabasePath(env, home);
  let db: Database | undefined;
  try {
    if (!path || !existsSync(path)) return [...providers.values()];
    db = new Database(path, { readonly: true, create: false });
    db.exec("PRAGMA busy_timeout = 100");
    // Bound reads, and project only usage fields: message bodies never leave SQLite.
    const rows = db.query<{ provider: string; model: string; tokens: string | null; cost: number | null; role: string; time_created: number }, []>(`SELECT json_extract(data, '$.providerID') AS provider, json_extract(data, '$.modelID') AS model, json_extract(data, '$.tokens') AS tokens, json_extract(data, '$.cost') AS cost, json_extract(data, '$.role') AS role, time_created FROM message ORDER BY rowid DESC LIMIT 2001`).all();
    for (const row of rows.slice(0, 2000)) {
      if (row.role !== "assistant" || !label(row.provider)) continue;
      const current = providers.get(row.provider) ?? { id: row.provider, name: row.provider, models: [], configured: false, activity: null };
      const tokens = row.tokens ? record(JSON.parse(row.tokens)) : {};
      const cache = record(tokens.cache);
      const activity = current.activity ?? { messages: 0, input: null, output: null, reasoning: null, cached_input: null, cache_write: null, reported_cost: null, latest_at: null, sampled: rows.length > 2000 };
      activity.messages++;
      activity.input = add(activity.input, tokens.input); activity.output = add(activity.output, tokens.output); activity.reasoning = add(activity.reasoning, tokens.reasoning);
      activity.cached_input = add(activity.cached_input, cache.read); activity.cache_write = add(activity.cache_write, cache.write);
      if (typeof row.cost === "number" && Number.isFinite(row.cost) && row.cost >= 0) activity.reported_cost = (activity.reported_cost ?? 0) + row.cost;
      if (Number.isFinite(row.time_created) && row.time_created > 0) {
        const time = new Date(row.time_created).toISOString();
        if (!activity.latest_at || time > activity.latest_at) activity.latest_at = time;
      }
      if (label(row.model) && !current.models.includes(row.model) && current.models.length < 32) current.models.push(row.model);
      current.activity = activity; providers.set(row.provider, current);
    }
  } catch { /* Missing/locked/older stores do not hide configured providers. */ }
  finally { db?.close(); }
  return [...providers.values()].slice(0, 64);
}
