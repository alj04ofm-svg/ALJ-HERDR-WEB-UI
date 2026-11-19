import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, readFile, readdir, rm, writeFile, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { AttachmentUploads, validateAttachmentSize } from "./attachment-uploads.ts";
import { ATTACHMENT_CHUNK_BYTES, MAX_ATTACHMENT_BYTES } from "../shared/attachments.ts";
const roots: string[] = [];
afterEach(async () => { for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true }); });
const sha = (b: Uint8Array | string) => createHash("sha256").update(b).digest("hex");
async function fixture() { const root = await mkdtemp(join(tmpdir(), "herdr-upload-test-")); roots.push(root); let terminal = "test-terminal"; const pane = { cwd: root, get terminal_id() { return terminal; } }; const lookup = async (id: string) => { if (id !== "test-pane") throw Error("unknown pane"); return pane; }; return { root, manager: new AttachmentUploads(join(root, "state"), lookup), restart: () => new AttachmentUploads(join(root, "state"), lookup), change: () => { terminal = "replaced"; } }; }
const init = (size: number) => ({ pane_id: "test-pane", name: "fixture.mp4", size, fingerprint: sha("identity") });
const request = (bytes: Uint8Array) => new Request("http://localhost/api/pane/attachment-upload", { method: "PATCH", body: new Uint8Array(bytes).buffer, headers: { "content-length": String(bytes.length) } });
describe("resumable attachments", () => {
  test("exact 2 GiB guard uses integers without allocating a large fixture", () => { expect(MAX_ATTACHMENT_BYTES).toBe(2147483648); expect(() => validateAttachmentSize(MAX_ATTACHMENT_BYTES)).not.toThrow(); for (const value of [MAX_ATTACHMENT_BYTES + 1, 0, -1, 1.1, NaN, Infinity, "2147483648"]) expect(() => validateAttachmentSize(value)).toThrow(); expect(Math.ceil(MAX_ATTACHMENT_BYTES / ATTACHMENT_CHUNK_BYTES)).toBe(256); });
  test("oversize is refused before pane lookup or state creation", async () => { const f = await fixture(); await expect(f.manager.start("owner", init(MAX_ATTACHMENT_BYTES + 1))).rejects.toMatchObject({ status: 413 }); expect(await readdir(f.root)).toEqual([]); });
  test("restart/resume, idempotent lost response, exact final hash, private bytes", async () => {
    const f = await fixture(), bytes = new Uint8Array(ATTACHMENT_CHUNK_BYTES + 31).fill(57);
    let state = await f.manager.start("owner", init(bytes.length));
    const first = bytes.subarray(0, ATTACHMENT_CHUNK_BYTES);
    state = await f.manager.chunk(state.id, "owner", "test-pane", 0, sha(first), request(first));
    expect(state.offset).toBe(ATTACHMENT_CHUNK_BYTES);
    const resumed = f.restart();
    const duplicate = await resumed.chunk(state.id, "owner", "test-pane", 0, sha(first), request(first)); expect(duplicate.offset).toBe(state.offset);
    const last = bytes.subarray(ATTACHMENT_CHUNK_BYTES);
    await resumed.chunk(state.id, "owner", "test-pane", state.offset, sha(last), request(last));
    const final = await resumed.finish(state.id, "owner", "test-pane");
    expect(final.sha256).toBe(sha(bytes)); expect(final.size).toBe(bytes.length); expect(final.offset).toBe(bytes.length);
    expect(await readFile(final.path!)).toEqual(Buffer.from(bytes)); if (process.platform !== "win32") expect((await stat(final.path!)).mode & 0o777).toBe(0o600);
    expect(await resumed.finish(state.id, "owner", "test-pane")).toEqual(final);
    await expect(resumed.cancel(state.id, "owner", "test-pane")).rejects.toMatchObject({ status: 409 }); expect((await stat(final.path!)).size).toBe(bytes.length);
  });
  test("bad hash/short chunk rolls back, cancel touches only its own partial", async () => { const f = await fixture(), bytes = new Uint8Array([1, 2, 3]); const state = await f.manager.start("owner", init(3)); await writeFile(join(f.root, "existing-media.mp4"), "preserve"); await expect(f.manager.chunk(state.id, "owner", "test-pane", 0, sha("wrong"), request(bytes))).rejects.toMatchObject({ status: 422 }); expect((await f.manager.status(state.id, "owner", "test-pane")).offset).toBe(0); await expect(f.manager.finish(state.id, "owner", "test-pane")).rejects.toMatchObject({ status: 409 }); await f.manager.cancel(state.id, "owner", "test-pane"); expect(await readFile(join(f.root, "existing-media.mp4"), "utf8")).toBe("preserve"); });
  test("owner, pane identity, offset and chunk bounds are enforced", async () => { const f = await fixture(), bytes = new Uint8Array([1,2,3]); const state = await f.manager.start("owner", init(3)); await expect(f.manager.status(state.id, "other-device", "test-pane")).rejects.toMatchObject({ status: 404 }); await expect(f.manager.status(state.id, "owner", "another-pane")).rejects.toMatchObject({ status: 404 }); await expect(f.manager.chunk(state.id, "owner", "test-pane", -1, sha(bytes), request(bytes))).rejects.toMatchObject({ status: 400 }); await expect(f.manager.chunk(state.id, "owner", "test-pane", 1, sha(bytes), request(bytes))).rejects.toMatchObject({ status: 409 }); const over = new Request("http://localhost", { method: "PATCH", body: "x", headers: { "content-length": String(ATTACHMENT_CHUNK_BYTES+1) } }); await expect(f.manager.chunk(state.id, "owner", "test-pane", 0, sha(bytes), over)).rejects.toMatchObject({ status: 413 }); f.change(); await expect(f.manager.status(state.id, "owner", "test-pane")).rejects.toMatchObject({ status: 409 }); });
  test("crash tail recovery only truncates unconfirmed partial bytes", async () => { const f = await fixture(), bytes = new Uint8Array([4,5,6]); const state = await f.manager.start("owner", init(3)); const partial = join(f.root, ".herdr-web-ui", `.upload-${state.id}.part`); await writeFile(partial, "unconfirmed tail"); await f.restart().chunk(state.id, "owner", "test-pane", 0, sha(bytes), request(bytes)); const final = await f.restart().finish(state.id, "owner", "test-pane"); expect(final.sha256).toBe(sha(bytes)); });
});
test("interrupted request keeps the last confirmed offset and no uncommitted bytes", async () => {
  const f = await fixture(), state = await f.manager.start("owner", init(3));
  const controller = new AbortController();
  const body = new ReadableStream<Uint8Array>({ start(stream) { stream.enqueue(new Uint8Array([1])); controller.abort(); stream.close(); } });
  const req = new Request("http://localhost", { method: "PATCH", body, signal: controller.signal });
  await expect(f.manager.chunk(state.id, "owner", "test-pane", 0, sha("abc"), req)).rejects.toBeDefined();
  expect((await f.restart().status(state.id, "owner", "test-pane")).offset).toBe(0);
  expect((await stat(join(f.root, ".herdr-web-ui", `.upload-${state.id}.part`))).size).toBe(0);
});
test("finish rejects disk corruption and can recover a completed rename after restart", async () => {
  const f = await fixture(), bytes = new Uint8Array([1,2,3]), state = await f.manager.start("owner", init(3));
  await f.manager.chunk(state.id, "owner", "test-pane", 0, sha(bytes), request(bytes));
  const partial = join(f.root, ".herdr-web-ui", `.upload-${state.id}.part`);
  await writeFile(partial, new Uint8Array([9,9,9]));
  await expect(f.manager.finish(state.id, "owner", "test-pane")).rejects.toMatchObject({ status: 422 });
  await writeFile(partial, bytes);
  const metadata = JSON.parse(await readFile(join(f.root, "state", `${state.id}.json`), "utf8")) as { path: string };
  const { rename } = await import("node:fs/promises"); await rename(partial, metadata.path);
  expect((await f.restart().finish(state.id, "owner", "test-pane")).sha256).toBe(sha(bytes));
});
