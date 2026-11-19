import { expect, test } from "bun:test";
import type { ConversationPart } from "../../shared/protocol.ts";
import { recordedFiles } from "./liveActivity.ts";

const tool = (name: string, input: string): ConversationPart =>
  ({ kind: "tool", name, input, output: "", summary: "" });

test("activity names only explicit file targets and keeps each path once", () => {
  const parts = [
    tool("Read", JSON.stringify({ file_path: "src/settings.ts" })),
    tool("exec_command", JSON.stringify({ cmd: "cat private-notes.txt" })),
    tool("Edit", JSON.stringify({ file_path: "src/settings.ts" })),
    tool("apply_patch", "*** Begin Patch\n*** Update File: src/App.tsx\n*** End Patch"),
  ];
  expect(recordedFiles(parts)).toEqual(["src/App.tsx", "src/settings.ts"]);
});
