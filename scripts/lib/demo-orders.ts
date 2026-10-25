// Demo production orders for the "demo" organization. DEMO ONLY (seeded by
// `npm run seed:demo`). Created through the RPCs as the head of production,
// so numbering, the routing snapshot and the status rules are the real ones.
// Idempotent: skipped when the demo product already has orders.
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { toAuthEmail } from "@/lib/auth/username";
import type { Database, Json } from "@/lib/supabase/types";
import type { ProvisionedOrganization } from "@/modules/organizations/provision";
import { readAdminEnv } from "./admin-client";

type Admin = SupabaseClient<Database>;

const PART_NUMBER = "DM-4711-02";

function day(offset: number): string {
  const date = new Date();
  date.setUTCDate(date.getUTCDate() + offset);
  return date.toISOString().slice(0, 10);
}

export async function seedDemoOrders(admin: Admin, org: ProvisionedOrganization, password: string) {
  const product = await admin
    .from("products")
    .select("id, customer_id")
    .eq("organization_id", org.id)
    .eq("part_number", PART_NUMBER)
    .is("archived_at", null)
    .single()
    .throwOnError();
  const existing = await admin
    .from("production_orders")
    .select("id", { count: "exact", head: true })
    .eq("organization_id", org.id)
    .eq("product_id", product.data.id);
  if (existing.error) throw existing.error;
  if ((existing.count ?? 0) > 0) return;

  const env = readAdminEnv();
  const planner = createClient<Database>(
    env.NEXT_PUBLIC_SUPABASE_URL,
    env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    { auth: { persistSession: false, autoRefreshToken: false } },
  );
  const { error: signInError } = await planner.auth.signInWithPassword({
    email: toAuthEmail("sef.proizvodnje", org.slug),
    password,
  });
  if (signInError) throw signInError;

  const create = async (order: Record<string, unknown>) => {
    const { data, error } = await planner.rpc("create_production_order", {
      p_org_id: org.id,
      p_order: {
        customer_id: product.data.customer_id,
        product_id: product.data.id,
        ...order,
      } as Json,
    });
    if (error) throw error;
    return data;
  };
  const status = async (id: string, to: string) => {
    const { error } = await planner.rpc("set_production_order_status", {
      p_order_id: id,
      p_status: to,
    });
    if (error) throw error;
  };

  // Waiting for material: the saw worker sees it on PILA-01.
  const first = await create({
    quantity: "120",
    due_date: day(14),
    planned_start: day(2),
    planned_end: day(9),
    bar_length_mm: "3000",
    bar_remnant_mm: "200",
    notes: "Demo: serija za montažu.",
  });
  await status(first, "planned");
  await status(first, "waiting_material");

  // Due soon and released: on the CNC queues, most urgent first.
  const second = await create({
    quantity: "40",
    due_date: day(4),
    priority: 1,
    planned_start: day(0),
    planned_end: day(3),
    bar_length_mm: "3000",
    bar_remnant_mm: "150",
    notes: "Demo: hitna dopuna.",
  });
  await status(second, "planned");
  await status(second, "ready");

  // A draft the head of production is still preparing.
  await create({ quantity: "250", due_date: day(30), notes: "Demo: nacrt za sljedeći mjesec." });

  await planner.auth.signOut({ scope: "local" });
}
