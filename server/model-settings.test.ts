import { describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ModelSettingsService, readModelCatalog, readNativeThreadId } from "./model-settings.ts";
import type { ModelSettingsChange } from "../shared/protocol.ts";

function fixture() {
  const calls: { method: string; params: Record<string, unknown> }[] = [];
  let binding = { thread: "native-thread", terminal: "native-terminal", home: "isolated" };
  let native = { id: "native-thread", model: "first", reasoningEffort: "high", status: { type: "idle" } };
  let ignoreUpdate = false;
  let refuse = false;
  let resolutions = 0;
  let replaceAt = Infinity;
  const service = new ModelSettingsService("isolated", {
    resolve: async () => ++resolutions >= replaceAt ? { ...binding, terminal: "replacement" } : binding,
    catalog: () => ["first", "second"].map(id => ({ id, label: id, efforts: ["low", "high"].map(id => ({ id, description: id })) })),
    connect: async (_home, run) => run(async <T>(method: string, params: Record<string, unknown>) => {
      calls.push({ method, params });
      if (method === "thread/read") return { thread: { ...native } } as T;
      if (method !== "thread/settings/update") throw new Error("No turns or other native operations allowed");
      if (refuse) throw new Error("native refusal");
      if (!ignoreUpdate) native = { ...native, ...(params.model ? { model: String(params.model) } : { reasoningEffort: String(params.effort) }) };
      return {} as T;
    }),
  });
  const expected = () => ({ thread_id: native.id, model: native.model, effort: native.reasoningEffort });
  const change = (field: Partial<ModelSettingsChange>) => service.change({ pane_id: "owned-pane", expected: expected(), ...field });
  return { service, calls, expected, change, setIgnored: () => { ignoreUpdate = true; }, setRefused: () => { refuse = true; }, replaceBeforeCommit: () => { replaceAt = 2; }, replaceAfterCommit: () => { replaceAt = 3; }, unload: () => { native.status.type = "notLoaded"; }, changeBinding: () => { binding.thread = "other-thread"; } };
}
describe("native model settings", () => {
  test("reads large native instruction headers without reading the transcript and refuses incomplete metadata", () => {
    const home = mkdtempSync(join(tmpdir(), "herdr-native-header-")); const path = join(home, "rollout.jsonl");
    try {
      writeFileSync(path, JSON.stringify({ type: "session_meta", payload: { id: "verified-native-thread", instructions: "x".repeat(80_000) } }) + "\nnot transcript JSON");
      expect(readNativeThreadId(path)).toBe("verified-native-thread");
      writeFileSync(path, '{"type":"session_meta","payload":{"id":"truncated'); expect(readNativeThreadId(path)).toBeNull();
      writeFileSync(path, JSON.stringify({ type: "session_meta", payload: { id: "oversized-native-thread", instructions: "x".repeat(300_000) } })); expect(readNativeThreadId(path)).toBeNull();
      expect(readNativeThreadId(join(home, "missing"))).toBeNull();
    } finally { rmSync(home, { recursive: true, force: true }); }
  });
  test("changes only effort, then only model, with confirmed native reads and no turn start", async () => {
    const f = fixture();
    expect((await f.change({ effort: "low" })).model).toBe("first");
    expect((await f.change({ model: "second" })).effort).toBe("low");
    expect(f.calls.filter(c => c.method === "thread/settings/update").map(c => c.params)).toEqual([
      { threadId: "native-thread", effort: "low" }, { threadId: "native-thread", model: "second" },
    ]);
    expect((await f.service.get("owned-pane")).model).toBe("second");
  });
  test("refuses stale model/effort and another thread before a mutation", async () => {
    const f = fixture();
    await expect(f.service.change({ pane_id: "owned-pane", expected: { ...f.expected(), effort: "low" }, model: "second" })).rejects.toThrow("Native settings changed");
    f.changeBinding();
    await expect(f.change({ model: "second", expected: { thread_id: "original-thread", model: "first", effort: "high" } })).rejects.toThrow("native session changed");
    expect(f.calls.some(c => c.method === "thread/settings/update")).toBe(false);
  });
  test("checks terminal identity again immediately before the native write", async () => {
    const f = fixture(); f.replaceBeforeCommit();
    await expect(f.change({ model: "second" })).rejects.toThrow("native session changed");
    expect(f.calls.some(c => c.method === "thread/settings/update")).toBe(false);
  });
  test("never reports applied to a replacement pane after a native acknowledgment", async () => {
    const f = fixture(); f.replaceAfterCommit();
    await expect(f.change({ effort: "low" })).rejects.toThrow("native session changed");
    expect(f.calls.filter(c => c.method === "thread/settings/update")).toHaveLength(1);
  });
  test("unknown settings are rejected and unloaded sessions are never resumed", async () => {
    const f = fixture(); await expect(f.change({ effort: "invented" })).rejects.toThrow("does not support");
    f.unload(); expect((await f.service.get("owned-pane")).supported).toBe(false);
    expect(f.calls.every(c => c.method === "thread/read")).toBe(true);
  });
  test("an acknowledgment without the new native values is not called applied", async () => {
    const f = fixture(); f.setIgnored(); await expect(f.change({ model: "second" })).rejects.toThrow("could not be confirmed");
    expect(f.calls.filter(c => c.method === "thread/settings/update")).toHaveLength(1);
  });
  test("native failures do not retry updates or lose the original settings", async () => {
    const f = fixture(); f.setRefused(); await expect(f.change({ effort: "low" })).rejects.toThrow("native refusal");
    expect(f.calls.filter(c => c.method === "thread/settings/update")).toHaveLength(1);
    expect((await f.service.get("owned-pane")).effort).toBe("high");
  });
  test("catalog offers only native listed models and native effort values", () => {
    const home = mkdtempSync(join(tmpdir(), "herdr-model-catalog-"));
    try {
      writeFileSync(join(home, "models_cache.json"), JSON.stringify({ models: [
        { slug: "listed", display_name: "Native label", supported_reasoning_levels: [{ effort: "high", description: "Native description" }] },
        { slug: "hidden", visibility: "hide" }, { slug: "unsupported", supported_in_api: false }, { slug: 9 },
      ] }));
      expect(readModelCatalog(home)).toEqual([{ id: "listed", label: "Native label", efforts: [{ id: "high", description: "Native description" }] }]);
    } finally { rmSync(home, { recursive: true, force: true }); }
  });
});
