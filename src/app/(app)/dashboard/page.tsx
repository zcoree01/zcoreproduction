import { LayoutGridIcon } from "lucide-react";
import { getTranslations } from "next-intl/server";
import { EmptyState } from "@/components/shared/empty-state";
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
    <div className="flex flex-col gap-6">
      <h1 className="text-2xl font-semibold tracking-tight">
        {t("welcome", { name: member.fullName ?? member.username })}
      </h1>
      <EmptyState
        icon={<LayoutGridIcon />}
        title={t("noModulesTitle")}
        description={t("noModulesDescription")}
      />
    </div>
  );
}
