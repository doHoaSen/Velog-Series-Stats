import { fetchAllMyPosts } from "../api/postApi";
import { fetchMySeriesList, fetchSeriesPosts } from "../api/seriesApi";
import { fetchPostStatsBatch } from "../api/statsApi";
import type { VelogPost } from "../model/post";
import type { VelogSeries } from "../model/series";
import type { PostStats } from "../model/stats";

const NO_SERIES_KEY = "__NO_SERIES__";
const NO_SERIES_NAME = "시리즈 없음";
// 성장률은 최근 7일 합계와 직전 7일 합계를 비교해서 계산한다 (총 14일치 일자별
// 조회수가 필요). Velog는 한국 서비스라 count_by_day의 day도 KST(UTC+9) 기준으로
// 집계된다고 보고, 날짜 경계를 브라우저 로컬 타임존이 아니라 KST로 고정해서 계산한다
// (한국은 DST가 없어 오프셋이 연중 고정이라 계산이 단순함).
const TREND_WINDOW_DAYS = 7;
const TREND_HISTORY_DAYS = TREND_WINDOW_DAYS * 2;
const KST_OFFSET_MS = 9 * 60 * 60 * 1000;
const ONE_DAY_MS = 24 * 60 * 60 * 1000;

function toKstDateString(date: Date): string {
  const kstTime = new Date(date.getTime() + KST_OFFSET_MS);
  const year = kstTime.getUTCFullYear();
  const month = String(kstTime.getUTCMonth() + 1).padStart(2, "0");
  const day = String(kstTime.getUTCDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}
// alias 배치 크기를 서버 Prisma 커넥션 풀 한도(5)에 맞춰 30 → 5로,
// 배치 동시 실행도 5 → 1(순차)로 낮췄다. (30개 alias × 배치 5개 동시 처리 조합이
// 실제로 "Timed out fetching a new connection from the connection pool" 에러를 유발함 — 2026-07-23 확인)
const STATS_POST_BATCH_SIZE = 5;
const STATS_BATCH_CONCURRENCY = 1;
// 시리즈 상세 조회(fetchSeriesPosts)도 시리즈 개수만큼 한꺼번에 Promise.all로 날리면
// (예: 시리즈 9개 → 동시 요청 9개) 요청마다 붙는 인증 조회(user.findUnique)까지 겹쳐
// 커넥션 풀 한도(5)를 넘길 수 있다. 풀 한도는 우리 확장 프로그램 전용이 아니라 Velog
// 서버 전체가 공유하므로 한도(5)를 꽉 채우지 않고 1개 여유를 두어 4로 설정.
// (2026-07-27, GetStats가 아닌 user.findUnique에서 동일한
// "Timed out fetching a new connection from the connection pool" 에러로 확인)
const SERIES_DETAIL_CONCURRENCY = 4;

export interface SeriesStats {
  seriesId: string | null;
  seriesName: string;
  postCount: number;
  totalViews: number;
  averageViews: number;
  // totalViews=0만으로는 '진짜 조회수 0'과 '아직 안 불러옴'을 구분할 수 없어 별도 플래그로 로딩 상태를 표시한다.
  viewsLoaded: boolean;
  // 최근 TREND_HISTORY_DAYS일치 KST 기준 일자별 조회수 (연속, 데이터 없는 날은 0)
  dailyCounts: Array<{ day: string; count: number }>;
  recentTotal: number;
  previousTotal: number;
  // previousTotal이 0이면(직전 7일 데이터 없음) 증감률을 계산할 수 없어 null
  growthRatePercent: number | null;
}

export interface SeriesOverview {
  posts: VelogPost[];
  seriesList: VelogSeries[];
  postIdToSeriesId: Map<string, string>;
  seriesStats: SeriesStats[];
}

// 조회수 없이 시리즈 목록(게시글 수)부터 먼저 보여줄 수 있도록 조회 단계와 조회수 집계 단계를 분리했다.
export async function fetchSeriesOverview(username: string): Promise<SeriesOverview> {
  const postsAndSeriesStart = performance.now();
  const [posts, seriesList] = await Promise.all([
    fetchAllMyPosts(username),
    fetchMySeriesList(username),
  ]);
  console.log(
    `[VelogSeriesStats] 게시글/시리즈 목록 조회: ${(performance.now() - postsAndSeriesStart).toFixed(0)}ms (게시글 ${posts.length}개, 시리즈 ${seriesList.length}개)`,
  );

  const mappingStart = performance.now();
  const postIdToSeriesId = await mapPostIdsToSeriesIds(username, seriesList);
  console.log(
    `[VelogSeriesStats] 게시글-시리즈 매핑: ${(performance.now() - mappingStart).toFixed(0)}ms`,
  );

  const seriesStats = groupBySeries(posts, seriesList, postIdToSeriesId, new Map<string, PostStats>());

  return { posts, seriesList, postIdToSeriesId, seriesStats };
}

export async function loadSeriesViews(
  overview: SeriesOverview,
  onProgress?: (seriesStats: SeriesStats[], loadedPostCount: number) => void,
): Promise<SeriesStats[]> {
  const { posts, seriesList, postIdToSeriesId } = overview;
  const statsStart = performance.now();

  const statsByPostId = await fetchViewsForPosts(posts, (partialStats) => {
    onProgress?.(
      groupBySeries(posts, seriesList, postIdToSeriesId, partialStats),
      partialStats.size,
    );
  });

  console.log(
    `[VelogSeriesStats] 조회수 조회 (${posts.length}개 게시글): ${(performance.now() - statsStart).toFixed(0)}ms`,
  );

  return groupBySeries(posts, seriesList, postIdToSeriesId, statsByPostId);
}

async function mapPostIdsToSeriesIds(
  username: string,
  seriesList: VelogSeries[],
): Promise<Map<string, string>> {
  const postIdToSeriesId = new Map<string, string>();
  const seriesBatches = chunk(seriesList, SERIES_DETAIL_CONCURRENCY);

  for (const batch of seriesBatches) {
    const seriesDetails = await Promise.all(
      batch.map((series) => fetchSeriesPosts(username, series.url_slug)),
    );

    for (const series of seriesDetails) {
      if (!series) continue;
      for (const seriesPost of series.series_posts) {
        postIdToSeriesId.set(seriesPost.post.id, series.id);
      }
    }
  }

  return postIdToSeriesId;
}

async function fetchViewsForPosts(
  posts: VelogPost[],
  onBatch?: (statsSoFar: Map<string, PostStats>) => void,
): Promise<Map<string, PostStats>> {
  const statsByPostId = new Map<string, PostStats>();
  const idBatches = chunk(
    posts.map((post) => post.id),
    STATS_POST_BATCH_SIZE,
  );

  for (let i = 0; i < idBatches.length; i += STATS_BATCH_CONCURRENCY) {
    const round = idBatches.slice(i, i + STATS_BATCH_CONCURRENCY);

    await Promise.all(
      round.map(async (idBatch) => {
        const batchStats = await fetchPostStatsBatch(idBatch);
        for (const [postId, stats] of batchStats) {
          statsByPostId.set(postId, stats);
        }
        onBatch?.(statsByPostId);
      }),
    );
  }

  return statsByPostId;
}

function chunk<T>(items: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    chunks.push(items.slice(i, i + size));
  }
  return chunks;
}

export function groupBySeries(
  posts: VelogPost[],
  seriesList: VelogSeries[],
  postIdToSeriesId: Map<string, string>,
  statsByPostId: Map<string, PostStats>,
  now: Date = new Date(),
): SeriesStats[] {
  const seriesNameById = new Map(seriesList.map((series) => [series.id, series.name]));
  const postsBySeriesKey = new Map<string, VelogPost[]>();

  for (const post of posts) {
    const seriesKey = postIdToSeriesId.get(post.id) ?? NO_SERIES_KEY;
    const group = postsBySeriesKey.get(seriesKey) ?? [];
    group.push(post);
    postsBySeriesKey.set(seriesKey, group);
  }

  return Array.from(postsBySeriesKey.entries()).map(([seriesKey, seriesPosts]) => {
    const totalViews = seriesPosts.reduce(
      (sum, post) => sum + (statsByPostId.get(post.id)?.total ?? 0),
      0,
    );
    const isNoSeries = seriesKey === NO_SERIES_KEY;
    const viewsLoaded = seriesPosts.every((post) => statsByPostId.has(post.id));

    const dailyCounts = buildDailyCounts(seriesPosts, statsByPostId, now);
    const { recentTotal, previousTotal, growthRatePercent } = calculateGrowth(dailyCounts);

    return {
      seriesId: isNoSeries ? null : seriesKey,
      seriesName: isNoSeries ? NO_SERIES_NAME : (seriesNameById.get(seriesKey) ?? NO_SERIES_NAME),
      postCount: seriesPosts.length,
      totalViews,
      averageViews: totalViews / seriesPosts.length,
      viewsLoaded,
      dailyCounts,
      recentTotal,
      previousTotal,
      growthRatePercent,
    };
  });
}

function buildDailyCounts(
  seriesPosts: VelogPost[],
  statsByPostId: Map<string, PostStats>,
  now: Date,
): Array<{ day: string; count: number }> {
  const countByDay = new Map<string, number>();

  for (const post of seriesPosts) {
    const stats = statsByPostId.get(post.id);
    if (!stats) continue;

    for (const entry of stats.count_by_day) {
      countByDay.set(entry.day, (countByDay.get(entry.day) ?? 0) + entry.count);
    }
  }

  const dailyCounts: Array<{ day: string; count: number }> = [];
  for (let offset = TREND_HISTORY_DAYS - 1; offset >= 0; offset--) {
    const day = toKstDateString(new Date(now.getTime() - offset * ONE_DAY_MS));
    dailyCounts.push({ day, count: countByDay.get(day) ?? 0 });
  }

  return dailyCounts;
}

function calculateGrowth(dailyCounts: Array<{ day: string; count: number }>): {
  recentTotal: number;
  previousTotal: number;
  growthRatePercent: number | null;
} {
  const previousWindow = dailyCounts.slice(0, TREND_WINDOW_DAYS);
  const recentWindow = dailyCounts.slice(TREND_WINDOW_DAYS);
  const sum = (window: Array<{ count: number }>) =>
    window.reduce((total, entry) => total + entry.count, 0);

  const previousTotal = sum(previousWindow);
  const recentTotal = sum(recentWindow);
  const growthRatePercent =
    previousTotal === 0 ? null : ((recentTotal - previousTotal) / previousTotal) * 100;

  return { recentTotal, previousTotal, growthRatePercent };
}
