import { InboxIcon } from "lucide-react";
import { getTranslations } from "next-intl/server";
import { ChangeRequestList } from "@/components/shared/company/change-request-list";
import { EmptyState } from "@/components/shared/empty-state";
import { ModuleDisabled } from "@/components/shared/module-disabled";
import { PageHeader } from "@/components/shared/page-header";
import { PageSuspense } from "@/components/shared/page-suspense";
import { PermissionDenied } from "@/components/shared/permission-denied";
import { getMemberAccess } from "@/lib/auth/access";
import { requireMember } from "@/lib/auth/session";
import { listChangeRequestsToDecide } from "@/modules/companies/queries";

export default function PlatformRequestsPage() {
  return (
    <PageSuspense>
      <PlatformRequestsContent />
    </PageSuspense>
  );
}

/** Claims of directory entries and proposals for entries without an owner. */
async function PlatformRequestsContent() {
  const member = await requireMember();
  const [t, access] = await Promise.all([getTranslations("platform"), getMemberAccess(member)]);
  if (!access.modules.has("platform")) return <ModuleDisabled />;
  if (!access.permissions.has("platform.manage")) {
    return <PermissionDenied description={t("deniedDescription")} />;
  }

  const requests = await listChangeRequestsToDecide(member.organization.id);

  return (
    <>
      <PageHeader title={t("requestsTitle")} description={t("requestsDescription")} />
      {requests.length === 0 ? (
        <EmptyState
          icon={<InboxIcon />}
          title={t("requestsEmptyTitle")}
          description={t("requestsEmptyDescription")}
        />
      ) : (
        <div className="max-w-3xl">
          <ChangeRequestList requests={requests} />
        </div>
      )}
    </>
  );
}
