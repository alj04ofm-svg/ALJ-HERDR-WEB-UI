import { t } from "./i18n.ts";

/** Bounds headers AND body, even when a stalled reader ignores abort. Never retries. */
export async function withReadDeadline<T>(read: (signal: AbortSignal) => Promise<T>, timeoutMs = 10_000, outer?: AbortSignal): Promise<T> {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  let cancel = () => {};
  const deadline = new Promise<never>((_, reject) => {
    cancel = () => { reject(outer?.reason ?? new DOMException("Aborted", "AbortError")); controller.abort(); };
    if (outer?.aborted) { cancel(); return; }
    outer?.addEventListener("abort", cancel, { once: true });
    timer = setTimeout(() => { reject(new Error(t("Connection read timed out. Check your connection and retry."))); controller.abort(); }, timeoutMs);
  });
  try { return await Promise.race([deadline, Promise.resolve().then(() => { controller.signal.throwIfAborted(); return read(controller.signal); })]); }
  finally { clearTimeout(timer); outer?.removeEventListener("abort", cancel); }
}
