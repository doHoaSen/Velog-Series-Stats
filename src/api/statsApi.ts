import { requestVelogGraphql, VELOG_V2_ENDPOINT } from "./graphqlClient";

// 게시글마다 getStats를 따로 요청하면 게시글 수만큼 executeScript 탭 주입 왕복이
// 생겨 느려진다. GraphQL alias로 여러 게시글의 getStats를 한 요청에 묶어 왕복 횟수를 줄인다.
export async function fetchPostStatsBatch(postIds: string[]): Promise<Map<string, number>> {
  const viewsByPostId = new Map<string, number>();

  if (postIds.length === 0) {
    return viewsByPostId;
  }

  const variableDefs = postIds.map((_, index) => `$id${index}: ID!`).join(", ");
  const fields = postIds
    .map((_, index) => `s${index}: getStats(post_id: $id${index}) { total }`)
    .join("\n");
  const query = `query GetStatsBatch(${variableDefs}) {\n${fields}\n}`;

  const variables: Record<string, string> = {};
  postIds.forEach((postId, index) => {
    variables[`id${index}`] = postId;
  });

  const data = await requestVelogGraphql<
    Record<string, { total: number } | null>,
    Record<string, string>
  >({
    endpoint: VELOG_V2_ENDPOINT,
    query,
    variables,
  });

  postIds.forEach((postId, index) => {
    viewsByPostId.set(postId, data[`s${index}`]?.total ?? 0);
  });

  return viewsByPostId;
}
