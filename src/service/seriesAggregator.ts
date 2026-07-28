import { fetchAllMyPosts } from "../api/postApi";
import { fetchMySeriesList, fetchSeriesPosts } from "../api/seriesApi";
import { fetchPostStatsBatch } from "../api/statsApi";
import type { VelogPost } from "../model/post";
import type { VelogSeries } from "../model/series";
import { groupByTag } from "./tagAggregator";
import type { TagStats } from "./tagAggregator";

const NO_SERIES_KEY = "__NO_SERIES__";
const NO_SERIES_NAME = "시리즈 없음";
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
}

export interface SeriesOverview {
  posts: VelogPost[];
  seriesList: VelogSeries[];
  postIdToSeriesId: Map<string, string>;
  seriesStats: SeriesStats[];
  tagStats: TagStats[];
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

  const seriesStats = groupBySeries(posts, seriesList, postIdToSeriesId, new Map());
  const tagStats = groupByTag(posts, new Map());

  return { posts, seriesList, postIdToSeriesId, seriesStats, tagStats };
}

export interface LoadedStats {
  seriesStats: SeriesStats[];
  tagStats: TagStats[];
}

export async function loadSeriesViews(
  overview: SeriesOverview,
  onProgress?: (loaded: LoadedStats, loadedPostCount: number) => void,
): Promise<LoadedStats> {
  const { posts, seriesList, postIdToSeriesId } = overview;
  const statsStart = performance.now();

  const viewsByPostId = await fetchViewsForPosts(posts, (partialViews) => {
    onProgress?.(
      {
        seriesStats: groupBySeries(posts, seriesList, postIdToSeriesId, partialViews),
        tagStats: groupByTag(posts, partialViews),
      },
      partialViews.size,
    );
  });

  console.log(
    `[VelogSeriesStats] 조회수 조회 (${posts.length}개 게시글): ${(performance.now() - statsStart).toFixed(0)}ms`,
  );

  return {
    seriesStats: groupBySeries(posts, seriesList, postIdToSeriesId, viewsByPostId),
    tagStats: groupByTag(posts, viewsByPostId),
  };
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
  onBatch?: (viewsSoFar: Map<string, number>) => void,
): Promise<Map<string, number>> {
  const viewsByPostId = new Map<string, number>();
  const idBatches = chunk(
    posts.map((post) => post.id),
    STATS_POST_BATCH_SIZE,
  );

  for (let i = 0; i < idBatches.length; i += STATS_BATCH_CONCURRENCY) {
    const round = idBatches.slice(i, i + STATS_BATCH_CONCURRENCY);

    await Promise.all(
      round.map(async (idBatch) => {
        const batchViews = await fetchPostStatsBatch(idBatch);
        for (const [postId, total] of batchViews) {
          viewsByPostId.set(postId, total);
        }
        onBatch?.(viewsByPostId);
      }),
    );
  }

  return viewsByPostId;
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
  viewsByPostId: Map<string, number>,
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
      (sum, post) => sum + (viewsByPostId.get(post.id) ?? 0),
      0,
    );
    const isNoSeries = seriesKey === NO_SERIES_KEY;
    const viewsLoaded = seriesPosts.every((post) => viewsByPostId.has(post.id));

    return {
      seriesId: isNoSeries ? null : seriesKey,
      seriesName: isNoSeries ? NO_SERIES_NAME : (seriesNameById.get(seriesKey) ?? NO_SERIES_NAME),
      postCount: seriesPosts.length,
      totalViews,
      averageViews: totalViews / seriesPosts.length,
      viewsLoaded,
    };
  });
}
