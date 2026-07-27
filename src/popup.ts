import { fetchCurrentUser } from "./api/userApi";
import { fetchSeriesOverview, loadSeriesViews } from "./service/seriesAggregator";
import type { SeriesStats } from "./service/seriesAggregator";

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
}

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
  row.append(nameSpan, statsSpan);

  const elements: SeriesRowElements = { row, statsSpan };
  updateSeriesStatsRow(elements, stats);
  return elements;
}

function updateSeriesStatsRow(elements: SeriesRowElements, stats: SeriesStats): void {
  elements.statsSpan.className = stats.viewsLoaded ? "series-stats" : "series-stats loading";
  elements.statsSpan.textContent = stats.viewsLoaded
    ? `총 ${stats.totalViews}회 · 평균 ${stats.averageViews.toFixed(1)}회`
    : "조회수 불러오는 중";
}
