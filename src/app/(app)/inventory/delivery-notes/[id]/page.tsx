import { ArrowLeftIcon, PrinterIcon } from "lucide-react";
import { getTranslations } from "next-intl/server";
import { getOrgFormatter } from "@/i18n/org-formatter";
import Link from "next/link";
import { z } from "zod";
import { EmptyState } from "@/components/shared/empty-state";
import { ModuleDisabled } from "@/components/shared/module-disabled";
import { PageHeader } from "@/components/shared/page-header";
import { PageSuspense } from "@/components/shared/page-suspense";
import { PermissionDenied } from "@/components/shared/permission-denied";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { buttonVariants } from "@/components/ui/button";
import { getMemberAccess } from "@/lib/auth/access";
import { requireMember } from "@/lib/auth/session";
import { formatDay } from "@/lib/format";
import { cn } from "@/lib/utils";
import { getDeliveryNote, getDeliverySettings, logoUrl } from "@/modules/finished-goods/queries";
import { deliveryPdfFileName } from "@/modules/finished-goods/rules";
import { DeliveryNotePaper } from "../delivery-note-paper";
import { CancelNoteButton } from "./cancel-note-button";
import { SendNoteMenu } from "./send-note-menu";

export default function DeliveryNotePage({ params }: PageProps<"/inventory/delivery-notes/[id]">) {
  return (
    <PageSuspense>
      <DeliveryNoteContent params={params} />
    </PageSuspense>
  );
}

async function DeliveryNoteContent({ params }: { params: Promise<{ id: string }> }) {
  const member = await requireMember();
  const [t, format, access] = await Promise.all([
    getTranslations("finishedGoods"),
    getOrgFormatter(member.organization.timezone),
    getMemberAccess(member),
  ]);
  if (!access.modules.has("finished_goods")) return <ModuleDisabled />;
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
  const logo = note.layout.show_logo
    ? await logoUrl((await getDeliverySettings(member.organization.id)).logoPath)
    : null;

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
            {note.status === "issued" ? (
              <SendNoteMenu
                noteId={note.id}
                fileName={deliveryPdfFileName(note.layout.title, note.number)}
                draft={{
                  to: note.customer.email,
                  subject: t("send.subject", { title: note.layout.title, number: note.number }),
                  body: t("send.body", {
                    title: note.layout.title,
                    number: note.number,
                    date: formatDay(note.issuedOn),
                    organization: member.organization.name,
                  }),
                }}
              />
            ) : null}
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
      <div className="overflow-x-auto rounded-lg border bg-muted p-3">
        <DeliveryNotePaper
          className="mx-auto aspect-[210/297] max-w-[210mm] min-w-[560px] shadow-md"
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
      </div>
    </div>
  );
}
