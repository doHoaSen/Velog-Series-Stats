import { requestVelogGraphql, VELOG_V3_ENDPOINT } from "./graphqlClient";
import type { VelogPost } from "../model/post";

const VELOG_POSTS_QUERY = `
  query velogPosts($input: GetPostsInput!) {
    posts(input: $input) {
      id
      title
      url_slug
      released_at
      updated_at
      comments_count
      tags
      is_private
      likes
    }
  }
`;

const PAGE_SIZE = 20;

interface VelogPostsInput {
  username: string;
  cursor?: string;
  limit: number;
  tag: string;
}

interface VelogPostsData {
  posts: VelogPost[];
}

export async function fetchAllMyPosts(username: string): Promise<VelogPost[]> {
  const posts: VelogPost[] = [];
  let cursor: string | undefined;

  for (;;) {
    const data = await requestVelogGraphql<VelogPostsData, { input: VelogPostsInput }>({
      endpoint: VELOG_V3_ENDPOINT,
      query: VELOG_POSTS_QUERY,
      variables: {
        input: { username, cursor, limit: PAGE_SIZE, tag: "" },
      },
    });

    posts.push(...data.posts);

    if (data.posts.length < PAGE_SIZE) {
      break;
    }

    cursor = data.posts[data.posts.length - 1]?.id;
  }

  return posts;
}
