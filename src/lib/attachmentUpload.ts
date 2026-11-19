import { ATTACHMENT_CHUNK_BYTES } from "../../shared/attachments.ts";
export type UploadOptions = { signal?: AbortSignal; onProgress?(fraction: number): void; onSession?(cancel: () => Promise<void>): void };
type Upload = { id: string; size: number; offset: number; chunk_bytes: number; chunks: { offset: number; size: number; sha256: string }[]; complete: boolean; path?: string; sha256?: string };
const digest = async (data: ArrayBuffer) => Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", data)), n => n.toString(16).padStart(2, "0")).join("");
/** Only a bounded slice enters JS memory. The browser streams each Blob request body. */
export async function uploadAttachment(base: string, pane: string, file: Blob, options: UploadOptions = {}): Promise<string> {
  const { signal, onProgress } = options;
  const name = file instanceof File ? file.name : "paste.png";
  const identity = JSON.stringify([name, file.size, file.type, file instanceof File ? file.lastModified : 0,
    await digest(await file.slice(0, 65536).arrayBuffer()), await digest(await file.slice(Math.max(0, file.size - 65536)).arrayBuffer())]);
  const fingerprint = await digest(new TextEncoder().encode(identity).buffer);
  const key = `herdr-web-ui:attachment-upload:${base}:${pane}:${fingerprint}`;
  let remembered: string | null = null;
  try { remembered = localStorage.getItem(key); } catch { /* Manual retries work during this visit. */ }
  const headers = { "x-herdr-machine": "1" };
  const request = async (url: string, init: RequestInit = {}): Promise<Upload> => {
    signal?.throwIfAborted();
    const response = await fetch(url, { ...init, headers: { ...headers, ...init.headers }, signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(120_000)]) : AbortSignal.timeout(120_000) });
    const body = await response.json().catch(() => null);
    if (!response.ok) {
      const error = new Error(body?.error?.message ?? (response.status === 413 ? "The connection rejected an 8 MiB chunk. Retry on a connection accepting this chunk size." : `Upload failed (${response.status}). Retry this file to resume.`)) as Error & { status: number };
      error.status = response.status; throw error;
    }
    return body as Upload;
  };
  let state: Upload | undefined;
  const endpoint = (id: string) => `${base}?${new URLSearchParams({ id, pane_id: pane })}`;
  if (remembered) {
    try { state = await request(endpoint(remembered)); }
    catch (error) { if ((error as { status?: number }).status !== 404) throw error; try { localStorage.removeItem(key); } catch {} }
  }
  if (!state) {
    state = await request(base, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ pane_id: pane, name, size: file.size, fingerprint }) });
    try { localStorage.setItem(key, state.id); } catch {}
  }
  const sessionId = state.id;
  options.onSession?.(async () => {
    for (let attempt = 0; attempt < 5; attempt++) {
      const response = await fetch(endpoint(sessionId), { method: "DELETE", headers, signal: AbortSignal.timeout(15_000) });
      const result = await response.json().catch(() => null);
      if (response.ok || result?.error?.code === "already_attached" || response.status === 404) { try { localStorage.removeItem(key); } catch {} return; }
      if (result?.error?.code !== "upload_busy") throw Error("The partial upload is retained. Reselect the same file to resume.");
      await new Promise(resolve => setTimeout(resolve, 300));
    }
    throw Error("The partial upload is still active and retained. Reselect the same file to resume.");
  });
  if (state.size !== file.size || state.chunk_bytes !== ATTACHMENT_CHUNK_BYTES) throw Error("The stored upload does not match this file. Keep the original file and retry.");
  // Never trust a filename/mtime alone when resuming: compare all confirmed bytes' hashes.
  for (const chunk of state.chunks) {
    signal?.throwIfAborted();
    if (await digest(await file.slice(chunk.offset, chunk.offset + chunk.size).arrayBuffer()) !== chunk.sha256) throw Error("The selected file differs from its confirmed chunks. Select the original file to resume.");
  }
  onProgress?.(state.offset / file.size);
  while (!state.complete && state.offset < file.size) {
    signal?.throwIfAborted();
    const offset = state.offset;
    const chunk = file.slice(offset, Math.min(offset + ATTACHMENT_CHUNK_BYTES, file.size));
    const hash = await digest(await chunk.arrayBuffer());
    let next: Upload | undefined;
    for (let attempt = 0; attempt < 3; attempt++) {
      try { next = await request(`${endpoint(state.id)}&offset=${offset}&sha256=${hash}`, { method: "PATCH", headers: { "content-type": "application/octet-stream" }, body: chunk }); break; }
      catch (error) {
        signal?.throwIfAborted();
        const status = (error as { status?: number }).status;
        if (attempt === 2 || (status && status < 500 && ![408, 409, 429].includes(status))) throw error;
        await new Promise<void>((resolve, reject) => { const abort = () => { clearTimeout(timer); reject(signal?.reason); }; const timer = setTimeout(() => { signal?.removeEventListener("abort", abort); resolve(); }, 500 * (attempt + 1)); signal?.addEventListener("abort", abort, { once: true }); });
      }
    }
    if (!next || next.offset <= offset || next.offset > file.size) throw Error("Upload progress was not confirmed. Retry this file to resume.");
    state = next; onProgress?.(state.offset / file.size);
  }
  if (!state.complete) state = await request(`${endpoint(state.id)}&complete=1`, { method: "POST" });
  if (!state.complete || state.offset !== file.size || !state.path || !/^[a-f0-9]{64}$/.test(state.sha256 ?? "")) throw Error("The saved file's size and SHA-256 were not confirmed. Retry this file.");
  try { localStorage.removeItem(key); } catch {}
  onProgress?.(1);
  return state.path;
}
/** One shared queue prevents repeated selections or pane mounts from creating unbounded transfers. */
let active = 0;
const waiting: (() => void)[] = [];
export async function inAttachmentQueue<T>(run: () => Promise<T>): Promise<T> {
  if (active >= 2) await new Promise<void>(resolve => waiting.push(resolve)); else active++;
  try { return await run(); } finally { const next = waiting.shift(); if (next) next(); else active--; }
}
