export function formatRelativeTime(timestamp: number, now: number = Date.now()): string {
  const diffMinutes = Math.floor((now - timestamp) / 60000);

  if (diffMinutes < 1) return "방금";
  if (diffMinutes < 60) return `${diffMinutes}분 전`;

  const diffHours = Math.floor(diffMinutes / 60);
  if (diffHours < 24) return `${diffHours}시간 전`;

  return `${Math.floor(diffHours / 24)}일 전`;
}
