import { test, expect } from "bun:test";
import { userMessage } from "./userMessage.ts";
test("separates Codex image envelopes from readable user text", () => {
  expect(userMessage('<image name=[Image #1] path="/tmp/my photo.png">opaque attachment</image> Please fix this')).toEqual({text:"Please fix this",images:["/tmp/my photo.png"]});
});
test("preserves prose and non-image markup rather than silently deleting it", () => {
  const text = '<image path="https://example.com/a.png">Example</image> <image path="/tmp/file.txt">Read this</image>';
  expect(userMessage(text)).toEqual({text,images:[]});
});
test("preserves image markup the user is discussing rather than treating it as an attachment", () => {
  const text = '<image path="/tmp/example.png">Example markup</image>';
  expect(userMessage(text)).toEqual({text, images:[]});
});
