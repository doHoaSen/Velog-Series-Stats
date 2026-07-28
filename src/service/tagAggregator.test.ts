import { describe, expect, it } from "vitest";
import { groupByTag } from "./tagAggregator";
import type { VelogPost } from "../model/post";

function makePost(id: string, overrides: Partial<VelogPost> = {}): VelogPost {
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
    ...overrides,
  };
}

describe("groupByTag", () => {
  it("태그별로 게시글을 묶고 조회수/좋아요/댓글수 합계를 계산한다", () => {
    const posts = [
      makePost("p1", { tags: ["React"], likes: 3, comments_count: 1 }),
      makePost("p2", { tags: ["React"], likes: 5, comments_count: 2 }),
      makePost("p3", { tags: ["TypeScript"], likes: 1, comments_count: 0 }),
    ];
    const viewsByPostId = new Map([
      ["p1", 10],
      ["p2", 20],
      ["p3", 7],
    ]);

    const result = groupByTag(posts, viewsByPostId);

    const react = result.find((t) => t.tagName === "React");
    expect(react).toMatchObject({
      postCount: 2,
      totalViews: 30,
      totalLikes: 8,
      totalComments: 3,
      viewsLoaded: true,
    });

    const typescript = result.find((t) => t.tagName === "TypeScript");
    expect(typescript).toMatchObject({
      postCount: 1,
      totalViews: 7,
      totalLikes: 1,
      totalComments: 0,
    });
  });

  it("한 게시글에 태그가 여러 개면 각 태그 그룹에 전체 값을 중복 반영한다", () => {
    const posts = [makePost("p1", { tags: ["React", "Frontend"], likes: 4, comments_count: 2 })];
    const viewsByPostId = new Map([["p1", 100]]);

    const result = groupByTag(posts, viewsByPostId);

    expect(result).toHaveLength(2);
    for (const tagStats of result) {
      expect(tagStats).toMatchObject({ postCount: 1, totalViews: 100, totalLikes: 4, totalComments: 2 });
    }
  });

  it("대소문자/공백만 다른 태그는 하나로 묶고 가장 자주 나온 표기를 사용한다", () => {
    const posts = [
      makePost("p1", { tags: ["react"] }),
      makePost("p2", { tags: [" React "] }),
      makePost("p3", { tags: ["React"] }),
    ];
    const viewsByPostId = new Map([
      ["p1", 1],
      ["p2", 1],
      ["p3", 1],
    ]);

    const result = groupByTag(posts, viewsByPostId);

    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({ tagName: "React", postCount: 3 });
  });

  it("동률이면 먼저 나온 표기를 사용한다", () => {
    const posts = [makePost("p1", { tags: ["react"] }), makePost("p2", { tags: ["React"] })];
    const viewsByPostId = new Map([
      ["p1", 1],
      ["p2", 1],
    ]);

    const result = groupByTag(posts, viewsByPostId);

    expect(result[0]?.tagName).toBe("react");
  });

  it("그룹 내 일부 게시글의 조회수가 아직 없으면 viewsLoaded를 false로 표시한다", () => {
    const posts = [makePost("p1", { tags: ["React"] }), makePost("p2", { tags: ["React"] })];
    const viewsByPostId = new Map([["p1", 10]]); // p2는 아직 조회수 미도착

    const result = groupByTag(posts, viewsByPostId);

    expect(result[0]?.viewsLoaded).toBe(false);
    expect(result[0]?.totalViews).toBe(10);
  });
});
