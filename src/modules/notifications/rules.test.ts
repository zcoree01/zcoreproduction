import { describe, expect, it } from "vitest";
import {
  bellItems,
  itemsToAnnounce,
  notificationKey,
  notificationKeysSchema,
  unreadCount,
  type BellSource,
} from "./rules";

const ID = "6f1c2c1e-0d3b-4c55-9a43-6a3e1b2f0c11";
const ID2 = "7a2d3d2f-1e4c-4d66-8b54-7b4f2c3a1d22";
const ID3 = "8b3e4e3a-2f5d-4e77-9c65-8c5a3d4b2e33";

const source = (key: string): BellSource => ({
  key,
  group: "close",
  href: "/orders",
  title: key,
  detail: "",
  toast: key,
});

describe("notification bell", () => {
  it("hides removed items and marks read ones", () => {
    const items = bellItems(
      [
        source(notificationKey("close", ID)),
        source(notificationKey("alert", ID2)),
        source(notificationKey("approval", ID3)),
      ],
      { read: [`alert:${ID2}`, `close:${ID}`], dismissed: [`close:${ID}`] },
    );
    expect(items.map((item) => [item.key, item.read])).toEqual([
      [`alert:${ID2}`, true],
      [`approval:${ID3}`, false],
    ]);
    expect(unreadCount(items)).toBe(1);
  });

  it("announces only unread items not shown before", () => {
    const items = bellItems(
      [source(`close:${ID}`), source(`alert:${ID2}`), source(`approval:${ID3}`)],
      {
        read: [`alert:${ID2}`],
        dismissed: [],
      },
    );
    expect(itemsToAnnounce(items, new Set([`approval:${ID3}`])).map((item) => item.key)).toEqual([
      `close:${ID}`,
    ]);
  });

  it("accepts only well-formed keys", () => {
    expect(notificationKeysSchema.safeParse([`close:${ID}`]).success).toBe(true);
    expect(notificationKeysSchema.safeParse([]).success).toBe(false);
    expect(notificationKeysSchema.safeParse(["close:1"]).success).toBe(false);
    expect(notificationKeysSchema.safeParse([`Close:${ID}`]).success).toBe(false);
  });
});
