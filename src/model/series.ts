export interface VelogSeries {
  id: string;
  name: string;
  url_slug: string;
  posts_count: number;
}

export interface SeriesPostRef {
  id: string;
  post: {
    id: string;
    title: string;
    url_slug: string;
  };
}

export interface SeriesWithPosts {
  id: string;
  name: string;
  url_slug: string;
  series_posts: SeriesPostRef[];
}
