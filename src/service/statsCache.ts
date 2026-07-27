import type { SeriesStats } from "./seriesAggregator";

const CACHE_STORAGE_KEY = "cachedSeriesStats";

// 이 시간보다 캐시가 신선하면 백그라운드 재조회를 생략한다 — 방금 불러온 결과를
// 팝업을 열 때마다 매번 무겁게 다시 조회하는 걸 방지하기 위함.
export const CACHE_FRESH_THRESHOLD_MS = 5 * 60 * 1000;

export interface CachedSeriesStats {
  username: string;
  seriesStats: SeriesStats[];
  cachedAt: number;
}

export function isCacheFresh(cachedAt: number, now: number = Date.now()): boolean {
  return now - cachedAt < CACHE_FRESH_THRESHOLD_MS;
}

export async function loadCachedSeriesStats(): Promise<CachedSeriesStats | null> {
  const stored = await chrome.storage.local.get(CACHE_STORAGE_KEY);
  const cached = stored[CACHE_STORAGE_KEY] as CachedSeriesStats | undefined;
  return cached ?? null;
}

export async function saveCachedSeriesStats(
  username: string,
  seriesStats: SeriesStats[],
): Promise<void> {
  const cached: CachedSeriesStats = { username, seriesStats, cachedAt: Date.now() };
  await chrome.storage.local.set({ [CACHE_STORAGE_KEY]: cached });
}
