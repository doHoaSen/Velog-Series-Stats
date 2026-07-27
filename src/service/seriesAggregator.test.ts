import { describe, expect, it } from "vitest";
import { groupBySeries } from "./seriesAggregator";
import type { VelogPost } from "../model/post";
import type { VelogSeries } from "../model/series";

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
    const viewsByPostId = new Map([
      ["p1", 10],
      ["p2", 20],
      ["p3", 5],
    ]);

    const result = groupBySeries(posts, seriesList, postIdToSeriesId, viewsByPostId);

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
    const viewsByPostId = new Map([["p1", 10]]); // p2는 아직 조회수 미도착

    const result = groupBySeries(posts, seriesList, postIdToSeriesId, viewsByPostId);

    expect(result[0]?.viewsLoaded).toBe(false);
    expect(result[0]?.totalViews).toBe(10);
  });
});
