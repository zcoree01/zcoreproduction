import type { SupabaseClient } from "@supabase/supabase-js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Database } from "@/lib/supabase/types";

vi.mock("server-only", () => ({}));
const purgeMock = vi.hoisted(() => vi.fn());
const adminMock = vi.hoisted(() => vi.fn(() => ({ admin: true })));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: adminMock }));
vi.mock("./purge", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./purge")>();
  return { ...actual, purgeDueOrganizations: purgeMock };
});

const { GET } = await import("@/app/api/cron/purge-organizations/route");
const { isCronAuthorized } = await import("./purge");
const actual = await vi.importActual<typeof import("./purge")>("./purge");

const URL_ = "https://app.zcore.ba/api/cron/purge-organizations";
const request = (authorization?: string) =>
  new Request(URL_, { headers: authorization ? { authorization } : {} });

describe("GET /api/cron/purge-organizations", () => {
  beforeEach(() => {
    purgeMock.mockReset();
    purgeMock.mockResolvedValue({ purged: [], failed: [] });
  });
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("rejects a request without the cron secret", async () => {
    vi.stubEnv("CRON_SECRET", "s3cret-value");
    for (const header of [undefined, "Bearer wrong", "s3cret-value", "Bearer s3cret-valu"]) {
      const res = await GET(request(header));
      expect(res.status).toBe(401);
    }
    expect(purgeMock).not.toHaveBeenCalled();
  });

  it("rejects every request when CRON_SECRET is not set", async () => {
    vi.stubEnv("CRON_SECRET", "");
    for (const header of [undefined, "Bearer ", "Bearer undefined"]) {
      const res = await GET(request(header));
      expect(res.status).toBe(401);
    }
    expect(purgeMock).not.toHaveBeenCalled();
  });

  it("runs the purge with the service client when the secret matches", async () => {
    vi.stubEnv("CRON_SECRET", "s3cret-value");
    purgeMock.mockResolvedValue({ purged: ["org-1"], failed: [] });
    const res = await GET(request("Bearer s3cret-value"));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ purged: ["org-1"], failed: [] });
    expect(purgeMock).toHaveBeenCalledWith({ admin: true }, expect.any(Date));
  });

  it("answers 500 when a firm could not be purged", async () => {
    vi.stubEnv("CRON_SECRET", "s3cret-value");
    purgeMock.mockResolvedValue({ purged: [], failed: [{ id: "org-1", error: "x" }] });
    const res = await GET(request("Bearer s3cret-value"));
    expect(res.status).toBe(500);
  });
});

describe("isCronAuthorized", () => {
  it("needs a non-empty secret and the exact bearer header", () => {
    expect(isCronAuthorized("Bearer abc", "abc")).toBe(true);
    expect(isCronAuthorized("Bearer abc", undefined)).toBe(false);
    expect(isCronAuthorized("Bearer ", "")).toBe(false);
    expect(isCronAuthorized(null, "abc")).toBe(false);
    expect(isCronAuthorized("bearer abc", "abc")).toBe(false);
    expect(isCronAuthorized("Bearer abcd", "abc")).toBe(false);
  });
});

// Minimal fake of the calls purgeDueOrganizations makes.
type Entry = { name: string; id: string | null };
function fakeClient(opts: {
  due: string[];
  files: Record<string, Record<string, Entry[]>>;
  rpcError?: Record<string, string>;
  listError?: string;
}) {
  const removed: { bucket: string; paths: string[] }[] = [];
  const rpcCalls: string[] = [];
  const filters: unknown[][] = [];
  const query = {
    select: () => query,
    not: (...a: unknown[]) => (filters.push(["not", ...a]), query),
    lte: (...a: unknown[]) => (filters.push(["lte", ...a]), query),
    eq: (...a: unknown[]) => (filters.push(["eq", ...a]), query),
    order: () => Promise.resolve({ data: opts.due.map((id) => ({ id })), error: null }),
  };
  const client = {
    from: (table: string) => {
      expect(table).toBe("organizations");
      return query;
    },
    storage: {
      from: (bucket: string) => ({
        list: async (prefix: string, o: { limit: number; offset: number }) => {
          if (opts.listError) return { data: null, error: { message: opts.listError } };
          const all = opts.files[bucket]?.[prefix] ?? [];
          return { data: all.slice(o.offset, o.offset + o.limit), error: null };
        },
        remove: async (paths: string[]) => {
          removed.push({ bucket, paths });
          return { data: [], error: null };
        },
      }),
    },
    rpc: async (fn: string, args: { p_org_id: string }) => {
      expect(fn).toBe("purge_organization");
      rpcCalls.push(args.p_org_id);
      const message = opts.rpcError?.[args.p_org_id];
      return message ? { data: null, error: { message } } : { data: true, error: null };
    },
  };
  return { client: client as unknown as SupabaseClient<Database>, removed, rpcCalls, filters };
}

describe("purgeDueOrganizations", () => {
  it("removes the firm's files in every bucket (nested folders), then purges it", async () => {
    const many = Array.from({ length: 150 }, (_, i) => ({ name: `f${i}.pdf`, id: `id${i}` }));
    const fake = fakeClient({
      due: ["org-a"],
      files: {
        "product-files": {
          "org-a": [
            { name: "p1", id: null },
            { name: "top.png", id: "x" },
          ],
          "org-a/p1": [
            { name: "rev", id: null },
            { name: "a.pdf", id: "y" },
          ],
          "org-a/p1/rev": [{ name: "b.dxf", id: "z" }],
        },
        "absence-documents": { "org-a": many },
      },
    });
    const now = new Date("2026-12-10T03:00:00Z");
    const result = await actual.purgeDueOrganizations(fake.client, now);
    expect(result).toEqual({ purged: ["org-a"], failed: [] });
    expect(fake.rpcCalls).toEqual(["org-a"]);
    // Ten minutes of margin: the files go before the database checks with its own clock.
    expect(fake.filters).toContainEqual(["lte", "delete_after", "2026-12-10T02:50:00.000Z"]);
    expect(fake.filters).toContainEqual(["not", "archived_at", "is", null]);
    const product = fake.removed
      .filter((r) => r.bucket === "product-files")
      .flatMap((r) => r.paths);
    expect(product.sort()).toEqual(["org-a/p1/a.pdf", "org-a/p1/rev/b.dxf", "org-a/top.png"]);
    const absence = fake.removed.filter((r) => r.bucket === "absence-documents");
    expect(absence.flatMap((r) => r.paths)).toHaveLength(150);
    expect(fake.removed.some((r) => r.bucket === "stock-certificates")).toBe(false);
  });

  it("selects only firms due at least the safety margin ago", () => {
    expect(actual.PURGE_SAFETY_MARGIN_MS).toBe(10 * 60_000);
    expect(actual.purgeCutoff(new Date("2026-12-10T00:05:00Z")).toISOString()).toBe(
      "2026-12-09T23:55:00.000Z",
    );
  });

  it("keeps going when one firm fails", async () => {
    const fake = fakeClient({
      due: ["org-a", "org-b"],
      files: {},
      rpcError: { "org-a": "rows left after purge: 1" },
    });
    const result = await actual.purgeDueOrganizations(fake.client, new Date());
    expect(result).toEqual({
      purged: ["org-b"],
      failed: [{ id: "org-a", error: "rows left after purge: 1" }],
    });
  });

  it("does not purge a firm whose files could not be listed", async () => {
    const fake = fakeClient({ due: ["org-a"], files: {}, listError: "storage down" });
    const result = await actual.purgeDueOrganizations(fake.client, new Date());
    expect(result.purged).toEqual([]);
    expect(result.failed[0]?.id).toBe("org-a");
    expect(fake.rpcCalls).toEqual([]);
  });
});
