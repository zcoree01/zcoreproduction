"use server";

import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import {
  actionFail,
  dbErrorKind,
  invalidFields,
  violates,
  type CommonActionError,
  type DbError,
} from "@/lib/actions/result";
import type { PermissionKey } from "@/lib/auth/permissions";
import { permitAction } from "@/lib/auth/require-permission";
import { requireMember } from "@/lib/auth/session";
import { numericParam } from "@/lib/supabase/numeric";
import { createClient } from "@/lib/supabase/server";
import type { Json } from "@/lib/supabase/types";
import { isLogoStoragePath, logoStoragePath } from "./rules";
import {
  cancelNoteSchema,
  DELIVERY_NOTE_FIELDS,
  deliveryNoteSchema,
  FINISHED_ERRORS,
  LOGO_CONTENT_TYPES,
  logoMetaSchema,
  NUMBER_SETTINGS_FIELDS,
  numberSettingsSchema,
  ORGANIZATION_FILES_BUCKET,
  receiveSchema,
  TEMPLATE_FIELDS,
  templateSchema,
  type DeliveryNoteField,
  type FinishedActionResult,
  type FinishedError,
  type NumberSettingsField,
  type TemplateField,
} from "./schemas";

// Finished goods and delivery notes (D-034). Receiving and shipping need
// finished_goods.manage (checked here and in the database functions);
// templates, number format and logo need org.settings.manage.

async function orgWith(permission: PermissionKey): Promise<string | null> {
  const member = await requireMember();
  const organizationId = member.organization.id;
  return (await permitAction(organizationId, permission)) ? organizationId : null;
}

function revalidateFinished() {
  revalidatePath("/inventory", "layout");
  revalidatePath("/orders", "layout");
  revalidatePath("/settings/delivery-notes");
}

type FinishedErrorCode =
  CommonActionError | FinishedError | "name_taken" | "upload_failed" | "file_type";

function fail<TField extends string = never>(
  error: FinishedErrorCode,
  fields: TField[] = [],
): FinishedActionResult<TField> {
  return actionFail<TField, FinishedError | "name_taken" | "upload_failed" | "file_type">(
    error,
    fields,
  );
}

function dbFail<TField extends string = never>(
  error: DbError,
  context: string,
): FinishedActionResult<TField> {
  const message = error?.message ?? "";
  const rule = FINISHED_ERRORS.find((key) => message === key || message.startsWith(`${key} `));
  if (rule) return fail<TField>(rule);
  switch (error?.code) {
    case "42501":
      return fail<TField>("denied");
    case "P0002":
      return fail<TField>("not_found");
    case "22023":
    case "22P02":
    case "23514":
      return fail<TField>("invalid");
    default:
      console.error(`${context} failed`, error);
      return fail<TField>("unexpected");
  }
}

export async function receiveFinishedAction(
  input: unknown,
): Promise<FinishedActionResult<"quantity">> {
  const organizationId = await orgWith("finished_goods.manage");
  if (!organizationId) return fail<"quantity">("denied");
  const parsed = receiveSchema.safeParse(input);
  if (!parsed.success) return fail<"quantity">("invalid", ["quantity"]);

  const supabase = await createClient();
  const { error } = await supabase.rpc("receive_finished_goods", {
    p_org_id: organizationId,
    p_idempotency_key: parsed.data.idempotencyKey,
    p_order_id: parsed.data.orderId,
    p_quantity: numericParam(parsed.data.quantity ?? "0"),
  });
  if (error) return dbFail<"quantity">(error, "finished goods receipt");
  revalidateFinished();
  return { ok: true, id: parsed.data.orderId };
}

export async function issueDeliveryNoteAction(
  input: unknown,
): Promise<FinishedActionResult<DeliveryNoteField>> {
  const organizationId = await orgWith("finished_goods.manage");
  if (!organizationId) return fail<DeliveryNoteField>("denied");
  const parsed = deliveryNoteSchema.safeParse(input);
  if (!parsed.success) {
    return fail<DeliveryNoteField>("invalid", invalidFields(parsed.error, DELIVERY_NOTE_FIELDS));
  }
  const note = parsed.data;

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("issue_delivery_note", {
    p_org_id: organizationId,
    p_idempotency_key: note.idempotencyKey,
    p_note: {
      customer_id: note.customerId,
      template_id: note.templateId,
      issued_on: note.issuedOn,
      notes: note.notes,
    },
    p_lines: note.lines.map((line) => ({
      order_id: line.orderId,
      quantity: line.quantity,
      customer_position: line.customerPosition,
    })) satisfies Json,
  });
  if (error) return dbFail<DeliveryNoteField>(error, "delivery note");
  revalidateFinished();
  return { ok: true, id: data };
}

export async function cancelDeliveryNoteAction(
  input: unknown,
): Promise<FinishedActionResult<"reason">> {
  const organizationId = await orgWith("finished_goods.manage");
  if (!organizationId) return fail<"reason">("denied");
  const parsed = cancelNoteSchema.safeParse(input);
  if (!parsed.success) return fail<"reason">("invalid", ["reason"]);
  const supabase = await createClient();
  const { error } = await supabase.rpc("cancel_delivery_note", {
    p_note_id: parsed.data.noteId,
    p_reason: parsed.data.reason,
  });
  if (error) return dbFail<"reason">(error, "delivery note cancel");
  revalidateFinished();
  return { ok: true, id: parsed.data.noteId };
}

// ---------------------------------------------------------------------------
// Settings: templates, number format, logo (org.settings.manage)
// ---------------------------------------------------------------------------

export async function saveTemplateAction(
  id: unknown,
  input: unknown,
): Promise<FinishedActionResult<TemplateField>> {
  const organizationId = await orgWith("org.settings.manage");
  if (!organizationId) return fail<TemplateField>("denied");
  const parsedId = z.uuid().nullable().safeParse(id);
  const parsed = templateSchema.safeParse(input);
  if (!parsedId.success) return fail<TemplateField>("invalid");
  if (!parsed.success)
    return fail<TemplateField>("invalid", invalidFields(parsed.error, TEMPLATE_FIELDS));

  const supabase = await createClient();
  // The default stays until another template becomes the default.
  if (parsedId.data && !parsed.data.isDefault) {
    const current = await supabase
      .from("delivery_note_templates")
      .select("is_default")
      .eq("organization_id", organizationId)
      .eq("id", parsedId.data)
      .maybeSingle();
    if (current.error) return dbFail<TemplateField>(current.error, "template read");
    if (current.data?.is_default) return fail<TemplateField>("invalid", ["isDefault"]);
  }
  // Only one default: clear the old one first.
  if (parsed.data.isDefault) {
    const cleared = await supabase
      .from("delivery_note_templates")
      .update({ is_default: false })
      .eq("organization_id", organizationId)
      .eq("is_default", true)
      .neq("id", parsedId.data ?? "00000000-0000-0000-0000-000000000000");
    if (cleared.error) return dbFail<TemplateField>(cleared.error, "template default");
  }
  const row = {
    name: parsed.data.name,
    is_default: parsed.data.isDefault,
    layout: parsed.data.layout satisfies Json,
  };
  const { data, error } = parsedId.data
    ? await supabase
        .from("delivery_note_templates")
        .update(row)
        .eq("organization_id", organizationId)
        .eq("id", parsedId.data)
        .select("id")
        .maybeSingle()
    : await supabase
        .from("delivery_note_templates")
        .insert({ ...row, organization_id: organizationId })
        .select("id")
        .single();
  if (error) {
    if (violates(error, "delivery_note_templates_name_key"))
      return fail<TemplateField>("name_taken", ["name"]);
    if (dbErrorKind(error) === "denied") return fail<TemplateField>("denied");
    return dbFail<TemplateField>(error, "template save");
  }
  if (!data) return fail<TemplateField>("not_found");
  revalidateFinished();
  return { ok: true, id: data.id };
}

export async function archiveTemplateAction(id: unknown): Promise<FinishedActionResult> {
  const organizationId = await orgWith("org.settings.manage");
  if (!organizationId) return fail("denied");
  const parsed = z.uuid().safeParse(id);
  if (!parsed.success) return fail("invalid");
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("delivery_note_templates")
    .update({ archived_at: new Date().toISOString(), is_default: false })
    .eq("organization_id", organizationId)
    .eq("id", parsed.data)
    .eq("is_default", false)
    .select("id")
    .maybeSingle();
  if (error) return dbFail(error, "template archive");
  // The default template cannot be archived (choose another default first).
  if (!data) return fail("invalid");
  revalidateFinished();
  return { ok: true, id: data.id };
}

async function updateSettings(
  organizationId: string,
  change: (settings: Record<string, Json | undefined>) => Record<string, Json | undefined>,
) {
  const supabase = await createClient();
  const current = await supabase
    .from("organizations")
    .select("settings")
    .eq("id", organizationId)
    .single();
  if (current.error) return current.error;
  const settings =
    current.data.settings &&
    typeof current.data.settings === "object" &&
    !Array.isArray(current.data.settings)
      ? (current.data.settings as Record<string, Json | undefined>)
      : {};
  const { error } = await supabase
    .from("organizations")
    .update({ settings: change(settings) })
    .eq("id", organizationId);
  return error;
}

export async function saveNumberSettingsAction(
  input: unknown,
): Promise<FinishedActionResult<NumberSettingsField>> {
  const organizationId = await orgWith("org.settings.manage");
  if (!organizationId) return fail<NumberSettingsField>("denied");
  const parsed = numberSettingsSchema.safeParse(input);
  if (!parsed.success) {
    return fail<NumberSettingsField>(
      "invalid",
      invalidFields(parsed.error, NUMBER_SETTINGS_FIELDS),
    );
  }
  const error = await updateSettings(organizationId, (settings) => ({
    ...settings,
    delivery_note_number_template: parsed.data.template,
    delivery_note_number_digits: parsed.data.digits,
  }));
  if (error) return dbFail<NumberSettingsField>(error, "delivery number settings");
  revalidateFinished();
  return { ok: true, id: organizationId };
}

/** Delivery note template of a customer (null: the default). */
export async function setCustomerTemplateAction(
  customerId: unknown,
  templateId: unknown,
): Promise<FinishedActionResult> {
  const organizationId = await orgWith("org.settings.manage");
  if (!organizationId) return fail("denied");
  const parsed = z
    .object({ customerId: z.uuid(), templateId: z.uuid().nullable() })
    .safeParse({ customerId, templateId });
  if (!parsed.success) return fail("invalid");
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("customers")
    .update({ delivery_note_template_id: parsed.data.templateId })
    .eq("organization_id", organizationId)
    .eq("id", parsed.data.customerId)
    .select("id")
    .maybeSingle();
  if (error) return dbFail(error, "customer template");
  if (!data) return fail("not_found");
  revalidateFinished();
  return { ok: true, id: data.id };
}

type LogoTicket =
  { ok: true; path: string; token: string } | Extract<FinishedActionResult, { ok: false }>;

export async function prepareLogoUploadAction(input: unknown): Promise<LogoTicket> {
  const organizationId = await orgWith("org.settings.manage");
  if (!organizationId) return fail("denied") as Extract<FinishedActionResult, { ok: false }>;
  const parsed = logoMetaSchema.safeParse(input);
  if (!parsed.success) return fail("file_type") as Extract<FinishedActionResult, { ok: false }>;
  const path = logoStoragePath(
    organizationId,
    randomUUID(),
    LOGO_CONTENT_TYPES[parsed.data.contentType],
  );
  const supabase = await createClient();
  const { data, error } = await supabase.storage
    .from(ORGANIZATION_FILES_BUCKET)
    .createSignedUploadUrl(path);
  if (error) {
    console.error("logo upload url failed", error);
    return fail("upload_failed") as Extract<FinishedActionResult, { ok: false }>;
  }
  return { ok: true, path: data.path, token: data.token };
}

export async function registerLogoAction(path: unknown): Promise<FinishedActionResult> {
  const organizationId = await orgWith("org.settings.manage");
  if (!organizationId) return fail("denied");
  const parsed = z.string().max(300).safeParse(path);
  if (!parsed.success || !isLogoStoragePath(parsed.data, organizationId)) return fail("invalid");
  const supabase = await createClient();
  const info = await supabase.storage.from(ORGANIZATION_FILES_BUCKET).info(parsed.data);
  if (info.error || !info.data.size) return fail("upload_failed");
  const error = await updateSettings(organizationId, (settings) => {
    const branding =
      settings.branding &&
      typeof settings.branding === "object" &&
      !Array.isArray(settings.branding)
        ? settings.branding
        : {};
    return { ...settings, branding: { ...branding, logo_path: parsed.data } };
  });
  if (error) return dbFail(error, "logo register");
  await supabase.rpc("write_audit", {
    p_org_id: organizationId,
    p_action: "organization.logo_changed",
    p_entity_type: "organizations",
    p_entity_id: organizationId,
  });
  revalidateFinished();
  return { ok: true, id: organizationId };
}
