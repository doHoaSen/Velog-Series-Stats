import { fetchCurrentUser } from "./api/userApi";
import { aggregateSeriesStats } from "./service/seriesAggregator";

const statusElement = document.querySelector<HTMLParagraphElement>("#status");
const loadButton = document.querySelector<HTMLButtonElement>("#load-button");
const resultElement = document.querySelector<HTMLElement>("#result");

if (!statusElement || !loadButton || !resultElement) {
  throw new Error("팝업 화면 요소를 찾지 못했습니다.");
}

loadButton.addEventListener("click", () => {
  void loadSeriesStats();
});

async function loadSeriesStats(): Promise<void> {
  if (!statusElement || !loadButton || !resultElement) return;

  loadButton.disabled = true;
  statusElement.textContent = "불러오는 중...";
  resultElement.textContent = "";

  const startedAt = performance.now();

  try {
    const user = await fetchCurrentUser();

    if (!user) {
      statusElement.textContent = "Velog에 로그인 후 다시 시도해주세요.";
      return;
    }

    const seriesStats = await aggregateSeriesStats(user.username);
    const sorted = [...seriesStats].sort((a, b) => b.totalViews - a.totalViews);
    const elapsedSeconds = ((performance.now() - startedAt) / 1000).toFixed(1);

    statusElement.textContent = `${user.username}님의 시리즈별 조회수 (${elapsedSeconds}초 소요)`;
    resultElement.replaceChildren(...sorted.map(renderSeriesStatsRow));
  } catch (error) {
    statusElement.textContent =
      error instanceof Error ? error.message : "통계를 불러오는 중 오류가 발생했습니다.";
  } finally {
    loadButton.disabled = false;
  }
}

function renderSeriesStatsRow(stats: {
  seriesName: string;
  postCount: number;
  totalViews: number;
  averageViews: number;
}): HTMLElement {
  const row = document.createElement("div");
  row.className = "series-row";
  row.textContent = `${stats.seriesName} · 글 ${stats.postCount}개 · 총 ${stats.totalViews}회 · 평균 ${stats.averageViews.toFixed(1)}회`;
  return row;
}
