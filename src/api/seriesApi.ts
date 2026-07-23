import { requestVelogGraphql, VELOG_V2_ENDPOINT, VELOG_V3_ENDPOINT } from "./graphqlClient";
import type { VelogSeries, SeriesWithPosts } from "../model/series";

const USER_SERIES_LIST_QUERY = `
  query getUserSeriesList($input: GetUserInput!) {
    user(input: $input) {
      id
      series_list {
        id
        name
        url_slug
        posts_count
      }
    }
  }
`;

const SERIES_WITH_POSTS_QUERY = `
  query series($username: String!, $url_slug: String!) {
    series(username: $username, url_slug: $url_slug) {
      id
      name
      url_slug
      series_posts {
        id
        post {
          id
          title
          url_slug
        }
      }
    }
  }
`;

interface UserSeriesListData {
  user: { id: string; series_list: VelogSeries[] } | null;
}

export async function fetchMySeriesList(username: string): Promise<VelogSeries[]> {
  const data = await requestVelogGraphql<UserSeriesListData, { input: { username: string } }>({
    endpoint: VELOG_V3_ENDPOINT,
    query: USER_SERIES_LIST_QUERY,
    variables: { input: { username } },
  });

  return data.user?.series_list ?? [];
}

interface SeriesWithPostsData {
  series: SeriesWithPosts | null;
}

export async function fetchSeriesPosts(
  username: string,
  urlSlug: string,
): Promise<SeriesWithPosts | null> {
  const data = await requestVelogGraphql<
    SeriesWithPostsData,
    { username: string; url_slug: string }
  >({
    endpoint: VELOG_V2_ENDPOINT,
    query: SERIES_WITH_POSTS_QUERY,
    variables: { username, url_slug: urlSlug },
  });

  return data.series;
}
