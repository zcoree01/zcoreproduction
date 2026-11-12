import type { SupabaseClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Database } from "@/lib/supabase/types";
import { ensureOrganization, ensureUser } from "@/modules/organizations/provision";
import { testTenantPassword } from "../shared/test-tenants";
import { setTenantLocked, setupFixture, signIn, type Fixture } from "./fixtures";

// Problem reports (Zcore organization, part 3): members submit, Zcore answers.

type Db = SupabaseClient<Database>;

let fx: Fixture;
let admin: Db;
let tech: Db;
const memberIds: string[] = [];
const reportIds: string[] = [];
const archivedSlug = `dbt-reg-rep-${crypto.randomUUID().slice(0, 8)}`;
let archivedOrgId = "";

async function submit(
  client: Db,
  org: string,
  over: Partial<{ category: string; description: string; key: string }> = {},
) {
  const { data, error } = await client.rpc("submit_problem_report", {
    p_org: org,
    p_category: over.category ?? "broken",
    p_description: over.description ?? "Ne radi dugme",
    p_page_path: "/orders",
    p_user_agent: "vitest",
    p_idempotency_key: over.key ?? crypto.randomUUID(),
  });
  if (data) reportIds.push(data);
  return { data, error };
}

beforeAll(async () => {
  fx = await setupFixture();
  const zcore = await ensureOrganization(fx.service, { slug: "zcore", name: "Zcore" });
  for (const [username, role] of [
    ["db.reports.admin", "platform_admin"],
    ["db.reports.tech", "platform_technician"],
  ] as const) {
    const id = await ensureUser(fx.service, zcore, {
      username,
      password: testTenantPassword(),
      fullName: username,
      role,
    });
    await fx.service.from("memberships").update({ archived_at: null }).eq("user_id", id);
    memberIds.push(id);
  }
  admin = await signIn("db.reports.admin", "zcore");
  tech = await signIn("db.reports.tech", "zcore");
});

afterAll(async () => {
  await setTenantLocked(fx.service, fx.a.org.id, false);
  if (reportIds.length > 0) {
    await fx.service.from("problem_report_files").delete().in("report_id", reportIds);
    await fx.service.from("problem_report_messages").delete().in("report_id", reportIds);
    await fx.service.from("problem_reports").delete().in("id", reportIds);
  }
  if (archivedOrgId) {
    await fx.service.rpc("purge_test_organization", { p_org_id: archivedOrgId });
  }
  for (const id of memberIds) {
    await fx.service
      .from("memberships")
      .update({ archived_at: new Date().toISOString() })
      .eq("user_id", id);
  }
});

describe("problem reports", () => {
  it("submits a report once per idempotency key", async () => {
    const key = crypto.randomUUID();
    const first = await submit(fx.a.operator, fx.a.org.id, { key });
    expect(first.error).toBeNull();
    const second = await submit(fx.a.operator, fx.a.org.id, { key });
    expect(second.error).toBeNull();
    expect(second.data).toBe(first.data);
    const rows = await fx.service
      .from("problem_reports")
      .select("id, status")
      .eq("idempotency_key", key);
    expect(rows.data).toHaveLength(1);
    expect(rows.data![0]!.status).toBe("new");
  });

  it("requires a description only for other", async () => {
    const noText = await submit(fx.a.operator, fx.a.org.id, { category: "slow", description: "" });
    expect(noText.error).toBeNull();
    const other = await submit(fx.a.operator, fx.a.org.id, {
      category: "other",
      description: "  ",
    });
    expect(other.error?.code).toBe("22023");
    const badCategory = await submit(fx.a.operator, fx.a.org.id, { category: "nope" });
    expect(badCategory.error?.code).toBe("22023");
    const tooLong = await submit(fx.a.operator, fx.a.org.id, { description: "x".repeat(4001) });
    expect(tooLong.error?.code).toBe("22023");
    const foreign = await submit(fx.a.operator, fx.b.org.id);
    expect(foreign.error?.code).toBe("42501");
  });

  it("shows a member only their own reports, never another firm's", async () => {
    const mine = await submit(fx.a.operator, fx.a.org.id);
    const own = await fx.a.operator.from("problem_reports").select("id").eq("id", mine.data!);
    expect(own.data).toHaveLength(1);
    for (const other of [fx.a.admin, fx.b.admin, fx.b.operator]) {
      const rows = await other.from("problem_reports").select("id").eq("id", mine.data!);
      expect(rows.error).toBeNull();
      expect(rows.data).toHaveLength(0);
    }
    const direct = await fx.a.operator.from("problem_reports").insert({
      organization_id: fx.a.org.id,
      created_by: fx.a.operatorId,
      category: "broken",
      idempotency_key: crypto.randomUUID(),
    });
    expect(direct.error).not.toBeNull();
  });

  it("lets the author reply and moves the report back to in_progress", async () => {
    const report = await submit(fx.a.operator, fx.a.org.id);
    const id = report.data!;
    const answered = await tech.rpc("platform_reply_problem_report", {
      p_id: id,
      p_body: "Pogledajte postavke",
      p_status: "waiting_user",
    });
    expect(answered.error).toBeNull();
    const stranger = await fx.a.admin.rpc("reply_problem_report", {
      p_org: fx.a.org.id,
      p_report_id: id,
      p_body: "tuđa",
    });
    expect(stranger.error?.code).toBe("42501");
    const reply = await fx.a.operator.rpc("reply_problem_report", {
      p_org: fx.a.org.id,
      p_report_id: id,
      p_body: "Hvala, probao sam",
    });
    expect(reply.error).toBeNull();
    const row = await fx.service.from("problem_reports").select("status").eq("id", id).single();
    expect(row.data!.status).toBe("in_progress");
    const messages = await fx.a.operator
      .from("problem_report_messages")
      .select("from_zcore")
      .eq("report_id", id);
    expect(messages.data!.map((m) => m.from_zcore).sort()).toEqual([false, true]);
    const empty = await fx.a.operator.rpc("reply_problem_report", {
      p_org: fx.a.org.id,
      p_report_id: id,
      p_body: " ",
    });
    expect(empty.error?.code).toBe("22023");
  });

  it("lets the Tehničar reply and change the status; refuses a tenant admin the platform RPCs", async () => {
    const report = await submit(fx.a.operator, fx.a.org.id);
    const id = report.data!;
    const list = await tech.rpc("platform_problem_reports", { p_org: fx.a.org.id });
    expect(list.error).toBeNull();
    expect(list.data!.some((r) => r.id === id)).toBe(true);
    const detail = await tech.rpc("platform_problem_report", { p_id: id });
    expect(detail.error).toBeNull();
    expect((detail.data as unknown as { messages: unknown[] }).messages).toEqual([]);
    const reply = await tech.rpc("platform_reply_problem_report", {
      p_id: id,
      p_body: "Radimo na tome",
    });
    expect(reply.error).toBeNull();
    const status = await tech.rpc("platform_set_problem_status", {
      p_id: id,
      p_status: "resolved",
    });
    expect(status.error).toBeNull();
    const row = await fx.service
      .from("problem_reports")
      .select("status, resolved_at")
      .eq("id", id)
      .single();
    expect(row.data!.status).toBe("resolved");
    expect(row.data!.resolved_at).not.toBeNull();
    const reopen = await tech.rpc("platform_set_problem_status", {
      p_id: id,
      p_status: "in_progress",
    });
    expect(reopen.error).toBeNull();
    const after = await fx.service
      .from("problem_reports")
      .select("resolved_at")
      .eq("id", id)
      .single();
    expect(after.data!.resolved_at).toBeNull();
    const admins = await admin.rpc("platform_problem_reports", {});
    expect(admins.error).toBeNull();

    const denied = [
      await fx.a.admin.rpc("platform_problem_reports", {}),
      await fx.a.admin.rpc("platform_problem_report", { p_id: id }),
      await fx.a.admin.rpc("platform_reply_problem_report", { p_id: id, p_body: "x" }),
      await fx.a.admin.rpc("platform_set_problem_status", { p_id: id, p_status: "resolved" }),
    ];
    for (const result of denied) expect(result.error?.code).toBe("42501");
  });

  it("accepts a report from a locked firm", async () => {
    await setTenantLocked(fx.service, fx.a.org.id, true);
    try {
      const result = await submit(fx.a.operator, fx.a.org.id);
      expect(result.error).toBeNull();
      expect(result.data).toBeTruthy();
    } finally {
      await setTenantLocked(fx.service, fx.a.org.id, false);
    }
  });

  it("refuses a report from an archived firm", async () => {
    const org = await ensureOrganization(fx.service, {
      slug: archivedSlug,
      name: "Arhiva Prijave",
    });
    archivedOrgId = org.id;
    await ensureUser(fx.service, org, {
      username: "clan",
      password: testTenantPassword(),
      fullName: "Clan",
      role: "operator",
    });
    const member = await signIn("clan", archivedSlug);
    const ok = await submit(member, org.id);
    expect(ok.error).toBeNull();
    await fx.service.from("problem_reports").delete().eq("id", ok.data!);
    const { error } = await fx.service
      .from("organizations")
      .update({ archived_at: new Date().toISOString() })
      .eq("id", org.id);
    expect(error).toBeNull();
    const refused = await submit(member, org.id);
    expect(refused.error?.code).toBe("42501");
  });

  it("gives the Zcore bell new reports through platform_report_notices (D-061)", async () => {
    const long = "Dugačak opis problema. ".repeat(30);
    const { data: id, error } = await submit(fx.a.admin, fx.a.org.id, { description: long });
    expect(error).toBeNull();
    const notices = await tech.rpc("platform_report_notices");
    expect(notices.error).toBeNull();
    const row = notices.data?.find((n) => n.notice_key === `report:${id}`);
    expect(row).toMatchObject({ kind: "new", report_id: id });
    // Firm name, then the description cut to what the bell shows.
    expect(row?.detail).toContain(" · Dugačak opis problema.");
    expect(row!.detail.length).toBeLessThanOrEqual(200);
    const denied = await fx.a.admin.rpc("platform_report_notices");
    expect(denied.error?.code).toBe("42501");
  });

  it("refuses a Zcore member the tenant submit RPC", async () => {
    const zcore = await fx.service.from("organizations").select("id").eq("slug", "zcore").single();
    const result = await submit(tech, zcore.data!.id);
    expect(result.error?.code).toBe("42501");
  });
});
