import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ updateTag: vi.fn() }));

type Context = {
  member: { organization: { id: string } };
  session: { active: boolean; supportEnded: boolean };
  active: boolean;
  cacheVersions: Record<string, number> | null;
} | null;

let context: Context = null;
let permissions = new Set<string>();

vi.mock("@/lib/auth/session", () => ({ getSessionContext: async () => context }));
vi.mock("@/lib/auth/access", () => ({
  getMemberAccess: async () => ({ permissions, modules: new Set(), locked: false }),
}));

const { orgCacheVersion, orgCacheTag } = await import("./org-cache");

const ORG = "11111111-1111-4111-8111-111111111111";
const OTHER = "22222222-2222-4222-8222-222222222222";

function signedIn(overrides: Partial<NonNullable<Context>> = {}): NonNullable<Context> {
  return {
    member: { organization: { id: ORG } },
    session: { active: true, supportEnded: false },
    active: true,
    cacheVersions: { customers: 4, machines: 2 },
    ...overrides,
  };
}

describe("orgCacheVersion", () => {
  beforeEach(() => {
    context = signedIn();
    permissions = new Set(["customers.read"]);
  });

  it("gives a member holding one of the permissions the lists' versions as key", async () => {
    expect(await orgCacheVersion(ORG, ["customers.read", "products.read"], ["customers"])).toBe(
      "customers:4",
    );
    expect(await orgCacheVersion(ORG, "member", ["machines", "stock_locations"])).toBe(
      "machines:2,stock_locations:0",
    );
  });

  it("changes the key when a list changes", async () => {
    const before = await orgCacheVersion(ORG, "member", ["customers"]);
    context = signedIn({ cacheVersions: { customers: 5, machines: 2 } });
    expect(await orgCacheVersion(ORG, "member", ["customers"])).not.toBe(before);
  });

  it("never serves another organization's lists", async () => {
    expect(await orgCacheVersion(OTHER, "member", ["customers"])).toBeNull();
    expect(await orgCacheVersion(OTHER, ["customers.read"], ["customers"])).toBeNull();
  });

  it("refuses without the permission the table's RLS asks for", async () => {
    expect(await orgCacheVersion(ORG, ["machines.read"], ["machines"])).toBeNull();
  });

  it("refuses when RLS would give the member nothing, or the versions are unknown", async () => {
    for (const refused of [
      null,
      signedIn({ active: false }),
      signedIn({ session: { active: false, supportEnded: false } }),
      signedIn({ session: { active: true, supportEnded: true } }),
      signedIn({ cacheVersions: null }),
    ]) {
      context = refused;
      expect(await orgCacheVersion(ORG, "member", ["customers"])).toBeNull();
    }
  });
});

describe("orgCacheTag", () => {
  it("is per organization and list", () => {
    expect(orgCacheTag(ORG, "customers")).toBe(`org:${ORG}:customers`);
    expect(orgCacheTag(ORG, "customers")).not.toBe(orgCacheTag(OTHER, "customers"));
  });
});
