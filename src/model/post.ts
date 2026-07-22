export interface VelogPost {
  id: string;
  title: string;
  url_slug: string;
  released_at: string;
  updated_at: string;
  comments_count: number;
  likes: number;
  is_private: boolean;
  tags: string[];
}
