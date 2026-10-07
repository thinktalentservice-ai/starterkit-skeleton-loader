import type { SkeletonSnapshot } from "./types";

// Page-session memory only. A persisted shape would outlive the layout it was
// measured from; a reload re-measures in one frame anyway.
const snapshots = new Map<string, SkeletonSnapshot>();

export function getSnapshot(name: string): SkeletonSnapshot | undefined {
  return snapshots.get(name);
}

export function setSnapshot(name: string, snapshot: SkeletonSnapshot): void {
  snapshots.set(name, snapshot);
}

export function clearSkeletonCache(): void {
  snapshots.clear();
}
