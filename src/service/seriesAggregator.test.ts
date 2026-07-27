import { describe, expect, it } from "vitest";
import { groupBySeries } from "./seriesAggregator";
import type { VelogPost } from "../model/post";
import type { VelogSeries } from "../model/series";
import type { PostStats } from "../model/stats";

// KST 정오로 고정 — groupBySeries의 성장률 계산(최근 7일 vs 직전 7일)이 이 시각을
// "오늘"로 보고 날짜 경계를 나눈다. 2026-07-27 KST 기준: 최근 7일 = 07-21~07-27, 직전 7일 = 07-14~07-20.
const NOW = new Date("2026-07-27T12:00:00+09:00");

function makePost(id: string): VelogPost {
  return {
    id,
    title: id,
    url_slug: id,
    released_at: "2026-01-01",
    updated_at: "2026-01-01",
    comments_count: 0,
    likes: 0,
    is_private: false,
    tags: [],
  };
}

function makeStats(total: number, countByDay: Array<{ day: string; count: number }> = []): PostStats {
  return { total, count_by_day: countByDay };
}

describe("groupBySeries", () => {
  it("시리즈별로 게시글을 묶고 총합/평균 조회수를 계산한다", () => {
    const posts = [makePost("p1"), makePost("p2"), makePost("p3")];
    const seriesList: VelogSeries[] = [
      { id: "s1", name: "시리즈A", url_slug: "a", posts_count: 2 },
    ];
    const postIdToSeriesId = new Map([
      ["p1", "s1"],
      ["p2", "s1"],
    ]);
    const statsByPostId = new Map([
      ["p1", makeStats(10)],
      ["p2", makeStats(20)],
      ["p3", makeStats(5)],
    ]);

    const result = groupBySeries(posts, seriesList, postIdToSeriesId, statsByPostId, NOW);

    const seriesA = result.find((s) => s.seriesId === "s1");
    expect(seriesA).toMatchObject({
      postCount: 2,
      totalViews: 30,
      averageViews: 15,
      viewsLoaded: true,
    });

    const noSeries = result.find((s) => s.seriesId === null);
    expect(noSeries).toMatchObject({
      seriesName: "시리즈 없음",
      postCount: 1,
      totalViews: 5,
      viewsLoaded: true,
    });
  });

  it("조회수가 아직 없는 게시글이 있으면 viewsLoaded를 false로 표시한다", () => {
    const posts = [makePost("p1"), makePost("p2")];
    const seriesList: VelogSeries[] = [
      { id: "s1", name: "시리즈A", url_slug: "a", posts_count: 2 },
    ];
    const postIdToSeriesId = new Map([
      ["p1", "s1"],
      ["p2", "s1"],
    ]);
    const statsByPostId = new Map([["p1", makeStats(10)]]); // p2는 아직 조회수 미도착

    const result = groupBySeries(posts, seriesList, postIdToSeriesId, statsByPostId, NOW);

    expect(result[0]?.viewsLoaded).toBe(false);
    expect(result[0]?.totalViews).toBe(10);
  });

  it("최근 7일과 직전 7일 조회수를 합산해 성장률을 계산한다", () => {
    const posts = [makePost("p1"), makePost("p2")];
    const seriesList: VelogSeries[] = [
      { id: "s1", name: "시리즈A", url_slug: "a", posts_count: 2 },
    ];
    const postIdToSeriesId = new Map([
      ["p1", "s1"],
      ["p2", "s1"],
    ]);
    const statsByPostId = new Map([
      [
        "p1",
        makeStats(14, [
          { day: "2026-07-27", count: 10 }, // 최근 7일
          { day: "2026-07-20", count: 4 }, // 직전 7일
        ]),
      ],
      [
        "p2",
        makeStats(6, [
          { day: "2026-07-26", count: 5 }, // 최근 7일
          { day: "2026-07-19", count: 1 }, // 직전 7일
        ]),
      ],
    ]);

    const result = groupBySeries(posts, seriesList, postIdToSeriesId, statsByPostId, NOW);
    const seriesA = result.find((s) => s.seriesId === "s1");

    expect(seriesA?.recentTotal).toBe(15);
    expect(seriesA?.previousTotal).toBe(5);
    expect(seriesA?.growthRatePercent).toBeCloseTo(200);
    expect(seriesA?.dailyCounts).toHaveLength(14);
  });

  it("직전 7일 데이터가 없으면 성장률을 null로 표시한다", () => {
    const posts = [makePost("p1")];
    const seriesList: VelogSeries[] = [
      { id: "s1", name: "시리즈A", url_slug: "a", posts_count: 1 },
    ];
    const postIdToSeriesId = new Map([["p1", "s1"]]);
    const statsByPostId = new Map([
      ["p1", makeStats(10, [{ day: "2026-07-27", count: 10 }])], // 최근 7일에만 데이터 존재
    ]);

    const result = groupBySeries(posts, seriesList, postIdToSeriesId, statsByPostId, NOW);
    const seriesA = result.find((s) => s.seriesId === "s1");

    expect(seriesA?.previousTotal).toBe(0);
    expect(seriesA?.growthRatePercent).toBeNull();
  });
});
