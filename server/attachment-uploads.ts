/** Resumable attachment transport. Checkpoints and incomplete bytes are private; final files
 * stay in the pane's attachment directory. Never reads or replaces an existing attachment. */
import { createReadStream } from "node:fs";
import { mkdir, open, readFile, readdir, rename, stat, statfs, unlink } from "node:fs/promises";
import { createHash } from "node:crypto";
import { join } from "node:path";
import { MAX_ATTACHMENT_BYTES, ATTACHMENT_CHUNK_BYTES } from "../shared/attachments.ts";
import { PasteImageError, pasteDirectory } from "./paste.ts";
import { paneGet } from "./herdr/client.ts";

type Pane = { cwd?: string | null; terminal_id?: string | null };
type Checkpoint = { id: string; owner: string; pane: string; terminal: string | null; cwd: string | null; name: string; size: number; fingerprint: string; offset: number; chunks: { offset: number; size: number; sha256: string }[]; partial: string; path: string; sha256?: string; created: number; updated: number; complete: boolean };
const fail = (code: string, message: string, status = 400): never => { throw new PasteImageError(code, message, status); };
const sha = (value: unknown): value is string => typeof value === "string" && /^[a-f0-9]{64}$/.test(value);
const integer = (value: unknown): value is number => typeof value === "number" && Number.isSafeInteger(value);
export function validateAttachmentSize(size: unknown): asserts size is number {
  if (!integer(size) || size < 1) fail("invalid_size", "Choose a nonempty file with an exact byte size.");
  if ((size as number) > MAX_ATTACHMENT_BYTES) fail("attachment_too_large", "Each file can be up to 2 GiB (2,147,483,648 bytes).", 413);
}
/** Metadata bodies stay small even when Content-Length is absent. */
export async function readUploadDetails(request: Request): Promise<unknown> {
  if (Number(request.headers.get("content-length")) > 4096) fail("invalid_upload", "File details exceed 4 KiB.", 413);
  if (!request.body) fail("invalid_upload", "File details are required.");
  const reader = request.body!.getReader(); const decoder = new TextDecoder(); let text = "", size = 0;
  try { for (;;) { const { done, value } = await reader.read(); if (done) break; size += value.byteLength; if (size > 4096) fail("invalid_upload", "File details exceed 4 KiB.", 413); text += decoder.decode(value, { stream: true }); } text += decoder.decode(); }
  finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
  try { return JSON.parse(text) as unknown; } catch { return fail("invalid_upload", "File details must be valid JSON."); }
}
export class AttachmentUploads {
  private busy = new Set<string>();
  private admission: Promise<void> = Promise.resolve();
  private async admit<T>(run: () => Promise<T>): Promise<T> { const prior = this.admission; let release!: () => void; this.admission = new Promise<void>(resolve => { release = resolve; }); await prior; try { return await run(); } finally { release(); } }
  constructor(private root: string, private lookup: (pane: string) => Promise<Pane> = paneGet) {}
  private file(id: string) { if (!/^[a-f0-9-]{36}$/.test(id)) fail("upload_not_found", "Upload not found.", 404); return join(this.root, `${id}.json`); }
  private async write(c: Checkpoint) {
    await mkdir(this.root, { recursive: true, mode: 0o700 });
    const tmp = `${this.file(c.id)}.${crypto.randomUUID()}.tmp`;
    const f = await open(tmp, "wx", 0o600);
    try { await f.writeFile(JSON.stringify(c)); await f.sync(); } finally { await f.close(); }
    await rename(tmp, this.file(c.id));
  }
  private async load(id: string, owner: string, pane: string) {
    let c: Checkpoint;
    try { c = JSON.parse(await readFile(this.file(id), "utf8")) as Checkpoint; }
    catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") fail("upload_not_found", "Upload checkpoint was not found. Select the file to start again.", 404); throw error; }
    if (c.owner !== owner || c.pane !== pane) fail("upload_not_found", "Upload does not belong to this pane and device.", 404);
    const current = await this.lookup(pane);
    if ((current.terminal_id ?? null) !== c.terminal || (current.cwd ?? null) !== c.cwd) fail("pane_changed", "This pane changed. Return to the original pane or start a new upload.", 409);
    return c;
  }
  private view(c: Checkpoint) { return { id: c.id, size: c.size, offset: c.offset, chunk_bytes: ATTACHMENT_CHUNK_BYTES, chunks: c.chunks, complete: c.complete, ...(c.complete ? { path: c.path, sha256: c.sha256 } : {}) }; }
  private async locked<T>(id: string, run: () => Promise<T>): Promise<T> {
    if (this.busy.has(id)) fail("upload_busy", "This file is already being transferred. Retry shortly.", 409);
    if (this.busy.size >= 4) fail("upload_busy", "Four transfers are active. Retry shortly.", 429);
    this.busy.add(id);
    try { return await run(); } catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOSPC") fail("attachment_storage_full", "Not enough disk space. Your confirmed chunks are retained; retry after space is available.", 507); throw error; } finally { this.busy.delete(id); }
  }
  async start(owner: string, payload: unknown) {
    if (!payload || typeof payload !== "object") fail("invalid_upload", "Expected file details.");
    const p = payload as Record<string, unknown>;
    validateAttachmentSize(p.size);
    if (typeof p.pane_id !== "string" || !p.pane_id.trim() || typeof p.name !== "string" || p.name.length > 512 || !sha(p.fingerprint)) fail("invalid_upload", "File name, pane and fingerprint are required.");
    return this.admit(() => this.locked("admission", async () => {
      const pane = await this.lookup(p.pane_id as string);
      await mkdir(this.root, { recursive: true, mode: 0o700 });
      let reserved = 0, active = 0;
      for (const name of await readdir(this.root)) {
        if (!name.endsWith(".json")) continue;
        const c = JSON.parse(await readFile(join(this.root, name), "utf8")) as Checkpoint;
        if (!c.complete && c.owner === owner && c.pane === p.pane_id && c.fingerprint === p.fingerprint && c.size === p.size && c.name === (p.name as string).normalize("NFC").replace(/[^\p{L}\p{N}._-]+/gu, "_").replace(/^[._]+/, "").slice(-100) && c.terminal === (pane.terminal_id ?? null) && c.cwd === (pane.cwd ?? null)) return this.view(c);
        if (!c.complete) { active++; reserved += c.size - c.offset; }
      }
      if (active >= 100 || reserved + (p.size as number) > 4 * MAX_ATTACHMENT_BYTES) fail("upload_capacity", "Unfinished uploads have reached the queue capacity. Resume or cancel an unfinished file first.", 429);
      const directory = pasteDirectory(pane.cwd);
      await mkdir(directory, { recursive: true, mode: 0o700 });
      const disk = await statfs(directory);
      if (disk.bavail * disk.bsize < reserved + (p.size as number)) fail("attachment_storage_full", "There is not enough free disk space for this file and unfinished uploads.", 507);
      const id = crypto.randomUUID();
      const name = (p.name as string).normalize("NFC").replace(/[^\p{L}\p{N}._-]+/gu, "_").replace(/^[._]+/, "").slice(-100) || "attachment.bin";
      const c: Checkpoint = { id, owner, pane: p.pane_id as string, terminal: pane.terminal_id ?? null, cwd: pane.cwd ?? null, name, size: p.size as number, fingerprint: p.fingerprint as string, offset: 0, chunks: [], partial: join(directory, `.upload-${id}.part`), path: join(directory, `${id}-${name}`), created: Date.now(), updated: Date.now(), complete: false };
      const f = await open(c.partial, "wx", 0o600); await f.close();
      try { await this.write(c); } catch (error) { await unlink(c.partial).catch(() => {}); throw error; }
      return this.view(c);
    }));
  }
  async status(id: string, owner: string, pane: string) { return this.view(await this.load(id, owner, pane)); }
  async chunk(id: string, owner: string, pane: string, offset: number, expected: string, request: Request) {
    return this.locked(id, async () => {
      const c = await this.load(id, owner, pane);
      if (!integer(offset) || offset < 0 || !sha(expected)) fail("invalid_chunk", "An exact offset and SHA-256 are required.");
      if (c.complete) return this.view(c);
      // An accepted chunk may have lost its HTTP response. A matching retry never appends twice.
      const accepted = c.chunks.find(chunk => chunk.offset === offset);
      if (accepted) { if (accepted.sha256 !== expected) fail("chunk_conflict", "This chunk does not match the confirmed file. Select the original file.", 409); return this.view(c); }
      if (offset !== c.offset) fail("offset_conflict", "The confirmed offset changed. Retry to resume from the checkpoint.", 409);
      const length = Math.min(ATTACHMENT_CHUNK_BYTES, c.size - c.offset);
      if (length <= 0 || !request.body) fail("invalid_chunk", "No chunk is expected at this offset.");
      const declared = request.headers.get("content-length");
      if (declared !== null && Number(declared) !== length) fail("invalid_chunk_size", `Expected exactly ${length} bytes.`, Number(declared) > ATTACHMENT_CHUNK_BYTES ? 413 : 400);
      const f = await open(c.partial, "r+");
      const reader = request.body!.getReader(); let committed = false;
      try {
        const s = await f.stat();
        if (s.size < c.offset) fail("checkpoint_incomplete", "Stored chunks are missing. Cancel this partial upload and select the original file again.", 409);
        await f.truncate(c.offset); // Recover only uncommitted bytes of this private partial.
        let received = 0; const hash = createHash("sha256");
        for (;;) {
          request.signal.throwIfAborted();
          const { done, value } = await reader.read(); if (done) break;
          if (received + value.length > length) fail("chunk_too_large", `A chunk is at most ${ATTACHMENT_CHUNK_BYTES} bytes.`, 413);
          hash.update(value);
          let written = 0;
          while (written < value.length) { const r = await f.write(value, written, value.length - written, c.offset + received + written); if (!r.bytesWritten) throw Error("Attachment write made no progress"); written += r.bytesWritten; }
          received += value.length;
        }
        request.signal.throwIfAborted();
        if (received !== length || hash.digest("hex") !== expected) fail("chunk_hash_mismatch", "Chunk size or SHA-256 did not match. Retry this file.", 422);
        await f.sync();
        c.chunks.push({ offset: c.offset, size: received, sha256: expected }); c.offset += received; c.updated = Date.now();
        await this.write(c); committed = true;
        return this.view(c);
      } finally { if (!committed) await f.truncate(offset).catch(() => {}); await f.close(); await reader.cancel().catch(() => {}); reader.releaseLock(); }
    });
  }
  async finish(id: string, owner: string, pane: string) {
    return this.locked(id, async () => {
      const c = await this.load(id, owner, pane);
      if (c.complete) return this.view(c);
      if (c.offset !== c.size) fail("upload_incomplete", "Finish uploading every chunk before attaching the file.", 409);
      let file = c.partial;
      try { await stat(file); } catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; file = c.path; } // Rename may have completed before a restart.
      if ((await stat(file)).size !== c.size) fail("final_size_mismatch", "Stored file size did not match. The file has not been attached.", 422);
      const whole = createHash("sha256");
      // Re-read every chunk from disk, bounded to the stream's high water mark, before publication.
      for (const chunk of c.chunks) {
        const part = createHash("sha256");
        for await (const bytes of createReadStream(file, { start: chunk.offset, end: chunk.offset + chunk.size - 1, highWaterMark: 256 * 1024 })) { part.update(bytes); whole.update(bytes); }
        if (part.digest("hex") !== chunk.sha256) fail("final_hash_mismatch", "Stored file hash did not match. The file has not been attached.", 422);
      }
      c.sha256 = whole.digest("hex");
      if (file === c.partial) await rename(c.partial, c.path);
      c.complete = true; c.updated = Date.now(); await this.write(c);
      return this.view(c);
    });
  }
  async cancel(id: string, owner: string, pane: string) {
    return this.locked(id, async () => { const c = await this.load(id, owner, pane); if (c.complete) fail("already_attached", "Completed attachments are preserved. Remove the draft mention to detach it.", 409); await unlink(c.partial).catch(error => { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }); await unlink(this.file(id)); return { cancelled: true }; });
  }
}
