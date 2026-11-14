import "server-only";
import { pageRange, toSearchPattern } from "@/lib/data-table/params";
import { decimalFromDb } from "@/lib/decimal";
import { createClient } from "@/lib/supabase/server";
import type { DeliveryNoteListParams } from "./list-params";
import {
  deliveryNumberSettingsFrom,
  layoutFrom,
  type DeliveryLineData,
  type DeliveryNumberSettings,
  type DeliveryTemplateLayout,
} from "./rules";

const dec = (value: number | string | null | undefined) => decimalFromDb(value) ?? "0";

export type FinishedStock = { received: string; shipped: string; onHand: string };

/** Finished goods of one order (needs finished_goods.read). */
export async function getOrderFinishedGoods(
  organizationId: string,
  orderId: string,
): Promise<FinishedStock> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("finished_goods_stock")
    .select("received, shipped, on_hand")
    .eq("organization_id", organizationId)
    .eq("order_id", orderId)
    .maybeSingle();
  if (error) throw error;
  return { received: dec(data?.received), shipped: dec(data?.shipped), onHand: dec(data?.on_hand) };
}

export type FinishedStockRow = FinishedStock & {
  orderId: string;
  orderNumber: string;
  customerId: string;
  customer: string;
  partNumber: string;
  productName: string;
  /** Of the order's revision (as the note's line will show them). */
  drawingNumber: string | null;
  revision: string | null;
  unit: string;
  customerPosition: string | null;
};

/** Orders with finished goods on hand, by customer. */
export async function listFinishedStock(organizationId: string): Promise<FinishedStockRow[]> {
  const supabase = await createClient();
  const stock = await supabase
    .from("finished_goods_stock")
    .select("order_id, received, shipped, on_hand")
    .eq("organization_id", organizationId)
    .gt("on_hand", 0);
  if (stock.error) throw stock.error;
  if (stock.data.length === 0) return [];
  const orders = await supabase
    .from("production_orders")
    .select(
      "id, order_number, unit, customer_position, customer:customers(id, name), product:products(part_number, name), revision:product_revisions(revision, drawing_number)",
    )
    .eq("organization_id", organizationId)
    .in(
      "id",
      stock.data.map((row) => row.order_id ?? ""),
    );
  if (orders.error) throw orders.error;
  const byId = new Map(orders.data.map((o) => [o.id, o]));
  return stock.data
    .flatMap((row) => {
      const order = byId.get(row.order_id ?? "");
      if (!order || !order.customer) return [];
      return [
        {
          orderId: order.id,
          orderNumber: order.order_number,
          customerId: order.customer.id,
          customer: order.customer.name,
          partNumber: order.product?.part_number ?? "",
          productName: order.product?.name ?? "",
          drawingNumber: order.revision?.drawing_number ?? null,
          revision: order.revision?.revision ?? null,
          unit: order.unit,
          customerPosition: order.customer_position,
          received: dec(row.received),
          shipped: dec(row.shipped),
          onHand: dec(row.on_hand),
        },
      ];
    })
    .sort(
      (a, b) =>
        a.customer.localeCompare(b.customer, "bs") || a.orderNumber.localeCompare(b.orderNumber),
    );
}

export type DeliveryTemplate = {
  id: string;
  name: string;
  isDefault: boolean;
  layout: DeliveryTemplateLayout;
  archived: boolean;
};

export async function listDeliveryTemplates(organizationId: string): Promise<DeliveryTemplate[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("delivery_note_templates")
    .select("id, name, is_default, layout, archived_at")
    .eq("organization_id", organizationId)
    .order("name");
  if (error) throw error;
  return data
    .map((t) => ({
      id: t.id,
      name: t.name,
      isDefault: t.is_default,
      layout: layoutFrom(t.layout),
      archived: t.archived_at !== null,
    }))
    .sort(
      (a, b) => Number(b.isDefault) - Number(a.isDefault) || a.name.localeCompare(b.name, "bs"),
    );
}

export async function getDeliverySettings(organizationId: string): Promise<{
  numbers: DeliveryNumberSettings;
  logoPath: string | null;
}> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("organizations")
    .select("settings")
    .eq("id", organizationId)
    .single();
  if (error) throw error;
  const settings = (data.settings ?? {}) as Record<string, unknown>;
  const branding =
    settings.branding && typeof settings.branding === "object"
      ? (settings.branding as Record<string, unknown>)
      : {};
  return {
    numbers: deliveryNumberSettingsFrom(settings),
    logoPath: typeof branding.logo_path === "string" ? branding.logo_path : null,
  };
}

/** Customers with their template, for the delivery note form. */
export async function listDeliveryCustomers(organizationId: string) {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("customers")
    .select("id, name, customer_number, delivery_note_template_id, address, city, tax_id")
    .eq("organization_id", organizationId)
    .is("archived_at", null)
    .order("name");
  if (error) throw error;
  return data.map((c) => ({
    id: c.id,
    name: c.name,
    number: c.customer_number,
    templateId: c.delivery_note_template_id,
    address: c.address,
    city: c.city,
    taxId: c.tax_id,
  }));
}

export type DeliveryNoteRow = {
  id: string;
  number: string;
  customer: string;
  issuedOn: string;
  status: "issued" | "cancelled";
  lines: number;
};

// Line count via an aggregate, not the line ids.
const NOTE_LIST_COLUMNS =
  "id, number, issued_on, status, customer:customers(name), delivery_note_lines(count)";

type NoteListRow = {
  id: string;
  number: string;
  issued_on: string;
  status: string;
  customer: { name: string } | null;
  delivery_note_lines: { count: number }[];
};

function toDeliveryNoteRow(n: NoteListRow): DeliveryNoteRow {
  return {
    id: n.id,
    number: n.number,
    customer: n.customer?.name ?? "",
    issuedOn: n.issued_on,
    status: n.status as DeliveryNoteRow["status"],
    lines: n.delivery_note_lines[0]?.count ?? 0,
  };
}

/** The newest delivery notes (dashboard widget). */
export async function listDeliveryNotes(
  organizationId: string,
  limit: number,
): Promise<DeliveryNoteRow[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("delivery_notes")
    .select(NOTE_LIST_COLUMNS)
    .eq("organization_id", organizationId)
    .order("created_at", { ascending: false })
    .limit(limit)
    .returns<NoteListRow[]>();
  if (error) throw error;
  return data.map(toDeliveryNoteRow);
}

export type DeliveryNotePage = { rows: DeliveryNoteRow[]; total: number };

/** One page of delivery notes, newest first, searched by number or customer. */
export async function listDeliveryNotesPage(
  organizationId: string,
  params: DeliveryNoteListParams,
): Promise<DeliveryNotePage> {
  const supabase = await createClient();
  const pattern = toSearchPattern(params.q);

  // The customer name lives on the embedded row: resolve matching customers
  // first, then search number OR customer in one filter.
  let customerIds: string[] = [];
  if (pattern) {
    const customers = await supabase
      .from("customers")
      .select("id")
      .eq("organization_id", organizationId)
      .ilike("name", pattern)
      .limit(200);
    if (customers.error) throw customers.error;
    customerIds = customers.data.map((c) => c.id);
  }

  const filtered = () => {
    let query = supabase
      .from("delivery_notes")
      .select(NOTE_LIST_COLUMNS, { count: "exact" })
      .eq("organization_id", organizationId);
    if (params.status) query = query.eq("status", params.status);
    if (pattern) {
      query =
        customerIds.length > 0
          ? query.or(`number.ilike.${pattern},customer_id.in.(${customerIds.join(",")})`)
          : query.ilike("number", pattern);
    }
    return query;
  };

  const { from, to } = pageRange(params);
  const { data, count, error } = await filtered()
    .order("created_at", { ascending: false })
    .range(from, to)
    .returns<NoteListRow[]>();
  if (error) {
    // Page past the end (e.g. after a filter change): report the total only.
    if (error.code === "PGRST103") {
      const counted = await filtered().limit(0);
      if (counted.error) throw counted.error;
      return { rows: [], total: counted.count ?? 0 };
    }
    throw error;
  }
  return { total: count ?? 0, rows: data.map(toDeliveryNoteRow) };
}

export type DeliveryNoteDetail = {
  id: string;
  number: string;
  issuedOn: string;
  status: "issued" | "cancelled";
  cancelReason: string | null;
  notes: string | null;
  customer: {
    name: string;
    address: string | null;
    city: string | null;
    taxId: string | null;
    email: string | null;
  };
  layout: DeliveryTemplateLayout;
  lines: DeliveryLineData[];
};

export async function getDeliveryNote(
  organizationId: string,
  noteId: string,
): Promise<DeliveryNoteDetail | null> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("delivery_notes")
    .select(
      "id, number, issued_on, status, cancel_reason, notes, customer:customers(name, address, city, tax_id, email), template:delivery_note_templates(layout), delivery_note_lines(line_no, customer_position, order_number, part_number, drawing_number, revision, product_name, quantity, unit)",
    )
    .eq("organization_id", organizationId)
    .eq("id", noteId)
    .maybeSingle();
  if (error) throw error;
  if (!data) return null;
  return {
    id: data.id,
    number: data.number,
    issuedOn: data.issued_on,
    status: data.status as DeliveryNoteDetail["status"],
    cancelReason: data.cancel_reason,
    notes: data.notes,
    customer: {
      name: data.customer?.name ?? "",
      address: data.customer?.address ?? null,
      city: data.customer?.city ?? null,
      taxId: data.customer?.tax_id ?? null,
      email: data.customer?.email ?? null,
    },
    layout: layoutFrom(data.template?.layout),
    lines: [...data.delivery_note_lines]
      .sort((a, b) => a.line_no - b.line_no)
      .map((l) => ({
        lineNo: l.line_no,
        customerPosition: l.customer_position,
        orderNumber: l.order_number,
        partNumber: l.part_number,
        drawingNumber: l.drawing_number,
        revision: l.revision,
        productName: l.product_name,
        quantity: dec(l.quantity),
        unit: l.unit,
      })),
  };
}

/** Short-lived link of the organization logo (members only, private bucket). */
export async function logoUrl(path: string | null): Promise<string | null> {
  if (!path) return null;
  const supabase = await createClient();
  const { data, error } = await supabase.storage
    .from("organization-files")
    .createSignedUrl(path, 600);
  return error ? null : data.signedUrl;
}

/** Logo bytes for the PDF (PNG / JPEG only; other formats are left out). */
export async function logoBytes(
  path: string | null,
): Promise<{ data: Buffer; format: "png" | "jpg" } | null> {
  if (!path) return null;
  const format = path.endsWith(".png") ? "png" : path.endsWith(".jpg") ? "jpg" : null;
  if (!format) return null;
  const supabase = await createClient();
  const { data, error } = await supabase.storage.from("organization-files").download(path);
  if (error) return null;
  return { data: Buffer.from(await data.arrayBuffer()), format };
}
