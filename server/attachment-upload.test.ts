import { afterAll, beforeAll, expect, it } from "bun:test";
import { createServer as createNetServer, type Socket } from "node:net";
import { mkdtempSync, readdirSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createServer } from "./index.ts";
import { LEGACY_ATTACHMENT_BYTES as MAX_ATTACHMENT_BYTES } from "../shared/attachments.ts";
import { socketAddress } from "./herdr/client.ts";

// Isolated RPC fixture, never a user's daemon, pane, configuration or provider.
const root = mkdtempSync(join(tmpdir(), "herdr-upload-http-"));
const previousSocket = process.env.HERDR_SOCKET;
const previousPaste = process.env.HERDR_WEB_PASTE_DIR;
const sockets = new Set<Socket>();
const socket = process.platform === "win32" ? `\\\\.\\pipe\\herdr-upload-${crypto.randomUUID()}` : join(root, "fixture.sock");
const rpc = createNetServer(client => {
  sockets.add(client);
  client.on("close", () => sockets.delete(client));
  let text = "";
  client.on("data", chunk => {
    text += chunk.toString();
    if (!text.includes("\n")) return;
    const frame = JSON.parse(text.split("\n")[0]!);
    if (frame.method === "events.subscribe") return;
    const missing = frame.method === "pane.get" && frame.params.pane_id !== "fixture:p1";
    const result = frame.method === "pane.get" ? { pane: { pane_id: "fixture:p1", cwd: root } }
      : frame.method === "session.snapshot" ? { workspaces: [], panes: [], tabs: [], layouts: [], agents: [] }
      : { version: "fixture", capabilities: {} };
    client.end(JSON.stringify({ id: frame.id, ...(missing ? { error: { code: "pane_not_found", message: "no such fixture pane" } } : { result }) }) + "\n");
  });
});
let bridge: ReturnType<typeof createServer>;
const headers = { authorization: "Bearer fixture-token", "content-type": "video/mp4", "x-herdr-machine": "1" };
const url = (pane = "fixture:p1") => `http://127.0.0.1:${bridge.port}/api/pane/image?pane_id=${encodeURIComponent(pane)}&name=fixture.mp4`;
const bytes = (size: number) => new ReadableStream<Uint8Array>({ pull(c) { if (!size) c.close(); else { const n = Math.min(size, 256 * 1024); size -= n; c.enqueue(new Uint8Array(n).fill(42)); } } });
beforeAll(async () => {
  delete process.env.HERDR_WEB_PASTE_DIR;
  process.env.HERDR_SOCKET = socket;
  await new Promise<void>((resolve, reject) => { rpc.once("error", reject); rpc.listen(socketAddress(socket), resolve); });
  bridge = createServer({ port: 0, hostname: "127.0.0.1", stateDir: join(root, "state"), token: "fixture-token", terminalAttach: false });
});
afterAll(async () => {
  bridge?.stop();
  for (const client of sockets) client.destroy();
  await new Promise<void>(resolve => rpc.close(() => resolve()));
  if (previousSocket === undefined) delete process.env.HERDR_SOCKET; else process.env.HERDR_SOCKET = previousSocket;
  if (previousPaste === undefined) delete process.env.HERDR_WEB_PASTE_DIR; else process.env.HERDR_WEB_PASTE_DIR = previousPaste;
  rmSync(root, { recursive: true, force: true });
});
it("requires authentication before storing any attachment", async () => {
  const res = await fetch(url(), { method: "POST", body: "private fixture" });
  expect(res.status).toBe(401);
  expect(readdirSync(root)).not.toContain(".herdr-web-ui");
});
it("saves a 16 MiB raw MP4 and the exact 100 MiB ceiling through the real HTTP receiver", async () => {
  for (const size of [16 * 1024 * 1024, MAX_ATTACHMENT_BYTES]) {
    const res = await fetch(url(), { method: "POST", headers, body: bytes(size) });
    expect(res.status).toBe(200);
    const saved = await res.json() as { path: string };
    expect(statSync(saved.path).size).toBe(size);
    expect(readFileSync(saved.path).every(byte => byte === 42)).toBe(true);
  }
}, 30_000);
it("rejects chunked over-limit bodies with the shared 413 and leaves no partial file", async () => {
  const before = readdirSync(join(root, ".herdr-web-ui"));
  const res = await fetch(url(), { method: "POST", headers, body: bytes(MAX_ATTACHMENT_BYTES + 1) });
  expect(res.status).toBe(413);
  expect(await res.json()).toMatchObject({ error: { code: "image_too_large", message: expect.stringContaining("100 MiB") } });
  expect(readdirSync(join(root, ".herdr-web-ui"))).toEqual(before);
}, 30_000);
it("preserves legacy pasted-image JSON and unknown-pane errors", async () => {
  const res = await fetch(`http://127.0.0.1:${bridge.port}/api/pane/image`, { method: "POST", headers: { ...headers, "content-type": "application/json" }, body: JSON.stringify({ pane_id: "fixture:p1", content_type: "image/png", data_base64: "aGVsbG8=" }) });
  expect(res.status).toBe(200);
  expect(readFileSync((await res.json() as { path: string }).path, "utf8")).toBe("hello");
  const missing = await fetch(url("not-a-pane"), { method: "POST", headers, body: "fixture" });
  expect(missing.status).toBe(404);
  expect(await missing.json()).toMatchObject({ error: { code: "pane_not_found" } });
});
it("resumable HTTP endpoint requires auth, enforces 2 GiB without a huge file, and completes exact bytes", async () => {
  const endpoint = `http://127.0.0.1:${bridge.port}/api/pane/attachment-upload`;
  const details = (size: number) => JSON.stringify({ pane_id: "fixture:p1", name: "resumable.mp4", size, fingerprint: "a".repeat(64) });
  expect((await fetch(endpoint, { method: "POST", body: details(3) })).status).toBe(401);
  const jsonHeaders = { ...headers, "content-type": "application/json" };
  const tooLarge = await fetch(endpoint, { method: "POST", headers: jsonHeaders, body: details(2147483649) });
  expect(tooLarge.status).toBe(413); expect(await tooLarge.json()).toMatchObject({ error: { message: expect.stringContaining("2 GiB") } });
  const exact = await fetch(endpoint, { method: "POST", headers: jsonHeaders, body: details(2147483648) }); expect(exact.status).toBe(200);
  const exactState = await exact.json() as { id: string; offset: number; size: number }; expect(exactState.offset).toBe(0); expect(exactState.size).toBe(2147483648);
  expect((await fetch(`${endpoint}?id=${exactState.id}&pane_id=fixture%3Ap1`, { method: "DELETE", headers })).status).toBe(200);
  const start = await fetch(endpoint, { method: "POST", headers: jsonHeaders, body: details(3) }); const state = await start.json() as { id: string };
  const url = `${endpoint}?id=${state.id}&pane_id=fixture%3Ap1`;
  expect((await fetch(url, { method: "GET" })).status).toBe(401);
  const chunk = await fetch(`${url}&offset=0&sha256=ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad`, { method: "PATCH", headers, body: "abc" }); expect(chunk.status).toBe(200);
  const final = await fetch(`${url}&complete=1`, { method: "POST", headers }); expect(final.status).toBe(200);
  const saved = await final.json() as { path: string; sha256: string; size: number }; expect(saved.sha256).toBe("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad"); expect(saved.size).toBe(3); expect(readFileSync(saved.path, "utf8")).toBe("abc");
});
