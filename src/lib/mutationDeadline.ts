/** A missing receipt does not prove that the server rejected a mutation. */
export class MutationOutcomeUnknown extends Error {
  constructor(cause?: unknown) {
    super("Mutation outcome is unknown", { cause });
    this.name = "MutationOutcomeUnknown";
  }
}

/** One submission, bounded through its response body. Abort is not server rollback. Never retries. */
export async function withMutationDeadline<T>(submit: (signal: AbortSignal) => Promise<T>, timeoutMs = 15_000): Promise<T> {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<never>((_, reject) => {
    timer = setTimeout(() => { reject(new MutationOutcomeUnknown()); controller.abort(); }, timeoutMs);
  });
  try { return await Promise.race([deadline, Promise.resolve().then(() => submit(controller.signal))]); }
  finally { clearTimeout(timer); }
}
