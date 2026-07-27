import { requestVelogGraphql, VELOG_V2_ENDPOINT } from "./graphqlClient";
import type { PostStats } from "../model/stats";

const EMPTY_POST_STATS: PostStats = { total: 0, count_by_day: [] };

// 게시글마다 getStats를 따로 요청하면 게시글 수만큼 executeScript 탭 주입 왕복이
// 생겨 느려진다. GraphQL alias로 여러 게시글의 getStats를 한 요청에 묶어 왕복 횟수를 줄인다.
// count_by_day까지 함께 요청해서 시리즈별 성장률(최근 7일 vs 직전 7일) 계산에 활용한다.
export async function fetchPostStatsBatch(postIds: string[]): Promise<Map<string, PostStats>> {
  const statsByPostId = new Map<string, PostStats>();

  if (postIds.length === 0) {
    return statsByPostId;
  }

  const variableDefs = postIds.map((_, index) => `$id${index}: ID!`).join(", ");
  const fields = postIds
    .map(
      (_, index) =>
        `s${index}: getStats(post_id: $id${index}) { total count_by_day { count day } }`,
    )
    .join("\n");
  const query = `query GetStatsBatch(${variableDefs}) {\n${fields}\n}`;

  const variables: Record<string, string> = {};
  postIds.forEach((postId, index) => {
    variables[`id${index}`] = postId;
  });

  const data = await requestVelogGraphql<Record<string, PostStats | null>, Record<string, string>>(
    {
      endpoint: VELOG_V2_ENDPOINT,
      query,
      variables,
    },
  );

  postIds.forEach((postId, index) => {
    statsByPostId.set(postId, data[`s${index}`] ?? EMPTY_POST_STATS);
  });

  return statsByPostId;
}
