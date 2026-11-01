import { ArrowLeftIcon, PrinterIcon } from "lucide-react";
import { getFormatter, getTranslations } from "next-intl/server";
import Link from "next/link";
import { z } from "zod";
import { EmptyState } from "@/components/shared/empty-state";
import { ModuleDisabled } from "@/components/shared/module-disabled";
import { PageHeader } from "@/components/shared/page-header";
import { PageSuspense } from "@/components/shared/page-suspense";
import { PermissionDenied } from "@/components/shared/permission-denied";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { buttonVariants } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { getMemberAccess } from "@/lib/auth/access";
import { requireMember } from "@/lib/auth/session";
import { formatDecimal } from "@/lib/decimal";
import { cn } from "@/lib/utils";
import { getDeliveryNote } from "@/modules/finished-goods/queries";
import { columnValue } from "@/modules/finished-goods/rules";
import { CancelNoteButton } from "./cancel-note-button";

export default function DeliveryNotePage({ params }: PageProps<"/inventory/delivery-notes/[id]">) {
  return (
    <PageSuspense>
      <DeliveryNoteContent params={params} />
    </PageSuspense>
  );
}

async function DeliveryNoteContent({ params }: { params: Promise<{ id: string }> }) {
  const member = await requireMember();
  const [t, tUnits, format, access] = await Promise.all([
    getTranslations("finishedGoods"),
    getTranslations("productUnits"),
    getFormatter(),
    getMemberAccess(member),
  ]);
  if (!access.modules.has("inventory")) return <ModuleDisabled />;
  if (!access.permissions.has("finished_goods.read")) {
    return <PermissionDenied description={t("deniedDescription")} />;
  }
  const { id } = await params;
  const noteId = z.uuid().safeParse(id);
  const note = noteId.success ? await getDeliveryNote(member.organization.id, noteId.data) : null;
  const back = (
    <Link
      href="/inventory/delivery-notes"
      className={cn(buttonVariants({ variant: "ghost", size: "sm" }), "w-fit")}
    >
      <ArrowLeftIcon />
      {t("notes.back")}
    </Link>
  );
  if (!note) {
    return (
      <>
        {back}
        <EmptyState title={t("errors.delivery_note_not_found")} />
      </>
    );
  }
  const unit = (value: string) => tUnits(value as "pcs");

  return (
    <div className="flex flex-col gap-4">
      {back}
      <PageHeader
        title={`${note.number} · ${note.customer.name}`}
        description={format.dateTime(new Date(`${note.issuedOn}T12:00:00Z`), {
          dateStyle: "long",
          timeZone: "UTC",
        })}
        actions={
          <div className="flex gap-2">
            <Link
              href={`/inventory/delivery-notes/${note.id}/print`}
              target="_blank"
              className={cn(buttonVariants({ variant: "outline" }))}
            >
              <PrinterIcon />
              {t("notes.print")}
            </Link>
            {note.status === "issued" && access.permissions.has("finished_goods.manage") ? (
              <CancelNoteButton noteId={note.id} number={note.number} />
            ) : null}
          </div>
        }
      />
      {note.status === "cancelled" ? (
        <Alert variant="destructive">
          <AlertDescription>
            {t("notes.cancelledNote", { reason: note.cancelReason ?? "" })}
          </AlertDescription>
        </Alert>
      ) : null}
      <div className="overflow-x-auto rounded-lg border">
        <Table>
          <TableHeader>
            <TableRow>
              {note.layout.columns.map((column) => (
                <TableHead key={column.key}>{column.label}</TableHead>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            {note.lines.map((line) => (
              <TableRow key={line.lineNo}>
                {note.layout.columns.map((column) => (
                  <TableCell key={column.key}>
                    {columnValue(
                      column.key,
                      line,
                      (value) => `${formatDecimal(value)} ${unit(line.unit)}`,
                      unit,
                    )}
                  </TableCell>
                ))}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
      {note.notes ? <p className="text-sm whitespace-pre-line">{note.notes}</p> : null}
    </div>
  );
}
