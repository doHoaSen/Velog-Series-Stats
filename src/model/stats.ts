export interface PostStats {
  total: number;
  count_by_day: Array<{
    count: number;
    day: string;
  }>;
}
