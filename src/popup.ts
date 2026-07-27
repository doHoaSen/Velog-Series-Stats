import { fetchCurrentUser } from "./api/userApi";
import { fetchSeriesOverview, loadSeriesViews } from "./service/seriesAggregator";
import type { SeriesStats } from "./service/seriesAggregator";
import { loadCachedSeriesStats, saveCachedSeriesStats, isCacheFresh } from "./service/statsCache";
import type { CachedSeriesStats } from "./service/statsCache";
import { formatRelativeTime } from "./utils/time";

type SortMode = "postCount" | "totalViews";

const statusElement = document.querySelector<HTMLParagraphElement>("#status");
const loadButton = document.querySelector<HTMLButtonElement>("#load-button");
const resultElement = document.querySelector<HTMLElement>("#result");
const sortSelect = document.querySelector<HTMLSelectElement>("#sort-select");

if (!statusElement || !loadButton || !resultElement || !sortSelect) {
  throw new Error("팝업 화면 요소를 찾지 못했습니다.");
}

interface SeriesRowElements {
  row: HTMLElement;
  statsSpan: HTMLSpanElement;
  growthSpan: HTMLSpanElement;
  // 클릭 핸들러가 행 생성 시점의 stats를 그대로 클로저로 들고 있으면, 행을 재사용할 때
  // (updateSeriesStatsRow) 갱신된 데이터가 아니라 처음 만들어졌을 때의 stale한 데이터로
  // 트렌드 패널이 열리게 된다. 그래서 최신 stats를 별도로 들고 있다가 클릭 시 참조한다.
  latestStats: SeriesStats;
}

let trendBackdropElement: HTMLElement | null = null;

let latestSeriesStats: SeriesStats[] = [];
let sortMode: SortMode = "postCount";
// 로딩 중엔 조회수 정렬을 선택해도 순서를 postCount로 고정하고, 다 불러온 뒤 한 번에 재정렬한다
// (배치가 도착할 때마다 순서가 계속 바뀌면 화면이 산만해지기 때문).
let viewsFullyLoaded = false;
// 순서가 그대로일 땐(로딩 중 진행률 갱신) DOM을 다시 붙이지 않고 기존 엘리먼트의
// 내용만 바꾼다 — 매번 새 엘리먼트로 갈아끼우면 CSS pulse 애니메이션이 계속 리셋돼서
// 실제로는 깜빡이는 게 눈에 안 보이는 문제가 있었다.
const rowElementsByKey = new Map<string, SeriesRowElements>();
let lastRenderedKeys: string[] = [];

loadButton.addEventListener("click", () => {
  void loadSeriesStats();
});

sortSelect.addEventListener("change", () => {
  sortMode = sortSelect.value === "totalViews" ? "totalViews" : "postCount";
  render();
});

void initFromCache();

// 캐시가 있으면 버튼을 누르지 않아도 이전 결과를 즉시 보여주고,
// 그 뒤에 조용히 백그라운드에서 최신 데이터로 새로고침한다.
async function initFromCache(): Promise<void> {
  if (!statusElement) return;

  const cached = await loadCachedSeriesStats();
  if (!cached) return;

  latestSeriesStats = cached.seriesStats;
  viewsFullyLoaded = true;
  statusElement.textContent = `${cached.username}님의 시리즈별 조회수 (${formatRelativeTime(cached.cachedAt)} 기준)`;
  render();

  if (isCacheFresh(cached.cachedAt)) return;

  void refreshInBackground(cached);
}

async function refreshInBackground(cached: CachedSeriesStats): Promise<void> {
  if (!statusElement || !loadButton) return;

  loadButton.disabled = true;
  statusElement.textContent = `${cached.username}님의 시리즈별 조회수 (${formatRelativeTime(cached.cachedAt)} 기준) · 새로고침 중...`;

  const startedAt = performance.now();

  try {
    const user = await fetchCurrentUser();
    if (!user) return; // 로그인 안 된 상태면 캐시된 화면을 그대로 두고 조용히 종료

    const overview = await fetchSeriesOverview(user.username);
    const finalSeriesStats = await loadSeriesViews(overview);

    // 새 데이터가 완전히 준비된 시점에만 한 번에 반영한다 — 중간에 화면이
    // "조회수 불러오는 중" 상태로 되돌아가면 이미 보여준 숫자가 깜빡이며
    // 사라지는 것처럼 보이기 때문에, 진행 중엔 기존 화면을 그대로 둔다.
    latestSeriesStats = finalSeriesStats;
    viewsFullyLoaded = true;
    render();
    void saveCachedSeriesStats(user.username, finalSeriesStats);

    const elapsedSeconds = ((performance.now() - startedAt) / 1000).toFixed(1);
    statusElement.textContent = `${user.username}님의 시리즈별 조회수 (${elapsedSeconds}초 소요)`;
  } catch (error) {
    console.warn("[VelogSeriesStats] 백그라운드 새로고침 실패, 캐시된 값 유지", error);
    statusElement.textContent = `${cached.username}님의 시리즈별 조회수 (${formatRelativeTime(cached.cachedAt)} 기준)`;
  } finally {
    loadButton.disabled = false;
  }
}

async function loadSeriesStats(): Promise<void> {
  if (!statusElement || !loadButton || !resultElement) return;

  loadButton.disabled = true;
  statusElement.textContent = "불러오는 중...";
  latestSeriesStats = [];
  viewsFullyLoaded = false;
  rowElementsByKey.clear();
  lastRenderedKeys = [];
  // 시리즈 목록 자체가 뜨기 전(로그인 확인 + 시리즈 개요 조회 구간)에도
  // 로딩 중이라는 걸 보여준다. 첫 render() 호출 시 실제 목록으로 자연스럽게 교체된다.
  resultElement.replaceChildren(createLoadingPlaceholder());

  const startedAt = performance.now();

  try {
    const user = await fetchCurrentUser();

    if (!user) {
      statusElement.textContent = "Velog에 로그인 후 다시 시도해주세요.";
      return;
    }

    const overview = await fetchSeriesOverview(user.username);
    latestSeriesStats = overview.seriesStats;
    statusElement.textContent = `${user.username}님의 시리즈 목록 불러옴 · 조회수 불러오는 중...`;
    render();

    const totalPostCount = overview.posts.length;

    const finalSeriesStats = await loadSeriesViews(overview, (updated, loadedPostCount) => {
      latestSeriesStats = updated;
      statusElement.textContent = `조회수 불러오는 중... (${loadedPostCount}/${totalPostCount})`;
      render();
    });

    latestSeriesStats = finalSeriesStats;
    viewsFullyLoaded = true;
    void saveCachedSeriesStats(user.username, finalSeriesStats);
    const elapsedSeconds = ((performance.now() - startedAt) / 1000).toFixed(1);
    statusElement.textContent = `${user.username}님의 시리즈별 조회수 (${elapsedSeconds}초 소요)`;
    render();
  } catch (error) {
    statusElement.textContent =
      error instanceof Error ? error.message : "통계를 불러오는 중 오류가 발생했습니다.";
  } finally {
    loadButton.disabled = false;
  }
}

function render(): void {
  if (!resultElement) return;

  const effectiveSortMode: SortMode = viewsFullyLoaded ? sortMode : "postCount";
  const sorted = sortSeriesStats(latestSeriesStats, effectiveSortMode);
  const keys = sorted.map(seriesKey);
  const orderUnchanged =
    keys.length === lastRenderedKeys.length &&
    keys.every((key, index) => key === lastRenderedKeys[index]);

  if (orderUnchanged) {
    for (const stats of sorted) {
      const elements = rowElementsByKey.get(seriesKey(stats));
      if (elements) updateSeriesStatsRow(elements, stats);
    }
    return;
  }

  lastRenderedKeys = keys;
  const rows = sorted.map((stats) => {
    const key = seriesKey(stats);
    const existing = rowElementsByKey.get(key);

    if (existing) {
      updateSeriesStatsRow(existing, stats);
      return existing.row;
    }

    const created = createSeriesStatsRow(stats);
    rowElementsByKey.set(key, created);
    return created.row;
  });

  resultElement.replaceChildren(...rows);
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

function sortSeriesStats(stats: SeriesStats[], mode: SortMode): SeriesStats[] {
  return [...stats].sort((a, b) => b[mode] - a[mode]);
}

function createSeriesStatsRow(stats: SeriesStats): SeriesRowElements {
  const row = document.createElement("div");
  row.className = "series-row";

  const nameSpan = document.createElement("span");
  nameSpan.textContent = `${stats.seriesName} · 글 ${stats.postCount}개 · `;

  const statsSpan = document.createElement("span");
  const growthSpan = document.createElement("span");
  growthSpan.className = "series-growth";

  const statsLine = document.createElement("div");
  statsLine.append(nameSpan, statsSpan);
  row.append(statsLine, growthSpan);

  const elements: SeriesRowElements = { row, statsSpan, growthSpan, latestStats: stats };

  // "시리즈 없음" 그룹은 시리즈 단위 트렌드라는 개념 자체가 없어 클릭 동작을 붙이지 않는다.
  if (stats.seriesId !== null) {
    row.classList.add("clickable");
    row.addEventListener("click", () => openTrendPanel(elements.latestStats));
  }

  updateSeriesStatsRow(elements, stats);
  return elements;
}

function updateSeriesStatsRow(elements: SeriesRowElements, stats: SeriesStats): void {
  elements.latestStats = stats;
  elements.statsSpan.className = stats.viewsLoaded ? "series-stats" : "series-stats loading";
  elements.statsSpan.textContent = stats.viewsLoaded
    ? `총 ${stats.totalViews}회 · 평균 ${stats.averageViews.toFixed(1)}회`
    : "조회수 불러오는 중";

  elements.growthSpan.textContent = stats.viewsLoaded ? formatGrowthSummary(stats) : "";
  elements.growthSpan.className = growthSpanClassName(stats);
}

function formatGrowthSummary(stats: SeriesStats): string {
  if (stats.growthRatePercent === null) {
    return "데이터 부족 (최근 활동 없음)";
  }

  const arrow = stats.growthRatePercent >= 0 ? "▲" : "▼";
  return `${arrow} ${Math.abs(stats.growthRatePercent).toFixed(1)}% · 최근 7일`;
}

function growthSpanClassName(stats: SeriesStats): string {
  if (stats.growthRatePercent === null) return "series-growth neutral";
  return stats.growthRatePercent >= 0 ? "series-growth up" : "series-growth down";
}

function openTrendPanel(stats: SeriesStats): void {
  closeTrendPanel();

  const backdrop = document.createElement("div");
  backdrop.className = "trend-backdrop";
  backdrop.addEventListener("click", (event) => {
    if (event.target === backdrop) closeTrendPanel();
  });

  const panel = document.createElement("div");
  panel.className = "trend-panel";

  const header = document.createElement("div");
  header.className = "trend-panel-header";

  const title = document.createElement("h2");
  title.textContent = stats.seriesName;

  const closeButton = document.createElement("button");
  closeButton.type = "button";
  closeButton.className = "trend-close-button";
  closeButton.textContent = "×";
  closeButton.setAttribute("aria-label", "닫기");
  closeButton.addEventListener("click", closeTrendPanel);

  header.append(title, closeButton);

  const headline = document.createElement("p");
  headline.className = "trend-headline";
  headline.textContent = formatTrendHeadline(stats);

  panel.append(header, headline, createTrendChart(stats.dailyCounts));
  backdrop.append(panel);
  document.body.append(backdrop);
  trendBackdropElement = backdrop;
}

function closeTrendPanel(): void {
  trendBackdropElement?.remove();
  trendBackdropElement = null;
}

function formatTrendHeadline(stats: SeriesStats): string {
  if (stats.growthRatePercent === null) {
    return `최근 7일 ${stats.recentTotal}회 · 직전 7일 데이터가 없어 증감률을 계산할 수 없습니다.`;
  }

  const arrow = stats.growthRatePercent >= 0 ? "▲" : "▼";
  return `${arrow} ${Math.abs(stats.growthRatePercent).toFixed(1)}% · 최근 7일 ${stats.recentTotal}회 / 직전 7일 ${stats.previousTotal}회`;
}

function createTrendChart(dailyCounts: SeriesStats["dailyCounts"]): HTMLElement {
  const chart = document.createElement("div");
  chart.className = "trend-chart";

  const maxCount = Math.max(1, ...dailyCounts.map((entry) => entry.count));

  for (const entry of dailyCounts) {
    const column = document.createElement("div");
    column.className = "trend-bar-column";

    const bar = document.createElement("div");
    bar.className = "trend-bar";
    bar.style.height = `${Math.round((entry.count / maxCount) * 100)}%`;
    bar.title = `${entry.day}: ${entry.count}회`;

    const label = document.createElement("span");
    label.className = "trend-bar-label";
    label.textContent = entry.day.slice(5); // MM-DD만 표시

    column.append(bar, label);
    chart.append(column);
  }

  return chart;
}
