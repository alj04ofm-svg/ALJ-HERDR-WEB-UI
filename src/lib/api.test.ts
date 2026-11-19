import { afterEach, expect, it } from "bun:test";
import { MAX_ATTACHMENT_BYTES, ATTACHMENT_CHUNK_BYTES } from "../../shared/attachments.ts";
import { AttachmentTooLargeError, uploadPaneImage } from "./api.ts";
import { inAttachmentQueue } from "./attachmentUpload.ts";
const realFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = realFetch; });
it("rejects 2 GiB+1 before reading or fetching, without allocating a huge fixture", async () => {
  const over = new File(["fixture"], "over.mp4", { type: "video/mp4" });
  Object.defineProperty(over, "size", { value: MAX_ATTACHMENT_BYTES + 1 });
  over.arrayBuffer = () => { throw Error("must not read"); };
  globalThis.fetch = (() => { throw Error("must not fetch"); }) as unknown as typeof fetch;
  const refused = await uploadPaneImage("p1", over).catch(error => error);
  expect(refused).toBeInstanceOf(AttachmentTooLargeError); expect(refused.message).toContain("2 GiB");
});
it("uses the selected remote machine, bounded Blob chunks and exact completion metadata", async () => {
  let offset = 0; const calls: string[] = [];
  const file = new File([new Uint8Array(ATTACHMENT_CHUNK_BYTES + 1)], "a & b.mp4", { type: "video/mp4" });
  file.arrayBuffer = () => { throw Error("never read the whole file"); };
  globalThis.fetch = (async (url: string, init: RequestInit = {}) => {
    calls.push(url); expect(url.startsWith("/api/machines/pc1/pane/attachment-upload")).toBe(true);
    if (init.method === "POST" && !url.includes("id=")) { const p = JSON.parse(init.body as string); expect(p.name).toBe(file.name); expect(p.size).toBe(file.size); }
    if (init.method === "PATCH") { expect(init.body).toBeInstanceOf(Blob); expect((init.body as Blob).size).toBeLessThanOrEqual(ATTACHMENT_CHUNK_BYTES); offset += (init.body as Blob).size; }
    const complete = url.includes("complete=1");
    return Response.json({ id: "fixture-id", size: file.size, offset, chunk_bytes: ATTACHMENT_CHUNK_BYTES, chunks: [], complete, ...(complete ? { path: "/remote/file.mp4", sha256: "a".repeat(64) } : {}) });
  }) as unknown as typeof fetch;
  expect(await uploadPaneImage("p1", file, "pc1")).toBe("/remote/file.mp4"); expect(offset).toBe(file.size); expect(calls.filter(url => url.includes("offset="))).toHaveLength(2);
});
it("reports an ingress 413 with a useful chunk-size recovery error", async () => {
  globalThis.fetch = (async () => new Response("<html>413</html>", { status: 413 })) as unknown as typeof fetch;
  const refused = await uploadPaneImage("p1", new File(["x"], "video.mp4")).catch(error => error);
  expect(refused.status).toBe(413); expect(refused.message).toContain("8 MiB chunk");
});
it("100 selected files share a queue with at most two active transfers", async () => {
  let active = 0, peak = 0;
  await Promise.all(Array.from({ length: 100 }, () => inAttachmentQueue(async () => { active++; peak = Math.max(peak, active); await new Promise(resolve => setTimeout(resolve, 1)); active--; })));
  expect(peak).toBe(2); expect(active).toBe(0);
});
