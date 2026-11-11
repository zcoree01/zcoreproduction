import { getFormatter, getTranslations } from "next-intl/server";
import { ModuleDisabled } from "@/components/shared/module-disabled";
import { PageHeader } from "@/components/shared/page-header";
import { PageSuspense } from "@/components/shared/page-suspense";
import { PermissionDenied } from "@/components/shared/permission-denied";
import { getMemberAccess } from "@/lib/auth/access";
import { requireMember } from "@/lib/auth/session";
import {
  listStockCounts,
  listStockItemOptions,
  listStockLocations,
} from "@/modules/inventory/queries";
import { CountList } from "./count-list";
import { canMoveStockFreely } from "@/modules/platform/lock-rules";

export default function CountsPage() {
  return (
    <PageSuspense>
      <CountsContent />
    </PageSuspense>
  );
}

async function CountsContent() {
  const member = await requireMember();
  const organizationId = member.organization.id;
  const [t, format, access] = await Promise.all([
    getTranslations("inventory"),
    getFormatter(),
    getMemberAccess(member),
  ]);
  if (!access.modules.has("inventory")) return <ModuleDisabled />;
  if (!access.permissions.has("inventory.read")) {
    return <PermissionDenied description={t("deniedDescription")} />;
  }

  const canMove = canMoveStockFreely(access);
  const [counts, locations, items] = await Promise.all([
    listStockCounts(organizationId),
    canMove ? listStockLocations(organizationId) : Promise.resolve([]),
    canMove ? listStockItemOptions(organizationId) : Promise.resolve([]),
  ]);

  return (
    <>
      <PageHeader title={t("counts.title")} description={t("counts.description")} />
      <CountList
        counts={counts.map((c) => ({
          ...c,
          createdLabel: format.dateTime(new Date(c.createdAt), {
            dateStyle: "short",
            timeStyle: "short",
          }),
        }))}
        locations={locations.filter((l) => !l.archived)}
        items={items}
        canOpen={canMove}
        detailBase="/inventory/counts"
      />
    </>
  );
}
