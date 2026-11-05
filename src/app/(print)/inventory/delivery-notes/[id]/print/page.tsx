import { getTranslations } from "next-intl/server";
import Link from "next/link";
import { Suspense } from "react";
import { z } from "zod";
import { DeliveryNotePaper } from "@/app/(app)/inventory/delivery-notes/delivery-note-paper";
import { PageSkeleton } from "@/components/shared/page-skeleton";
import { PrintButton } from "@/components/shared/print-button";
import { buttonVariants } from "@/components/ui/button";
import { getMemberAccess } from "@/lib/auth/access";
import { requireMember } from "@/lib/auth/session";
import { firstParam } from "@/lib/data-table/params";
import { formatDay } from "@/lib/format";
import { cn } from "@/lib/utils";
import { getDeliveryNote, getDeliverySettings, logoUrl } from "@/modules/finished-goods/queries";
import { AutoPrint } from "./auto-print";

// Printable delivery note (A4) laid out by its template (D-034): by default
// an original and a copy, each on its own page (D-039); ?copies=1 prints
// the original only, ?print=1 opens the print dialog right away.

export default function DeliveryNotePrintPage({
  params,
  searchParams,
}: PageProps<"/inventory/delivery-notes/[id]/print">) {
  return (
    <Suspense fallback={<PageSkeleton label="" />}>
      <DeliveryNotePrint params={params} searchParams={searchParams} />
    </Suspense>
  );
}

async function DeliveryNotePrint({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const member = await requireMember();
  const organizationId = member.organization.id;
  const [t, access] = await Promise.all([
    getTranslations("finishedGoods"),
    getMemberAccess(member),
  ]);
  if (!access.modules.has("finished_goods") || !access.permissions.has("finished_goods.read")) {
    return <p className="p-8">{t("deniedDescription")}</p>;
  }
  const [{ id }, query] = await Promise.all([params, searchParams]);
  const noteId = z.uuid().safeParse(id);
  const [note, settings] = await Promise.all([
    noteId.success ? getDeliveryNote(organizationId, noteId.data) : Promise.resolve(null),
    getDeliverySettings(organizationId),
  ]);
  if (!note) return <p className="p-8">{t("errors.delivery_note_not_found")}</p>;
  const logo = note.layout.show_logo ? await logoUrl(settings.logoPath) : null;
  const single = firstParam(query.copies) === "1";
  const copies = single ? [t("print.original")] : [t("print.original"), t("print.copy")];
  const base = `/inventory/delivery-notes/${note.id}/print`;

  return (
    <div className="mx-auto flex w-full max-w-[210mm] flex-col gap-6 p-8 print:max-w-none print:p-0">
      {firstParam(query.print) === "1" ? <AutoPrint /> : null}
      <div className="flex flex-wrap items-center justify-between gap-2 print:hidden">
        <Link
          href={`/inventory/delivery-notes/${note.id}`}
          className={buttonVariants({ variant: "outline" })}
        >
          {t("notes.back")}
        </Link>
        <div className="flex items-center gap-2">
          <nav className="flex rounded-lg border p-0.5 text-sm" aria-label={t("print.copies")}>
            <Link
              href={base}
              aria-current={single ? undefined : "page"}
              className={cn("rounded-md px-3 py-1", !single && "bg-muted font-medium")}
            >
              {t("print.originalAndCopy")}
            </Link>
            <Link
              href={`${base}?copies=1`}
              aria-current={single ? "page" : undefined}
              className={cn("rounded-md px-3 py-1", single && "bg-muted font-medium")}
            >
              {t("print.originalOnly")}
            </Link>
          </nav>
          <PrintButton label={t("notes.print")} />
        </div>
      </div>

      {copies.map((label, index) => (
        <DeliveryNotePaper
          key={label}
          className={cn(
            "min-h-[270mm] shadow-md print:min-h-0 print:p-0 print:shadow-none",
            index > 0 && "break-before-page",
          )}
          copyLabel={label}
          organizationName={member.organization.name}
          logoUrl={logo}
          layout={note.layout}
          number={note.number}
          date={formatDay(note.issuedOn)}
          cancelled={note.status === "cancelled"}
          customer={note.customer}
          lines={note.lines}
          notes={note.notes}
        />
      ))}
    </div>
  );
}
