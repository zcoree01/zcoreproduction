import { getFormatter, getTranslations } from "next-intl/server";
import Image from "next/image";
import Link from "next/link";
import { Suspense } from "react";
import { z } from "zod";
import { PageSkeleton } from "@/components/shared/page-skeleton";
import { PrintButton } from "@/components/shared/print-button";
import { buttonVariants } from "@/components/ui/button";
import { getMemberAccess } from "@/lib/auth/access";
import { requireMember } from "@/lib/auth/session";
import { formatDecimal } from "@/lib/decimal";
import { getDeliveryNote, getDeliverySettings, logoUrl } from "@/modules/finished-goods/queries";
import { columnValue } from "@/modules/finished-goods/rules";

// Printable delivery note (A4) laid out by its template (D-034): logo, title,
// number and date, customer, header text, the table columns of the template,
// footer text and signature lines.

export default function DeliveryNotePrintPage({
  params,
}: PageProps<"/inventory/delivery-notes/[id]/print">) {
  return (
    <Suspense fallback={<PageSkeleton label="" />}>
      <DeliveryNotePrint params={params} />
    </Suspense>
  );
}

async function DeliveryNotePrint({ params }: { params: Promise<{ id: string }> }) {
  const member = await requireMember();
  const organizationId = member.organization.id;
  const [t, tUnits, format, access] = await Promise.all([
    getTranslations("finishedGoods"),
    getTranslations("productUnits"),
    getFormatter(),
    getMemberAccess(member),
  ]);
  if (!access.modules.has("inventory") || !access.permissions.has("finished_goods.read")) {
    return <p className="p-8">{t("deniedDescription")}</p>;
  }
  const { id } = await params;
  const noteId = z.uuid().safeParse(id);
  const [note, settings] = await Promise.all([
    noteId.success ? getDeliveryNote(organizationId, noteId.data) : Promise.resolve(null),
    getDeliverySettings(organizationId),
  ]);
  if (!note) return <p className="p-8">{t("errors.delivery_note_not_found")}</p>;
  const logo = note.layout.show_logo ? await logoUrl(settings.logoPath) : null;
  const unit = (value: string) => tUnits(value as "pcs");
  const date = format.dateTime(new Date(`${note.issuedOn}T12:00:00Z`), {
    dateStyle: "medium",
    timeZone: "UTC",
  });

  return (
    <div className="mx-auto flex w-full max-w-[210mm] flex-col gap-6 p-8 text-sm print:p-0">
      <div className="flex items-center justify-between gap-2 print:hidden">
        <Link
          href={`/inventory/delivery-notes/${note.id}`}
          className={buttonVariants({ variant: "outline" })}
        >
          {t("notes.back")}
        </Link>
        <PrintButton label={t("notes.print")} />
      </div>

      <header className="flex items-start justify-between gap-6">
        <div className="flex flex-col gap-2">
          {logo ? (
            // Signed URL of the organization's own logo (private bucket, not optimized).
            <Image
              src={logo}
              alt={member.organization.name}
              width={224}
              height={64}
              unoptimized
              className="h-16 w-auto max-w-56 object-contain"
            />
          ) : null}
          <span className="font-semibold">{member.organization.name}</span>
        </div>
        <div className="text-right">
          <h1 className="text-2xl font-bold">{note.layout.title}</h1>
          <p>
            {t("print.number")}: <strong className="font-mono">{note.number}</strong>
          </p>
          <p>
            {t("print.date")}: {date}
          </p>
          {note.status === "cancelled" ? (
            <p className="mt-1 font-bold text-red-700">{t("print.cancelled")}</p>
          ) : null}
        </div>
      </header>

      <section className="flex flex-col">
        <span className="text-xs uppercase">{t("print.customer")}</span>
        <span className="text-base font-semibold">{note.customer.name}</span>
        {note.customer.address ? <span>{note.customer.address}</span> : null}
        {note.customer.city ? <span>{note.customer.city}</span> : null}
        {note.customer.taxId ? (
          <span>{t("print.taxId", { taxId: note.customer.taxId })}</span>
        ) : null}
      </section>

      {note.layout.header_text ? (
        <p className="whitespace-pre-line">{note.layout.header_text}</p>
      ) : null}

      <table className="w-full border-collapse">
        <thead>
          <tr>
            {note.layout.columns.map((column) => (
              <th key={column.key} className="border border-black px-2 py-1 text-left">
                {column.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {note.lines.map((line) => (
            <tr key={line.lineNo}>
              {note.layout.columns.map((column) => (
                <td
                  key={column.key}
                  className={`border border-black px-2 py-1 ${column.key === "quantity" ? "text-right tabular-nums" : ""}`}
                >
                  {columnValue(
                    column.key,
                    line,
                    (value) => `${formatDecimal(value)} ${unit(line.unit)}`,
                    unit,
                  )}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>

      {note.notes ? <p className="whitespace-pre-line">{note.notes}</p> : null}
      {note.layout.footer_text ? (
        <p className="whitespace-pre-line">{note.layout.footer_text}</p>
      ) : null}

      {note.layout.signatures.length > 0 ? (
        <footer className="mt-16 flex justify-between gap-8">
          {note.layout.signatures.map((label) => (
            <div key={label} className="flex min-w-40 flex-1 flex-col items-center">
              <span className="w-full border-t border-black" />
              <span className="mt-1">{t("print.signature", { label })}</span>
            </div>
          ))}
        </footer>
      ) : null}
    </div>
  );
}
