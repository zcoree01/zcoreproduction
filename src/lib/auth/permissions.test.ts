import { describe, expect, it, vi } from "vitest";
import {
  checkPermission,
  PermissionDeniedError,
  UnauthenticatedError,
  type PermissionClient,
} from "./permissions";

const ORG_ID = "11111111-1111-4111-8111-111111111111";
const USER_ID = "22222222-2222-4222-8222-222222222222";

function fakeClient(options: {
  user?: { id: string } | null;
  rpc?: { data: boolean | null; error: { message: string } | null };
}) {
  const rpc = vi.fn(async () => options.rpc ?? { data: true, error: null });
  const client: PermissionClient = {
    auth: {
      getUser: async () => ({
        data: { user: options.user === undefined ? { id: USER_ID } : options.user },
        error: null,
      }),
    },
    rpc,
  };
  return { client, rpc };
}

describe("checkPermission", () => {
  it("returns the user id when the database grants the permission", async () => {
    const { client, rpc } = fakeClient({ rpc: { data: true, error: null } });
    await expect(checkPermission(client, ORG_ID, "users.manage")).resolves.toEqual({
      userId: USER_ID,
    });
    expect(rpc).toHaveBeenCalledWith("has_permission", {
      p_org_id: ORG_ID,
      p_permission: "users.manage",
    });
  });

  it("throws PermissionDeniedError when the database denies it", async () => {
    const { client } = fakeClient({ rpc: { data: false, error: null } });
    await expect(checkPermission(client, ORG_ID, "audit.read")).rejects.toBeInstanceOf(
      PermissionDeniedError,
    );
  });

  it("treats a null result as denied", async () => {
    const { client } = fakeClient({ rpc: { data: null, error: null } });
    await expect(checkPermission(client, ORG_ID, "audit.read")).rejects.toBeInstanceOf(
      PermissionDeniedError,
    );
  });

  it("throws UnauthenticatedError without a session and never asks the database", async () => {
    const { client, rpc } = fakeClient({ user: null });
    await expect(checkPermission(client, ORG_ID, "users.read")).rejects.toBeInstanceOf(
      UnauthenticatedError,
    );
    expect(rpc).not.toHaveBeenCalled();
  });

  it("fails closed when the RPC errors", async () => {
    const { client } = fakeClient({ rpc: { data: null, error: { message: "boom" } } });
    await expect(checkPermission(client, ORG_ID, "users.read")).rejects.toThrow(
      "Permission check failed: boom",
    );
  });

  it("rejects a non-uuid organization id before any call", async () => {
    const { client, rpc } = fakeClient({});
    await expect(checkPermission(client, "demo", "users.read")).rejects.toThrow();
    expect(rpc).not.toHaveBeenCalled();
  });

  it("rejects unknown permission keys at runtime", async () => {
    const { client, rpc } = fakeClient({});
    // Simulates an unchecked value reaching the function (e.g. from a form).
    const forged = "everything.allow" as unknown as "users.read";
    await expect(checkPermission(client, ORG_ID, forged)).rejects.toThrow();
    expect(rpc).not.toHaveBeenCalled();
  });
});
