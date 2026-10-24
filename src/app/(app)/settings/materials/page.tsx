import { getTranslations } from "next-intl/server";
import { ModuleDisabled } from "@/components/shared/module-disabled";
import { PageHeader } from "@/components/shared/page-header";
import { PageSuspense } from "@/components/shared/page-suspense";
import { PermissionDenied } from "@/components/shared/permission-denied";
import { getMemberAccess } from "@/lib/auth/access";
import { requireMember } from "@/lib/auth/session";
import { listMaterialGroups } from "@/modules/materials/queries";
import { MaterialList } from "./material-list";

export default function MaterialsPage() {
  return (
    <PageSuspense>
      <MaterialsContent />
    </PageSuspense>
  );
}

async function MaterialsContent() {
  const member = await requireMember();
  const [t, access] = await Promise.all([getTranslations("materials"), getMemberAccess(member)]);

  if (!access.modules.has("production")) return <ModuleDisabled />;
  if (!access.permissions.has("products.manage")) {
    return <PermissionDenied description={t("deniedDescription")} />;
  }

  const groups = await listMaterialGroups(member.organization.id);
  return (
    <>
      <PageHeader title={t("title")} description={t("description")} />
      <MaterialList groups={groups} />
    </>
  );
}
