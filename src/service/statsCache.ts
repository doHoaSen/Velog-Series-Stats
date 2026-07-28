import type { SeriesStats } from "./seriesAggregator";
import type { TagStats } from "./tagAggregator";

const CACHE_STORAGE_KEY = "cachedSeriesStats";

// SeriesStats/TagStats의 필드 구성이 바뀔 때마다 올려야 한다. 저장된 캐시의 버전이 이 값과 다르면
// 예전 스키마로 보고 폐기한다 — 그렇지 않으면 예전 캐시에 없는 필드가 undefined인 채로
// 화면에 쓰여서 잘못된 값이 표시되거나 렌더링 중 예외가 날 수 있다.
// 1 → 2: tagStats 필드 추가 (태그별 참여도 분석 기능).
const CACHE_SCHEMA_VERSION = 2;

// 이 시간보다 캐시가 신선하면 백그라운드 재조회를 생략한다 — 방금 불러온 결과를
// 팝업을 열 때마다 매번 무겁게 다시 조회하는 걸 방지하기 위함.
export const CACHE_FRESH_THRESHOLD_MS = 5 * 60 * 1000;

export interface CachedSeriesStats {
  username: string;
  seriesStats: SeriesStats[];
  tagStats: TagStats[];
  cachedAt: number;
}

interface StoredCache extends CachedSeriesStats {
  schemaVersion: number;
}

export function isCacheFresh(cachedAt: number, now: number = Date.now()): boolean {
  return now - cachedAt < CACHE_FRESH_THRESHOLD_MS;
}

export async function loadCachedSeriesStats(): Promise<CachedSeriesStats | null> {
  const stored = await chrome.storage.local.get(CACHE_STORAGE_KEY);
  const cached = stored[CACHE_STORAGE_KEY] as StoredCache | undefined;
  if (!cached || cached.schemaVersion !== CACHE_SCHEMA_VERSION) return null;
  return cached;
}

export async function saveCachedSeriesStats(
  username: string,
  seriesStats: SeriesStats[],
  tagStats: TagStats[],
): Promise<void> {
  const cached: StoredCache = {
    username,
    seriesStats,
    tagStats,
    cachedAt: Date.now(),
    schemaVersion: CACHE_SCHEMA_VERSION,
  };
  await chrome.storage.local.set({ [CACHE_STORAGE_KEY]: cached });
}
