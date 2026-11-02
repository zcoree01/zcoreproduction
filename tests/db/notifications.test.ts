import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { setupFixture, type Fixture } from "./fixtures";

// Notification state (D-038): each user marks bell items read or removes
// them; only the caller's own rows exist and are visible, removing implies
// read, and repeating is harmless.

let fx: Fixture;
const keys = [`alert:${randomUUID()}`, `close:${randomUUID()}`];

async function clear() {
  await fx.service.from("notification_reads").delete().in("item_key", keys);
}

beforeAll(async () => {
  fx = await setupFixture();
  await clear();
}, 60_000);

afterAll(async () => {
  await clear();
});

describe("notification state", () => {
  it("marks read, removes, and keeps rows per user", async () => {
    const read = await fx.a.admin.rpc("mark_notifications", {
      p_org_id: fx.a.org.id,
      p_keys: keys,
      p_dismiss: false,
    });
    expect(read.error).toBeNull();
    const removed = await fx.a.admin.rpc("mark_notifications", {
      p_org_id: fx.a.org.id,
      p_keys: [keys[0]!],
      p_dismiss: true,
    });
    expect(removed.error).toBeNull();
    // Marking read again does not bring a removed item back.
    await fx.a.admin
      .rpc("mark_notifications", { p_org_id: fx.a.org.id, p_keys: keys, p_dismiss: false })
      .throwOnError();

    const own = await fx.a.admin
      .from("notification_reads")
      .select("item_key, dismissed_at")
      .in("item_key", keys)
      .order("item_key");
    expect(own.data?.map((row) => [row.item_key, row.dismissed_at !== null])).toEqual([
      [keys[0], true],
      [keys[1], false],
    ]);

    // Another user of the same organization sees none of them.
    const other = await fx.a.operator
      .from("notification_reads")
      .select("item_key")
      .in("item_key", keys);
    expect(other.data).toEqual([]);
  });

  it("refuses other organizations and bad keys", async () => {
    const foreign = await fx.a.admin.rpc("mark_notifications", {
      p_org_id: fx.b.org.id,
      p_keys: keys,
      p_dismiss: false,
    });
    expect(foreign.error?.code).toBe("42501");
    const bad = await fx.a.admin.rpc("mark_notifications", {
      p_org_id: fx.a.org.id,
      p_keys: ["alert:1"],
      p_dismiss: false,
    });
    expect(bad.error).not.toBeNull();
    const direct = await fx.a.admin.from("notification_reads").insert({
      organization_id: fx.a.org.id,
      user_id: fx.a.adminId,
      item_key: keys[1]!,
    });
    expect(direct.error).not.toBeNull();
  });
});
