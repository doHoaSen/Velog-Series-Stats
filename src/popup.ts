import { fetchCurrentUser } from "./api/userApi";
import { fetchSeriesOverview, loadSeriesViews } from "./service/seriesAggregator";
import type { SeriesStats } from "./service/seriesAggregator";
import type { TagStats } from "./service/tagAggregator";
import { loadCachedSeriesStats, saveCachedSeriesStats, isCacheFresh } from "./service/statsCache";
import type { CachedSeriesStats } from "./service/statsCache";
import { formatRelativeTime } from "./utils/time";

type SortMode = "postCount" | "averageViews";
type ActiveTab = "series" | "tag";

const statusElement = document.querySelector<HTMLParagraphElement>("#status");
const loadButton = document.querySelector<HTMLButtonElement>("#load-button");
const resultElement = document.querySelector<HTMLElement>("#result");
const sortSelect = document.querySelector<HTMLSelectElement>("#sort-select");
const tabButtons = document.querySelectorAll<HTMLButtonElement>(".tab-button");

if (!statusElement || !loadButton || !resultElement || !sortSelect || tabButtons.length === 0) {
  throw new Error("팝업 화면 요소를 찾지 못했습니다.");
}

interface RowElements {
  row: HTMLElement;
  statsSpan: HTMLSpanElement;
}

let latestSeriesStats: SeriesStats[] = [];
let latestTagStats: TagStats[] = [];
let sortMode: SortMode = "postCount";
let activeTab: ActiveTab = "series";
// 로딩 중엔 조회수 정렬을 선택해도 순서를 postCount로 고정하고, 다 불러온 뒤 한 번에 재정렬한다
// (배치가 도착할 때마다 순서가 계속 바뀌면 화면이 산만해지기 때문). 태그 탭도 동일하게 적용한다.
let viewsFullyLoaded = false;
// 순서가 그대로일 땐(로딩 중 진행률 갱신) DOM을 다시 붙이지 않고 기존 엘리먼트의
// 내용만 바꾼다 — 매번 새 엘리먼트로 갈아끼우면 CSS pulse 애니메이션이 계속 리셋돼서
// 실제로는 깜빡이는 게 눈에 안 보이는 문제가 있었다. 탭마다 별도로 상태를 유지해서
// 탭을 오갈 때도 이미 만든 엘리먼트를 재사용한다.
const seriesRowElementsByKey = new Map<string, RowElements>();
let lastRenderedSeriesKeys: string[] = [];
const tagRowElementsByKey = new Map<string, RowElements>();
let lastRenderedTagKeys: string[] = [];

loadButton.addEventListener("click", () => {
  void loadSeriesStats();
});

sortSelect.addEventListener("change", () => {
  sortMode = sortSelect.value === "averageViews" ? "averageViews" : "postCount";
  render();
});

for (const button of tabButtons) {
  button.addEventListener("click", () => {
    const tab: ActiveTab = button.dataset.tab === "tag" ? "tag" : "series";
    if (tab === activeTab) return;

    activeTab = tab;
    for (const other of tabButtons) other.classList.toggle("active", other === button);
    // 탭을 바꾸면 #result의 DOM이 다른 탭의 행으로 바뀌어 있으므로, 데이터가 그대로여도
    // "이전과 동일" 최적화를 건너뛰고 반드시 다시 붙이도록 직전 렌더 키를 비운다.
    if (activeTab === "series") {
      lastRenderedSeriesKeys = [];
    } else {
      lastRenderedTagKeys = [];
    }
    render();
  });
}

void initFromCache();

// 캐시가 신선하면(5분 이내) 버튼을 누르지 않아도 즉시 보여준다.
// 오래된 캐시는 헷갈리는 옛 숫자를 화면에 띄우지 않고 바로 새로 조회한다(loadSeriesStats 재사용,
// 실패 시에만 이 캐시로 되돌아가도록 fallback으로 전달).
async function initFromCache(): Promise<void> {
  const cached = await loadCachedSeriesStats();
  if (!cached) return;

  if (isCacheFresh(cached.cachedAt)) {
    showCachedStats(cached);
    return;
  }

  void loadSeriesStats(cached);
}

function showCachedStats(cached: CachedSeriesStats): void {
  if (!statusElement) return;
  latestSeriesStats = cached.seriesStats;
  latestTagStats = cached.tagStats;
  viewsFullyLoaded = true;
  statusElement.textContent = `${cached.username}님의 시리즈별 조회수 (${formatRelativeTime(cached.cachedAt)} 기준)`;
  render();
}

// fallbackCache가 있으면(오래된 캐시 자동 새로고침) 로그인 안 됨/조회 실패 시 그 캐시로 되돌아가고,
// 없으면(수동 버튼 클릭) 에러 메시지를 그대로 보여준다.
async function loadSeriesStats(fallbackCache?: CachedSeriesStats): Promise<void> {
  if (!statusElement || !loadButton || !resultElement) return;

  loadButton.disabled = true;
  statusElement.textContent = "불러오는 중...";
  latestSeriesStats = [];
  latestTagStats = [];
  viewsFullyLoaded = false;
  seriesRowElementsByKey.clear();
  lastRenderedSeriesKeys = [];
  tagRowElementsByKey.clear();
  lastRenderedTagKeys = [];
  // 시리즈 목록 자체가 뜨기 전(로그인 확인 + 시리즈 개요 조회 구간)에도
  // 로딩 중이라는 걸 보여준다. 첫 render() 호출 시 실제 목록으로 자연스럽게 교체된다.
  resultElement.replaceChildren(createLoadingPlaceholder());

  const startedAt = performance.now();

  try {
    const user = await fetchCurrentUser();

    if (!user) {
      if (fallbackCache) {
        showCachedStats(fallbackCache);
      } else {
        statusElement.textContent = "Velog에 로그인 후 다시 시도해주세요.";
      }
      return;
    }

    const overview = await fetchSeriesOverview(user.username);
    latestSeriesStats = overview.seriesStats;
    latestTagStats = overview.tagStats;
    statusElement.textContent = `${user.username}님의 시리즈 목록 불러옴 · 조회수 불러오는 중...`;
    render();

    const totalPostCount = overview.posts.length;

    const finalStats = await loadSeriesViews(overview, (loaded, loadedPostCount) => {
      latestSeriesStats = loaded.seriesStats;
      latestTagStats = loaded.tagStats;
      statusElement.textContent = `조회수 불러오는 중... (${loadedPostCount}/${totalPostCount})`;
      render();
    });

    latestSeriesStats = finalStats.seriesStats;
    latestTagStats = finalStats.tagStats;
    viewsFullyLoaded = true;
    void saveCachedSeriesStats(user.username, finalStats.seriesStats, finalStats.tagStats);
    const elapsedSeconds = ((performance.now() - startedAt) / 1000).toFixed(1);
    statusElement.textContent = `${user.username}님의 시리즈별 조회수 (${elapsedSeconds}초 소요)`;
    render();
  } catch (error) {
    if (fallbackCache) {
      console.warn("[VelogSeriesStats] 자동 새로고침 실패, 캐시된 값 유지", error);
      showCachedStats(fallbackCache);
    } else {
      statusElement.textContent =
        error instanceof Error ? error.message : "통계를 불러오는 중 오류가 발생했습니다.";
    }
  } finally {
    loadButton.disabled = false;
  }
}

function render(): void {
  if (activeTab === "series") {
    renderSeries();
  } else {
    renderTags();
  }
}

function renderSeries(): void {
  if (!resultElement) return;

  const sorted = sortByMode(latestSeriesStats, viewsFullyLoaded ? sortMode : "postCount");
  const keys = sorted.map(seriesKey);

  if (sameKeys(keys, lastRenderedSeriesKeys)) {
    for (const stats of sorted) {
      const elements = seriesRowElementsByKey.get(seriesKey(stats));
      if (elements) updateSeriesStatsRow(elements, stats);
    }
    return;
  }

  lastRenderedSeriesKeys = keys;
  const rows = sorted.map((stats) => {
    const key = seriesKey(stats);
    const existing = seriesRowElementsByKey.get(key);

    if (existing) {
      updateSeriesStatsRow(existing, stats);
      return existing.row;
    }

    const created = createSeriesStatsRow(stats);
    seriesRowElementsByKey.set(key, created);
    return created.row;
  });

  resultElement.replaceChildren(...rows);
}

function renderTags(): void {
  if (!resultElement) return;

  const sorted = sortByMode(latestTagStats, viewsFullyLoaded ? sortMode : "postCount");
  const keys = sorted.map((stats) => stats.tagName);

  if (sorted.length === 0) {
    lastRenderedTagKeys = [];
    resultElement.replaceChildren(createEmptyTagNotice());
    return;
  }

  if (sameKeys(keys, lastRenderedTagKeys)) {
    for (const stats of sorted) {
      const elements = tagRowElementsByKey.get(stats.tagName);
      if (elements) updateTagStatsRow(elements, stats);
    }
    return;
  }

  lastRenderedTagKeys = keys;
  const rows = sorted.map((stats) => {
    const existing = tagRowElementsByKey.get(stats.tagName);

    if (existing) {
      updateTagStatsRow(existing, stats);
      return existing.row;
    }

    const created = createTagStatsRow(stats);
    tagRowElementsByKey.set(stats.tagName, created);
    return created.row;
  });

  resultElement.replaceChildren(...rows);
}

function sameKeys(keys: string[], previous: string[]): boolean {
  return keys.length === previous.length && keys.every((key, index) => key === previous[index]);
}

function seriesKey(stats: SeriesStats): string {
  return stats.seriesId ?? "__NO_SERIES__";
}

function createLoadingPlaceholder(): HTMLElement {
  const placeholder = document.createElement("div");
  placeholder.className = "loading-placeholder";

  const spinner = document.createElement("div");
  spinner.className = "loading-spinner";

  const text = document.createElement("span");
  text.textContent = "시리즈 목록 불러오는 중...";

  placeholder.append(spinner, text);
  return placeholder;
}

function createEmptyTagNotice(): HTMLElement {
  const notice = document.createElement("p");
  notice.className = "empty-notice";
  notice.textContent = "태그가 달린 게시글이 없습니다.";
  return notice;
}

function sortByMode<T extends { postCount: number; averageViews: number }>(
  stats: T[],
  mode: SortMode,
): T[] {
  return [...stats].sort((a, b) => b[mode] - a[mode]);
}

function createSeriesStatsRow(stats: SeriesStats): RowElements {
  const row = document.createElement("div");
  row.className = "stats-row";

  const nameSpan = document.createElement("span");
  nameSpan.textContent = `${stats.seriesName} · 글 ${stats.postCount}개 · `;

  const statsSpan = document.createElement("span");
  row.append(nameSpan, statsSpan);

  const elements: RowElements = { row, statsSpan };
  updateSeriesStatsRow(elements, stats);
  return elements;
}

function updateSeriesStatsRow(elements: RowElements, stats: SeriesStats): void {
  elements.statsSpan.className = stats.viewsLoaded ? "stats-value" : "stats-value loading";
  elements.statsSpan.textContent = stats.viewsLoaded
    ? `총 ${stats.totalViews}회 · 평균 ${stats.averageViews.toFixed(1)}회`
    : "조회수 불러오는 중";
}

function createTagStatsRow(stats: TagStats): RowElements {
  const row = document.createElement("div");
  row.className = "stats-row";

  const nameSpan = document.createElement("span");
  nameSpan.textContent = `${stats.tagName} · 글 ${stats.postCount}개 · `;

  const statsSpan = document.createElement("span");
  row.append(nameSpan, statsSpan);

  const elements: RowElements = { row, statsSpan };
  updateTagStatsRow(elements, stats);
  return elements;
}

function updateTagStatsRow(elements: RowElements, stats: TagStats): void {
  elements.statsSpan.className = stats.viewsLoaded ? "stats-value" : "stats-value loading";
  elements.statsSpan.textContent = stats.viewsLoaded
    ? `총 ${stats.totalViews}회 · 평균 ${stats.averageViews.toFixed(1)}회`
    : "조회수 불러오는 중";
}
