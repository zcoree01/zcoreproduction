import { describe, expect, it } from "vitest";
import { requestHost, resolveTenant, tenantUrl } from "./resolve";

describe("requestHost", () => {
  const headers = (values: Record<string, string>) => new Headers(values);

  it("prefers x-forwarded-host (server action redirects fetch via localhost)", () => {
    expect(
      requestHost(headers({ host: "localhost:3000", "x-forwarded-host": "demo.localhost:3000" })),
    ).toBe("demo.localhost:3000");
  });

  it("takes the first entry of a forwarded list", () => {
    expect(requestHost(headers({ "x-forwarded-host": "demo.zcore.ba, proxy.internal" }))).toBe(
      "demo.zcore.ba",
    );
  });

  it("falls back to host", () => {
    expect(requestHost(headers({ host: "demo.zcore.ba" }))).toBe("demo.zcore.ba");
    expect(requestHost(headers({}))).toBeNull();
  });
});

const resolve = (
  host: string | null,
  orgParam: string | null = null,
  orgCookie: string | null = null,
) => resolveTenant({ host, orgParam, orgCookie });

describe("resolveTenant", () => {
  it("uses the subdomain of the production domain", () => {
    expect(resolve("demo.zcore.ba")).toEqual({ slug: "demo", source: "subdomain", persist: false });
    expect(resolve("Metal-Pro.ZCORE.ba:443").slug).toBe("metal-pro");
  });

  it("uses <slug>.localhost in development", () => {
    expect(resolve("demo.localhost:3000")).toEqual({
      slug: "demo",
      source: "subdomain",
      persist: false,
    });
  });

  it("never accepts ?org or the cookie on production hosts", () => {
    expect(resolve("zcore.ba", "demo", "demo").slug).toBeNull();
    expect(resolve("www.zcore.ba", "demo").slug).toBeNull();
    expect(resolve("evil.example.com", "demo", "demo").slug).toBeNull();
  });

  it("lets the subdomain win over ?org", () => {
    expect(resolve("demo.zcore.ba", "other").slug).toBe("demo");
    expect(resolve("demo.localhost:3000", "other").slug).toBe("demo");
  });

  it("accepts ?org on localhost and Vercel previews and asks to persist it", () => {
    expect(resolve("localhost:3000", "demo")).toEqual({
      slug: "demo",
      source: "query",
      persist: true,
    });
    expect(resolve("127.0.0.1:3000", "demo").slug).toBe("demo");
    expect(resolve("[::1]:3000", "demo").slug).toBe("demo");
    expect(resolve("zcore-git-main.vercel.app", "demo").slug).toBe("demo");
  });

  it("falls back to the remembered cookie on dev hosts", () => {
    expect(resolve("localhost:3000", null, "demo")).toEqual({
      slug: "demo",
      source: "cookie",
      persist: false,
    });
  });

  it("rejects reserved, nested and malformed subdomains", () => {
    for (const host of [
      "app.zcore.ba",
      "api.zcore.ba",
      "a.b.zcore.ba",
      "-x.zcore.ba",
      "x_y.zcore.ba",
    ]) {
      expect(resolve(host).slug, host).toBeNull();
    }
  });

  it("ignores malformed ?org values", () => {
    expect(resolve("localhost:3000", "../etc").slug).toBeNull();
    expect(resolve("localhost:3000", "Demo Firma").slug).toBeNull();
  });

  it("returns nothing without a host", () => {
    expect(resolve(null, "demo").slug).toBeNull();
  });
});

describe("tenantUrl", () => {
  const path = "/floor/operations/abc";

  it("keeps the tenant subdomain", () => {
    expect(tenantUrl({ host: "demo.zcore.ba", protocol: null, slug: "demo", path })).toBe(
      "https://demo.zcore.ba/floor/operations/abc",
    );
    expect(tenantUrl({ host: "demo.localhost:3000", protocol: null, slug: "demo", path })).toBe(
      "http://demo.localhost:3000/floor/operations/abc",
    );
  });

  it("adds ?org on hosts without a tenant subdomain", () => {
    expect(tenantUrl({ host: "localhost:3000", protocol: "http", slug: "demo", path })).toBe(
      "http://localhost:3000/floor/operations/abc?org=demo",
    );
    expect(
      tenantUrl({ host: "zcore-git-x.vercel.app", protocol: "https", slug: "demo", path }),
    ).toBe("https://zcore-git-x.vercel.app/floor/operations/abc?org=demo");
  });
});
