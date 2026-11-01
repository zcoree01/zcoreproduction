import { PlusIcon, TruckIcon } from "lucide-react";
import { getFormatter, getTranslations } from "next-intl/server";
import Link from "next/link";
import { EmptyState } from "@/components/shared/empty-state";
import { ModuleDisabled } from "@/components/shared/module-disabled";
import { PageHeader } from "@/components/shared/page-header";
import { PageSuspense } from "@/components/shared/page-suspense";
import { PermissionDenied } from "@/components/shared/permission-denied";
import { Badge } from "@/components/ui/badge";
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
import { cn } from "@/lib/utils";
import { listDeliveryNotes } from "@/modules/finished-goods/queries";

export default function DeliveryNotesPage() {
  return (
    <PageSuspense>
      <DeliveryNotesContent />
    </PageSuspense>
  );
}

async function DeliveryNotesContent() {
  const member = await requireMember();
  const [t, format, access] = await Promise.all([
    getTranslations("finishedGoods"),
    getFormatter(),
    getMemberAccess(member),
  ]);
  if (!access.modules.has("inventory")) return <ModuleDisabled />;
  if (!access.permissions.has("finished_goods.read")) {
    return <PermissionDenied description={t("deniedDescription")} />;
  }
  const notes = await listDeliveryNotes(member.organization.id);
  const newButton = access.permissions.has("finished_goods.manage") ? (
    <Link href="/inventory/delivery-notes/new" className={cn(buttonVariants())}>
      <PlusIcon />
      {t("notes.new")}
    </Link>
  ) : null;

  return (
    <>
      <PageHeader
        title={t("notes.title")}
        description={t("notes.description")}
        actions={newButton}
      />
      {notes.length === 0 ? (
        <EmptyState
          icon={<TruckIcon />}
          title={t("notes.emptyTitle")}
          description={t("notes.emptyDescription")}
        />
      ) : (
        <div className="overflow-x-auto rounded-lg border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t("notes.columns.number")}</TableHead>
                <TableHead>{t("notes.columns.customer")}</TableHead>
                <TableHead>{t("notes.columns.date")}</TableHead>
                <TableHead className="text-right">{t("notes.columns.lines")}</TableHead>
                <TableHead>{t("notes.columns.status")}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {notes.map((note) => (
                <TableRow key={note.id}>
                  <TableCell className="font-mono font-medium">
                    <Link href={`/inventory/delivery-notes/${note.id}`} className="hover:underline">
                      {note.number}
                    </Link>
                  </TableCell>
                  <TableCell>{note.customer}</TableCell>
                  <TableCell>
                    {format.dateTime(new Date(`${note.issuedOn}T12:00:00Z`), {
                      dateStyle: "medium",
                      timeZone: "UTC",
                    })}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">{note.lines}</TableCell>
                  <TableCell>
                    <Badge variant={note.status === "issued" ? "outline" : "destructive"}>
                      {t(`notes.status.${note.status}`)}
                    </Badge>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </>
  );
}
