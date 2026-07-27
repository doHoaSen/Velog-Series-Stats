import type { SeriesStats } from "./seriesAggregator";

const CACHE_STORAGE_KEY = "cachedSeriesStats";

export interface CachedSeriesStats {
  username: string;
  seriesStats: SeriesStats[];
  cachedAt: number;
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
