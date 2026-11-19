import type { Machine } from "../../shared/machines.ts";

export function machineDisplayName(machine: Pick<Machine, "kind" | "name"> | undefined, fallback = ""): string {
  return machine?.name ?? fallback;
}
