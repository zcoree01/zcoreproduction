import { LayoutGridIcon } from "lucide-react";
import { getTranslations } from "next-intl/server";
import { EmptyState } from "@/components/shared/empty-state";
import { PageHeader } from "@/components/shared/page-header";
import { PageSuspense } from "@/components/shared/page-suspense";
import { requireMember } from "@/lib/auth/session";

export default function DashboardPage() {
  return (
    <PageSuspense>
      <DashboardContent />
    </PageSuspense>
  );
}

async function DashboardContent() {
  const member = await requireMember();
  const t = await getTranslations("dashboard");

  return (
    <>
      <PageHeader
        title={t("welcome", { name: member.fullName ?? member.username })}
        description={member.organization.name}
      />
      <EmptyState
        icon={<LayoutGridIcon />}
        title={t("noModulesTitle")}
        description={t("noModulesDescription")}
      />
    </>
  );
}
