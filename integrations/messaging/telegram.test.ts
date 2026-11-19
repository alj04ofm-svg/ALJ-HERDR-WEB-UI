import { Socket } from "node:net";
import { expect, it, spyOn } from "bun:test";
import { createTelegramClient, TelegramAdapter } from "./telegram.ts";
it("constructs the actual production client with one connection attempt, bounded RPC attempts and no automatic reconnect, without network", async () => {
  const previous = globalThis.fetch; let calls = 0;
  const tcp = spyOn(Socket.prototype, "connect").mockImplementation(() => { calls++; throw Error("TCP forbidden in offline constructor check"); });
  globalThis.fetch = (() => { calls++; throw Error("Network forbidden in offline constructor check"); }) as typeof fetch;
  let client: Awaited<ReturnType<typeof createTelegramClient>> | undefined;
  try {
    client = await createTelegramClient(12345, "a".repeat(32), "", new AbortController().signal);
    expect(client._connectionRetries).toBe(1); expect(client._requestRetries).toBe(3);
    expect(client._autoReconnect).toBe(false); expect(client._sender).toBeUndefined();
    expect(calls).toBe(0);
    const cancelled = new AbortController(); cancelled.abort();
    await expect(createTelegramClient(12345, "a".repeat(32), "", cancelled.signal)).rejects.toThrow();
    expect(() => new TelegramAdapter("/tmp/unused-messaging-fixture", "../../invalid")).toThrow();
  } finally { if (client) await client.destroy(); globalThis.fetch = previous; tcp.mockRestore(); }
});
