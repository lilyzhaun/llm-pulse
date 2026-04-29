import { describe, expect, it } from "vitest";
import { compareByCreatedAtDescThenIdDesc } from "../../src/lib/comparators.js";

describe("compareByCreatedAtDescThenIdDesc", () => {
  it("按 created_at 倒序排列", () => {
    const items = [
      { created_at: 100, id: 1 },
      { created_at: 200, id: 2 },
      { created_at: 150, id: 3 },
    ];

    const sorted = [...items].sort(compareByCreatedAtDescThenIdDesc);

    expect(sorted).toEqual([
      { created_at: 200, id: 2 },
      { created_at: 150, id: 3 },
      { created_at: 100, id: 1 },
    ]);
  });

  it("相同 created_at 时按 id 倒序排列", () => {
    const items = [
      { created_at: 100, id: 1 },
      { created_at: 100, id: 3 },
      { created_at: 100, id: 2 },
    ];

    const sorted = [...items].sort(compareByCreatedAtDescThenIdDesc);

    expect(sorted).toEqual([
      { created_at: 100, id: 3 },
      { created_at: 100, id: 2 },
      { created_at: 100, id: 1 },
    ]);
  });

  it("完全相同的记录返回 0", () => {
    const left = { created_at: 100, id: 1 };
    const right = { created_at: 100, id: 1 };

    expect(compareByCreatedAtDescThenIdDesc(left, right)).toBe(0);
  });

  it("对空数组排序不抛异常", () => {
    expect(() => [].sort(compareByCreatedAtDescThenIdDesc)).not.toThrow();
  });
});
