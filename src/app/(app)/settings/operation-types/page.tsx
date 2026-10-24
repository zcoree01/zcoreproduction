import { getTranslations } from "next-intl/server";
import { ModuleDisabled } from "@/components/shared/module-disabled";
import { PageHeader } from "@/components/shared/page-header";
import { PageSuspense } from "@/components/shared/page-suspense";
import { PermissionDenied } from "@/components/shared/permission-denied";
import { getMemberAccess } from "@/lib/auth/access";
import { requireMember } from "@/lib/auth/session";
import { listOperationTypes } from "@/modules/products/queries";
import { OperationTypeList } from "./operation-type-list";

export default function OperationTypesPage() {
  return (
    <PageSuspense>
      <OperationTypesContent />
    </PageSuspense>
  );
}

async function OperationTypesContent() {
  const member = await requireMember();
  const [t, access] = await Promise.all([
    getTranslations("operationTypes"),
    getMemberAccess(member),
  ]);

  if (!access.modules.has("production")) return <ModuleDisabled />;
  if (!access.permissions.has("products.manage")) {
    return <PermissionDenied description={t("deniedDescription")} />;
  }

  const items = await listOperationTypes(member.organization.id, { includeArchived: true });
  return (
    <>
      <PageHeader title={t("title")} description={t("description")} />
      <OperationTypeList items={items} />
    </>
  );
}
