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
});
