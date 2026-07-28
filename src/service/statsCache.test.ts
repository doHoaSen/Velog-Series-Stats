import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  CACHE_FRESH_THRESHOLD_MS,
  isCacheFresh,
  loadCachedSeriesStats,
  saveCachedSeriesStats,
} from "./statsCache";

describe("isCacheFresh", () => {
  it("기준 시간 이내면 true를 반환한다", () => {
    const now = 1_000_000;
    expect(isCacheFresh(now - CACHE_FRESH_THRESHOLD_MS + 1, now)).toBe(true);
  });

  it("기준 시간을 넘으면 false를 반환한다", () => {
    const now = 1_000_000;
    expect(isCacheFresh(now - CACHE_FRESH_THRESHOLD_MS - 1, now)).toBe(false);
  });
});

describe("loadCachedSeriesStats / saveCachedSeriesStats", () => {
  const storage = new Map<string, unknown>();

  beforeEach(() => {
    storage.clear();
    vi.stubGlobal("chrome", {
      storage: {
        local: {
          get: vi.fn((key: string) =>
            Promise.resolve(storage.has(key) ? { [key]: storage.get(key) } : {}),
          ),
          set: vi.fn((items: Record<string, unknown>) => {
            for (const [key, value] of Object.entries(items)) storage.set(key, value);
            return Promise.resolve();
          }),
        },
      },
    });
  });

  it("저장한 값을 다시 불러올 수 있다", async () => {
    await saveCachedSeriesStats("tester", [], []);
    const cached = await loadCachedSeriesStats();

    expect(cached?.username).toBe("tester");
  });

  it("저장된 값이 없으면 null을 반환한다", async () => {
    const cached = await loadCachedSeriesStats();
    expect(cached).toBeNull();
  });

  it("스키마 버전이 다른(예전 형식) 캐시는 폐기하고 null을 반환한다", async () => {
    storage.set("cachedSeriesStats", {
      username: "tester",
      seriesStats: [],
      cachedAt: Date.now(),
      schemaVersion: 0,
    });

    const cached = await loadCachedSeriesStats();
    expect(cached).toBeNull();
  });
});
