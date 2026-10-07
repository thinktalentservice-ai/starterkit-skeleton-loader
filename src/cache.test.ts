import { clearSkeletonCache, getSnapshot, setSnapshot } from "./cache";
import type { SkeletonSnapshot } from "./types";

const snapshot = (width: number): SkeletonSnapshot => ({ bones: [], width, height: 10 });

describe("snapshot cache", () => {
  beforeEach(() => clearSkeletonCache());

  it("returns undefined for a name it has not seen", () => {
    expect(getSnapshot("card")).toBeUndefined();
  });

  it("returns what was stored under a name", () => {
    const stored = snapshot(100);
    setSnapshot("card", stored);
    expect(getSnapshot("card")).toBe(stored);
  });

  it("replaces an earlier snapshot for the same name", () => {
    setSnapshot("card", snapshot(100));
    setSnapshot("card", snapshot(200));
    expect(getSnapshot("card")?.width).toBe(200);
  });

  it("keeps names apart", () => {
    setSnapshot("card", snapshot(100));
    expect(getSnapshot("row")).toBeUndefined();
  });

  it("forgets everything on clear", () => {
    setSnapshot("card", snapshot(100));
    clearSkeletonCache();
    expect(getSnapshot("card")).toBeUndefined();
  });
});
