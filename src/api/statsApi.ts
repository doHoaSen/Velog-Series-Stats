import { requestVelogGraphql, VELOG_V2_ENDPOINT } from "./graphqlClient";
import type { PostStats } from "../model/stats";

const GET_STATS_QUERY = `
  query GetStats($post_id: ID!) {
    getStats(post_id: $post_id) {
      total
      count_by_day {
        count
        day
      }
    }
  }
`;

interface GetStatsData {
  getStats: PostStats;
}

export async function fetchPostStats(postId: string): Promise<PostStats> {
  const data = await requestVelogGraphql<GetStatsData, { post_id: string }>({
    endpoint: VELOG_V2_ENDPOINT,
    query: GET_STATS_QUERY,
    variables: { post_id: postId },
  });

  return data.getStats;
}
