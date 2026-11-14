import path from "node:path";
import { describe, expect, it } from "vitest";
import bs from "../../messages/bs.json";
import { MESSAGE_SCOPES, pickMessages, type MessageScope } from "./message-scopes";
import { messageUsage, minimalPaths } from "./message-usage";

const src = path.resolve(__dirname, "..");

// What each scope's provider wraps. Root: the root layout itself and pages
// outside every route group.
const ENTRIES: Record<MessageScope, string[]> = {
  root: ["app/layout.tsx", "app/page.tsx"],
  floor: ["app/(floor)"],
  auth: ["app/(auth)"],
  kiosk: ["app/(kiosk)"],
};

describe("message scopes", () => {
  it.each(Object.keys(ENTRIES) as MessageScope[])(
    "%s lists exactly the messages its client components read",
    (scope) => {
      const usage = messageUsage(
        src,
        ENTRIES[scope].map((entry) => path.join(src, entry)),
      );
      expect(usage.unresolved).toEqual([]);
      // On failure: copy the received list into MESSAGE_SCOPES.
      expect(minimalPaths(usage.namespaces)).toEqual([...MESSAGE_SCOPES[scope]]);
    },
  );

  it("every scoped path exists in bs.json", () => {
    for (const paths of Object.values(MESSAGE_SCOPES)) {
      for (const p of paths) {
        const value = p
          .split(".")
          .reduce<unknown>((node, key) => (node as Record<string, unknown> | undefined)?.[key], bs);
        expect(value, p).toBeTypeOf("object");
      }
    }
  });
});

describe("pickMessages", () => {
  const messages = { a: { x: "1", y: { z: "2" } }, b: { w: "3" }, c: "4" };

  it("keeps whole namespaces and nested paths only", () => {
    expect(pickMessages(messages, ["b", "a.y"])).toEqual({ b: { w: "3" }, a: { y: { z: "2" } } });
  });

  it("merges sibling paths and skips missing ones", () => {
    expect(pickMessages(messages, ["a.x", "a.y", "missing.path"])).toEqual({
      a: { x: "1", y: { z: "2" } },
    });
  });
});

describe("minimalPaths", () => {
  it("drops paths covered by an ancestor, sorted", () => {
    expect(minimalPaths(["orders.form", "common", "orders", "ordersX.a"])).toEqual([
      "common",
      "orders",
      "ordersX.a",
    ]);
  });
});
