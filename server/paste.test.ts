import { afterEach, describe, expect, it } from "bun:test";
import { homedir, tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { mkdtempSync, readdirSync, readFileSync, rmSync, statSync } from "node:fs";
import { LEGACY_ATTACHMENT_BYTES as MAX_ATTACHMENT_BYTES } from "../shared/attachments.ts";
import { pasteDirectory, saveAttachmentStream } from "./paste.ts";

describe("pasteDirectory", () => {
  const previous = process.env["HERDR_WEB_PASTE_DIR"];
  afterEach(() => {
    if (previous === undefined) delete process.env["HERDR_WEB_PASTE_DIR"]; else process.env["HERDR_WEB_PASTE_DIR"] = previous;
  });

  it("keeps attachments next to the pane, or in the temp dir without a cwd", () => {
    delete process.env["HERDR_WEB_PASTE_DIR"];
    expect(pasteDirectory("/work/repo")).toBe(join("/work/repo", ".herdr-web-ui"));
    expect(pasteDirectory(null)).toBe(join(tmpdir(), "herdr-web-ui", ".herdr-web-ui"));
  });

  it("uses HERDR_WEB_PASTE_DIR for every pane when set, as an absolute path", () => {
    process.env["HERDR_WEB_PASTE_DIR"] = "/var/tmp/pastes";
    expect(pasteDirectory("/work/repo")).toBe(resolve("/var/tmp/pastes"));
    expect(pasteDirectory(undefined)).toBe(resolve("/var/tmp/pastes"));
    process.env["HERDR_WEB_PASTE_DIR"] = "pastes";
    expect(pasteDirectory("/work/repo")).toBe(resolve("pastes"));
  });

  it("expands a leading ~ to the home directory", () => {
    process.env["HERDR_WEB_PASTE_DIR"] = "~/pastes";
    expect(pasteDirectory("/work/repo")).toBe(join(homedir(), "pastes"));
    process.env["HERDR_WEB_PASTE_DIR"] = "~";
    expect(pasteDirectory("/work/repo")).toBe(homedir());
    process.env["HERDR_WEB_PASTE_DIR"] = "~/";
    expect(pasteDirectory("/work/repo")).toBe(homedir());
  });

  it("stays under the home directory with a doubled or a Windows separator after ~", () => {
    process.env["HERDR_WEB_PASTE_DIR"] = "~//pastes";
    expect(pasteDirectory("/work/repo")).toBe(join(homedir(), "pastes"));
    process.env["HERDR_WEB_PASTE_DIR"] = "~\\pastes";
    expect(pasteDirectory("/work/repo")).toBe(join(homedir(), "pastes"));
    // a name that only starts with ~ is a folder of that name, not the home directory
    process.env["HERDR_WEB_PASTE_DIR"] = "~pastes";
    expect(pasteDirectory("/work/repo")).toBe(resolve("~pastes"));
  });

  it("ignores spaces around the value, and a value of only spaces", () => {
    process.env["HERDR_WEB_PASTE_DIR"] = "  /var/tmp/pastes  ";
    expect(pasteDirectory("/work/repo")).toBe(resolve("/var/tmp/pastes"));
    process.env["HERDR_WEB_PASTE_DIR"] = "   ";
    expect(pasteDirectory("/work/repo")).toBe(join("/work/repo", ".herdr-web-ui"));
  });

  it("treats an empty HERDR_WEB_PASTE_DIR as unset", () => {
    process.env["HERDR_WEB_PASTE_DIR"] = "";
    expect(pasteDirectory("/work/repo")).toBe(join("/work/repo", ".herdr-web-ui"));
  });
});


describe("streamed attachments", () => {
  const roots: string[] = [];
  afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });
  const directory = () => { const root = mkdtempSync(join(tmpdir(), "herdr-upload-fixture-")); roots.push(root); return root; };
  const stream = (size: number) => new ReadableStream<Uint8Array>({
    pull(controller) {
      if (!size) { controller.close(); return; }
      const n = Math.min(size, 256 * 1024);
      size -= n;
      controller.enqueue(new Uint8Array(n).fill(37));
    },
  });
  it("stores the exact byte ceiling, sanitized filename and private mode without buffering the file", async () => {
    const root = directory();
    const path = await saveAttachmentStream(root, { body: stream(MAX_ATTACHMENT_BYTES), contentType: "video/mp4", name: "../clip.MP4" });
    expect(statSync(path).size).toBe(MAX_ATTACHMENT_BYTES);
    if (process.platform !== "win32") expect(statSync(path).mode & 0o777).toBe(0o600);
    expect(path.startsWith(join(root, "clip-"))).toBe(true);
    expect(path.endsWith(".mp4")).toBe(true);
    expect(readdirSync(root)).toHaveLength(1);
  });
  it("counts actual bytes with no length or a misleading length and removes only its own incomplete upload", async () => {
    for (const contentLength of [undefined, "1"]) {
      const root = directory();
      const kept = await saveAttachmentStream(root, { body: stream(3), contentType: "text/plain", name: "kept.txt" });
      await expect(saveAttachmentStream(root, { body: stream(MAX_ATTACHMENT_BYTES + 1), contentType: "video/mp4", contentLength })).rejects.toMatchObject({ status: 413, code: "image_too_large" });
      expect(readdirSync(root)).toHaveLength(1);
      expect([...readFileSync(kept)]).toEqual([37, 37, 37]);
    }
  });
  it("refuses declared oversize before consuming the stream", async () => {
    const root = directory();
    await expect(saveAttachmentStream(root, { body: stream(1), contentType: "video/mp4", contentLength: String(MAX_ATTACHMENT_BYTES + 1) })).rejects.toMatchObject({ status: 413 });
    expect(readdirSync(root)).toEqual([]);
  });
  it("does not publish empty or interrupted uploads", async () => {
    const root = directory();
    await expect(saveAttachmentStream(root, { body: stream(0), contentType: "video/mp4" })).rejects.toMatchObject({ status: 400 });
    let reads = 0;
    const broken = new ReadableStream<Uint8Array>({ pull(controller) { if (reads++) controller.error(new Error("disconnected")); else controller.enqueue(new Uint8Array(1024)); } });
    await expect(saveAttachmentStream(root, { body: broken, contentType: "video/mp4" })).rejects.toThrow("disconnected");
    expect(readdirSync(root)).toEqual([]);
  });
});
