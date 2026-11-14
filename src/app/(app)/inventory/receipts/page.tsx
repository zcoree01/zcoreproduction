import { PlusIcon, ReceiptIcon } from "lucide-react";
import { getTranslations } from "next-intl/server";
import { getOrgFormatter } from "@/i18n/org-formatter";
import Link from "next/link";
import { EmptyState } from "@/components/shared/empty-state";
import { ModuleDisabled } from "@/components/shared/module-disabled";
import { PageHeader } from "@/components/shared/page-header";
import { PageSuspense } from "@/components/shared/page-suspense";
import { PermissionDenied } from "@/components/shared/permission-denied";
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
import { divideDecimal, formatDecimal } from "@/lib/decimal";
import { cn } from "@/lib/utils";
import { listReceipts } from "@/modules/inventory/queries";
import { canMoveStockFreely } from "@/modules/platform/lock-rules";

const LIMIT = 50;

export default function ReceiptsPage() {
  return (
    <PageSuspense>
      <ReceiptsContent />
    </PageSuspense>
  );
}

async function ReceiptsContent() {
  const member = await requireMember();
  const [t, format, access] = await Promise.all([
    getTranslations("inventory"),
    getOrgFormatter(member.organization.timezone),
    getMemberAccess(member),
  ]);

  if (!access.modules.has("inventory")) return <ModuleDisabled />;
  if (!access.permissions.has("inventory.read")) {
    return <PermissionDenied description={t("deniedDescription")} />;
  }

  const receipts = await listReceipts(member.organization.id);
  const newButton = canMoveStockFreely(access) ? (
    <Link href="/inventory/receipts/new" className={cn(buttonVariants())}>
      <PlusIcon />
      {t("receipts.new")}
    </Link>
  ) : null;

  return (
    <>
      <PageHeader
        title={t("receipts.title")}
        description={t("receipts.description")}
        actions={newButton}
      />
      {receipts.length === 0 ? (
        <EmptyState
          icon={<ReceiptIcon />}
          title={t("receipts.emptyTitle")}
          description={t("receipts.emptyDescription")}
          action={newButton}
        />
      ) : (
        <div className="flex flex-col gap-2">
          <div className="overflow-x-auto rounded-lg border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t("receipts.columns.number")}</TableHead>
                  <TableHead>{t("receipts.columns.date")}</TableHead>
                  <TableHead>{t("receipts.columns.supplier")}</TableHead>
                  <TableHead>{t("receipts.columns.deliveryNote")}</TableHead>
                  <TableHead className="text-right">{t("receipts.columns.lines")}</TableHead>
                  <TableHead className="text-right">{t("receipts.columns.value")}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {receipts.map((receipt) => (
                  <TableRow key={receipt.id}>
                    <TableCell className="font-medium">{receipt.number}</TableCell>
                    <TableCell>
                      {format.dateTime(new Date(`${receipt.documentDate}T12:00:00Z`), {
                        dateStyle: "medium",
                      })}
                    </TableCell>
                    <TableCell>{receipt.supplier ?? t("unknown")}</TableCell>
                    <TableCell>{receipt.deliveryNote ?? t("unknown")}</TableCell>
                    <TableCell className="text-right tabular-nums">{receipt.lines}</TableCell>
                    <TableCell className="text-right tabular-nums">
                      {t("money", { value: formatDecimal(divideDecimal(receipt.value, "1", 2)) })}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
          {receipts.length >= LIMIT ? (
            <p className="text-sm text-muted-foreground">{t("receipts.limit")}</p>
          ) : null}
        </div>
      )}
    </>
  );
}
