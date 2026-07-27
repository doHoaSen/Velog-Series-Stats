import { describe, expect, it } from "vitest";
import { formatRelativeTime } from "./time";

describe("formatRelativeTime", () => {
  const now = new Date("2026-07-27T12:00:00Z").getTime();

  it("1분 미만이면 '방금'을 반환한다", () => {
    expect(formatRelativeTime(now - 30_000, now)).toBe("방금");
  });

  it("1시간 미만이면 'n분 전'을 반환한다", () => {
    expect(formatRelativeTime(now - 5 * 60_000, now)).toBe("5분 전");
  });

  it("24시간 미만이면 'n시간 전'을 반환한다", () => {
    expect(formatRelativeTime(now - 3 * 60 * 60_000, now)).toBe("3시간 전");
  });

  it("24시간 이상이면 'n일 전'을 반환한다", () => {
    expect(formatRelativeTime(now - 2 * 24 * 60 * 60_000, now)).toBe("2일 전");
  });
});
