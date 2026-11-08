import { describe, expect, it } from "vitest";
import bs from "../../messages/bs.json";

type Messages = { [key: string]: string | Messages };

function collectLeaves(messages: Messages, prefix = ""): [string, string][] {
  return Object.entries(messages).flatMap(([key, value]) => {
    const path = prefix ? `${prefix}.${key}` : key;
    return typeof value === "string"
      ? [[path, value] as [string, string]]
      : collectLeaves(value, path);
  });
}

describe("messages/bs.json", () => {
  it("has no empty translations", () => {
    const empty = collectLeaves(bs).filter(([, value]) => value.trim() === "");
    expect(empty).toEqual([]);
  });

  it("has no key with a dot (next-intl uses dots for nesting)", () => {
    const keys = (messages: Messages, prefix = ""): string[] =>
      Object.entries(messages).flatMap(([key, value]) => [
        ...(key.includes(".") ? [`${prefix}${key}`] : []),
        ...(typeof value === "string" ? [] : keys(value, `${prefix}${key} › `)),
      ]);
    expect(keys(bs)).toEqual([]);
  });
});
