import { getFormatter, getTranslations } from "next-intl/server";
import { ModuleDisabled } from "@/components/shared/module-disabled";
import { PageHeader } from "@/components/shared/page-header";
import { PageSuspense } from "@/components/shared/page-suspense";
import { PermissionDenied } from "@/components/shared/permission-denied";
import { getMemberAccess } from "@/lib/auth/access";
import { requireMember } from "@/lib/auth/session";
import { listAdjustments } from "@/modules/inventory/queries";
import { AdjustmentList } from "./adjustment-list";

export default function AdjustmentsPage() {
  return (
    <PageSuspense>
      <AdjustmentsContent />
    </PageSuspense>
  );
}

async function AdjustmentsContent() {
  const member = await requireMember();
  const [t, format, access] = await Promise.all([
    getTranslations("inventory"),
    getFormatter(),
    getMemberAccess(member),
  ]);

  if (!access.modules.has("inventory")) return <ModuleDisabled />;
  if (!access.permissions.has("inventory.read")) {
    return <PermissionDenied description={t("deniedDescription")} />;
  }

  // Dates are formatted here: server and browser ICU data differ (hydration).
  const adjustments = (await listAdjustments(member.organization.id)).map((doc) => ({
    ...doc,
    createdLabel: format.dateTime(new Date(doc.createdAt), {
      dateStyle: "short",
      timeStyle: "short",
    }),
  }));
  return (
    <>
      <PageHeader title={t("adjustments.title")} description={t("adjustments.description")} />
      <AdjustmentList
        adjustments={adjustments}
        canApprove={access.permissions.has("inventory.adjust.approve")}
      />
    </>
  );
}
