import "server-only";
import { pageRange, toSearchPattern } from "@/lib/data-table/params";
import { createClient } from "@/lib/supabase/server";
import type { CustomerListParams } from "./list-params";

export type CustomerRow = {
  id: string;
  number: number;
  name: string;
  taxId: string | null;
  address: string | null;
  city: string | null;
  country: string | null;
  contactPerson: string | null;
  phone: string | null;
  email: string | null;
  notes: string | null;
  productCount: number;
  archived: boolean;
};

export type CustomerPage = { rows: CustomerRow[]; total: number };

const COLUMNS =
  "id, customer_number, name, tax_id, address, city, country, contact_person, phone, email, notes, archived_at, products(count)";

type Row = {
  id: string;
  customer_number: number;
  name: string;
  tax_id: string | null;
  address: string | null;
  city: string | null;
  country: string | null;
  contact_person: string | null;
  phone: string | null;
  email: string | null;
  notes: string | null;
  archived_at: string | null;
  products: { count: number }[];
};

function toCustomerRow(row: Row): CustomerRow {
  return {
    id: row.id,
    number: row.customer_number,
    name: row.name,
    taxId: row.tax_id,
    address: row.address,
    city: row.city,
    country: row.country,
    contactPerson: row.contact_person,
    phone: row.phone,
    email: row.email,
    notes: row.notes,
    productCount: row.products[0]?.count ?? 0,
    archived: row.archived_at !== null,
  };
}

export async function listCustomersPage(
  organizationId: string,
  params: CustomerListParams,
): Promise<CustomerPage> {
  const supabase = await createClient();
  const pattern = toSearchPattern(params.q);
  const filtered = () => {
    let query = supabase
      .from("customers")
      .select(COLUMNS, { count: "exact" })
      .eq("organization_id", organizationId);
    query =
      params.view === "archived"
        ? query.not("archived_at", "is", null)
        : query.is("archived_at", null);
    if (pattern) {
      query = query.or(
        `name.ilike.${pattern},city.ilike.${pattern},tax_id.ilike.${pattern},contact_person.ilike.${pattern}`,
      );
    }
    return query;
  };

  const { from, to } = pageRange(params);
  const { data, count, error } = await filtered().order("name").range(from, to);
  if (error) {
    if (error.code === "PGRST103") {
      const counted = await filtered().limit(0);
      if (counted.error) throw counted.error;
      return { rows: [], total: counted.count ?? 0 };
    }
    throw error;
  }
  return { total: count ?? 0, rows: data.map(toCustomerRow) };
}

export async function getCustomer(organizationId: string, id: string): Promise<CustomerRow | null> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("customers")
    .select(COLUMNS)
    .eq("organization_id", organizationId)
    .eq("id", id)
    .maybeSingle();
  if (error) throw error;
  return data ? toCustomerRow(data) : null;
}

export type CustomerOption = { id: string; name: string; number: number };

/** Active customers for selects. */
export async function listCustomerOptions(organizationId: string): Promise<CustomerOption[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("customers")
    .select("id, name, customer_number")
    .eq("organization_id", organizationId)
    .is("archived_at", null)
    .order("name");
  if (error) throw error;
  return data.map((row) => ({ id: row.id, name: row.name, number: row.customer_number }));
}
