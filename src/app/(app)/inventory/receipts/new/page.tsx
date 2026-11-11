import { ArrowLeftIcon, PackagePlusIcon } from "lucide-react";
import { getTranslations } from "next-intl/server";
import Link from "next/link";
import { EmptyState } from "@/components/shared/empty-state";
import { ModuleDisabled } from "@/components/shared/module-disabled";
import { PageHeader } from "@/components/shared/page-header";
import { PageSuspense } from "@/components/shared/page-suspense";
import { PermissionDenied } from "@/components/shared/permission-denied";
import { buttonVariants } from "@/components/ui/button";
import { getMemberAccess } from "@/lib/auth/access";
import { requireMember } from "@/lib/auth/session";
import { zonedDate } from "@/lib/timezone";
import { cn } from "@/lib/utils";
import { listCustomerOptions } from "@/modules/customers/queries";
import {
  getInventorySettings,
  listStockItemOptions,
  listStockLocations,
} from "@/modules/inventory/queries";
import { ReceiptForm } from "./receipt-form";
import { canMoveStockFreely } from "@/modules/platform/lock-rules";

export default function NewReceiptPage() {
  return (
    <PageSuspense>
      <NewReceiptContent />
    </PageSuspense>
  );
}

async function NewReceiptContent() {
  const member = await requireMember();
  const organizationId = member.organization.id;
  const [t, access] = await Promise.all([getTranslations("inventory"), getMemberAccess(member)]);

  if (!access.modules.has("inventory")) return <ModuleDisabled />;
  if (!canMoveStockFreely(access)) {
    return <PermissionDenied description={t("receiptForm.deniedDescription")} />;
  }

  const [items, locations, customers, settings] = await Promise.all([
    listStockItemOptions(organizationId),
    listStockLocations(organizationId),
    access.permissions.has("customers.read")
      ? listCustomerOptions(organizationId)
      : Promise.resolve([]),
    getInventorySettings(organizationId),
  ]);

  const back = (
    <Link
      href="/inventory/receipts"
      className={cn(buttonVariants({ variant: "ghost", size: "sm" }), "w-fit")}
    >
      <ArrowLeftIcon />
      {t("receiptForm.back")}
    </Link>
  );

  if (items.length === 0) {
    return (
      <>
        {back}
        <EmptyState
          icon={<PackagePlusIcon />}
          title={t("receiptForm.noItemsTitle")}
          description={t("receiptForm.noItemsDescription")}
          action={
            <Link href="/inventory" className={cn(buttonVariants({ variant: "outline" }))}>
              {t("detail.back")}
            </Link>
          }
        />
      </>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      {back}
      <PageHeader title={t("receiptForm.title")} description={t("receiptForm.description")} />
      <ReceiptForm
        items={items}
        locations={locations.filter((location) => !location.archived)}
        customers={customers}
        settings={settings}
        today={zonedDate(new Date(), member.organization.timezone)}
      />
    </div>
  );
}
