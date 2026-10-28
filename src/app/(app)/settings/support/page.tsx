import { ShieldCheckIcon } from "lucide-react";
import { getTranslations } from "next-intl/server";
import { EmptyState } from "@/components/shared/empty-state";
import { PageHeader } from "@/components/shared/page-header";
import { PageSuspense } from "@/components/shared/page-suspense";
import { PermissionDenied } from "@/components/shared/permission-denied";
import { getMemberAccess } from "@/lib/auth/access";
import { requireMember } from "@/lib/auth/session";
import { listSupportRequests } from "@/modules/support/queries";
import { SupportRequests } from "./support-requests";

export default function SupportSettingsPage() {
  return (
    <PageSuspense>
      <SupportSettingsContent />
    </PageSuspense>
  );
}

/** Zcore support access: approve for a limited time, reject, or end it. */
async function SupportSettingsContent() {
  const member = await requireMember();
  const [t, access] = await Promise.all([getTranslations("support"), getMemberAccess(member)]);
  // The Zcore organization itself has no company data or support access (D-028).
  if (access.modules.has("platform")) {
    return <PermissionDenied description={t("notForPlatform")} />;
  }
  if (!access.permissions.has("support.approve")) {
    return <PermissionDenied description={t("deniedDescription")} />;
  }
  const requests = await listSupportRequests(member.organization.id);
  return (
    <>
      <PageHeader title={t("title")} description={t("description")} />
      {requests.length === 0 ? (
        <EmptyState
          icon={<ShieldCheckIcon />}
          title={t("emptyTitle")}
          description={t("emptyDescription")}
        />
      ) : (
        <div className="max-w-3xl">
          <SupportRequests requests={requests} />
        </div>
      )}
    </>
  );
}
