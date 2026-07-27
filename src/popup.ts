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

let latestSeriesStats: SeriesStats[] = [];
let sortMode: SortMode = "postCount";
// 로딩 중엔 조회수 정렬을 선택해도 순서를 postCount로 고정하고, 다 불러온 뒤 한 번에 재정렬한다
// (배치가 도착할 때마다 순서가 계속 바뀌면 화면이 산만해지기 때문).
let viewsFullyLoaded = false;

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
  resultElement.textContent = "";

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
  resultElement.replaceChildren(...sorted.map(renderSeriesStatsRow));
}

function sortSeriesStats(stats: SeriesStats[], mode: SortMode): SeriesStats[] {
  return [...stats].sort((a, b) => b[mode] - a[mode]);
}

function renderSeriesStatsRow(stats: SeriesStats): HTMLElement {
  const row = document.createElement("div");
  row.className = "series-row";

  const nameSpan = document.createElement("span");
  nameSpan.textContent = `${stats.seriesName} · 글 ${stats.postCount}개 · `;

  const statsSpan = document.createElement("span");
  statsSpan.className = stats.viewsLoaded ? "series-stats" : "series-stats loading";
  statsSpan.textContent = stats.viewsLoaded
    ? `총 ${stats.totalViews}회 · 평균 ${stats.averageViews.toFixed(1)}회`
    : "조회수 불러오는 중";

  row.append(nameSpan, statsSpan);
  return row;
}
