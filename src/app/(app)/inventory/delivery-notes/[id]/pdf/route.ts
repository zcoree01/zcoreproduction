import { getTranslations } from "next-intl/server";
import { z } from "zod";
import { formatDecimal } from "@/lib/decimal";
import { getMemberAccess } from "@/lib/auth/access";
import { getCurrentMember } from "@/lib/auth/session";
import { formatDay } from "@/lib/format";
import { renderDeliveryNotePdf } from "@/modules/finished-goods/pdf";
import { getDeliveryNote, getDeliverySettings, logoBytes } from "@/modules/finished-goods/queries";
import { deliveryPdfFileName } from "@/modules/finished-goods/rules";

// Delivery note as PDF (D-040): the original only by default (for e-mail),
// ?copies=2 adds the copy. finished_goods.read; data through RLS.

export async function GET(
  request: Request,
  context: RouteContext<"/inventory/delivery-notes/[id]/pdf">,
) {
  const member = await getCurrentMember();
  if (!member) return new Response(null, { status: 401 });
  const access = await getMemberAccess(member);
  if (!access.modules.has("finished_goods") || !access.permissions.has("finished_goods.read")) {
    return new Response(null, { status: 403 });
  }
  const { id } = await context.params;
  const noteId = z.uuid().safeParse(id);
  if (!noteId.success) return new Response(null, { status: 404 });
  const organizationId = member.organization.id;
  const [note, settings, t, tUnits] = await Promise.all([
    getDeliveryNote(organizationId, noteId.data),
    getDeliverySettings(organizationId),
    getTranslations("finishedGoods.print"),
    getTranslations("productUnits"),
  ]);
  if (!note) return new Response(null, { status: 404 });
  const copies =
    new URL(request.url).searchParams.get("copies") === "2"
      ? [t("original"), t("copy")]
      : [t("original")];
  const unit = (value: string) => tUnits(value as "pcs");

  const pdf = await renderDeliveryNotePdf({
    organizationName: member.organization.name,
    logo: note.layout.show_logo ? await logoBytes(settings.logoPath) : null,
    layout: note.layout,
    number: note.number,
    date: formatDay(note.issuedOn),
    cancelled: note.status === "cancelled",
    customer: note.customer,
    lines: note.lines,
    notes: note.notes,
    labels: {
      number: t("number"),
      date: t("date"),
      customer: t("customer"),
      taxId: (taxId) => t("taxId", { taxId }),
      cancelled: t("cancelled"),
      copies,
      quantity: (line) => `${formatDecimal(line.quantity)} ${unit(line.unit)}`,
      unit,
    },
  });

  return new Response(new Uint8Array(pdf), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="${deliveryPdfFileName(note.layout.title, note.number)}"`,
      "Cache-Control": "private, no-store",
    },
  });
}
