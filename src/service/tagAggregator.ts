import type { VelogPost } from "../model/post";

export interface TagStats {
  tagName: string;
  postCount: number;
  totalViews: number;
  averageViews: number;
  // totalViews=0만으로는 '진짜 조회수 0'과 '아직 안 불러옴'을 구분할 수 없어 별도 플래그로 로딩 상태를 표시한다.
  viewsLoaded: boolean;
}

interface TagGroup {
  postsById: Map<string, VelogPost>;
  // 대소문자/공백만 다른 태그를 하나로 묶되, 화면에는 그중 가장 자주 쓰인 원본 표기를 보여주기 위한 집계.
  labelCounts: Map<string, number>;
}

export function groupByTag(
  posts: VelogPost[],
  viewsByPostId: Map<string, number>,
): TagStats[] {
  const groupsByKey = new Map<string, TagGroup>();

  for (const post of posts) {
    for (const rawTag of post.tags) {
      const label = rawTag.trim();
      if (!label) continue;
      // trim + 소문자로 정규화한 값을 그룹 키로 써서 "React"와 "react"를 같은 태그로 묶는다.
      const key = label.toLowerCase();

      const group = groupsByKey.get(key) ?? { postsById: new Map(), labelCounts: new Map() };
      group.postsById.set(post.id, post);
      group.labelCounts.set(label, (group.labelCounts.get(label) ?? 0) + 1);
      groupsByKey.set(key, group);
    }
  }

  return Array.from(groupsByKey.values()).map((group) => {
    const tagPosts = Array.from(group.postsById.values());
    const viewsLoaded = tagPosts.every((post) => viewsByPostId.has(post.id));
    const totalViews = tagPosts.reduce((sum, post) => sum + (viewsByPostId.get(post.id) ?? 0), 0);

    return {
      tagName: pickDisplayLabel(group.labelCounts),
      postCount: tagPosts.length,
      totalViews,
      averageViews: totalViews / tagPosts.length,
      viewsLoaded,
    };
  });
}

// 가장 자주 나온 표기를 고르되, 동률이면 먼저 나온 표기를 유지한다
// (Map은 삽입 순서를 보존하므로, 엄격히 더 큰 카운트일 때만 교체하면 동률 시 첫 번째가 남는다).
function pickDisplayLabel(labelCounts: Map<string, number>): string {
  let bestLabel = "";
  let bestCount = 0;
  for (const [label, count] of labelCounts) {
    if (count > bestCount) {
      bestLabel = label;
      bestCount = count;
    }
  }
  return bestLabel;
}
