import { fetchAllMyPosts } from "../api/postApi";
import { fetchMySeriesList, fetchSeriesPosts } from "../api/seriesApi";
import { fetchPostStats } from "../api/statsApi";
import type { VelogPost } from "../model/post";
import type { VelogSeries } from "../model/series";

const NO_SERIES_KEY = "__NO_SERIES__";
const NO_SERIES_NAME = "시리즈 없음";
const STATS_CONCURRENCY = 5;

export interface SeriesStats {
  seriesId: string | null;
  seriesName: string;
  postCount: number;
  totalViews: number;
  averageViews: number;
}

export async function aggregateSeriesStats(username: string): Promise<SeriesStats[]> {
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

  const statsStart = performance.now();
  const viewsByPostId = await fetchViewsForPosts(posts);
  console.log(
    `[VelogSeriesStats] 조회수 조회 (${posts.length}개 게시글): ${(performance.now() - statsStart).toFixed(0)}ms`,
  );

  return groupBySeries(posts, seriesList, postIdToSeriesId, viewsByPostId);
}

async function mapPostIdsToSeriesIds(
  username: string,
  seriesList: VelogSeries[],
): Promise<Map<string, string>> {
  const postIdToSeriesId = new Map<string, string>();

  const seriesDetails = await Promise.all(
    seriesList.map((series) => fetchSeriesPosts(username, series.url_slug)),
  );

  for (const series of seriesDetails) {
    if (!series) continue;
    for (const seriesPost of series.series_posts) {
      postIdToSeriesId.set(seriesPost.post.id, series.id);
    }
  }

  return postIdToSeriesId;
}

async function fetchViewsForPosts(posts: VelogPost[]): Promise<Map<string, number>> {
  const viewsByPostId = new Map<string, number>();

  for (let i = 0; i < posts.length; i += STATS_CONCURRENCY) {
    const batch = posts.slice(i, i + STATS_CONCURRENCY);
    const statsBatch = await Promise.all(batch.map((post) => fetchPostStats(post.id)));

    batch.forEach((post, index) => {
      viewsByPostId.set(post.id, statsBatch[index]?.total ?? 0);
    });
  }

  return viewsByPostId;
}

function groupBySeries(
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

    return {
      seriesId: isNoSeries ? null : seriesKey,
      seriesName: isNoSeries ? NO_SERIES_NAME : (seriesNameById.get(seriesKey) ?? NO_SERIES_NAME),
      postCount: seriesPosts.length,
      totalViews,
      averageViews: totalViews / seriesPosts.length,
    };
  });
}
